#!/usr/bin/env node
// Validates registry/*.json and generates the files built from it.
//
//   node scripts/registry.mjs               validate, then write src/registry-data.ts and the README table
//   node scripts/registry.mjs --check       validate, and fail if the generated files are out of date
//   node scripts/registry.mjs --json <file> validate, then write the full registry as one JSON file
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = join(root, 'registry');
const dataFile = join(root, 'src', 'registry-data.ts');
const readmeFile = join(root, 'README.md');

const KINDS = ['ai-agent', 'ai-reviewer', 'bot'];
const VERDICTS = ['human', 'ai-assisted', 'ai-agent', 'bot'];
const SCOPES = ['code', 'message'];
const FIELDS = {
  id: 'string', name: 'string', vendor: 'string', kind: 'string', url: 'string', description: 'string',
  aliases: 'strings', logins: 'strings', emails: 'strings', names: 'strings', nameMarkers: 'strings?',
  trailers: 'strings', footers: 'array', models: 'strings', evidence: 'strings', examples: 'array',
};
// Trailer keys that whowrote already reads for every tool (see src/classify.ts).
const RESERVED_TRAILERS = ['co-authored-by', 'assisted-by', 'ai-assisted', 'ai-assisted-by', 'agent-assisted', 'generated-by', 'made-with', 'co-developed-by'];

export function loadRegistry() {
  const errors = [];
  const entries = [];
  const files = readdirSync(registryDir).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const where = `registry/${file}`;
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(registryDir, file), 'utf8'));
    } catch (err) {
      errors.push(`${where}: invalid JSON (${err.message})`);
      continue;
    }
    errors.push(...validateEntry(entry, file).map((e) => `${where}: ${e}`));
    entries.push(entry);
  }
  const seen = { id: new Map(), login: new Map(), email: new Map(), trailer: new Map(), alias: new Map() };
  for (const e of entries) {
    claim(seen.id, e.id, e.id, 'id', errors);
    for (const l of e.logins ?? []) claim(seen.login, l.toLowerCase(), e.id, `login "${l}"`, errors);
    for (const m of e.emails ?? []) claim(seen.email, m.toLowerCase(), e.id, `email "${m}"`, errors);
    for (const t of e.trailers ?? []) claim(seen.trailer, t.toLowerCase(), e.id, `trailer "${t}"`, errors);
    for (const a of e.aliases ?? []) claim(seen.alias, a, e.id, `alias "${a}"`, errors);
  }
  if (errors.length) {
    console.error(`Registry has ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  const order = (e) => `${KINDS.indexOf(e.kind)}:${e.name.toLowerCase()}`;
  return entries.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

function claim(map, key, id, what, errors) {
  const owner = map.get(key);
  if (owner !== undefined && owner !== id) errors.push(`registry/${id}.json: ${what} is already used by registry/${owner}.json`);
  else if (owner === id && what === 'id') errors.push(`registry/${id}.json: duplicate id`);
  map.set(key, id);
}

function validateEntry(e, file) {
  const errs = [];
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return ['must be a JSON object'];
  for (const key of Object.keys(e)) if (!(key in FIELDS) && key !== '$schema') errs.push(`unknown field "${key}"`);
  for (const [key, type] of Object.entries(FIELDS)) {
    const v = e[key];
    if (type.endsWith('?') && v === undefined) continue;
    const base = type.replace('?', '');
    if (base === 'string' && (typeof v !== 'string' || v.trim() === '')) errs.push(`"${key}" must be a non-empty string`);
    if (base === 'array' && !Array.isArray(v)) errs.push(`"${key}" must be an array`);
    if (base === 'strings' && (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s.trim() === ''))) {
      errs.push(`"${key}" must be an array of non-empty strings`);
    }
  }
  if (errs.length) return errs;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) errs.push('"id" must be lowercase words joined by hyphens');
  if (basename(file, '.json') !== e.id) errs.push(`the file must be named ${e.id}.json`);
  if (!KINDS.includes(e.kind)) errs.push(`"kind" must be one of ${KINDS.join(', ')}`);
  for (const u of [e.url, ...e.evidence]) if (!/^https:\/\/\S+$/.test(u)) errs.push(`"${u}" is not an https URL`);
  if (e.evidence.length === 0) errs.push('"evidence" needs at least one link: vendor docs, or public commits that show the signal');
  for (const a of e.aliases) if (a !== a.toLowerCase().trim()) errs.push(`alias "${a}" must be lowercase`);
  for (const l of e.logins) if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/.test(l)) errs.push(`login "${l}" is not a valid GitHub login`);
  for (const m of e.emails) if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m)) errs.push(`email "${m}" is not an email address`);
  for (const t of e.trailers) {
    if (!/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(t)) errs.push(`trailer "${t}" is not a valid trailer key`);
    if (RESERVED_TRAILERS.includes(t.toLowerCase())) errs.push(`trailer "${t}" is read for every tool already; remove it`);
  }
  const signals = e.logins.length + e.emails.length + e.names.length + (e.nameMarkers?.length ?? 0) + e.trailers.length + e.footers.length + e.aliases.length;
  if (signals === 0) errs.push('needs at least one signal (logins, emails, names, nameMarkers, trailers, footers or aliases)');
  for (const p of [...e.names, ...(e.nameMarkers ?? [])]) errs.push(...checkPattern(p, false));
  for (const p of e.models) {
    errs.push(...checkPattern(p, false));
    if (!p.includes('(?<model>')) errs.push(`model pattern ${JSON.stringify(p)} needs a (?<model>…) group`);
  }
  for (const f of e.footers) {
    if (typeof f !== 'object' || f === null || typeof f.pattern !== 'string') { errs.push('each footer must be { "pattern": "…" }'); continue; }
    for (const key of Object.keys(f)) if (key !== 'pattern' && key !== 'scope') errs.push(`unknown footer field "${key}"`);
    if (f.scope !== undefined && !SCOPES.includes(f.scope)) errs.push(`footer scope must be one of ${SCOPES.join(', ')}`);
    errs.push(...checkPattern(f.pattern, true));
  }
  if (e.examples.length === 0) errs.push('"examples" needs at least one example');
  e.examples.forEach((x, i) => {
    const kinds = ['commit', 'pullRequest', 'actor'].filter((k) => x && k in x);
    if (kinds.length !== 1) errs.push(`examples[${i}] needs exactly one of "commit", "pullRequest" or "actor"`);
    if (!VERDICTS.includes(x?.verdict)) errs.push(`examples[${i}].verdict must be one of ${VERDICTS.join(', ')}`);
  });
  return errs;
}

// Patterns run against untrusted commit messages, so they must compile and stay simple.
function checkPattern(p, footer) {
  const errs = [];
  try {
    new RegExp(p, 'iu');
  } catch (err) {
    return [`pattern ${JSON.stringify(p)} does not compile: ${err.message}`];
  }
  if (p.length > 200) errs.push(`pattern ${JSON.stringify(p)} is longer than 200 characters`);
  // Quantified groups that themselves end in a quantifier, like (a+)+ or (\w*)*, can backtrack catastrophically.
  if (/[+*}?]\)[+*{]/.test(p)) errs.push(`pattern ${JSON.stringify(p)} has a nested quantifier`);
  if (/\.\*|\.\+/.test(p)) errs.push(`pattern ${JSON.stringify(p)} uses .* or .+; match the exact text instead`);
  if (/\\[1-9]/.test(p)) errs.push(`pattern ${JSON.stringify(p)} uses a backreference`);
  if (footer && /^\^|\$$/.test(p)) errs.push(`footer pattern ${JSON.stringify(p)} must not be anchored; footers are searched for anywhere`);
  return errs;
}

function runtimeData(entries) {
  return entries.map(({ evidence, examples, ...rest }) => rest);
}

function dataSource(entries) {
  return `// Generated by scripts/registry.mjs from registry/*.json. Do not edit: run \`npm run registry\`.
import type { RuntimeEntry } from './registry.js';

export const REGISTRY: readonly RuntimeEntry[] = ${JSON.stringify(runtimeData(entries), null, 2)};
`;
}

const KIND_LABEL = { 'ai-agent': 'AI agent', 'ai-reviewer': 'AI reviewer', bot: 'Bot' };

function readmeTable(entries) {
  const rows = entries.map((e) => {
    const signals = [
      ...e.logins.map((l) => `\`${l}\``),
      ...e.emails.map((m) => `\`${m}\``),
      ...e.trailers.map((t) => `\`${t}:\``),
      ...(e.names.length ? ['name pattern'] : []),
      ...(e.nameMarkers?.length ? ['name marker'] : []),
      ...(e.footers.length ? [`${e.footers.length} footer${e.footers.length > 1 ? 's' : ''}`] : []),
    ];
    return `| [${e.name}](${e.url}) | ${e.vendor} | ${KIND_LABEL[e.kind]} | ${signals.join(', ').replace(/\|/g, '\\|')} | [${e.id}](registry/${e.id}.json) |`;
  });
  return ['| Tool | Vendor | Kind | Recognised by | Entry |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

const START = '<!-- registry-table:start (generated by `npm run registry`) -->';
const END = '<!-- registry-table:end -->';

function withTable(readme, entries) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1 || b < a) return readme;
  return `${readme.slice(0, a + START.length)}\n${readmeTable(entries)}\n${readme.slice(b)}`;
}

