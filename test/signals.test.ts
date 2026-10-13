// Branches, pull request context, declarations, attribution notes, agent config files and hints.
import { describe, expect, it } from 'vitest';
import { classifyCommit, classifyPullRequest, detectAgentSetup, parseNotes } from '../src/index.js';
import { globToRegExp } from '../src/glob.js';
import { countLines } from '../src/notes.js';

const JANE = 'Jane Doe <jane@example.com>';
const commit = (message: string, extra: Record<string, unknown> = {}) => classifyCommit({ message, author: JANE, ...extra });
const ids = (r: { tools: { id: string }[] }) => r.tools.map((t) => t.id);

describe('branches', () => {
  it('credits branches that agents create', () => {
    const copilot = classifyPullRequest({ author: 'jane', title: 'Fix', body: '', branch: 'copilot/add-theme-switcher' });
    expect(copilot.verdict).toBe('ai-assisted');
    expect(copilot.tools[0]).toMatchObject({ id: 'github-copilot', signals: ['branch'] });
    expect(ids(classifyPullRequest({ author: 'jane', branch: 'claude/issue-42-20261012-1030' }))).toEqual(['claude']);
    expect(ids(classifyPullRequest({ author: 'jane', branch: 'refs/heads/claude/fix' }))).toEqual(['claude']);
  });

  it('reads the head branch of GitHub pull request objects', () => {
    expect(classifyPullRequest({ user: { login: 'jane', type: 'User' }, title: 'x', body: null, head: { ref: 'copilot/x' } }).verdict).toBe('ai-assisted');
  });

  it('does not credit branches that only mention a tool', () => {
    for (const branch of ['feature/claude-api', 'fix-copilot-typo', 'jane/claude', 'main']) {
      expect(classifyPullRequest({ author: 'jane', branch }).verdict, branch).toBe('human');
    }
  });

  it('turns weaker naming habits into hints', () => {
    const r = classifyPullRequest({ author: 'jane', branch: 'cursor/fix-blink-rate' });
    expect(r.verdict).toBe('human');
    expect(r.hints).toEqual([{ hint: 'branch', value: 'cursor/fix-blink-rate', note: expect.stringContaining('Cursor'), tool: 'cursor' }]);
    expect(classifyPullRequest({ author: 'jane', branch: 'codex/fix-dates' }).hints[0]).toMatchObject({ tool: 'openai-codex' });
    expect(classifyPullRequest({ author: 'jane', branch: 'devin/1712345678-fix' }).hints[0]).toMatchObject({ tool: 'devin' });
  });

  it('reads the branch in merge commit messages', () => {
    expect(ids(commit('Merge pull request #12 from octo/copilot/add-theme\n\nAdd a theme'))).toEqual(['github-copilot']);
    expect(ids(commit("Merge branch 'claude/fix-login'"))).toEqual(['claude']);
    expect(commit('Merge pull request #12 from octo/feature/theme').verdict).toBe('human');
    // Only the subject line counts.
    expect(commit('Fix\n\nMerge pull request #12 from octo/copilot/x').verdict).toBe('human');
  });
});

