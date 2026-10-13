// Reads pull requests from the GitHub API. Used by the CLI only; the library itself never goes online.
import { spawnSync } from 'node:child_process';
import type { GitHubCommit, Identity, PullRequestContext } from './types.js';

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

function hosts(): string[] {
  const out = ['github.com'];
  try {
    const server = process.env['GITHUB_SERVER_URL'];
    if (server) out.push(new URL(server).host.toLowerCase());
  } catch {
    // not a URL: ignore
  }
  return out;
}

/** `owner/repo` → `{ owner, repo }`. */
export function parseRepo(s: string): GitHubRepo | undefined {
  const m = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(s.trim());
  if (!m || !NAME.test(m[1]!) || !NAME.test(m[2]!)) return undefined;
  return { owner: m[1]!, repo: m[2]! };
}

/** The GitHub repository a git remote URL points to (https, ssh or scp-style), if it is one. */
export function repoFromRemote(url: string | undefined): GitHubRepo | undefined {
  if (!url) return undefined;
  const u = url.trim();
  const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(u);
  let host: string;
  let path: string;
  if (scp && !u.includes('://')) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    try {
      const parsed = new URL(u);
      host = parsed.host;
      path = parsed.pathname;
    } catch {
      return undefined;
    }
  }
  if (!hosts().includes(host.toLowerCase())) return undefined;
  return parseRepo(path.replace(/^\/+/, '').replace(/\/+$/, ''));
}

/**
 * A pull request reference: `https://github.com/o/r/pull/12`, `o/r#12`, `o/r/pull/12`, or `#12` / `12`
 * in the given repository.
 */
