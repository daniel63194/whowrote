// Property-based tests (fuzzing) with fast-check. Commit messages, names and pull request descriptions
// are untrusted input, so classification must cope with anything: never throw, never hang on crafted
// text, always return a consistent result, and never print raw control characters.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyActor, classifyCommit, classifyPullRequest, parseIdentity, tools } from '../src/index.js';
import { REGISTRY } from '../src/registry-data.js';
import { displaySafe, renderExplain, renderMarkdown, renderText } from '../src/report.js';
import { Tally } from '../src/stats.js';
import type { Result } from '../src/types.js';

const RUNS = { numRuns: 300 };
const VERDICTS = ['human', 'ai-assisted', 'ai-agent', 'bot'];
const IDS = new Set(tools.map((t) => t.id));

// Fragments of real signals, so random messages often get close to matching.
const fragment = fc.constantFrom(
  'Co-authored-by: ', 'Co-Authored-By: Claude', ' <noreply@anthropic.com>', 'Assisted-by: ', 'AI-assisted: ',
  'Made-with: ', 'Generated-by: ', '🤖 Generated with [', 'Claude Code', '](https://claude.com/claude-code)',
  '> This pull request was created with GitHub Copilot.', 'Made with [Cursor', 'Copilot', '(aider)', '[bot]',
  '@users.noreply.github.com', '198982749+', 'https://app.devin.ai/sessions/', 'chatgpt.com/codex/tasks/task_',
  'Amp-Thread-ID: ', 'Claude-Session: ', 'AI-assisted: no', 'copilot/', 'claude/', 'Merge pull request #1 from o/', '## Summary', '## Test plan',
  '  abc 1-5,7', '---', '{"schema_version":"authorship/3.0.0","prompts":{"abc":{"agent_id":{"tool":"cursor"}}}}', 'CLAUDE.md', '.cursor/', '\n', '\r\n', '\n\n', ' ', ':', '<', '>', '(', ')', '[', ']', '\u001b[31m', '\u202e', '\0',
);
const text = fc.oneof(fc.string({ maxLength: 300 }), fc.array(fragment, { maxLength: 40 }).map((a) => a.join('')));
const identity = fc.oneof(
  text,
  fc.record({ name: fc.option(text), email: fc.option(text), login: fc.option(text), type: fc.option(fc.constantFrom('User', 'Bot', 'Organization', '')) }),
);

function assertConsistent(r: Result): void {
  expect(VERDICTS).toContain(r.verdict);
  expect(r.ai).toBe(r.verdict === 'ai-assisted' || r.verdict === 'ai-agent');
  for (const t of r.tools) {
    expect(IDS.has(t.id)).toBe(true);
    expect(t.signals.length).toBeGreaterThan(0);
  }
  for (const e of r.evidence) {
    expect(typeof e.value).toBe('string');
    if (e.tool !== undefined) expect(IDS.has(e.tool)).toBe(true);
  }
  // Only "code" evidence names tools in the result.
  const fromEvidence = new Set(r.evidence.filter((e) => e.tool && e.scope === 'code').map((e) => e.tool));
  expect(new Set(r.tools.map((t) => t.id))).toEqual(fromEvidence);
  if (r.verdict === 'human') expect(r.evidence.some((e) => e.scope === 'code' && e.kind !== 'human')).toBe(false);
  if (r.declaredHuman) expect(r.verdict).toBe('human');
  for (const h of r.hints) {
    expect(['agent-config', 'branch', 'text']).toContain(h.hint);
    if (h.tool !== undefined) expect(IDS.has(h.tool)).toBe(true);
  }
}

