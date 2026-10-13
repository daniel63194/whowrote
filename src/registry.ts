import { REGISTRY } from './registry-data.js';
import { globToRegExp } from './glob.js';
import { candidateLogins, looksLikeBot } from './identity.js';
import type { Identity, RegistryEntry, Scope, Tool } from './types.js';

/** A registry entry as shipped in the library (without the evidence links and examples). */
export type RuntimeEntry = Omit<RegistryEntry, 'evidence' | 'examples'>;

export interface CompiledTool {
  tool: Tool;
  ai: boolean;
  names: RegExp[];
  markers: RegExp[];
  models: RegExp[];
  footers: { re: RegExp; scope: Scope }[];
  branches: RegExp[];
  hints: { res: RegExp[]; in: 'message' | 'branch'; note: string }[];
  files: { glob: string; re: RegExp }[];
}

const compiled: CompiledTool[] = REGISTRY.map((e) => ({
  tool: Object.freeze({ id: e.id, name: e.name, vendor: e.vendor, kind: e.kind, url: e.url, description: e.description }),
  ai: e.kind !== 'bot',
  names: e.names.map((p) => new RegExp(p, 'iu')),
  markers: (e.nameMarkers ?? []).map((p) => new RegExp(p, 'iu')),
  models: e.models.map((p) => new RegExp(p, 'iu')),
  footers: e.footers.map((f) => ({ re: new RegExp(f.pattern, 'iu'), scope: f.scope ?? 'code' })),
  branches: (e.branches ?? []).map((p) => new RegExp(p, 'iu')),
  hints: (e.hints ?? []).map((h) => ({ res: h.all.map((p) => new RegExp(p, 'imu')), in: h.in ?? 'message', note: h.note })),
  files: (e.files ?? []).map((glob) => ({ glob, re: globToRegExp(glob) })),
}));

const byId = new Map(compiled.map((c) => [c.tool.id, c]));
const byLogin = new Map<string, CompiledTool>();
const byEmail = new Map<string, CompiledTool>();
const byTrailer = new Map<string, CompiledTool>();
const aliases: [string, CompiledTool][] = [];
REGISTRY.forEach((e, i) => {
  const c = compiled[i]!;
  for (const l of e.logins) byLogin.set(l.toLowerCase(), c);
  for (const m of e.emails) byEmail.set(m.toLowerCase(), c);
  for (const t of e.trailers) byTrailer.set(t.toLowerCase(), c);
  for (const a of new Set([...e.aliases, e.name.toLowerCase(), e.id])) aliases.push([a, c]);
});
// Longest first, so "github copilot" wins over "copilot" and "cursor bugbot" over "cursor".
aliases.sort((a, b) => b[0].length - a[0].length);

export const footerTools: readonly CompiledTool[] = compiled.filter((c) => c.footers.length > 0);

/** Every tool in the registry: AI agents, then AI reviewers, then bots. */
export const tools: readonly Tool[] = Object.freeze(compiled.map((c) => c.tool));

/** Looks up a registry tool by id, e.g. `getTool('claude')`. */
export function getTool(id: string): Tool | undefined {
  return byId.get(id)?.tool;
}

export function compiledTool(id: string): CompiledTool | undefined {
  return byId.get(id);
}

export function trailerTool(key: string): CompiledTool | undefined {
  return byTrailer.get(key.toLowerCase());
}

export type IdentityMatch =
  | { type: 'tool'; tool: CompiledTool; model?: string }
  | { type: 'marker'; tool: CompiledTool }
  | { type: 'bot' }
  | { type: 'none' };

/**
 * Matches an identity against the registry. An AI tool wins over a bot (the identity
 * "Copilot Autofix powered by AI <…+github-advanced-security[bot]@…>" is Copilot, not a generic bot),
 * and within each, a login beats an email, which beats a name pattern.
 */