export function parsePrRef(ref: string, fallback?: GitHubRepo): { repo: GitHubRepo; number: number } | undefined {
  const s = ref.trim();
  const num = (n: string): number | undefined => {
    const v = Number(n);
    return Number.isSafeInteger(v) && v > 0 ? v : undefined;
  };
  let m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d{1,9})(?:[/?#].*)?$/.exec(s);
  if (m) {
    if (!hosts().includes(m[1]!.toLowerCase())) return undefined;
    const repo = parseRepo(`${m[2]}/${m[3]}`);
    const n = num(m[4]!);
    return repo && n ? { repo, number: n } : undefined;
  }
  m = /^([^/\s#]+\/[^/\s#]+?)(?:#|\/pull\/)(\d{1,9})$/.exec(s);
  if (m) {
    const repo = parseRepo(m[1]!);
    const n = num(m[2]!);
    return repo && n ? { repo, number: n } : undefined;
  }
  m = /^#?(\d{1,9})$/.exec(s);
  if (m && fallback) {
    const n = num(m[1]!);
    return n ? { repo: fallback, number: n } : undefined;
  }
  return undefined;
}

/** A token from GITHUB_TOKEN, GH_TOKEN or the GitHub CLI (`gh auth token`), if there is one. */
export function resolveToken(): string | undefined {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  if (process.env['WHOWROTE_NO_GH'] === '1') return undefined;
  try {
    const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const t = r.status === 0 ? r.stdout.trim() : '';
    return /^[\w.-]{20,}$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** A pull request as fetched from the REST API, ready for `classifyPullRequest`. */
export interface FetchedPullRequest {
  number: number;
  url: string;
  title: string;
  body: string | null;
  author: Identity | null;
  branch: string | null;
  commits: GitHubCommit[];
  files: string[];
}

interface RestPull {
  number: number;
  html_url?: string;
  title?: string | null;
  body?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
  head?: { ref?: string | null } | null;
}

interface GraphQLPull {
  number: number;
  title?: string | null;
  body?: string | null;
  headRefName?: string | null;
  author?: { __typename?: string; login?: string | null } | null;
}

/** GraphQL leaves `[bot]` off app logins ("dependabot"); REST keeps it ("dependabot[bot]"). */
function graphqlAuthor(a: GraphQLPull['author']): Identity | null {
  if (!a?.login) return null;
  const bot = a.__typename === 'Bot';
  const id: Identity = { login: a.login, type: bot ? 'Bot' : 'User' };
  if (bot && !a.login.endsWith('[bot]')) id.name = `${a.login}[bot]`;
  return id;
}

export interface ClientOptions {
  token?: string | undefined;
  apiUrl?: string | undefined;
  graphqlUrl?: string | undefined;
}

export class GitHubClient {
  readonly token: string | undefined;
  private readonly api: string;
  private readonly graphqlUrl: string;

  constructor(o: ClientOptions = {}) {
    this.token = o.token;
    const api = o.apiUrl ?? process.env['WHOWROTE_GITHUB_API'] ?? process.env['GITHUB_API_URL'] ?? 'https://api.github.com';
    this.api = api.replace(/\/+$/, '');
    this.graphqlUrl = o.graphqlUrl ?? (process.env['WHOWROTE_GITHUB_API'] ? `${this.api}/graphql` : (process.env['GITHUB_GRAPHQL_URL'] ?? `${this.api}/graphql`));
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'whowrote',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async request(url: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, { method: init.method ?? 'GET', headers: { ...this.headers(), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, ...(init.body ? { body: init.body } : {}), signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new GitHubError(`could not reach the GitHub API (${(err as Error).message})`);
    }
    if (res.ok) return (await res.json()) as unknown;
    const remaining = res.headers.get('x-ratelimit-remaining');
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.status === 429)) {
      throw new GitHubError(this.token ? 'GitHub API rate limit reached; try again later' : 'GitHub API rate limit reached; set GITHUB_TOKEN (or run gh auth login) for a higher limit', res.status);
    }
    if (res.status === 401) throw new GitHubError('GitHub rejected the token (check GITHUB_TOKEN or gh auth status)', 401);
    if (res.status === 404) throw new GitHubError(this.token ? 'not found on GitHub' : 'not found on GitHub (private repositories need GITHUB_TOKEN, or gh auth login)', 404);
    let detail = '';
    try {
      detail = String(((await res.json()) as { message?: unknown }).message ?? '');
    } catch {
      // no JSON body
    }
    throw new GitHubError(`GitHub API error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, res.status);
  }

  async rest<T>(path: string): Promise<T> {
    return (await this.request(`${this.api}${path}`)) as T;
  }

  private async restPages<T>(path: string, maxPages: number): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const items = await this.rest<T[]>(`${path}${sep}per_page=100&page=${page}`);
      if (!Array.isArray(items)) break;
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  /** A pull request with its commits (GitHub lists at most 250) and, optionally, its changed files. */
  async pullRequest(repo: GitHubRepo, number: number, options: { files?: boolean } = {}): Promise<FetchedPullRequest> {
    const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${number}`;
    const pr = await this.rest<RestPull>(base);
    const commits = await this.restPages<GitHubCommit>(`${base}/commits`, 3);
    const files = options.files ? (await this.restPages<{ filename?: string }>(`${base}/files`, 3)).flatMap((f) => (typeof f.filename === 'string' ? [f.filename] : [])) : [];
    return {
      number: pr.number,
      url: pr.html_url ?? '',
      title: pr.title ?? '',
      body: pr.body ?? null,
      author: pr.user?.login ? { login: pr.user.login, type: pr.user.type ?? null } : null,
      branch: pr.head?.ref ?? null,
      commits,
      files,
    };
  }

  /** Commits only, for a pull request whose commits aren't in the local clone. */
  async pullRequestCommits(repo: GitHubRepo, number: number): Promise<GitHubCommit[]> {
    return this.restPages<GitHubCommit>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${number}/commits`, 3);
  }

  /** The pull requests a commit belongs to (works without a token for public repositories). */
  async pullRequestsForCommit(repo: GitHubRepo, sha: string): Promise<{ number: number; context: PullRequestContext }[]> {
    const pulls = await this.rest<RestPull[]>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(sha)}/pulls`);
    return (Array.isArray(pulls) ? pulls : []).map((p) => ({
      number: p.number,
      context: { author: p.user?.login ? { login: p.user.login, type: p.user.type ?? null } : null, title: p.title ?? null, body: p.body ?? null, branch: p.head?.ref ?? null },
    }));
  }

  /**
   * Many pull requests at once, through GraphQL (which needs a token). Numbers that are issues, or don't
   * exist, are left out.
   */
  async pullRequests(repo: GitHubRepo, numbers: readonly number[], onProgress?: (done: number) => void): Promise<Map<number, PullRequestContext>> {
    if (!this.token) throw new GitHubError('reading many pull requests uses the GitHub GraphQL API, which needs a token: set GITHUB_TOKEN, or run gh auth login');
    const out = new Map<number, PullRequestContext>();
    const unique = [...new Set(numbers)].filter((n) => Number.isSafeInteger(n) && n > 0);
    const batches: number[][] = [];
    for (let i = 0; i < unique.length; i += 50) batches.push(unique.slice(i, i + 50));
    let done = 0;
    const run = async (batch: number[]): Promise<void> => {
      const fields = batch.map((n) => `p${n}: pullRequest(number: ${n}) { number title body headRefName author { __typename login } }`).join('\n');
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
      const res = (await this.request(this.graphqlUrl, { method: 'POST', body: JSON.stringify({ query, variables: { owner: repo.owner, name: repo.repo } }) })) as {
        data?: { repository?: Record<string, GraphQLPull | null> | null } | null;
        errors?: { type?: string; message?: string }[];
      };
      const nodes = res.data?.repository;
      if (!nodes) {
        const first = res.errors?.[0]?.message;
        throw new GitHubError(`GitHub GraphQL error${first ? `: ${first.slice(0, 200)}` : ''}`);
      }
      for (const node of Object.values(nodes)) {
        if (!node || typeof node.number !== 'number') continue;
        out.set(node.number, { author: graphqlAuthor(node.author), title: node.title ?? null, body: node.body ?? null, branch: node.headRefName ?? null });
      }
      done += batch.length;
      onProgress?.(done);
    };
    // A few requests at a time: fast enough, and polite to the API.
    let next = 0;
    const workers = Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) await run(batches[next++]!);
    });
    await Promise.all(workers);
    return out;
  }
}

/** The pull request number in a squash-merge subject ("Fix login (#123)") or a merge commit subject. */
export function prNumberFromSubject(subject: string): number | undefined {
  const m = /\(#(\d{1,9})\)\s*$/.exec(subject) ?? /^Merge pull request #(\d{1,9}) from /.exec(subject);
  return m ? Number(m[1]) : undefined;
}
