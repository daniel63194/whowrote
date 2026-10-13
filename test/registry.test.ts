import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyActor, classifyCommit, classifyPullRequest, getTool, tools } from '../src/index.js';
import type { RegistryEntry, Result } from '../src/types.js';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'registry');
const entries: RegistryEntry[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RegistryEntry);

describe('registry', () => {
  it('passes validation and the generated files are up to date', () => {
    // Throws (exit code 1) with the list of problems otherwise.
    execFileSync(process.execPath, [join(root, 'scripts', 'registry.mjs'), '--check'], { stdio: 'pipe' });
  });

  it('accepts a checkout with CRLF line endings (git core.autocrlf on Windows)', () => {
    const copy = mkdtempSync(join(tmpdir(), 'whowrote-crlf-'));
    try {
      cpSync(join(root, 'scripts'), join(copy, 'scripts'), { recursive: true });
      mkdirSync(join(copy, 'src'));
      mkdirSync(join(copy, 'registry'));
      const crlf = (from: string, to: string): void => writeFileSync(to, readFileSync(from, 'utf8').replace(/\r?\n/g, '\r\n'));
      crlf(join(root, 'README.md'), join(copy, 'README.md'));
      crlf(join(root, 'src', 'registry-data.ts'), join(copy, 'src', 'registry-data.ts'));
      for (const f of readdirSync(dir)) crlf(join(dir, f), join(copy, 'registry', f));
      execFileSync(process.execPath, [join(copy, 'scripts', 'registry.mjs'), '--check'], { stdio: 'pipe' });
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('exposes every entry as a tool', () => {
    expect(tools.map((t) => t.id).sort()).toEqual(entries.map((e) => e.id).sort());
    for (const e of entries) expect(getTool(e.id)).toMatchObject({ id: e.id, name: e.name, vendor: e.vendor, kind: e.kind });
    expect(getTool('nope')).toBeUndefined();
  });

  it('keeps AI agents, then AI reviewers, then bots', () => {
    const order = tools.map((t) => ['ai-agent', 'ai-reviewer', 'bot'].indexOf(t.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('freezes the tool objects it hands out', () => {
    expect(Object.isFrozen(tools)).toBe(true);
    expect(Object.isFrozen(tools[0])).toBe(true);
  });
});

describe.each(entries.map((e) => [e.id, e] as const))('registry/%s.json examples', (_id, entry) => {
  it.each(entry.examples.map((x, i) => [i, x] as const))('example %i', (_i, example) => {
    let r: Result;
    if ('commit' in example) r = classifyCommit(example.commit);
    else if ('pullRequest' in example) r = classifyPullRequest(example.pullRequest);
    else r = classifyActor(example.actor);

    expect(r.verdict).toBe(example.verdict);
    const ids = r.tools.map((t) => t.id);
    // A "human" example is a near miss: the tool must not be credited.
    if (example.verdict === 'human') expect(ids).not.toContain(entry.id);
    else expect(ids).toContain(entry.id);
    if (example.models) expect(r.tools.find((t) => t.id === entry.id)?.models).toEqual(example.models);
  });
});
