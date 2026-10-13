// CLI tests for attribution notes, agent setup, hints, declarations and the GitHub layer.
// The GitHub API is a local fake (test/github-server.ts); the CLI is pointed at it with WHOWROTE_GITHUB_API.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeGitHub, ghCommit, type FakeGitHub } from './github-server.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
let dir: string;
let repo: string;
let gh: FakeGitHub;
const shas: Record<string, string> = {};
const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(key: string, date: string, message: string, files: Record<string, string> = {}, author = 'Jane Doe <jane@example.com>'): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
    git(['add', path]);
  }
  const m = /^(.*) <(.*)>$/.exec(author)!;
  git(['commit', '--allow-empty', '-q', '-m', message], {
    GIT_AUTHOR_NAME: m[1]!, GIT_AUTHOR_EMAIL: m[2]!, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com', GIT_COMMITTER_DATE: date,
  });
  shas[key] = git(['rev-parse', 'HEAD']);
}

/** Runs the CLI without blocking, so the fake GitHub server in this process can answer it. */
function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: repo,
      env: {
        ...process.env, ...GIT_ENV, NO_COLOR: '1', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', GITHUB_EVENT_PATH: '',
        GITHUB_TOKEN: '', GH_TOKEN: '', WHOWROTE_NO_GH: '1', WHOWROTE_GITHUB_API: gh.url, ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const GIT_AI_NOTE = `src/app.ts
  1a2b3c4d5e6f7a8b 1-40
---
{"schema_version":"authorship/3.0.0","prompts":{"1a2b3c4d5e6f7a8b":{"agent_id":{"tool":"cursor","id":"s","model":"gpt-4o"}}}}`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'whowrote-signals-'));
  GIT_ENV['GIT_CONFIG_GLOBAL'] = join(dir, 'gitconfig');
  writeFileSync(GIT_ENV['GIT_CONFIG_GLOBAL'], '');
  repo = join(dir, 'app');
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { env: { ...process.env, ...GIT_ENV } });
  git(['remote', 'add', 'origin', 'https://github.com/octo/app.git']);
  commit('plain', '2026-07-01T10:00:00Z', 'Initial commit', { 'README.md': '# app\n' });
  commit('noted', '2026-07-02T10:00:00Z', 'Add the app', { 'src/app.ts': 'export {}\n' });
  git(['notes', '--ref=ai', 'add', '-m', GIT_AI_NOTE, shas.noted!]);
  commit('claudemd', '2026-08-01T10:00:00Z', 'Add agent instructions', { 'CLAUDE.md': '# rules\n', 'AGENTS.md': '# rules\n' });
  commit('declared', '2026-08-02T10:00:00Z', 'Tune the parser\n\nAI-assisted: no');
  commit('squashed', '2026-09-01T10:00:00Z', 'Add a theme switcher (#7)', { 'src/theme.ts': 'export {}\n' });
  commit('layout', '2026-09-02T10:00:00Z', 'Guard the lookup (#8)');
  gh = await fakeGitHub({
    pulls: [
      { number: 7, title: 'Add a theme switcher', body: 'Adds it.', user: { login: 'Copilot', type: 'Bot' }, head: { ref: 'copilot/add-theme-switcher' }, commits: [ghCommit('Copilot', '198982749+Copilot@users.noreply.github.com', 'Add theme', 'Copilot', 'Bot')], files: ['src/theme.ts'] },
      { number: 8, title: 'Guard the lookup', body: '## Summary\n- Guard it\n\n## Test plan\n- [x] npm test', user: { login: 'jane', type: 'User' }, head: { ref: 'fix-lookup' }, commits: [], files: ['CLAUDE.md'] },
      { number: 9, title: 'Add docs', body: 'Docs.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', user: { login: 'jane', type: 'User' }, head: { ref: 'docs' }, commits: [ghCommit('Jane', 'jane@example.com', 'Docs\n\nCo-Authored-By: Claude <noreply@anthropic.com>', 'jane')] },
    ],
    commitPulls: { [shas.squashed!]: [7] },
  });
});