export function matchIdentity(id: Identity): IdentityMatch {
  const hits: CompiledTool[] = [];
  for (const l of candidateLogins(id)) {
    const c = byLogin.get(l);
    if (c) hits.push(c);
  }
  if (id.email) {
    const c = byEmail.get(id.email.toLowerCase());
    if (c) hits.push(c);
  }
  if (id.name) {
    const name = id.name.slice(0, 300);
    for (const c of compiled) if (c.names.some((re) => re.test(name))) hits.push(c);
  }
  const best = hits.find((c) => c.ai) ?? hits[0];
  if (best) {
    const model = id.name ? modelFrom(best, id.name) : undefined;
    return model === undefined ? { type: 'tool', tool: best } : { type: 'tool', tool: best, model };
  }
  if (id.name) {
    const name = id.name.slice(0, 300);
    for (const c of compiled) if (c.markers.some((re) => re.test(name))) return { type: 'marker', tool: c };
  }
  return looksLikeBot(id) ? { type: 'bot' } : { type: 'none' };
}

export function modelFrom(c: CompiledTool, text: string): string | undefined {
  for (const re of c.models) {
    const m = re.exec(text.slice(0, 300));
    const model = m?.groups?.['model']?.trim();
    if (model) return model;
  }
  return undefined;
}

/** Finds a registry tool named in free text, such as the value of `Assisted-by: Claude:claude-opus-4`. */
export function toolByAlias(text: string): CompiledTool | undefined {
  const s = text.slice(0, 300).toLowerCase();
  for (const [alias, c] of aliases) {
    let from = 0;
    for (;;) {
      const at = s.indexOf(alias, from);
      if (at === -1) break;
      const before = at === 0 ? '' : s[at - 1]!;
      const after = s[at + alias.length] ?? '';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return c;
      from = at + 1;
    }
  }
  return undefined;
}

/**
 * The tool whose name or alias `text` starts with: "GitHub Copilot on behalf of @mona" → GitHub Copilot.
 * A one-word name followed by a capitalised word is taken as a person ("Devin Griffin", "Claude Monet").
 */
export function toolNamedAtStart(text: string): CompiledTool | undefined {
  const head = text.slice(0, 300);
  const s = head.toLowerCase();
  for (const [alias, c] of aliases) {
    if (!s.startsWith(alias)) continue;
    const rest = head.slice(alias.length);
    if (!/^(?:$|[\s\]).,:;!*_'"<’])/u.test(rest)) continue;
    if (!alias.includes(' ') && /^\s+\p{Lu}\p{Ll}/u.test(rest)) continue;
    return c;
  }
  return undefined;
}

/** The tool that creates branches named like this on its own (`copilot/…`, `claude/…`), if any. */
export function branchTool(branch: string): CompiledTool | undefined {
  const b = branch.slice(0, 300);
  return compiled.find((c) => c.branches.some((re) => re.test(b)));
}

/** Weak signals in a branch name or a message: registry hints whose patterns all match. */
export function hintsIn(where: 'message' | 'branch', text: string): { tool: CompiledTool; note: string; excerpt: string }[] {
  const t = text.length > 200_000 ? text.slice(0, 200_000) : text;
  const out: { tool: CompiledTool; note: string; excerpt: string }[] = [];
  for (const c of compiled) {
    for (const h of c.hints) {
      if (h.in !== where) continue;
      const first = h.res[0]!.exec(t);
      if (first && h.res.slice(1).every((re) => re.test(t))) out.push({ tool: c, note: h.note, excerpt: where === 'branch' ? t : first[0] });
    }
  }
  return out;
}

/** Instruction files several agents read, so they can't be credited to one tool. */
export const SHARED_AGENT_FILES = Object.freeze({
  name: 'Shared agent instructions',
  url: 'https://agents.md',
  files: ['**/AGENTS.md', '**/AGENT.md'],
});
const sharedFiles = SHARED_AGENT_FILES.files.map((glob) => ({ glob, re: globToRegExp(glob) }));

/** Which AI tool a repository file configures: `CLAUDE.md` → Claude, `AGENTS.md` → shared. */
export function configFileOwner(path: string): { tool?: CompiledTool; shared?: true } | undefined {
  const p = path.replace(/^\.\//, '');
  for (const c of compiled) if (c.files.some((f) => f.re.test(p))) return { tool: c };
  if (sharedFiles.some((f) => f.re.test(p))) return { shared: true };
  return undefined;
}

/** Every agent config glob, for asking git which commits changed one. */
export function agentConfigGlobs(): string[] {
  return [...compiled.flatMap((c) => c.files.map((f) => f.glob)), ...SHARED_AGENT_FILES.files];
}
