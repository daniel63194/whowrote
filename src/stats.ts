import type { AgentSetup } from './setup.js';
import type { Result, ToolKind, Verdict } from './types.js';

export const VERDICTS: readonly Verdict[] = ['human', 'ai-assisted', 'ai-agent', 'bot'];

export type Counts = Record<Verdict, number>;

export interface ToolCount {
  id: string;
  name: string;
  vendor: string;
  kind: ToolKind;
  commits: number;
  models: { model: string; commits: number }[];
  /** Lines attributed by git notes (git-ai, Agent Trace), when there are any. */
  lines?: number;
}

export interface HintCount {
  note: string;
  tool?: string;
  commits: number;
}

export interface Period {
  period: string;
  total: number;
  verdicts: Counts;
}

export interface Summary {
  total: number;
  verdicts: Counts;
  /** Of the `human` commits, how many declare that no AI was used (`AI-assisted: no`). */
  declaredHuman: number;
  /** AI tools, most commits first. A commit can involve more than one tool. */
  tools: ToolCount[];
  /** Commits with AI involvement disclosed only through an unnamed tool, e.g. `Assisted-by: GPT-5.4`. */
  otherAI: number;
  /** Bots by name, most commits first. */
  bots: { name: string; commits: number }[];
  /** Weak signals among commits with no AI disclosed, most common first. They are not counted as AI. */
  hints: HintCount[];
  /** AI tools the repository is configured for (from its files), when known. */
  setup?: AgentSetup[];
  periods?: Period[];
  /** Committer dates of the oldest and newest commit seen, ISO 8601. */
  first?: string;
  last?: string;
}

export type PeriodUnit = 'week' | 'month' | 'quarter' | 'year';

export function zero(): Counts {
  return { human: 0, 'ai-assisted': 0, 'ai-agent': 0, bot: 0 };
}

/** `2026-10-12T08:00:00+02:00` → `2026-10` (month), `2026-Q4`, `2026`, or the ISO week `2026-W41`. */
export function periodOf(iso: string, unit: PeriodUnit): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (unit === 'year') return String(y);
  if (unit === 'quarter') return `${y}-Q${Math.ceil(m / 3)}`;
  if (unit === 'month') return `${y}-${String(m).padStart(2, '0')}`;
  // ISO 8601 week: the week with the year's first Thursday is week 1.
  const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const wy = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(wy, 0, 1)) / 86_400_000 + 1) / 7);
  return `${wy}-W${String(week).padStart(2, '0')}`;
}

export class Tally {
  private total = 0;
  private readonly verdicts = zero();
  private readonly tools = new Map<string, ToolCount & { modelMap: Map<string, number> }>();
  private otherAI = 0;
  private declaredHuman = 0;
  private readonly bots = new Map<string, number>();
  private readonly hints = new Map<string, HintCount>();
  private readonly periods = new Map<string, Period>();
  private first: string | undefined;
  private last: string | undefined;

  constructor(private readonly unit?: PeriodUnit) {}

  add(r: Result, date?: string): void {
    this.total++;
    this.verdicts[r.verdict]++;
    for (const t of r.tools) {
      if (t.kind === 'bot') continue;
      let c = this.tools.get(t.id);
      if (!c) {
        c = { id: t.id, name: t.name, vendor: t.vendor, kind: t.kind, commits: 0, models: [], modelMap: new Map() };
        this.tools.set(t.id, c);
      }
      c.commits++;
      for (const m of t.models) c.modelMap.set(m, (c.modelMap.get(m) ?? 0) + 1);
      if (t.lines !== undefined) c.lines = (c.lines ?? 0) + t.lines;
    }
    if (r.declaredHuman) this.declaredHuman++;
    if (r.verdict === 'human') {
      // Count each hint once per commit.
      for (const key of new Set(r.hints.map((h) => `${h.tool ?? ''}\u0000${h.note}`))) {
        const [tool, note] = key.split('\u0000') as [string, string];
        const h = this.hints.get(key) ?? { note, ...(tool ? { tool } : {}), commits: 0 };
        h.commits++;
        this.hints.set(key, h);
      }
    }
    if (r.ai && !r.tools.some((t) => t.kind !== 'bot')) this.otherAI++;
    if (r.verdict === 'bot') {
      const name = botName(r);
      this.bots.set(name, (this.bots.get(name) ?? 0) + 1);
    }
    if (date) {
      if (this.first === undefined || date < this.first) this.first = date;
      if (this.last === undefined || date > this.last) this.last = date;
      if (this.unit) {
        const key = periodOf(date, this.unit);
        let p = this.periods.get(key);
        if (!p) {
          p = { period: key, total: 0, verdicts: zero() };
          this.periods.set(key, p);
        }
        p.total++;
        p.verdicts[r.verdict]++;
      }
    }
  }

  summary(): Summary {
    const s: Summary = {
      total: this.total,
      verdicts: { ...this.verdicts },
      tools: [...this.tools.values()]
        .map(({ modelMap, ...t }) => ({
          ...t,
          models: [...modelMap].map(([model, commits]) => ({ model, commits })).sort((a, b) => b.commits - a.commits || a.model.localeCompare(b.model)),
        }))
        .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name)),
      otherAI: this.otherAI,
      bots: [...this.bots].map(([name, commits]) => ({ name, commits })).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name)),
      declaredHuman: this.declaredHuman,
      hints: [...this.hints.values()].sort((a, b) => b.commits - a.commits || a.note.localeCompare(b.note)),
    };
    if (this.unit) s.periods = [...this.periods.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
    if (this.first !== undefined) s.first = this.first;
    if (this.last !== undefined) s.last = this.last;
    return s;
  }
}

/** The registry name of the bot that authored a commit, or its git name or login. */
function botName(r: Result): string {
  const bot = r.tools.find((t) => t.kind === 'bot');
  if (bot) return bot.name;
  const e = r.evidence.find((x) => x.signal === 'author' && x.kind === 'bot');
  if (!e) return 'unknown';
  const lt = e.value.lastIndexOf(' <');
  return lt > 0 ? e.value.slice(0, lt) : e.value;
}
