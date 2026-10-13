import { describe, expect, it } from 'vitest';
import { classifyActor, classifyCommit, classifyPullRequest, identify, isAI, isBot, isHuman, parseIdentity } from '../src/index.js';
import { loginFromEmail, looksLikeBot } from '../src/identity.js';

const JANE = 'Jane Doe <jane@example.com>';
const commit = (message: string, author = JANE, committer?: string) => classifyCommit({ message, author, ...(committer ? { committer } : {}) });

describe('parseIdentity', () => {
  it('reads "Name <email>", emails, logins and names', () => {
    expect(parseIdentity('Jane Doe <jane@example.com>')).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
    expect(parseIdentity('  <jane@example.com> ')).toEqual({ email: 'jane@example.com' });
    expect(parseIdentity('jane@example.com')).toEqual({ email: 'jane@example.com' });
    expect(parseIdentity('dependabot[bot]')).toEqual({ name: 'dependabot[bot]', login: 'dependabot[bot]' });
    expect(parseIdentity('Jane Doe')).toEqual({ name: 'Jane Doe' });
    expect(parseIdentity('')).toEqual({});
    expect(parseIdentity(null)).toEqual({});
    expect(parseIdentity({ name: ' Jane ', email: '', login: null, type: 'User' })).toEqual({ name: 'Jane', type: 'User' });
  });

  it('takes the last <…> as the email', () => {
    expect(parseIdentity('A <b> C <c@example.com>')).toEqual({ name: 'A <b> C', email: 'c@example.com' });
  });
});

describe('loginFromEmail', () => {
  it('reads GitHub noreply addresses, with and without the numeric id', () => {
    expect(loginFromEmail('49699333+dependabot[bot]@users.noreply.github.com')).toBe('dependabot[bot]');
    expect(loginFromEmail('Octocat@users.noreply.github.com')).toBe('octocat');
    expect(loginFromEmail('198982749+Copilot@users.noreply.github.com')).toBe('copilot');
    expect(loginFromEmail('jane@example.com')).toBeUndefined();
    expect(loginFromEmail('not a login@users.noreply.github.com')).toBeUndefined();
  });
});

describe('looksLikeBot', () => {
  it.each([
    [{ login: 'some-app[bot]' }],
    [{ name: 'some-app[bot]', email: 'someone@example.com' }],
    [{ email: '1+release-app[bot]@users.noreply.github.com' }],
    [{ type: 'Bot', login: 'whatever' }],
    [{ name: 'Release Bot', email: 'r@example.com' }],
    [{ name: 'nextjs-bot', email: 'it+nextjs-bot@vercel.com' }],
    [{ name: 'gemini-cli-robot', email: 'gemini-cli-robot@google.com' }],
    [{ name: 'Google Team Member', email: 'genai-sdk-bot@google.com' }],
    [{ name: 'bot_apk', email: 'apk@example.com' }],
  ])('%o is a bot', (id) => expect(looksLikeBot(id)).toBe(true));

  it.each([
    [{ name: 'Talbot Smith', email: 'talbot@example.com' }],
    [{ name: 'Abbot', email: 'abbot@example.com' }],
    [{ name: 'Jane Doe', email: 'jane@example.com', type: 'User' }],
    [{ name: 'Botond Kovács', email: 'botond@example.com' }],
    [{ name: 'Robotics Team', email: 'robotics@example.com' }],
  ])('%o is not a bot', (id) => expect(looksLikeBot(id)).toBe(false));
});

