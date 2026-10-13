import { spawn } from 'node:child_process';
import { globToPathspec } from './glob.js';

/** A commit as read from `git log`. */
export interface GitCommit {
  sha: string;
  /** Committer date, ISO 8601. */
  date: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  message: string;
  /** Git notes from the notes ref that was read, if any. */
  notes?: string;
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
  /** Also read git notes from these refs, e.g. `refs/notes/ai` (git-ai). Missing refs are fine. */
  notes?: readonly string[] | undefined;
}

// Records end with NUL (-z), which cannot occur in commit messages; fields are split on US, and the notes
// are separated from the message by GS.
const NUL = '\0';
const US = '\x1f';
const GS = '\x1d';
const FIELDS = `%H${US}%cI${US}%an${US}%ae${US}%cn${US}%ce${US}`;

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

const GIT_ENV = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...extra });
// Commands that read trees must not download them one by one from a partial clone's remote (very slow);
// with this they fail instead, and whowrote leaves out what needed them.
const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: '1' };

/** Options that limit which commits are walked, shared by every `git log` whowrote runs. */
function rangeArgs(o: LogOptions): string[] {
  const args: string[] = [];
  if (o.noWalk) args.push('--no-walk=unsorted');
  else if (!o.merges) args.push('--no-merges');
  if (o.firstParent) args.push('--first-parent');
  if (o.since) args.push(`--since=${o.since}`);
  if (o.until) args.push(`--until=${o.until}`);
  if (o.maxCount !== undefined) args.push(`--max-count=${o.maxCount}`);
  // Everything after this is a revision, even if it starts with "-".
  args.push('--end-of-options', ...(o.revisions?.length ? o.revisions : ['HEAD']));
  return args;
}

export function gitLogArgs(o: LogOptions): string[] {
  const notes = o.notes ?? [];
  const format = notes.length > 0 ? `--format=${FIELDS}%N${GS}%B` : `--format=${FIELDS}%B`;
  const args = ['-c', 'log.showSignature=false', '-c', 'core.quotePath=false', 'log', '-z', format, '--no-color', '--encoding=UTF-8'];
  args.push(...(notes.length > 0 ? notes.map((r) => `--notes=${r}`) : ['--no-notes']));
  args.push(...rangeArgs(o));
  args.push('--', ...(o.paths ?? []));
  return args;
}

/** Parses one `git log -z` record. */
export function parseRecord(rec: string, withNotes = false): GitCommit | undefined {
  const parts = rec.split(US);
  if (parts.length < 7) return undefined;
  const [rawSha, date, an, ae, cn, ce] = parts as [string, string, string, string, string, string];
  const sha = rawSha.replace(/^\n+/, '');
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return undefined;
  let rest = parts.slice(6).join(US);
  let notes: string | undefined;
  if (withNotes) {
    const gs = rest.indexOf(GS);
    if (gs !== -1) {
      notes = rest.slice(0, gs).trim();
      rest = rest.slice(gs + 1);
    }
  }
  const commit: GitCommit = { sha, date, author: { name: an, email: ae }, committer: { name: cn, email: ce }, message: rest.replace(/\n+$/, '') };
  if (notes) commit.notes = notes;
  return commit;
}

/** Runs git and streams its stdout split on NUL. Throws GitError on failure. */
async function* gitRecords(args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv = {}): AsyncGenerator<string> {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV(env) });
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
        yield buf.slice(from, end);
        from = end + 1;
        end = buf.indexOf(NUL, from);
      }
      buf = buf.slice(from);
    }
    if (buf.trim() !== '') yield buf;
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
    throw new GitError(detail.replace(/^(?:fatal|error):\s*/, '') || `git exited with code ${code}`, code);
  }
}

/**
 * Streams commits from `git log` without a shell. Memory stays flat on large histories because records
 * are parsed as they arrive.
 */
export async function* readCommits(o: LogOptions = {}): AsyncGenerator<GitCommit> {
  const withNotes = (o.notes?.length ?? 0) > 0;
  for await (const rec of gitRecords(gitLogArgs(o), o.cwd)) {
    const c = parseRecord(rec, withNotes);
    if (c) yield c;
  }
}

/** The files at a revision (`git ls-tree -r`). */
export async function listFiles(cwd: string | undefined, revision: string): Promise<string[]> {
  const out: string[] = [];
  for await (const path of gitRecords(['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', '-z', '--end-of-options', revision], cwd, NO_LAZY_FETCH)) {
    if (path) out.push(path);
    if (out.length >= 500_000) break;
  }
  return out;
}

/** For each commit in the range that changed a file matching one of the globs, the matching files. */
export async function changedFilesMatching(o: LogOptions, globs: readonly string[]): Promise<Map<string, string[]>> {
  const args = ['-c', 'core.quotePath=false', 'log', '-z', '--format=%x01%H', '--name-only', '--no-renames', '--no-color', '--no-notes', ...rangeArgs(o), '--'];
  args.push(...globs.map(globToPathspec));
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for await (const rec of gitRecords(args, o.cwd, NO_LAZY_FETCH)) {
    const item = rec.replace(/^\n+/, '');
    if (item.startsWith('\x01')) {
      current = [];
      out.set(item.slice(1), current);
    } else if (item && current) {
      current.push(item);
    }
  }
  return out;
}

/** The files a single commit changed. */
export async function changedFiles(cwd: string | undefined, sha: string): Promise<string[]> {
  const out: string[] = [];
  for await (const path of gitRecords(['-c', 'core.quotePath=false', 'diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', '-m', '--end-of-options', sha], cwd, NO_LAZY_FETCH)) {
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Output of a small git command, trimmed, or undefined if it fails. */
export async function gitOutput(cwd: string | undefined, args: string[]): Promise<string | undefined> {
  let out = '';
  try {
    for await (const rec of gitRecords(args, cwd)) out += rec;
  } catch {
    return undefined;
  }
  return out.trim();
}
