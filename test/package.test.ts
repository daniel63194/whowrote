import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = join(import.meta.dirname, '..', 'dist');

describe('published package', () => {
  it('keeps the library free of Node built-ins, so it runs in browsers, Deno, Bun and edge runtimes', () => {
    const seen = new Set<string>();
    const nodeImports: string[] = [];
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*'([^']+)'/g)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
        else nodeImports.push(`${file}: ${spec}`);
      }
    };
    walk(join(dist, 'index.js'));
    expect(nodeImports).toEqual([]);
    expect(seen.size).toBeGreaterThan(3);
  });

  it('ships the full registry as JSON', () => {
    const json = JSON.parse(readFileSync(join(dist, 'registry.json'), 'utf8')) as { version: number; tools: { id: string; evidence: string[]; examples: unknown[] }[] };
    expect(json.version).toBe(1);
    expect(json.tools.length).toBeGreaterThan(30);
    for (const t of json.tools) {
      expect(t.evidence.length).toBeGreaterThan(0);
      expect(t.examples.length).toBeGreaterThan(0);
    }
  });

  it('exports what package.json promises', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { exports: Record<string, string | Record<string, string>> };
    expect(Object.keys(pkg.exports)).toEqual(['.', './registry.json', './package.json']);
  });
});