afterAll(async () => {
  await gh.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('notes, setup, hints and declarations', () => {
  it('reads git-ai notes, shows the agent setup and declared commits', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/No AI disclosed\s+4\s/);
    expect(r.stdout).toMatch(/Declared no AI\s+1\s/);
    expect(r.stdout).toMatch(/AI-assisted\s+1\s/);
    expect(r.stdout).toMatch(/Cursor \(Anysphere\)\s+1\s+gpt-4o \(1\) · 40 lines in notes/);
    expect(r.stdout).toMatch(/Agent setup at HEAD\s+files/);
    expect(r.stdout).toMatch(/Claude \(Anthropic\)\s+CLAUDE\.md/);
    expect(r.stdout).toMatch(/Shared agent instructions\s+AGENTS\.md/);
    expect(r.stdout).not.toContain('Hints');
  });

  it('can skip notes, or read another notes ref', async () => {
    expect(JSON.parse((await run(['--no-notes', '--format', 'json'])).stdout).summary.verdicts['ai-assisted']).toBe(0);
    git(['notes', '--ref=trace', 'add', '-m', JSON.stringify({ version: '0.1.0', id: 'x', timestamp: 't', tool: { name: 'claude' }, files: [{ path: 'a', conversations: [{ contributor: { type: 'ai' }, ranges: [{ start_line: 1, end_line: 5 }] }] }] }), shas.layout!]);
    const out = JSON.parse((await run(['--notes', 'refs/notes/trace', '--format', 'json', '--commits'])).stdout);
    expect(out.summary.tools.map((t: { id: string }) => t.id)).toEqual(['claude']);
    expect((await run(['--notes', 'trace'])).code).toBe(2);
  });

  it('shows hints only when asked, and never counts them', async () => {
    const r = await run(['--hints']);
    expect(r.stdout).toMatch(/Hints, among commits with no AI disclosed/);
    expect(r.stdout).toMatch(/changes Claude's configuration\s+1/);
    expect(r.stdout).toMatch(/changes shared agent instructions\s+1/);
    expect(r.stdout).toMatch(/No AI disclosed\s+4\s/);
    const json = JSON.parse((await run(['--hints', '--format', 'json', '--commits'])).stdout);
    const row = json.commits.find((c: { sha: string }) => c.sha === shas.claudemd);
    expect(row.hints.map((h: { tool?: string }) => h.tool ?? 'shared').sort()).toEqual(['claude', 'shared']);
    expect(row.verdict).toBe('human');
  });

  it('explains notes, declarations and hints', async () => {
    const r = await run(['explain', shas.noted!, shas.declared!, shas.claudemd!]);
    expect(r.stdout).toMatch(/note\s+Cursor \(Anysphere\)\s+git-ai: 40 lines by cursor \(gpt-4o\)\s+\(model gpt-4o\)/);
    expect(r.stdout).toMatch(/verdict\s+Declared no AI/);
    expect(r.stdout).toMatch(/trailer\s+declared no AI\s+AI-assisted: no/);
    expect(r.stdout).toMatch(/hints\s+config\s+AGENTS\.md\s+\(changes shared agent instructions; weak, not counted\)/);
    expect(r.stdout).toMatch(/config\s+Claude \(Anthropic\)\s+CLAUDE\.md\s+\(changes Claude's configuration; weak, not counted\)/);
  });
});

describe('the GitHub layer', () => {
  it('classifies a pull request by number, reference or URL', async () => {
    const output = join(dir, 'out.txt');
    writeFileSync(output, '');
    const r = await run(['pr', '7', '--hints'], { GITHUB_OUTPUT: output });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('#7 Add a theme switcher');
    expect(r.stdout).toMatch(/verdict\s+AI agent/);
    expect(r.stdout).toMatch(/branch\s+GitHub Copilot\s+copilot\/add-theme-switcher/);
    expect(readFileSync(output, 'utf8')).toBe('verdict=ai-agent\nai=true\ntools=github-copilot\ndeclared-human=false\n');
    const json = JSON.parse((await run(['pr', 'octo/app#9', '--format', 'json'])).stdout);
    expect(json).toMatchObject({ pullRequest: { number: 9, branch: 'docs', commits: 1, url: 'https://github.com/octo/app/pull/9' }, verdict: 'ai-assisted' });
    expect((await run(['pr', 'https://github.com/octo/app/pull/8', '--format', 'json', '--hints'])).stdout).toContain('"hint": "text"');
  });

  it('reports GitHub errors with exit code 2', async () => {
    const r = await run(['pr', '404']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^whowrote: not found on GitHub/);
    expect((await run(['pr', 'not-a-pr'])).code).toBe(2);
    expect((await run(['pr', '1', '2'])).code).toBe(2);
  });

  it('reads squash-merged pull requests for the history with --github', async () => {
    const r = await run(['--github', '--format', 'json', '--commits'], { GITHUB_TOKEN: 'secret' });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    const bySha = Object.fromEntries(out.commits.map((c: { sha: string }) => [c.sha, c]));
    expect(bySha[shas.squashed!]).toMatchObject({ verdict: 'ai-agent', tools: ['github-copilot'] });
    expect(bySha[shas.layout!].verdict).toBe('human');
    const graphql = gh.requests.filter((q) => q.path === '/graphql');
    expect(graphql.at(-1)?.auth).toBe('Bearer secret');
    expect(graphql.at(-1)?.body).toContain('p7: pullRequest(number: 7)');
  });

  it('looks up the pull request of each explained commit, without a token', async () => {
    const r = await run(['explain', '--github', shas.squashed!]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/verdict\s+AI agent/);
    expect(r.stdout).toMatch(/PR author\s+GitHub Copilot\s+Copilot/);
    expect(r.stdout).toMatch(/branch\s+GitHub Copilot\s+copilot\/add-theme-switcher/);
  });

  it('needs a token for --github history', async () => {
    const r = await run(['--github']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('needs a token');
  });

  it('uses --repo when the remote is not on GitHub', async () => {
    git(['remote', 'set-url', 'origin', 'https://gitlab.com/octo/app.git']);
    try {
      expect((await run(['pr', '7'])).stderr).toContain('is not a pull request');
      expect((await run(['pr', '7', '--repo', 'octo/app'])).code).toBe(0);
      expect((await run(['--github'], { GITHUB_TOKEN: 't' })).stderr).toContain('pass --repo owner/name');
      expect((await run(['--repo', 'nope'])).code).toBe(2);
    } finally {
      git(['remote', 'set-url', 'origin', 'https://github.com/octo/app.git']);
    }
  });

  it('asks GitHub for the commits of an event whose commits are not in the clone', async () => {
    const file = join(dir, 'event.json');
    writeFileSync(file, JSON.stringify({
      repository: { full_name: 'octo/app' },
      pull_request: { number: 9, title: 'Add docs', body: 'Docs.', user: { login: 'jane', type: 'User' }, head: { ref: 'docs', sha: 'b'.repeat(40) }, base: { sha: 'a'.repeat(40) } },
    }));
    const r = await run(['pr', '--event', file, '--format', 'json']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toMatchObject({ verdict: 'ai-assisted', pullRequest: { commits: 1 }, tools: [{ id: 'claude' }] });
  });
});