describe('classifyCommit', () => {
  it('calls an undisclosed commit human, with no evidence', () => {
    expect(commit('Fix typo')).toEqual({ verdict: 'human', ai: false, tools: [], evidence: [] });
  });

  it('credits AI co-authors and keeps their model', () => {
    const r = commit('Fix\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\nCo-authored-by: Bob <bob@example.com>');
    expect(r.verdict).toBe('ai-assisted');
    expect(r.ai).toBe(true);
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toMatchObject({ id: 'claude', name: 'Claude', vendor: 'Anthropic', signals: ['co-author'], models: ['Claude Fable 5.1'] });
    expect(r.evidence).toEqual([
      { signal: 'co-author', value: 'Claude Fable 5.1 <noreply@anthropic.com>', tool: 'claude', kind: 'ai', scope: 'code', model: 'Claude Fable 5.1' },
    ]);
  });

  it('reads co-author trailers anywhere in a squash-merge message', () => {
    const r = commit('Feature (#12)\n\n* first\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n\n* second\n');
    expect(r.tools.map((t) => t.id)).toEqual(['cursor']);
  });

  it('lists several tools in order of appearance', () => {
    const r = commit('x\n\nCo-authored-by: Codex <noreply@openai.com>\nCo-authored-by: Claude <noreply@anthropic.com>');
    expect(r.tools.map((t) => t.id)).toEqual(['openai-codex', 'claude']);
  });

  it('records each piece of evidence once', () => {
    const r = commit('x\n\nCo-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by: Claude <noreply@anthropic.com>');
    expect(r.evidence).toHaveLength(1);
  });

  it('calls an AI agent author ai-agent, whoever the co-authors are', () => {
    const r = classifyCommit({ author: 'Copilot <198982749+Copilot@users.noreply.github.com>', message: 'Fix\n\nCo-authored-by: Jane <jane@example.com>' });
    expect(r.verdict).toBe('ai-agent');
    expect(r.tools[0]).toMatchObject({ id: 'github-copilot', signals: ['author'] });
  });

  it('calls a bot author bot, and ai-agent when the change discloses an AI agent', () => {
    expect(classifyCommit({ author: 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', message: 'Bump x' }).verdict).toBe('bot');
    const r = classifyCommit({ author: 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>', message: 'Fix\n\nCo-authored-by: Claude <noreply@anthropic.com>' });
    expect(r.verdict).toBe('ai-agent');
    expect(r.tools.map((t) => t.id)).toEqual(['github-actions', 'claude']);
  });

  it('names unlisted bots by their identity', () => {
    const r = classifyCommit({ author: 'acme-release[bot] <123+acme-release[bot]@users.noreply.github.com>', message: 'Release 1.2.3' });
    expect(r.verdict).toBe('bot');
    expect(r.tools).toEqual([]);
    expect(r.evidence).toEqual([{ signal: 'author', value: 'acme-release[bot] <123+acme-release[bot]@users.noreply.github.com>', kind: 'bot', scope: 'code' }]);
  });

  it('prefers an AI tool over a bot identity', () => {
    const r = commit('x\n\nCo-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>');
    expect(r.tools.map((t) => t.id)).toEqual(['github-copilot']);
  });

  it('ignores bots and people as co-authors', () => {
    expect(commit('x\n\nCo-authored-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>').verdict).toBe('human');
    expect(commit('x\n\nCo-authored-by: Devin Griffin <devin@example.com>').verdict).toBe('human');
  });

  it('ignores the committer unless it is an AI tool', () => {
    expect(commit('x', JANE, 'GitHub <noreply@github.com>').verdict).toBe('human');
    expect(commit('x', JANE, 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>').verdict).toBe('human');
    const r = commit('x', JANE, 'Cursor Agent <cursoragent@cursor.com>');
    expect(r.verdict).toBe('ai-assisted');
    expect(r.evidence[0]).toMatchObject({ signal: 'committer', tool: 'cursor' });
  });

  it('reads aider name markers as assistance, not as an agent author', () => {
    const r = classifyCommit({ author: 'Paul (aider) <paul@example.com>', committer: 'Paul (aider) <paul@example.com>', message: 'feat: x' });
    expect(r.verdict).toBe('ai-assisted');
    expect(r.evidence).toHaveLength(1);
    expect(r.tools[0]).toMatchObject({ id: 'aider', signals: ['name-marker'] });
  });

  it('accepts GitHub REST API commit objects', () => {
    const r = classifyCommit({
      commit: { message: 'Bump lodash', author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' }, committer: { name: 'GitHub', email: 'noreply@github.com' } },
      author: { login: 'dependabot[bot]', type: 'Bot' },
      committer: { login: 'web-flow', type: 'User' },
    });
    expect(r.verdict).toBe('bot');
    expect(r.tools.map((t) => t.id)).toEqual(['dependabot']);
  });

  it('uses the GitHub login when the git identity says nothing', () => {
    const r = classifyCommit({ commit: { message: 'Fix', author: { name: 'x', email: 'x@example.com' } }, author: { login: 'devin-ai-integration[bot]', type: 'Bot' } });
    expect(r.verdict).toBe('ai-agent');
    expect(r.tools[0]?.id).toBe('devin');
  });

  it('copes with missing fields', () => {
    expect(classifyCommit({}).verdict).toBe('human');
    expect(classifyCommit({ message: null, author: null }).verdict).toBe('human');
  });
});

describe('trailers', () => {
  it('reads tool session trailers', () => {
    expect(commit('x\n\nCopilot-Session: 19deb2d0-75af-4fcf-ac1d-a6933c00769f').tools.map((t) => t.id)).toEqual(['github-copilot']);
    expect(commit('x\n\nAmp-Thread-ID: https://ampcode.com/threads/T-1').tools.map((t) => t.id)).toEqual(['amp']);
    expect(commit('x\n\nclaude-session: https://claude.ai/code/session_1').tools.map((t) => t.id)).toEqual(['claude']);
  });

  it('reads Assisted-by (the Linux kernel convention) and names the tool and model when it can', () => {
    const r = commit('x\n\nAssisted-by: Claude:claude-opus-4 coccinelle');
    expect(r.verdict).toBe('ai-assisted');
    expect(r.tools[0]).toMatchObject({ id: 'claude', models: ['claude-opus-4'] });
    const unnamed = commit('x\n\nAssisted-by: LLM sparse');
    expect(unnamed.verdict).toBe('ai-assisted');
    expect(unnamed.tools).toEqual([]);
    expect(unnamed.evidence[0]).toMatchObject({ signal: 'trailer', kind: 'ai', value: 'Assisted-by: LLM sparse' });
  });

  it('does not count Assisted-by when it credits a person', () => {
    expect(commit('x\n\nAssisted-by: Bob Smith <bob@example.com>').verdict).toBe('human');
    expect(commit('x\n\nAssisted-by: Claude <noreply@anthropic.com>').verdict).toBe('ai-assisted');
  });

  it('does not count negative disclosures', () => {
    for (const v of ['no', 'None', 'false', 'N/A', 'nope.', '-']) expect(commit(`x\n\nAI-assisted: ${v}`).verdict).toBe('human');
    expect(commit('x\n\nAI-assisted: yes').verdict).toBe('ai-assisted');
  });

  it('reads Made-with and Generated-by only when they name an AI tool', () => {
    expect(commit('x\n\nMade-with: Cursor').tools.map((t) => t.id)).toEqual(['cursor']);
    expect(commit('x\n\nMade-with: love').verdict).toBe('human');
    expect(commit('x\n\nGenerated-by: scripts/gen.sh').verdict).toBe('human');
    expect(commit('x\n\nGenerated-by: an LLM').verdict).toBe('ai-assisted');
    expect(commit('x\n\nGenerated-by: dependabot').verdict).toBe('human');
  });

  it('ignores URLs and prose that look like trailers', () => {
    expect(commit('See https://example.com/a:b\n\nNote: Claude was mentioned').verdict).toBe('human');
  });
});

describe('footers and disclosure lines', () => {
  it.each([
    ['🤖 Generated with [Claude Code](https://claude.com/claude-code)', 'claude'],
    ['Generated with [Claude Code](https://claude.ai/code)', 'claude'],
    ['> This pull request was authored with GitHub Copilot.', 'github-copilot'],
    ['This PR was generated with the help of GitHub Copilot.', 'github-copilot'],
    ['Made with [Cursor](https://cursor.com)', 'cursor'],
    ['Generated with Copilot Chat', 'github-copilot'],
    ['Written by Claude', 'claude'],
    ['🤖 Generated with [OpenCode](https://opencode.ai)', 'opencode'],
    ['Made by [Open SWE](https://github.com/langchain-ai/open-swe)', 'open-swe'],
    ['AI disclaimer: Created with codex and gpt-6 astra. Iterated on, reviewed', 'openai-codex'],
    ['Link to Devin run: https://app.devin.ai/sessions/abc', 'devin'],
    ['https://chatgpt.com/codex/tasks/task_e_123', 'openai-codex'],
  ])('%s', (line, id) => {
    const r = commit(`Change\n\nBody text.\n\n${line}`);
    expect(r.verdict).toBe('ai-assisted');
    expect(r.tools.map((t) => t.id)).toContain(id);
  });

  it.each([
    'Child-completion notifications are\ngenerated by Codex itself, so they are plaintext.',
    'The docs explain how Claude Code generated with care these files.',
    'Generated by codex-rs/build.rs',
    'Generated with Renovate Bot',
    'Created with love by the team',
    'AI disclosure: Created without AI tools.',
    'Written by Devin Griffin',
    'Written by Claude Monet',
  ])('not a disclosure: %s', (line) => {
    expect(commit(`Change\n\n${line}`).verdict).toBe('human');
  });

  it('reports description-only footers without changing the verdict', () => {
    const r = commit('Fix\n\n> This pull request description was generated by GitHub Copilot.');
    expect(r.verdict).toBe('human');
    expect(r.tools).toEqual([]);
    expect(r.evidence).toEqual([expect.objectContaining({ signal: 'footer', tool: 'github-copilot', scope: 'message' })]);
  });

  it('treats a reviewer writing a summary as message-only', () => {
    const r = commit('Fix\n\n> <sup>Written by [Cursor Bugbot](https://cursor.com/dashboard?tab=bugbot) for commit abc.</sup>');
    expect(r.verdict).toBe('human');
    expect(r.evidence[0]).toMatchObject({ tool: 'cursor-bugbot', scope: 'message' });
  });

  it('shortens long excerpts', () => {
    const r = commit(`x\n\n🤖 Generated with [Claude Code](https://claude.com/${'a'.repeat(300)})`);
    expect(r.evidence[0]!.value.length).toBeLessThanOrEqual(120);
  });
});

describe('classifyPullRequest', () => {
  it('reads webhook pull request objects', () => {
    expect(classifyPullRequest({ user: { login: 'Copilot', type: 'Bot' }, title: 'Fix', body: '' }).verdict).toBe('ai-agent');
    expect(classifyPullRequest({ user: { login: 'renovate[bot]', type: 'Bot' }, title: 'Update x', body: null }).verdict).toBe('bot');
    expect(classifyPullRequest({ user: { login: 'jane', type: 'User' }, title: 'Fix', body: 'Plain.' }).verdict).toBe('human');
  });

  it('reads the description', () => {
    const r = classifyPullRequest({ author: 'jane', title: 'Fix', body: 'Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' });
    expect(r.verdict).toBe('ai-assisted');
  });

  it('counts agent commits in a person’s pull request as AI involvement', () => {
    const r = classifyPullRequest({
      author: { login: 'jane', type: 'User' },
      title: 'Feature',
      body: '',
      commits: [
        { author: JANE, message: 'part 1' },
        { author: 'Cursor Agent <cursoragent@cursor.com>', message: 'part 2' },
        { author: 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>', message: 'format' },
      ],
    });
    expect(r.verdict).toBe('ai-assisted');
    expect(r.tools.map((t) => t.id)).toEqual(['cursor']);
  });

  it('copes with an empty object', () => {
    expect(classifyPullRequest({}).verdict).toBe('human');
  });
});

describe('actors', () => {
  it('classifies accounts', () => {
    expect(classifyActor('dependabot[bot]').verdict).toBe('bot');
    expect(classifyActor({ login: 'Copilot', type: 'Bot' }).verdict).toBe('ai-agent');
    expect(classifyActor('copilot-swe-agent[bot]').verdict).toBe('ai-agent');
    expect(classifyActor('Jane Doe <jane@example.com>').verdict).toBe('human');
    expect(classifyActor('Jane (aider) <jane@example.com>').verdict).toBe('ai-assisted');
  });

  it('has boolean helpers for contributor lists', () => {
    const people = ['jane', 'dependabot[bot]', 'Copilot', 'renovate-bot', 'claude[bot]', 'octocat'];
    expect(people.filter(isHuman)).toEqual(['jane', 'octocat']);
    expect(people.filter(isBot)).toEqual(['dependabot[bot]', 'Copilot', 'renovate-bot', 'claude[bot]']);
    expect(people.filter(isAI)).toEqual(['Copilot', 'claude[bot]']);
  });

  it('identifies the registry tool', () => {
    expect(identify('cursor[bot]')?.id).toBe('cursor-bugbot');
    expect(identify('Claude Opus 4.6 <noreply@anthropic.com>')).toMatchObject({ id: 'claude', models: ['Claude Opus 4.6'] });
    expect(identify('jane')).toBeUndefined();
  });

  it('does not mistake people named after tools', () => {
    for (const p of ['Claude Monet <claude@example.com>', 'Jules Verne <jules@example.com>', 'Devin <devin@example.com>', 'Amp Jones <amp@example.com>', 'Codex <codex@example.com>']) {
      expect(classifyActor(p).verdict).toBe('human');
    }
  });
});
