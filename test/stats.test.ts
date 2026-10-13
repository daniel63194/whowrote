import { describe, expect, it } from 'vitest';
import { classifyCommit } from '../src/classify.js';
import { renderMarkdown, renderText } from '../src/report.js';
import { Tally, periodOf } from '../src/stats.js';

describe('periodOf', () => {
  it('groups by year, quarter and month in UTC', () => {
    expect(periodOf('2026-10-12T08:00:00+02:00', 'month')).toBe('2026-10');
    expect(periodOf('2026-10-01T01:00:00+02:00', 'month')).toBe('2026-09');
    expect(periodOf('2026-10-12T08:00:00Z', 'quarter')).toBe('2026-Q4');
    expect(periodOf('2026-03-31T23:59:59Z', 'quarter')).toBe('2026-Q1');
    expect(periodOf('2026-10-12T08:00:00Z', 'year')).toBe('2026');
    expect(periodOf('not a date', 'month')).toBe('unknown');
  });

  it('uses ISO 8601 weeks', () => {
    expect(periodOf('2026-01-01T12:00:00Z', 'week')).toBe('2026-W01'); // a Thursday
    expect(periodOf('2027-01-01T12:00:00Z', 'week')).toBe('2026-W53'); // a Friday
    expect(periodOf('2024-12-30T12:00:00Z', 'week')).toBe('2025-W01'); // a Monday
    expect(periodOf('2026-10-12T12:00:00Z', 'week')).toBe('2026-W42');
  });
});

describe('Tally', () => {
  const commits = [
    { date: '2026-08-02T10:00:00Z', author: 'Jane <jane@example.com>', message: 'one' },
    { date: '2026-08-03T10:00:00Z', author: 'Jane <jane@example.com>', message: 'two\n\nCo-authored-by: Claude Opus 4.6 <noreply@anthropic.com>' },
    { date: '2026-09-03T10:00:00Z', author: 'Jane <jane@example.com>', message: 'three\n\nCo-authored-by: Claude Opus 4.6 (1M context) <noreply@anthropic.com>\nCo-authored-by: Cursor <cursoragent@cursor.com>' },
    { date: '2026-09-04T10:00:00Z', author: 'Jane <jane@example.com>', message: 'four\n\nAssisted-by: LLM' },
    { date: '2026-09-05T10:00:00Z', author: 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', message: 'bump' },
    { date: '2026-07-01T10:00:00Z', author: 'acme[bot] <1+acme[bot]@users.noreply.github.com>', message: 'release' },
    { date: '2026-09-06T10:00:00Z', author: 'Copilot <198982749+Copilot@users.noreply.github.com>', message: 'agent' },
  ];
  const tally = new Tally('month');
  for (const c of commits) tally.add(classifyCommit(c), c.date);
  const s = tally.summary();

  it('counts verdicts', () => {
    expect(s.total).toBe(7);
    expect(s.verdicts).toEqual({ human: 1, 'ai-assisted': 3, 'ai-agent': 1, bot: 2 });
  });

  it('counts AI tools and models, most commits first', () => {
    expect(s.tools.map((t) => [t.id, t.commits])).toEqual([
      ['claude', 2],
      ['cursor', 1],
      ['github-copilot', 1],
    ]);
    expect(s.tools[0]!.models).toEqual([{ model: 'Claude Opus 4.6', commits: 2 }]);
    expect(s.otherAI).toBe(1);
  });

  it('names bots by registry name or identity', () => {
    expect(s.bots).toEqual([
      { name: 'acme[bot]', commits: 1 },
      { name: 'Dependabot', commits: 1 },
    ]);
  });

  it('breaks down by period, oldest first, and keeps the date range', () => {
    expect(s.periods?.map((p) => [p.period, p.total])).toEqual([
      ['2026-07', 1],
      ['2026-08', 2],
      ['2026-09', 4],
    ]);
    expect(s.first).toBe('2026-07-01T10:00:00Z');
    expect(s.last).toBe('2026-09-06T10:00:00Z');
  });

  it('renders text and Markdown', () => {
    const text = renderText(s, { title: 'demo' });
    expect(text).toContain('whowrote · demo · 7 commits · 2026-07-01 → 2026-09-06');
    expect(text).toMatch(/AI-assisted\s+3\s+42\.9%/);
    expect(text).toContain('Claude (Anthropic)');
    expect(text).toContain('GitHub Copilot ');
    expect(text).not.toContain('GitHub Copilot (GitHub)');
    expect(text).toContain('Unnamed AI tool');
    expect(text).toContain('2026-09');
    const md = renderMarkdown(s, { title: 'demo_repo' });
    expect(md).toContain('### whowrote: demo\\_repo');
    expect(md).toContain('| AI-assisted | 3 | 42.9% |');
    expect(md).toContain('| Claude (Anthropic) | 2 | Claude Opus 4.6 (2) |');
    expect(md).toContain('| 2026-09 | 4 | 0% | 50.0% | 25.0% | 25.0% |');
  });

  it('renders an empty range', () => {
    const empty = new Tally().summary();
    expect(renderText(empty, { title: 'x' })).toContain('No commits in this range.');
    expect(renderMarkdown(empty, { title: 'x' })).toContain('No commits in this range.');
  });
});
