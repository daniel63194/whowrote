import { spawn } from 'node:child_process';

/** A commit as read from `git log`. */
export interface GitCommit {
  sha: string;
  /** Committer date, ISO 8601. */
  date: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  message: string;
}

export interface LogOptions {
  /** Repository directory (default: the current directory). */
  cwd?: string | undefined;
  /** Revisions or ranges, e.g. `main`, `v1.0..HEAD`. Default: `HEAD`. */
  revisions?: readonly string[] | undefined;
  /** Limit to commits touching these paths. */
  paths?: readonly string[] | undefined;
  since?: string | undefined;
  until?: string | undefined;
  maxCount?: number | undefined;
  /** Include merge commits (default: false). */
  merges?: boolean | undefined;
  /** Walk only the first parent of merges, like `git log --first-parent`. */
  firstParent?: boolean | undefined;
  /** Stop after one commit per revision instead of walking history (for `explain`). */
  noWalk?: boolean | undefined;
}

// Records end with NUL (-z), which cannot occur in commit messages; fields are split on US.
const NUL = '\0';
const US = '\x1f';
const FORMAT = `--format=%H${US}%cI${US}%an${US}%ae${US}%cn${US}%ce${US}%B`;

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function gitLogArgs(o: LogOptions): string[] {
  const args = ['-c', 'log.showSignature=false', '-c', 'core.quotePath=false', 'log', '-z', FORMAT, '--no-color', '--encoding=UTF-8'];
  if (o.noWalk) args.push('--no-walk=unsorted');
  else if (!o.merges) args.push('--no-merges');
  if (o.firstParent) args.push('--first-parent');
  if (o.since) args.push(`--since=${o.since}`);
  if (o.until) args.push(`--until=${o.until}`);
  if (o.maxCount !== undefined) args.push(`--max-count=${o.maxCount}`);
  // Everything after this is a revision, even if it starts with "-".
  args.push('--end-of-options', ...(o.revisions?.length ? o.revisions : ['HEAD']));
  args.push('--', ...(o.paths ?? []));
  return args;
}

/** Parses one `git log -z` record. */
export function parseRecord(rec: string): GitCommit | undefined {
  const parts = rec.split(US);
  if (parts.length < 7) return undefined;
  const [rawSha, date, an, ae, cn, ce] = parts as [string, string, string, string, string, string];
  const sha = rawSha.replace(/^\n+/, '');
  const message = parts.slice(6).join(US).replace(/\n+$/, '');
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return undefined;
  return { sha, date, author: { name: an, email: ae }, committer: { name: cn, email: ce }, message };
}

/**
 * Streams commits from `git log` without a shell. Memory stays flat on large histories because records
 * are parsed as they arrive.
 */
export async function* readCommits(o: LogOptions = {}): AsyncGenerator<GitCommit> {
  const child = spawn('git', gitLogArgs(o), {
    cwd: o.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    if (stderr.length < 10_000) stderr += d;
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  child.stdout.setEncoding('utf8');
  exit.catch(() => undefined); // awaited below; this only stops an early exit from being reported as unhandled
  let buf = '';
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      buf += chunk;
      let end = buf.indexOf(NUL);
      let from = 0;
      while (end !== -1) {
        const c = parseRecord(buf.slice(from, end));
        if (c) yield c;
        from = end + 1;
        end = buf.indexOf(NUL, from);
      }
      buf = buf.slice(from);
    }
    if (buf.trim() !== '') {
      const c = parseRecord(buf);
      if (c) yield c;
    }
  } finally {
    if (child.exitCode === null) child.kill();
  }

  let code: number | null;
  try {
    code = await exit;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new GitError(e.code === 'ENOENT' ? 'git was not found on PATH' : `could not run git: ${e.message}`, null);
  }
  if (code !== 0) {
    const detail = stderr.split('\n').find((l) => l.startsWith('fatal:') || l.startsWith('error:')) ?? stderr.trim().split('\n')[0] ?? '';
    throw new GitError(detail.replace(/^(?:fatal|error):\s*/, '') || `git log exited with code ${code}`, code);
  }
}