// Line endings are normalised so that a CRLF checkout (git's core.autocrlf on Windows) compares equal.
function readOr(file, fallback) {
  try {
    return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return fallback;
  }
}

const args = process.argv.slice(2);
const entries = loadRegistry();
const counts = KINDS.map((k) => `${entries.filter((e) => e.kind === k).length} ${KIND_LABEL[k].toLowerCase()}s`).join(', ');

if (args[0] === '--json') {
  if (!args[1]) throw new Error('--json needs a file');
  writeFileSync(args[1], `${JSON.stringify({ version: 1, tools: entries }, null, 2)}\n`);
} else if (args[0] === '--check') {
  const stale = [];
  if (readOr(dataFile, '') !== dataSource(entries)) stale.push('src/registry-data.ts');
  const readme = readOr(readmeFile, '');
  if (readme && withTable(readme, entries) !== readme) stale.push('the table in README.md');
  if (stale.length) {
    console.error(`${stale.join(' and ')} ${stale.length > 1 ? 'are' : 'is'} out of date. Run: npm run registry`);
    process.exit(1);
  }
} else {
  writeFileSync(dataFile, dataSource(entries));
  const readme = readOr(readmeFile, '');
  if (readme) writeFileSync(readmeFile, withTable(readme, entries));
  console.log(`Registry OK: ${entries.length} tools (${counts}). Wrote src/registry-data.ts${readme ? ' and the README table' : ''}.`);
}
