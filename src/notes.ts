/**
 * Reads AI attribution records that tools store in git notes:
 *
 * - **git-ai** authorship logs (`refs/notes/ai`): file paths with indented `<session> <line ranges>`
 *   entries, a `---` line, then JSON whose `prompts` map each session to its `agent_id` (`tool`, `model`).
 *   https://usegitai.com/docs/get-started/how-git-ai-works
 * - **Agent Trace** records: JSON with `files[].conversations[]`, each with a `contributor` (`type` ai,
 *   human, mixed or unknown; optional `model_id`) and line `ranges`. The spec leaves storage open; git notes
 *   are one of the options it lists. https://agent-trace.dev
 *
 * Anything else is ignored. Notes are untrusted input: sizes are capped and malformed records are skipped.
 */

export interface NoteAttribution {
  format: 'git-ai' | 'agent-trace';
  /** `ai` for AI-written lines (including Agent Trace's `mixed`), `human` for lines a person wrote. */
  kind: 'ai' | 'human';
  /** The tool's own name for itself, e.g. `cursor` or `claude`, when the record says. */
  tool?: string;
  model?: string;
  /** Number of lines attributed, when the record has line ranges. */
  lines?: number;
}

const MAX_NOTE = 2_000_000;
const MAX_LINES = 10_000_000;

/** `1-5,10,15-20` → 12. Malformed pieces count as 0. */
export function countLines(ranges: string): number {
  let n = 0;
  for (const piece of ranges.split(',')) {
    const m = /^\s*(\d{1,9})(?:\s*-\s*(\d{1,9}))?\s*$/.exec(piece);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b >= a) n += b - a + 1;
  }
  return Math.min(n, MAX_LINES);
}

type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() !== '' ? x.trim().slice(0, 200) : undefined);

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function merge(out: NoteAttribution[], a: NoteAttribution): void {
  const same = out.find((x) => x.format === a.format && x.kind === a.kind && x.tool === a.tool && x.model === a.model);
  if (!same) {
    out.push(a);
    return;
  }
  if (a.lines !== undefined) same.lines = Math.min((same.lines ?? 0) + a.lines, MAX_LINES);
}

function agentOf(prompt: unknown): { tool?: string; model?: string } {
  if (!isObject(prompt)) return {};
  const agent = isObject(prompt['agent_id']) ? prompt['agent_id'] : prompt;
  const out: { tool?: string; model?: string } = {};
  const tool = str(agent['tool']);
  const model = str(agent['model']);
  if (tool) out.tool = tool;
  if (model) out.model = model;
  return out;
}

/** git-ai's text format: attestation lines, `---`, then JSON metadata. */
function readGitAi(text: string, out: NoteAttribution[]): boolean {
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex((l) => l.trim() === '---');
  if (sep === -1) return false;
  const meta = tryJson(lines.slice(sep + 1).join('\n'));
  const prompts = isObject(meta) && isObject(meta['prompts']) ? meta['prompts'] : {};
  const schema = isObject(meta) ? str(meta['schema_version']) : undefined;
  const counts = new Map<string, number>();
  for (const line of lines.slice(0, sep)) {
    // "  <session> <ranges>": indented, as opposed to the file path lines.
    if (!/^\s/.test(line) || line.length > 20_000) continue;
    const t = line.trim();
    const space = t.search(/\s/);
    if (space === -1) continue;
    const session = t.slice(0, space);
    const ranges = t.slice(space + 1).trim();
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(session) || !/^[\d,\s-]+$/.test(ranges)) continue;
    counts.set(session, (counts.get(session) ?? 0) + countLines(ranges));
  }
  if (counts.size === 0 && !schema?.startsWith('authorship/')) return false;
  for (const [session, lineCount] of counts) {
    merge(out, { format: 'git-ai', kind: 'ai', ...agentOf(prompts[session]), lines: lineCount });
  }
  // Sessions in the metadata without attested lines still say which tool was used.
  if (counts.size === 0) for (const p of Object.values(prompts)) merge(out, { format: 'git-ai', kind: 'ai', ...agentOf(p) });
  return true;
}

/** An Agent Trace record, or an older git-ai log stored as plain JSON. */
function readJson(value: unknown, out: NoteAttribution[]): boolean {
  if (!isObject(value)) return false;
  if (Array.isArray(value['files'])) {
    const recordTool = isObject(value['tool']) ? str(value['tool']['name']) : undefined;
    let found = false;
    for (const file of value['files'].slice(0, 10_000)) {
      if (!isObject(file) || !Array.isArray(file['conversations'])) continue;
      for (const conv of file['conversations'].slice(0, 10_000)) {
        if (!isObject(conv)) continue;
        const ranges = Array.isArray(conv['ranges']) ? conv['ranges'] : [];
        const byContributor = new Map<string, { kind: 'ai' | 'human'; model?: string; lines: number }>();
        for (const r of ranges.slice(0, 100_000)) {
          if (!isObject(r)) continue;
          const who = isObject(r['contributor']) ? r['contributor'] : isObject(conv['contributor']) ? conv['contributor'] : {};
          const type = str(who['type']);
          if (type !== 'ai' && type !== 'mixed' && type !== 'human') continue;
          const kind = type === 'human' ? 'human' : 'ai';
          const model = str(who['model_id']);
          const start = Number(r['start_line']);
          const end = Number(r['end_line']);
          const n = Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start ? Math.min(end - start + 1, MAX_LINES) : 0;
          const key = `${kind}\u0000${model ?? ''}`;
          const entry = byContributor.get(key) ?? { kind, ...(model ? { model } : {}), lines: 0 };
          entry.lines = Math.min(entry.lines + n, MAX_LINES);
          byContributor.set(key, entry);
        }
        for (const e of byContributor.values()) {
          found = true;
          const a: NoteAttribution = { format: 'agent-trace', kind: e.kind, lines: e.lines };
          if (e.kind === 'ai' && recordTool) a.tool = recordTool;
          if (e.model) a.model = e.model;
          merge(out, a);
        }
      }
    }
    return found;
  }
  // git-ai 1.x/2.x stored the whole log as JSON; take the agents it names.
  if (str(value['schema_version'])?.startsWith('authorship/') && isObject(value['prompts'])) {
    for (const p of Object.values(value['prompts'])) merge(out, { format: 'git-ai', kind: 'ai', ...agentOf(p) });
    return true;
  }
  return false;
}

/** Reads every attribution record in the text of one or more git notes. */
export function parseNotes(notes: string | readonly string[] | null | undefined): NoteAttribution[] {
  const out: NoteAttribution[] = [];
  const list = typeof notes === 'string' ? [notes] : (notes ?? []);
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const text = raw.length > MAX_NOTE ? raw.slice(0, MAX_NOTE) : raw;
    if (readJson(tryJson(text), out)) continue;
    if (readGitAi(text, out)) continue;
    // Several JSON records, one per line (JSON Lines).
    for (const line of text.split(/\r?\n/)) if (line.trim().startsWith('{')) readJson(tryJson(line), out);
  }
  return out;
}
