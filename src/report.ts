import { getTool } from './registry.js';
import type { AgentSetup } from './setup.js';
import type { Summary } from './stats.js';
import type { Evidence, Hint, Result, Verdict } from './types.js';

// Control characters (including terminal escape sequences) and bidirectional overrides ("Trojan Source")
// in commit messages and names could rewrite the terminal or reorder text.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Makes untrusted text safe to print: unsafe characters become `\uXXXX`. */
export function displaySafe(text: string): string {
  return text.replace(UNSAFE, (ch) => (ch === '\t' ? ' ' : `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

export const LABEL: Record<Verdict, string> = {
  human: 'No AI disclosed',
  'ai-assisted': 'AI-assisted',
  'ai-agent': 'AI agent',
  bot: 'Bot',
};
export const DECLARED_LABEL = 'Declared no AI';

/** The label for a result: "Declared no AI" when a person declared it, else the verdict's label. */
export const resultLabel = (r: Pick<Result, 'verdict' | 'declaredHuman'>): string => (r.declaredHuman ? DECLARED_LABEL : LABEL[r.verdict]);

const COLOR: Record<Verdict, number> = { human: 32, 'ai-assisted': 35, 'ai-agent': 36, bot: 90 };

/** "Claude (Anthropic)", but "GitHub Copilot" rather than "GitHub Copilot (GitHub)". */
export const toolName = (t: { name: string; vendor: string }): string => (t.name.includes(t.vendor) ? t.name : `${t.name} (${t.vendor})`);

const num = (n: number): string => n.toLocaleString('en-US');
const pct = (n: number, total: number): string => (total === 0 ? '0%' : `${((100 * n) / total).toFixed(n === total || n === 0 ? 0 : 1)}%`);

export interface ReportMeta {
  /** What was analysed, e.g. the repository folder name. */
  title: string;
  /** Revision range, if not the default. */
  range?: string | undefined;
  /** The revision the agent setup was read from, e.g. `HEAD`. */
  setupAt?: string | undefined;
}

export interface ReportOptions {
  color?: boolean;
  /** Show weak signals (hints). */
  hints?: boolean;
}

type Paint = (code: number, s: string) => string;
const painter = (color: boolean): Paint => (code, s) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);

function dateRange(s: Summary): string {
  if (!s.first || !s.last) return '';
  const a = s.first.slice(0, 10);
  const b = s.last.slice(0, 10);
  return a === b ? a : `${a} → ${b}`;
}

function modelList(models: { model: string; commits: number }[], max = 3): string {
  const shown = models.slice(0, max).map((m) => `${m.model} (${num(m.commits)})`);
  if (models.length > max) shown.push(`+${models.length - max} more`);
  return shown.join(' · ');
}

/** The rows of the verdict table: "No AI disclosed" without the declared ones, then "Declared no AI" if any. */
function verdictRows(s: Summary): { label: string; n: number; color: number }[] {
  const rows = [{ label: LABEL.human, n: s.verdicts.human - s.declaredHuman, color: COLOR.human }];
  if (s.declaredHuman > 0) rows.push({ label: DECLARED_LABEL, n: s.declaredHuman, color: COLOR.human });
  for (const v of ['ai-assisted', 'ai-agent', 'bot'] as const) rows.push({ label: LABEL[v], n: s.verdicts[v], color: COLOR[v] });
  return rows;
}

function setupFiles(e: AgentSetup, max = 2): string {
  // The shortest paths first: top-level files say more than deeply nested ones.
  const shown = [...e.files].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, max);
  if (e.files.length > max) shown.push(`+${e.files.length - max} more`);
  return shown.join(', ');
}

function hintLabel(h: { note: string; tool?: string }): string {
  const t = h.tool ? getTool(h.tool) : undefined;
  return t && !h.note.includes(t.name) ? `${t.name}: ${h.note}` : h.note;
}

const DISCLAIMER = [
  'Based on what commits disclose (co-author trailers, agent accounts, branches, session links, attribution',
  'notes). "No AI disclosed" means no AI tool or automation was disclosed, not that none was used.',
];

/** The terminal report. */
export function renderText(s: Summary, meta: ReportMeta, options: ReportOptions = {}): string {
  const c = painter(options.color ?? false);
  const safe = displaySafe;
  const out: string[] = [];
  const head = [safe(meta.title), `${num(s.total)} commit${s.total === 1 ? '' : 's'}`, dateRange(s), meta.range ? safe(meta.range) : ''].filter(Boolean);
  out.push(c(1, `whowrote · ${head.join(' · ')}`));
  out.push('');
  if (s.total === 0) {
    out.push('  No commits in this range.');
    return `${out.join('\n')}\n`;
  }
  const width = 24;
  for (const row of verdictRows(s)) {
    const bar = '█'.repeat(Math.round((width * row.n) / s.total)) || (row.n > 0 ? '▏' : '');
    out.push(`  ${row.label.padEnd(16)} ${num(row.n).padStart(9)}  ${pct(row.n, s.total).padStart(6)}  ${c(row.color, bar)}`);
  }

  if (s.tools.length > 0 || s.otherAI > 0) {
    out.push('');
    out.push(c(1, `  ${'AI tools'.padEnd(34)} ${'commits'.padStart(8)}  models`));
    for (const t of s.tools) {
      const extra = [modelList(t.models), t.lines ? `${num(t.lines)} lines in notes` : ''].filter(Boolean).join(' · ');
      out.push(`  ${safe(toolName(t)).padEnd(34)} ${num(t.commits).padStart(8)}  ${c(90, safe(extra))}`);
    }
    if (s.otherAI > 0) out.push(`  ${'Unnamed AI tool'.padEnd(34)} ${num(s.otherAI).padStart(8)}  ${c(90, 'disclosed without a known tool name')}`);
  }

  if (s.bots.length > 0) {
    out.push('');
    out.push(c(1, `  ${'Bots'.padEnd(34)} ${'commits'.padStart(8)}`));
    for (const b of s.bots.slice(0, 10)) out.push(`  ${safe(b.name).slice(0, 34).padEnd(34)} ${num(b.commits).padStart(8)}`);
    if (s.bots.length > 10) {
      const rest = s.bots.slice(10).reduce((a, b) => a + b.commits, 0);
      out.push(c(90, `  ${`${s.bots.length - 10} more`.padEnd(34)} ${num(rest).padStart(8)}`));
    }
  }

  if (s.setup && s.setup.length > 0) {
    out.push('');
    out.push(c(1, `  ${`Agent setup${meta.setupAt ? ` at ${safe(meta.setupAt)}` : ''}`.padEnd(34)} files`));
    for (const e of s.setup) out.push(`  ${safe(e.tool ? toolName(e.tool) : e.name).padEnd(34)} ${c(90, safe(setupFiles(e)))}`);
  }

  if (options.hints) {
    out.push('');
    if (s.hints.length === 0) {
      out.push(c(90, '  Hints: none among the commits with no AI disclosed.'));
    } else {
      out.push(c(1, `  ${'Hints, among commits with no AI disclosed'.padEnd(62)} ${'commits'.padStart(8)}`));
      for (const h of s.hints.slice(0, 10)) out.push(`  ${safe(hintLabel(h)).slice(0, 62).padEnd(62)} ${num(h.commits).padStart(8)}`);
      out.push(c(90, '  Weak signals: often seen with AI tools, but people do these things too. Not counted above.'));
    }
  }

  if (s.periods && s.periods.length > 0) {
    out.push('');
    out.push(c(1, `  ${'Period'.padEnd(10)} ${'Commits'.padStart(8)} ${'No AI disclosed'.padStart(16)} ${'AI-assisted'.padStart(12)} ${'AI agent'.padStart(9)} ${'Bot'.padStart(6)}`));
    for (const p of s.periods) {
      const cell = (v: Verdict, w: number): string => pct(p.verdicts[v], p.total).padStart(w);
      out.push(`  ${p.period.padEnd(10)} ${num(p.total).padStart(8)} ${cell('human', 16)} ${cell('ai-assisted', 12)} ${cell('ai-agent', 9)} ${cell('bot', 6)}`);
    }
  }

  out.push('');
  for (const line of DISCLAIMER) out.push(c(90, `  ${line}`));
  return `${out.join('\n')}\n`;
}

const escapeMd = (s: string): string => displaySafe(s).replace(/[\\`*_[\]<>|#!~]/g, (ch) => `\\${ch}`);

/** The Markdown report, for GitHub job summaries, issues and READMEs. */
export function renderMarkdown(s: Summary, meta: ReportMeta, options: ReportOptions = {}): string {
  const out: string[] = [];
  const head = [`${num(s.total)} commit${s.total === 1 ? '' : 's'}`, dateRange(s), meta.range ? `\`${displaySafe(meta.range).replace(/`/g, "'")}\`` : ''].filter(Boolean);
  out.push(`### whowrote: ${escapeMd(meta.title)}`);
  out.push('');
  out.push(head.join(' · '));
  out.push('');
  if (s.total === 0) {
    out.push('No commits in this range.');
    return `${out.join('\n')}\n`;
  }
  out.push('| | Commits | Share |');
  out.push('| --- | ---: | ---: |');
  for (const row of verdictRows(s)) out.push(`| ${row.label} | ${num(row.n)} | ${pct(row.n, s.total)} |`);
  if (s.tools.length > 0 || s.otherAI > 0) {
    out.push('');
    out.push('| AI tool | Commits | Models |');
    out.push('| --- | ---: | --- |');
    for (const t of s.tools) out.push(`| ${escapeMd(toolName(t))} | ${num(t.commits)} | ${escapeMd(modelList(t.models))} |`);
    if (s.otherAI > 0) out.push(`| Unnamed AI tool | ${num(s.otherAI)} | |`);
  }
  if (s.bots.length > 0) {
    out.push('');
    out.push('| Bot | Commits |');
    out.push('| --- | ---: |');
    for (const b of s.bots.slice(0, 10)) out.push(`| ${escapeMd(b.name)} | ${num(b.commits)} |`);
    if (s.bots.length > 10) out.push(`| ${s.bots.length - 10} more | ${num(s.bots.slice(10).reduce((a, b) => a + b.commits, 0))} |`);
  }
  if (s.setup && s.setup.length > 0) {
    out.push('');
    out.push(`| Agent setup${meta.setupAt ? ` at \`${displaySafe(meta.setupAt).replace(/`/g, "'")}\`` : ''} | Files |`);
    out.push('| --- | --- |');
    for (const e of s.setup) out.push(`| ${escapeMd(e.tool ? toolName(e.tool) : e.name)} | ${escapeMd(setupFiles(e))} |`);
  }
  if (options.hints && s.hints.length > 0) {
    out.push('');
    out.push('| Hint (weak signal, not counted) | Commits with no AI disclosed |');
    out.push('| --- | ---: |');
    for (const h of s.hints.slice(0, 10)) out.push(`| ${escapeMd(hintLabel(h))} | ${num(h.commits)} |`);
  }
  if (s.periods && s.periods.length > 0) {
    out.push('');
    out.push('| Period | Commits | No AI disclosed | AI-assisted | AI agent | Bot |');
    out.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const p of s.periods) {
      out.push(`| ${p.period} | ${num(p.total)} | ${(['human', 'ai-assisted', 'ai-agent', 'bot'] as const).map((v) => pct(p.verdicts[v], p.total)).join(' | ')} |`);
    }
  }
  out.push('');
  out.push('<sub>Counted by [whowrote](https://github.com/daniel63194/whowrote) from what commits disclose. "No AI disclosed" means no AI tool or automation was disclosed, not that none was used.</sub>');
  return `${out.join('\n')}\n`;
}

const SIGNAL_LABEL: Record<Evidence['signal'], string> = {
  author: 'author',
  committer: 'committer',
  'co-author': 'co-author',
  trailer: 'trailer',
  footer: 'footer',
  'name-marker': 'name marker',
  branch: 'branch',
  'pr-author': 'PR author',
  note: 'note',
};

function toolLabel(e: Evidence): string {
  if (e.kind === 'human') return 'declared no AI';
  if (!e.tool) return e.kind === 'ai' ? 'unnamed AI tool' : 'unlisted bot';
  const t = getTool(e.tool);
  return t ? toolName(t) : e.tool;
}

const HINT_LABEL: Record<Hint['hint'], string> = { 'agent-config': 'config', branch: 'branch', text: 'text' };

/** One commit or pull request, with every piece of evidence and every hint. */
export function renderExplain(
  commit: { sha: string; subject: string; author: string },
  r: Result,
  options: { color?: boolean } = {},
): string {
  const c = painter(options.color ?? false);
  const safe = displaySafe;
  const out: string[] = [];
  out.push(commit.sha ? `${c(33, commit.sha.slice(0, 12))} ${safe(commit.subject)}` : safe(commit.subject));
  out.push(`  verdict   ${c(COLOR[r.verdict], resultLabel(r))}`);
  out.push(`  author    ${safe(commit.author)}`);
  if (r.evidence.length === 0) {
    out.push(`  evidence  ${c(90, 'none: no AI tool or automation is disclosed')}`);
  }
  r.evidence.forEach((e, i) => {
    const note = [
      e.model ? `model ${e.model}` : '',
      e.scope === 'message' ? 'message only, does not change the verdict' : '',
      e.kind === 'human' && r.verdict !== 'human' ? 'outweighed by the AI evidence' : '',
    ]
      .filter(Boolean)
      .join('; ');
    const line = `${SIGNAL_LABEL[e.signal].padEnd(11)} ${toolLabel(e).padEnd(28)} ${e.value}`;
    out.push(`  ${i === 0 ? 'evidence' : ''.padEnd(8)}  ${safe(line)}${note ? c(90, `  (${safe(note)})`) : ''}`);
  });
  r.hints.forEach((h, i) => {
    const t = h.tool ? getTool(h.tool) : undefined;
    const line = `${HINT_LABEL[h.hint].padEnd(11)} ${(t ? toolName(t) : '').padEnd(28)} ${h.value}`;
    out.push(`  ${i === 0 ? 'hints   ' : ''.padEnd(8)}  ${c(90, `${safe(line)}  (${safe(h.note)}; weak, not counted)`)}`);
  });
  return `${out.join('\n')}\n`;
}

/** One line per commit for `--commits`. */
export function renderCommitLine(commit: { sha: string; subject: string }, r: Result, options: { color?: boolean } = {}): string {
  const c = painter(options.color ?? false);
  const who = r.tools.filter((t) => t.kind !== 'bot').map((t) => t.name);
  if (who.length === 0 && r.ai) who.push('unnamed AI tool');
  if (r.verdict === 'bot') {
    const bot = r.tools.find((t) => t.kind === 'bot')?.name ?? r.evidence.find((e) => e.signal === 'author')?.value.replace(/ <.*$/, '') ?? '';
    who.push(bot);
  }
  return `${c(33, commit.sha.slice(0, 10))}  ${c(COLOR[r.verdict], resultLabel(r).padEnd(15))}  ${displaySafe(who.join(', ')).slice(0, 40).padEnd(24)}  ${displaySafe(commit.subject).slice(0, 100)}`;
}
