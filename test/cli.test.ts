import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitError, gitLogArgs, readCommits } from '../src/git.js';
import { tools } from '../src/index.js';

// These tests run the built CLI (dist/cli.js) against a throwaway git repository; `npm test` builds first.
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

let dir: string;
let repo: string;
const shas: Record<string, string> = {};

// Isolated from the machine's git config (signing, hooks, default branch), with an identity of its own.
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

function commit(key: string, author: string, date: string, message: string): void {
  const m = /^(.*) <(.*)>$/.exec(author)!;
  git(['commit', '--allow-empty', '-q', '-m', message], {
    GIT_AUTHOR_NAME: m[1]!, GIT_AUTHOR_EMAIL: m[2]!, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com', GIT_COMMITTER_DATE: date,
  });
  shas[key] = git(['rev-parse', 'HEAD']);
}

function run(args: string[], options: { env?: Record<string, string>; input?: string; cwd?: string } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? repo,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...GIT_ENV, NO_COLOR: '1', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', GITHUB_EVENT_PATH: '', ...options.env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'whowrote-'));
  GIT_ENV['GIT_CONFIG_GLOBAL'] = join(dir, 'gitconfig');
  writeFileSync(GIT_ENV['GIT_CONFIG_GLOBAL'], '');
  repo = join(dir, 'demo');
  spawnSync('git', ['init', '-q', '-b', 'main', repo], { env: { ...process.env, ...GIT_ENV } });
  commit('human', 'Jane Doe <jane@example.com>', '2026-07-01T10:00:00Z', 'Initial commit');
  commit('claude', 'Jane Doe <jane@example.com>', '2026-08-01T10:00:00Z', 'Fix retry\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>');
  commit('copilot', 'Copilot <198982749+Copilot@users.noreply.github.com>', '2026-09-01T10:00:00Z', 'Fix null check\n\nCo-authored-by: Jane Doe <jane@example.com>');
  commit('bot', 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', '2026-09-02T10:00:00Z', 'Bump lodash from 4.17.20 to 4.17.21');
  commit('llm', 'Bob <bob@example.com>', '2026-09-03T10:00:00Z', 'Tune parser\n\nAssisted-by: LLM sparse');
  commit('escape', 'Bob <bob@example.com>', '2026-10-01T10:00:00Z', 'Colour \u001b[31mred\u001b[0m and \u202eevil');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('whowrote (history)', () => {
  it('prints a breakdown', () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('whowrote · demo · 6 commits · 2026-07-01 → 2026-10-01');
    expect(r.stdout).toMatch(/No AI disclosed\s+2\s+33\.3%/);
    expect(r.stdout).toMatch(/AI-assisted\s+2\s+33\.3%/);
    expect(r.stdout).toMatch(/AI agent\s+1\s+16\.7%/);
    expect(r.stdout).toMatch(/Bot\s+1\s+16\.7%/);
    expect(r.stdout).toMatch(/Claude \(Anthropic\)\s+1\s+Claude Opus 4\.6 \(1\)/);
    expect(r.stdout).toMatch(/Unnamed AI tool\s+1/);
    expect(r.stdout).toMatch(/Dependabot\s+1/);
  });

  it('writes JSON with every commit', () => {
    const r = run(['--format', 'json', '--commits']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.version).toBe(1);
    expect(out.summary.total).toBe(6);
    expect(out.summary.verdicts).toEqual({ human: 2, 'ai-assisted': 2, 'ai-agent': 1, bot: 1 });
    expect(out.commits).toHaveLength(6);
    const bySha = Object.fromEntries(out.commits.map((c: { sha: string }) => [c.sha, c]));
    expect(bySha[shas.claude!]).toMatchObject({ verdict: 'ai-assisted', ai: true, tools: ['claude'], subject: 'Fix retry' });
    expect(bySha[shas.copilot!]).toMatchObject({ verdict: 'ai-agent', tools: ['github-copilot'] });
    expect(bySha[shas.bot!]).toMatchObject({ verdict: 'bot', tools: ['dependabot'] });
  });

  it('lists AI and bot commits with --commits', () => {
    const r = run(['--commits']);
    expect(r.stdout).toContain(`${shas.claude!.slice(0, 10)}  AI-assisted      Claude`);
    expect(r.stdout).toContain(`${shas.bot!.slice(0, 10)}  Bot              Dependabot`);
    expect(r.stdout).not.toContain(shas.human!.slice(0, 10));
  });

  it('breaks down by month, and writes Markdown', () => {
    const r = run(['--by', 'month', '--format', 'markdown']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('### whowrote: demo');
    expect(r.stdout).toContain('| 2026-09 | 3 | 0% | 33.3% | 33.3% | 33.3% |');
  });

  it('honours ranges, dates, counts and paths', () => {
    expect(JSON.parse(run(['--format', 'json', `${shas.claude}..HEAD`]).stdout).summary.total).toBe(4);
    expect(JSON.parse(run(['--format', 'json', '--since', '2026-09-01T00:00:00Z']).stdout).summary.total).toBe(4);
    expect(JSON.parse(run(['--format', 'json', '--until', '2026-08-15']).stdout).summary.total).toBe(2);
    expect(JSON.parse(run(['--format', 'json', '-n', '2']).stdout).summary.total).toBe(2);
    expect(JSON.parse(run(['--format', 'json', '--', 'no-such-path']).stdout).summary.total).toBe(0);
  });

  it('exits 1 with --fail-on when a commit matches, and lists them', () => {
    const r = run(['--fail-on', 'ai-agent']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('1 commit is AI agent (--fail-on)');
    expect(r.stderr).toContain(shas.copilot!.slice(0, 10));
    expect(run(['--fail-on', 'ai,bot', '-n', '1']).code).toBe(0);
    expect(run(['--fail-on', 'ai', '-n', '2']).code).toBe(1);
  });

  it('appends the Markdown report with --summary', () => {
    const file = join(dir, 'summary.md');
    writeFileSync(file, '# before\n');
    expect(run(['--summary', file]).code).toBe(0);
    const md = readFileSync(file, 'utf8');
    expect(md.startsWith('# before\n')).toBe(true);
    expect(md).toContain('| AI-assisted | 2 | 33.3% |');
  });

  it('escapes control and bidi characters from commit messages', () => {
    const r = run(['explain', shas.escape!]);
    expect(r.stdout).not.toMatch(/[\u001b\u202e]/);
    expect(r.stdout).toContain('Colour \\u001b[31mred\\u001b[0m and \\u202eevil');
  });
});

describe('whowrote explain', () => {
  it('shows the evidence for a commit', () => {
    const r = run(['explain', shas.claude!]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`${shas.claude!.slice(0, 12)} Fix retry`);
    expect(r.stdout).toMatch(/verdict\s+AI-assisted/);
    expect(r.stdout).toMatch(/co-author\s+Claude \(Anthropic\)\s+Claude Opus 4\.6 \(1M context\) <noreply@anthropic\.com>\s+\(model Claude Opus 4\.6\)/);
  });

  it('explains HEAD by default, and several commits as JSON', () => {
    expect(run(['explain']).stdout).toContain(shas.escape!.slice(0, 12));
    const out = JSON.parse(run(['explain', '--format', 'json', shas.bot!, shas.human!]).stdout);
    expect(out.map((c: { verdict: string }) => c.verdict)).toEqual(['bot', 'human']);
  });

  it('can explain merge commits', () => {
    git(['checkout', '-q', '-b', 'side', shas.human!]);
    commit('side', 'Jane Doe <jane@example.com>', '2026-10-02T10:00:00Z', 'Side work');
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--no-ff', '-m', 'Merge side\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>', 'side']);
    const merge = git(['rev-parse', 'HEAD']);
    expect(run(['explain', merge]).stdout).toMatch(/verdict\s+AI-assisted/);
    // History leaves merges out unless asked.
    expect(JSON.parse(run(['--format', 'json']).stdout).summary.total).toBe(7);
    expect(JSON.parse(run(['--format', 'json', '--merges']).stdout).summary.total).toBe(8);
    git(['reset', '-q', '--hard', shas.escape!]);
  });
});

describe('whowrote actor / tools', () => {
  it('classifies identities', () => {
    const r = run(['actor', 'dependabot[bot]', 'Copilot', 'Jane Doe <jane@example.com>', 'acme[bot]']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/dependabot\[bot\]\s+Bot\s+Dependabot \(GitHub\)/);
    expect(r.stdout).toMatch(/Copilot\s+AI agent\s+GitHub Copilot/);
    expect(r.stdout).toMatch(/Jane Doe <jane@example.com>\s+No AI disclosed/);
    expect(r.stdout).toMatch(/acme\[bot\]\s+Bot\s+unlisted bot/);
    expect(JSON.parse(run(['actor', '--format', 'json', 'claude[bot]']).stdout)[0]).toMatchObject({ input: 'claude[bot]', verdict: 'ai-agent' });
    expect(run(['actor', '--fail-on', 'bot', 'renovate[bot]']).code).toBe(1);
  });

  it('lists the registry', () => {
    expect(JSON.parse(run(['tools', '--format', 'json']).stdout)).toHaveLength(tools.length);
    expect(run(['tools']).stdout).toMatch(/^Claude\s+Anthropic\s+AI agent\s+claude$/m);
  });
});

describe('whowrote pr', () => {
  const event = (pr: Record<string, unknown>): string => {
    const file = join(dir, `event-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify({ action: 'opened', pull_request: pr }));
    return file;
  };

  it('classifies a pull request from a webhook payload and writes step outputs', () => {
    const output = join(dir, 'output.txt');
    writeFileSync(output, '');
    const file = event({ number: 7, title: 'Fix flaky test', body: 'Fixes it.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', user: { login: 'jane', type: 'User' } });
    const r = run(['pr', '--event', file], { env: { GITHUB_OUTPUT: output } });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('#7 Fix flaky test');
    expect(r.stdout).toMatch(/verdict\s+AI-assisted/);
    expect(readFileSync(output, 'utf8')).toBe('verdict=ai-assisted\nai=true\ntools=claude\ndeclared-human=false\n');
  });

  it('reads $GITHUB_EVENT_PATH, and the commits when they are in the clone', () => {
    const file = event({ number: 8, title: 'Work', body: '', user: { login: 'jane', type: 'User' }, base: { sha: shas.human }, head: { sha: shas.claude } });
    const r = run(['pr', '--format', 'json'], { env: { GITHUB_EVENT_PATH: file } });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ pullRequest: { number: 8, commits: 1 }, verdict: 'ai-assisted', tools: [{ id: 'claude' }] });
  });

  it('says so when the commits are not in the clone', () => {
    const file = event({ number: 9, title: 'Work', body: '', user: { login: 'jane' }, base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } });
    const r = run(['pr', '--event', file]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('fetch-depth: 0');
  });

  it('reads gh pr view --json output from stdin', () => {
    const gh = {
      number: 3,
      title: 'Bump x',
      body: 'Bumps x.',
      author: { login: 'app/dependabot', is_bot: true },
      commits: [{ oid: 'c'.repeat(40), messageHeadline: 'Bump x', messageBody: '', authors: [{ login: 'dependabot[bot]', name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' }] }],
    };
    const r = run(['pr', '--event', '-', '--format', 'json', '--fail-on', 'bot'], { input: JSON.stringify(gh) });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ verdict: 'bot', tools: [{ id: 'dependabot' }] });
  });

  it('finds agent commits listed by gh', () => {
    const gh = { title: 'Feature', body: '', author: { login: 'jane' }, commits: [{ messageHeadline: 'Part', messageBody: 'Co-authored-by: Codex <noreply@openai.com>', authors: [{ name: 'Jane', email: 'jane@example.com' }] }] };
    expect(JSON.parse(run(['pr', '--event', '-', '--format', 'json'], { input: JSON.stringify(gh) }).stdout).verdict).toBe('ai-assisted');
  });

  it('rejects input that is not a pull request', () => {
    const file = join(dir, 'nope.json');
    writeFileSync(file, '{"hello":1}');
    expect(run(['pr', '--event', file]).code).toBe(2);
    expect(run(['pr']).stderr).toContain('pr needs a pull request');
    expect(run(['pr', '--event', join(dir, 'missing.json')]).code).toBe(2);
  });
});

describe('errors and safety', () => {
  it('rejects bad options with exit code 2', () => {
    for (const args of [['--format', 'xml'], ['--by', 'day'], ['-n', '0'], ['--fail-on', 'human'], ['--since', ''], ['--bogus'], ['actor'], ['--event', 'x.json']]) {
      const r = run(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^whowrote: /);
    }
  });

  it('reports git errors', () => {
    const outside = mkdtempSync(join(tmpdir(), 'whowrote-nogit-'));
    const r = run([], { cwd: outside, env: { GIT_CEILING_DIRECTORIES: tmpdir() } });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^whowrote: not a git repository/);
    rmSync(outside, { recursive: true, force: true });
    expect(run(['no-such-branch']).stderr).toContain('whowrote: ');
  });

  it('never passes revisions to git as options', async () => {
    const target = join(dir, 'pwned.txt');
    expect(gitLogArgs({ revisions: [`--output=${target}`] })).toEqual(expect.arrayContaining(['--end-of-options', `--output=${target}`]));
    const args = gitLogArgs({ revisions: [`--output=${target}`] });
    expect(args.indexOf('--end-of-options')).toBeLessThan(args.indexOf(`--output=${target}`));
    await expect(async () => {
      for await (const c of readCommits({ cwd: repo, revisions: [`--output=${target}`] })) void c;
    }).rejects.toThrow(GitError);
    expect(existsSync(target)).toBe(false);
    // The CLI does not accept unknown options in the first place.
    expect(run([`--output=${target}`]).code).toBe(2);
  });

  it('stops git when the reader stops early', async () => {
    let n = 0;
    for await (const c of readCommits({ cwd: repo })) {
      void c;
      if (++n === 2) break;
    }
    expect(n).toBe(2);
  });

  // `| true` closes the pipe before the CLI has started, so every write hits EPIPE.
  it.skipIf(process.platform === 'win32')('stops quietly when the output pipe closes', () => {
    for (const cmd of ['tools', '--commits', 'explain HEAD', '--fail-on ai']) {
      const r = spawnSync('bash', ['-c', `{ "$NODE" "$CLI" ${cmd}; echo "exit=$?" >&2; } | true`], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, ...GIT_ENV, NODE: process.execPath, CLI, NO_COLOR: '1', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
      });
      expect(r.stderr, cmd).not.toContain('EPIPE');
      // --fail-on still decides the exit code.
      expect(r.stderr.trim().split('\n').pop(), cmd).toBe(cmd.startsWith('--fail-on') ? 'exit=1' : 'exit=0');
    }
  });

  it('prints help and version', () => {
    expect(run(['--help']).stdout).toContain('Usage:');
    expect(run(['-v']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.skipIf(process.platform === 'win32')('ships the CLI as an executable file', () => {
    expect(statSync(CLI).mode & 0o111).toBe(0o111);
  });
});