describe('fuzz: classification', () => {
  it('classifies any commit consistently', () => {
    fc.assert(
      fc.property(text, identity, fc.option(identity), fc.option(text), fc.array(text, { maxLength: 4 }), fc.option(fc.record({ author: identity, body: text, branch: text })), (message, author, committer, notes, files, pullRequest) => {
        assertConsistent(classifyCommit({ message, author, committer, notes, files, pullRequest }));
      }),
      RUNS,
    );
  });

  it('classifies any pull request and actor consistently', () => {
    fc.assert(
      fc.property(identity, fc.option(text), fc.option(text), fc.option(text), fc.array(fc.record({ message: text, author: identity, notes: text }), { maxLength: 3 }), (author, title, body, branch, commits) => {
        assertConsistent(classifyPullRequest({ author, title, body, branch, commits }));
        assertConsistent(classifyActor(author));
      }),
      RUNS,
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(text, identity, (message, author) => {
        expect(classifyCommit({ message, author })).toEqual(classifyCommit({ message, author }));
      }),
      { numRuns: 100 },
    );
  });

  it('round-trips "Name <email>"', () => {
    const part = fc.string({ maxLength: 40 }).filter((s) => !/[<>]/.test(s) && s.trim() === s && s !== '');
    fc.assert(
      fc.property(part, part.filter((s) => !/\s/.test(s)), (name, email) => {
        expect(parseIdentity(`${name} <${email}>`)).toEqual({ name, email });
      }),
      RUNS,
    );
  });
});

describe('fuzz: crafted input stays fast', () => {
  const big = (unit: string): string => unit.repeat(Math.ceil(200_000 / unit.length));
  const attacks = [
    big(' '),
    big('a'),
    big('Co-authored-by: '),
    big('Generated with '),
    big('🤖 Generated with [Claude Code'),
    big('<'),
    big('Claude '),
    big('\n> '),
    big('Assisted-by: Claude:'),
    big('https://cursor.com/agents'),
    big('(aider'),
    big('## Summary\n'),
    big('  abc 1-'),
    big('{"files":[{"conversations":['),
    `${big('x')}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
  ];

  it.each(attacks.map((a, i) => [i, a] as const))('message %i is classified in well under a second', (_i, message) => {
    const start = performance.now();
    classifyCommit({ message, author: message.slice(0, 5000), committer: message.slice(0, 5000), notes: message, files: [message.slice(0, 5000)], pullRequest: { body: message, branch: message.slice(0, 300) } });
    classifyPullRequest({ author: message.slice(0, 5000), title: message.slice(0, 5000), body: message });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('every registry pattern runs in linear time on long input', () => {
    const patterns = REGISTRY.flatMap((e) => [...e.names, ...(e.nameMarkers ?? []), ...e.models, ...e.footers.map((f) => f.pattern), ...(e.branches ?? []), ...(e.hints ?? []).flatMap((h) => h.all)]);
    for (const p of patterns) {
      const re = new RegExp(p, 'iu');
      for (const unit of [' ', 'a', '(', '[', '1.', 'Claude ', 'aider (']) {
        const s = unit.repeat(20_000);
        const start = performance.now();
        re.test(s);
        expect(performance.now() - start, `${p} on ${JSON.stringify(unit)}`).toBeLessThan(200);
      }
    }
  });
});

describe('fuzz: output is safe to print', () => {
  // eslint-disable-next-line no-control-regex
  const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

  it('displaySafe removes control and bidi characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        expect(displaySafe(s)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
      }),
      RUNS,
    );
  });

  it('reports never contain unsafe characters from the input', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ message: text, author: identity }), { maxLength: 6 }), text, (commits, title) => {
        const tally = new Tally('month');
        for (const c of commits) tally.add(classifyCommit(c), '2026-10-01T00:00:00Z');
        const s = tally.summary();
        expect(renderText(s, { title })).not.toMatch(UNSAFE);
        expect(renderMarkdown(s, { title })).not.toMatch(UNSAFE);
        for (const c of commits) {
          expect(renderExplain({ sha: 'abc', subject: c.message, author: typeof c.author === 'string' ? c.author : JSON.stringify(c.author) }, classifyCommit(c))).not.toMatch(UNSAFE);
        }
      }),
      { numRuns: 150 },
    );
  });
});
