import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GitHubClient, GitHubError, parsePrRef, parseRepo, prNumberFromSubject, repoFromRemote, resolveToken } from '../src/github.js';
import { classifyPullRequest } from '../src/index.js';
import { fakeGitHub, ghCommit, type FakeGitHub } from './github-server.js';

const REPO = { owner: 'octo', repo: 'demo' };

describe('references', () => {
  it('parses repositories and git remotes', () => {
    expect(parseRepo('octo/demo')).toEqual(REPO);
    expect(parseRepo('octo/demo.git')).toEqual(REPO);
    expect(parseRepo('octo')).toBeUndefined();
    expect(parseRepo('../etc/passwd')).toBeUndefined();
    expect(repoFromRemote('https://github.com/octo/demo.git')).toEqual(REPO);
    expect(repoFromRemote('git@github.com:octo/demo.git')).toEqual(REPO);
    expect(repoFromRemote('ssh://git@github.com/octo/demo')).toEqual(REPO);
    expect(repoFromRemote('https://gitlab.com/octo/demo.git')).toBeUndefined();
    expect(repoFromRemote(undefined)).toBeUndefined();
  });

  it('accepts a GitHub Enterprise host from GITHUB_SERVER_URL', () => {
    const before = process.env['GITHUB_SERVER_URL'];
    process.env['GITHUB_SERVER_URL'] = 'https://git.example.com';
    try {
      expect(repoFromRemote('https://git.example.com/octo/demo')).toEqual(REPO);
      expect(parsePrRef('https://git.example.com/octo/demo/pull/3')).toEqual({ repo: REPO, number: 3 });
    } finally {
      if (before === undefined) delete process.env['GITHUB_SERVER_URL'];
      else process.env['GITHUB_SERVER_URL'] = before;
    }
  });

  it('parses pull request references', () => {
    expect(parsePrRef('https://github.com/octo/demo/pull/12')).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('https://github.com/octo/demo/pull/12/files')).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('octo/demo#12')).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('octo/demo/pull/12')).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('#12', REPO)).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('12', REPO)).toEqual({ repo: REPO, number: 12 });
    expect(parsePrRef('12')).toBeUndefined();
    expect(parsePrRef('0', REPO)).toBeUndefined();
    expect(parsePrRef('https://evil.example/octo/demo/pull/1')).toBeUndefined();
  });

  it('finds the pull request number in commit subjects', () => {
    expect(prNumberFromSubject('Fix login (#123)')).toBe(123);
    expect(prNumberFromSubject('Merge pull request #45 from octo/branch')).toBe(45);
    expect(prNumberFromSubject('Fix #123 in the parser')).toBeUndefined();
    expect(prNumberFromSubject('Plain')).toBeUndefined();
  });

  it('reads the token from the environment', () => {
    const saved = { a: process.env['GITHUB_TOKEN'], b: process.env['GH_TOKEN'], c: process.env['WHOWROTE_NO_GH'] };
    try {
      process.env['WHOWROTE_NO_GH'] = '1';
      delete process.env['GITHUB_TOKEN'];
      process.env['GH_TOKEN'] = 'gh-token';
      expect(resolveToken()).toBe('gh-token');
      process.env['GITHUB_TOKEN'] = 'first';
      expect(resolveToken()).toBe('first');
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];
      expect(resolveToken()).toBeUndefined();
    } finally {
      for (const [k, v] of [['GITHUB_TOKEN', saved.a], ['GH_TOKEN', saved.b], ['WHOWROTE_NO_GH', saved.c]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('GitHubClient', () => {
  let gh: FakeGitHub;
  const many = Array.from({ length: 150 }, (_, i) => ghCommit('Jane', 'jane@example.com', `part ${i}`, 'jane'));
  beforeAll(async () => {
    gh = await fakeGitHub({
      pulls: [
        {
          number: 7,
          title: 'Add a theme switcher',
          body: 'Adds it.',
          user: { login: 'Copilot', type: 'Bot' },
          head: { ref: 'copilot/add-theme-switcher' },
          commits: [ghCommit('Copilot', '198982749+Copilot@users.noreply.github.com', 'Add theme', 'Copilot', 'Bot')],
          files: ['src/theme.ts', '.github/copilot-instructions.md'],
        },
        { number: 8, title: 'Big', body: null, user: { login: 'jane', type: 'User' }, head: { ref: 'big' }, commits: many },
        { number: 9, title: 'Bump', body: 'Bumps x.', user: { login: 'dependabot[bot]', type: 'Bot' }, head: { ref: 'dependabot/npm/x' } },
      ],
      commitPulls: { abc123: [7] },
      rateLimited: ['/repos/octo/limited'],
    });
  });
  afterAll(() => gh.close());
  afterEach(() => {
    gh.requests.length = 0;
  });

  it('reads a pull request with its commits and files', async () => {
    const client = new GitHubClient({ apiUrl: gh.url, token: 't0ken' });
    const pr = await client.pullRequest(REPO, 7, { files: true });
    expect(pr).toMatchObject({ number: 7, title: 'Add a theme switcher', branch: 'copilot/add-theme-switcher', author: { login: 'Copilot', type: 'Bot' }, files: ['src/theme.ts', '.github/copilot-instructions.md'] });
    expect(pr.commits).toHaveLength(1);
    expect(gh.requests.every((r) => r.auth === 'Bearer t0ken')).toBe(true);
    const r = classifyPullRequest(pr);
    expect(r.verdict).toBe('ai-agent');
    expect(r.hints).toEqual([expect.objectContaining({ hint: 'agent-config', tool: 'github-copilot' })]);
  });

  it('follows pagination, and sends no token when there is none', async () => {
    const pr = await new GitHubClient({ apiUrl: gh.url }).pullRequest(REPO, 8);
    expect(pr.commits).toHaveLength(150);
    expect(gh.requests.map((r) => r.path)).toEqual(['/repos/octo/demo/pulls/8', '/repos/octo/demo/pulls/8/commits?per_page=100&page=1', '/repos/octo/demo/pulls/8/commits?per_page=100&page=2']);
    expect(gh.requests.every((r) => r.auth === undefined)).toBe(true);
  });

  it('explains 404s and rate limits', async () => {
    const anon = new GitHubClient({ apiUrl: gh.url });
    await expect(anon.pullRequest(REPO, 404)).rejects.toThrow(/not found on GitHub \(private repositories need GITHUB_TOKEN/);
    await expect(anon.pullRequest({ owner: 'octo', repo: 'limited' }, 1)).rejects.toThrow(/rate limit reached; set GITHUB_TOKEN/);
    await expect(new GitHubClient({ apiUrl: 'http://127.0.0.1:1' }).pullRequest(REPO, 1)).rejects.toThrow(GitHubError);
  });

  it('finds the pull requests of a commit', async () => {
    const prs = await new GitHubClient({ apiUrl: gh.url }).pullRequestsForCommit(REPO, 'abc123');
    expect(prs).toEqual([{ number: 7, context: { author: { login: 'Copilot', type: 'Bot' }, title: 'Add a theme switcher', body: 'Adds it.', branch: 'copilot/add-theme-switcher' } }]);
  });

  it('reads many pull requests through GraphQL, skipping numbers that are not pull requests', async () => {
    const client = new GitHubClient({ apiUrl: gh.url, graphqlUrl: `${gh.url}/graphql`, token: 't' });
    const done: number[] = [];
    const prs = await client.pullRequests(REPO, [7, 9, 9, 1234], (n) => done.push(n));
    expect([...prs.keys()].sort()).toEqual([7, 9]);
    // GraphQL leaves "[bot]" off app logins; whowrote puts it back for matching.
    expect(prs.get(9)?.author).toEqual({ login: 'dependabot', type: 'Bot', name: 'dependabot[bot]' });
    expect(prs.get(7)).toMatchObject({ branch: 'copilot/add-theme-switcher', author: { login: 'Copilot', type: 'Bot' } });
    expect(done).toEqual([3]);
  });

  it('batches GraphQL queries', async () => {
    const client = new GitHubClient({ apiUrl: gh.url, graphqlUrl: `${gh.url}/graphql`, token: 't' });
    await client.pullRequests(REPO, Array.from({ length: 120 }, (_, i) => i + 1));
    expect(gh.requests.filter((r) => r.path === '/graphql')).toHaveLength(3);
  });

  it('needs a token for GraphQL', async () => {
    await expect(new GitHubClient({ apiUrl: gh.url }).pullRequests(REPO, [7])).rejects.toThrow(/needs a token/);
  });
});