describe('pull request context on a commit', () => {
  it('makes a commit from an agent pull request ai-agent, even when a person is the git author', () => {
    const r = commit('Fix null check (#12)', { pullRequest: { author: { login: 'Copilot', type: 'Bot' }, body: '' } });
    expect(r.verdict).toBe('ai-agent');
    expect(r.tools[0]).toMatchObject({ id: 'github-copilot', signals: ['pr-author'] });
  });

  it('reads the description and branch of the pull request', () => {
    expect(commit('Fix (#12)', { pullRequest: { author: 'jane', body: 'Fixes it.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' } }).verdict).toBe('ai-assisted');
    expect(ids(commit('Fix (#12)', { pullRequest: { author: 'jane', branch: 'copilot/fix-x' } }))).toEqual(['github-copilot']);
    expect(commit('Fix (#12)', { pullRequest: { author: 'jane', title: 'Fix', body: 'Plain.' } }).verdict).toBe('human');
  });

  it('keeps a bot author a bot', () => {
    const r = classifyCommit({ author: 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', message: 'Bump x (#3)', pullRequest: { author: { login: 'dependabot[bot]', type: 'Bot' } } });
    expect(r.verdict).toBe('bot');
    // A maintainer squash-merging a bot's pull request under their own name.
    expect(commit('Bump x (#4)', { pullRequest: { author: { login: 'renovate[bot]', type: 'Bot' } } }).verdict).toBe('bot');
  });
});

describe('declarations', () => {
  it('marks "no AI" declarations', () => {
    for (const line of ['AI-assisted: no', 'AI-assisted: none', 'Assisted-by: nobody', 'AI: none', 'AI-used: No.', 'AI-generated: false', 'AI-tools: n/a', 'AI-usage: not used']) {
      const r = commit(`Fix\n\n${line}`);
      expect(r.verdict, line).toBe('human');
      expect(r.declaredHuman, line).toBe(true);
      expect(r.evidence[0], line).toMatchObject({ signal: 'trailer', kind: 'human', value: line });
    }
  });

  it('does not let a declaration hide disclosed AI', () => {
    const r = commit('Fix\n\nAI-assisted: no\nCo-authored-by: Claude <noreply@anthropic.com>');
    expect(r.verdict).toBe('ai-assisted');
    expect(r.declaredHuman).toBe(false);
    expect(ids(r)).toEqual(['claude']);
  });

  it('reads positive AI-used and AI-generated as unnamed AI', () => {
    expect(commit('Fix\n\nAI-used: yes').verdict).toBe('ai-assisted');
    expect(ids(commit('Fix\n\nAI-generated: Copilot'))).toEqual(['github-copilot']);
  });

  it('ignores conventional-commit scopes and free text on ambiguous keys', () => {
    for (const m of ['ai: add streaming support', 'AI: rework the model picker', 'Fix\n\nAI: I used it for the tests']) {
      const r = commit(m);
      expect(r.verdict, m).toBe('human');
      expect(r.declaredHuman, m).toBe(false);
    }
  });

  it('never marks bots as declared humans', () => {
    const r = classifyCommit({ author: 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', message: 'Bump\n\nAI-assisted: no' });
    expect(r.verdict).toBe('bot');
    expect(r.declaredHuman).toBe(false);
  });
});

const GIT_AI = `src/auth.ts
  1a2b3c4d5e6f7a8b 1-8,10-21
  9f8e7d6c5b4a3f2e 9,22-30
src/db.ts
  1a2b3c4d5e6f7a8b 12-19
---
{"schema_version":"authorship/3.0.0","git_ai_version":"1.0.0","base_commit_sha":"abc","prompts":{
"1a2b3c4d5e6f7a8b":{"agent_id":{"tool":"cursor","id":"s1","model":"gpt-4o"},"messages":[]},
"9f8e7d6c5b4a3f2e":{"agent_id":{"tool":"claude","id":"s2","model":"claude-opus-4-6"},"messages":[]}}}`;

const TRACE = JSON.stringify({
  version: '0.1.0',
  id: '550e8400-e29b-41d4-a716-446655440000',
  timestamp: '2026-01-25T10:00:00Z',
  tool: { name: 'cursor', version: '2.0.0' },
  files: [
    {
      path: 'src/app.ts',
      conversations: [
        { contributor: { type: 'ai', model_id: 'anthropic/claude-opus-4-5' }, ranges: [{ start_line: 1, end_line: 50 }] },
        { contributor: { type: 'human' }, ranges: [{ start_line: 51, end_line: 60 }] },
      ],
    },
  ],
});

describe('attribution notes', () => {
  it('counts line ranges', () => {
    expect(countLines('1-5,10,15-20')).toBe(12);
    expect(countLines('5-1, x, 3')).toBe(1);
    expect(countLines('1-999999999')).toBe(10_000_000);
  });

  it('reads git-ai authorship logs', () => {
    expect(parseNotes(GIT_AI)).toEqual([
      { format: 'git-ai', kind: 'ai', tool: 'cursor', model: 'gpt-4o', lines: 28 },
      { format: 'git-ai', kind: 'ai', tool: 'claude', model: 'claude-opus-4-6', lines: 10 },
    ]);
    const r = commit('Add auth', { notes: GIT_AI });
    expect(r.verdict).toBe('ai-assisted');
    expect(r.tools).toEqual([
      expect.objectContaining({ id: 'cursor', signals: ['note'], models: ['gpt-4o'], lines: 28 }),
      expect.objectContaining({ id: 'claude', signals: ['note'], models: ['claude-opus-4-6'], lines: 10 }),
    ]);
    expect(r.evidence[0]!.value).toBe('git-ai: 28 lines by cursor (gpt-4o)');
  });

  it('reads Agent Trace records, including the lines people wrote', () => {
    expect(parseNotes(TRACE)).toEqual([
      { format: 'agent-trace', kind: 'ai', tool: 'cursor', model: 'anthropic/claude-opus-4-5', lines: 50 },
      { format: 'agent-trace', kind: 'human', lines: 10 },
    ]);
    const r = commit('Add app', { notes: TRACE });
    expect(r.verdict).toBe('ai-assisted');
    expect(r.tools[0]).toMatchObject({ id: 'cursor', lines: 50 });
  });

  it('treats a record that credits only people as a declaration', () => {
    const human = JSON.stringify({ version: '0.1.0', id: 'x', timestamp: 't', files: [{ path: 'a', conversations: [{ contributor: { type: 'human' }, ranges: [{ start_line: 1, end_line: 3 }] }] }] });
    const r = commit('Edit', { notes: human });
    expect(r.verdict).toBe('human');
    expect(r.declaredHuman).toBe(true);
    expect(r.evidence[0]).toMatchObject({ signal: 'note', kind: 'human', lines: 3 });
  });

  it('counts unknown tools as unnamed AI, and reads several notes and JSON lines', () => {
    const unknown = GIT_AI.replace('"cursor"', '"some-new-agent"');
    const r = commit('x', { notes: unknown });
    expect(r.verdict).toBe('ai-assisted');
    expect(r.evidence.find((e) => e.value.includes('some-new-agent'))?.tool).toBeUndefined();
    expect(parseNotes([TRACE, GIT_AI])).toHaveLength(4);
    expect(parseNotes(`${TRACE}\n${TRACE}`)).toEqual([
      { format: 'agent-trace', kind: 'ai', tool: 'cursor', model: 'anthropic/claude-opus-4-5', lines: 100 },
      { format: 'agent-trace', kind: 'human', lines: 20 },
    ]);
  });

  it('ignores notes that are not attribution records', () => {
    for (const n of ['Reviewed in the weekly sync.', '{"foo": 1}', '---', 'a\n---\nnot json', '[1,2,3]', '', null]) {
      expect(parseNotes(n), String(n)).toEqual([]);
      expect(commit('x', { notes: n }).verdict).toBe('human');
    }
  });

  it('reads older git-ai logs stored as JSON', () => {
    const old = JSON.stringify({ schema_version: 'authorship/2.0.0', prompts: { a: { agent_id: { tool: 'claude', model: 'opus' } } } });
    expect(parseNotes(old)).toEqual([{ format: 'git-ai', kind: 'ai', tool: 'claude', model: 'opus' }]);
  });
});

describe('agent config files', () => {
  it('compiles the registry globs', () => {
    expect(globToRegExp('**/CLAUDE.md').test('CLAUDE.md')).toBe(true);
    expect(globToRegExp('**/CLAUDE.md').test('packages/api/CLAUDE.md')).toBe(true);
    expect(globToRegExp('**/CLAUDE.md').test('docs/NOT-CLAUDE.md')).toBe(false);
    expect(globToRegExp('.cursor/**').test('.cursor/rules/a.mdc')).toBe(true);
    expect(globToRegExp('.cursor/**').test('.cursor')).toBe(false);
    expect(globToRegExp('.github/*.yml').test('.github/a.yml')).toBe(true);
    expect(globToRegExp('.github/*.yml').test('.github/x/a.yml')).toBe(false);
    expect(globToRegExp('a.b(c)').test('a.b(c)')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('finds the tools a repository is set up for', () => {
    const setup = detectAgentSetup(['README.md', 'CLAUDE.md', '.claude/settings.json', 'AGENTS.md', 'web/AGENTS.md', '.github/copilot-instructions.md', 'src/index.ts', '.windsurfrules']);
    expect(setup.map((s) => [s.tool?.id ?? 'shared', s.files])).toEqual([
      ['claude', ['.claude/settings.json', 'CLAUDE.md']],
      ['devin', ['.windsurfrules']],
      ['github-copilot', ['.github/copilot-instructions.md']],
      ['shared', ['AGENTS.md', 'web/AGENTS.md']],
    ]);
    expect(detectAgentSetup(['src/a.ts', 'docs/claude.md'])).toEqual([]);
  });

  it('turns changes to agent config into hints, not evidence', () => {
    const r = commit('Update instructions', { files: ['CLAUDE.md', 'packages/x/AGENTS.md', 'src/a.ts'] });
    expect(r.verdict).toBe('human');
    expect(r.tools).toEqual([]);
    expect(r.hints).toEqual([
      { hint: 'agent-config', value: 'CLAUDE.md', note: "changes Claude's configuration", tool: 'claude' },
      { hint: 'agent-config', value: 'packages/x/AGENTS.md', note: 'changes shared agent instructions' },
    ]);
  });
});

describe('text hints', () => {
  it('reports Claude Code’s pull request layout as a hint only', () => {
    const body = '## Summary\n- Guard the lookup\n\n## Test plan\n- [x] npm test';
    const r = classifyPullRequest({ author: 'jane', title: 'Fix', body });
    expect(r.verdict).toBe('human');
    expect(r.hints).toEqual([expect.objectContaining({ hint: 'text', tool: 'claude' })]);
    expect(classifyPullRequest({ author: 'jane', body: '## Summary\n- Guard the lookup' }).hints).toEqual([]);
  });

  it('collects hints from a pull request’s commits', () => {
    const r = classifyPullRequest({ author: 'jane', commits: [{ author: JANE, message: 'Docs', files: ['.cursor/rules/style.mdc'] }] });
    expect(r.hints).toEqual([expect.objectContaining({ hint: 'agent-config', tool: 'cursor' })]);
  });
});
