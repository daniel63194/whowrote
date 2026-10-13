#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { classifyActor, classifyCommit, classifyPullRequest } from './classify.js';
import { GitError, readCommits, type GitCommit, type LogOptions } from './git.js';
import { tools } from './registry.js';
import { LABEL, displaySafe, renderCommitLine, renderExplain, renderMarkdown, renderText, toolName } from './report.js';
import { Tally, VERDICTS, type PeriodUnit } from './stats.js';
import type { CommitInput, Identity, PullRequestInput, Result, Verdict } from './types.js';

const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const HELP = `whowrote ${VERSION} - human, bot or AI agent? See who wrote a repository's commits

Usage:
  whowrote [<revision-range>...] [-- <path>...]   Break down a repository's history
  whowrote explain [<commit>...]                  Show the evidence behind each commit's verdict
  whowrote actor <identity>...                    Classify accounts and git identities, e.g.
                                                  dependabot[bot] or "Jane Doe <jane@example.com>"
  whowrote pr [--event <file>]                    Classify a pull request from a GitHub event or
                                                  \`gh pr view --json author,title,body,commits\` (- for stdin)
  whowrote tools                                  List the AI tools and bots whowrote recognises

Options:
  -C <dir>                     Run in this repository (default: the current directory)
  --since <date>, --until <date>
                               Limit by commit date ("90 days ago", 2026-01-01)
  -n, --max-count <n>          Look at the newest <n> commits only
  --by <week|month|quarter|year>
                               Add a breakdown by period
  --merges                     Include merge commits (default: left out)
  --first-parent               Follow only the first parent of merges
  --commits                    List each AI and bot commit (with --format json: every commit)
  --format <text|markdown|json>
                               Output format (default: text)
  --fail-on <verdicts>         Exit with code 1 if any commit (or the pull request) has one of these
                               verdicts: ai, ai-agent, ai-assisted, bot (comma-separated)
  --summary <file>             Also append the Markdown report to this file (e.g. $GITHUB_STEP_SUMMARY)
  --no-color                   Plain output
  -h, --help                   Show this help
  -v, --version                Show the version

Verdicts:
  human        nothing discloses AI involvement or automation
  ai-assisted  a person is the author and AI involvement is disclosed (e.g. Co-authored-by: Claude)
  ai-agent     an AI agent's own identity is the author (e.g. Copilot, Devin)
  bot          an automation account (e.g. dependabot[bot]) with no AI involvement disclosed

whowrote reads what commits disclose. It does not guess from code style.
To analyse a branch named like a command, write refs/heads/<name>.
Docs: https://github.com/daniel63194/whowrote
`;

class UsageError extends Error {}

const COMMANDS = new Set(['explain', 'actor', 'pr', 'tools']);
const PERIODS: readonly PeriodUnit[] = ['week', 'month', 'quarter', 'year'];
type Format = 'text' | 'markdown' | 'json';

interface Options {
  cwd: string;
  format: Format;
  color: boolean;
  failOn: Set<Verdict>;
  summary?: string;
  log: LogOptions;
  by?: PeriodUnit;
  commits: boolean;
  event?: string;
}

const useColor = (flag: boolean): boolean => flag && process.stdout.isTTY === true && !process.env['NO_COLOR'];

function write(s: string): void {
  process.stdout.write(s);
}

function subject(message: string): string {
  return message.split('\n', 1)[0] ?? '';
}

function commitInput(c: GitCommit): CommitInput {
  return { message: c.message, author: c.author, committer: c.committer };
}

function parseFailOn(raw: string[] | undefined): Set<Verdict> {
  const out = new Set<Verdict>();
  for (const v of (raw ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)) {
    if (v === 'ai') {
      out.add('ai-assisted');
      out.add('ai-agent');
    } else if ((VERDICTS as readonly string[]).includes(v) && v !== 'human') out.add(v as Verdict);
    else throw new UsageError(`--fail-on takes ai, ai-agent, ai-assisted or bot, not "${v}"`);
  }
  return out;
}

function writeSummary(o: Options, markdown: string): void {
  if (o.summary) appendFileSync(o.summary, `${markdown}\n`);
}

function githubOutput(values: Record<string, string>): void {
  const file = process.env['GITHUB_OUTPUT'];
  if (!file) return;
  appendFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, ' ')}\n`).join(''));
}

async function cmdStats(o: Options): Promise<number> {
  const tally = new Tally(o.by);
  const rows: { sha: string; date: string; subject: string; verdict: Verdict; result: Result }[] = [];
  const failing: typeof rows = [];
  for await (const c of readCommits(o.log)) {
    const r = classifyCommit(commitInput(c));
    tally.add(r, c.date);
    const row = { sha: c.sha, date: c.date, subject: subject(c.message), verdict: r.verdict, result: r };
    if (o.commits && (o.format === 'json' || r.verdict !== 'human')) rows.push(row);
    if (o.failOn.has(r.verdict)) failing.push(row);
  }
  const summary = tally.summary();
  const range = o.log.revisions?.length ? o.log.revisions.join(' ') : undefined;
  const meta = { title: basename(resolve(o.cwd)), range };

  if (o.format === 'json') {
    const out: Record<string, unknown> = {
      version: 1,
      repository: meta.title,
      range: { revisions: o.log.revisions ?? ['HEAD'], since: o.log.since ?? null, until: o.log.until ?? null, paths: o.log.paths ?? [] },
      summary,
    };
    if (o.commits) out['commits'] = rows.map(({ result, ...r }) => ({ ...r, ai: result.ai, tools: result.tools.map((t) => t.id), evidence: result.evidence }));
    write(`${JSON.stringify(out, null, 2)}\n`);
  } else if (o.format === 'markdown') {
    write(renderMarkdown(summary, meta));
  } else {
    write(renderText(summary, meta, { color: o.color }));
    if (o.commits && rows.length > 0) {
      write('\n');
      for (const r of rows) write(`${renderCommitLine(r, r.result, { color: o.color })}\n`);
    }
  }
  writeSummary(o, renderMarkdown(summary, meta));

  if (failing.length > 0) {
    const what = [...o.failOn].map((v) => LABEL[v]).join(' or ');
    process.stderr.write(`whowrote: ${failing.length} commit${failing.length === 1 ? '' : 's'} ${failing.length === 1 ? 'is' : 'are'} ${what} (--fail-on)\n`);
    for (const r of failing.slice(0, 20)) process.stderr.write(`  ${renderCommitLine(r, r.result)}\n`);
    if (failing.length > 20) process.stderr.write(`  …and ${failing.length - 20} more (see --commits)\n`);
    return 1;
  }
  return 0;
}

async function cmdExplain(revisions: string[], o: Options): Promise<number> {
  const out: unknown[] = [];
  let failed = false;
  let first = true;
  for await (const c of readCommits({ ...o.log, revisions: revisions.length ? revisions : ['HEAD'], noWalk: true })) {
    const r = classifyCommit(commitInput(c));
    if (o.failOn.has(r.verdict)) failed = true;
    if (o.format === 'json') {
      out.push({ sha: c.sha, date: c.date, subject: subject(c.message), ...r });
    } else {
      if (!first) write('\n');
      first = false;
      const author = c.author.email ? `${c.author.name} <${c.author.email}>` : c.author.name;
      const text = renderExplain({ sha: c.sha, subject: subject(c.message), author }, r, { color: o.color && o.format === 'text' });
      write(o.format === 'markdown' ? `\`\`\`\n${text.replace(/```/g, "'''")}\`\`\`\n` : text);
    }
  }
  if (o.format === 'json') write(`${JSON.stringify(out, null, 2)}\n`);
  return failed ? 1 : 0;
}

function cmdActor(identities: string[], o: Options): number {
  if (identities.length === 0) throw new UsageError('actor needs at least one login or identity, e.g. whowrote actor "dependabot[bot]"');
  const results = identities.map((id) => ({ input: id, ...classifyActor(id) }));
  if (o.format === 'json') {
    write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    const width = Math.min(48, Math.max(...identities.map((s) => s.length)));
    for (const r of results) {
      const tool = r.tools[0] ? toolName(r.tools[0]) : r.verdict === 'bot' ? 'unlisted bot' : '';
      write(`${displaySafe(r.input).padEnd(width)}  ${LABEL[r.verdict].padEnd(11)}  ${displaySafe(tool)}\n`);
    }
  }
  return results.some((r) => o.failOn.has(r.verdict)) ? 1 : 0;
}

function cmdTools(o: Options): number {
  if (o.format === 'json') {
    write(`${JSON.stringify(tools, null, 2)}\n`);
    return 0;
  }
  const kind = { 'ai-agent': 'AI agent', 'ai-reviewer': 'AI reviewer', bot: 'Bot' } as const;
  if (o.format === 'markdown') {
    write('| Tool | Vendor | Kind | Id |\n| --- | --- | --- | --- |\n');
    for (const t of tools) write(`| [${t.name}](${t.url}) | ${t.vendor} | ${kind[t.kind]} | \`${t.id}\` |\n`);
    return 0;
  }
  for (const t of tools) write(`${t.name.padEnd(22)} ${t.vendor.padEnd(16)} ${kind[t.kind].padEnd(12)} ${t.id}\n`);
  return 0;
}

// --- pull requests ---------------------------------------------------------------------------------

interface GhAuthor {
  login?: string | null;
  type?: string | null;
  is_bot?: boolean | null;
  name?: string | null;
  email?: string | null;
}

/** GitHub webhooks use `user` (login, type); `gh pr view --json` uses `author` (login "app/dependabot", is_bot). */
function prAuthor(pr: Record<string, unknown>): Identity | null {
  const a = (pr['user'] ?? pr['author']) as GhAuthor | null | undefined;
  if (!a || typeof a !== 'object') return null;
  let login = typeof a.login === 'string' ? a.login : undefined;
  if (login?.startsWith('app/')) login = `${login.slice(4)}[bot]`;
  const id: Identity = { login, type: a.type ?? (a.is_bot ? 'Bot' : undefined) };
  if (a.name) id.name = a.name;
  if (a.email) id.email = a.email;
  return id;
}

/** Commits from `gh pr view --json commits` ({ authors, messageHeadline, messageBody }). */
function ghCommits(pr: Record<string, unknown>): CommitInput[] {
  const list = pr['commits'];
  if (!Array.isArray(list)) return [];
  return list.flatMap((c: Record<string, unknown>) => {
    if (typeof c !== 'object' || c === null || typeof c['messageHeadline'] !== 'string') return [];
    const authors = Array.isArray(c['authors']) ? (c['authors'] as GhAuthor[]) : [];
    const message = [c['messageHeadline'], c['messageBody']].filter((s) => typeof s === 'string' && s !== '').join('\n\n');
    return [{ message, author: authors[0] ? { name: authors[0].name, email: authors[0].email, login: authors[0].login } : null }];
  });
}

async function cmdPr(o: Options): Promise<number> {
  const source = o.event ?? process.env['GITHUB_EVENT_PATH'];
  if (!source) throw new UsageError('pr needs --event <file> (a GitHub event payload, or gh pr view --json output; - reads stdin)');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(source === '-' ? 0 : source, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new UsageError(`could not read ${source === '-' ? 'stdin' : source}: ${(err as Error).message}`);
  }
  const pr = (typeof data['pull_request'] === 'object' && data['pull_request'] !== null ? data['pull_request'] : data) as Record<string, unknown>;
  if (!('title' in pr) && !('body' in pr) && !('user' in pr) && !('author' in pr)) {
    throw new UsageError(`${source} does not look like a pull request (no title, body or author)`);
  }

  const commits: CommitInput[] = ghCommits(pr);
  let note = '';
  const base = (pr['base'] as { sha?: string } | undefined)?.sha;
  const head = (pr['head'] as { sha?: string } | undefined)?.sha;
  if (commits.length === 0 && base && head && /^[0-9a-f]{40,64}$/.test(base) && /^[0-9a-f]{40,64}$/.test(head)) {
    try {
      for await (const c of readCommits({ ...o.log, revisions: [`${base}..${head}`], merges: true })) commits.push(commitInput(c));
    } catch (err) {
      if (!(err instanceof GitError)) throw err;
      note = 'The pull request commits are not in this clone, so only its author and description were read. Check out with fetch-depth: 0 to include them.';
    }
  }

  const author = prAuthor(pr);
  const input: PullRequestInput = {
    author,
    title: typeof pr['title'] === 'string' ? pr['title'] : null,
    body: typeof pr['body'] === 'string' ? pr['body'] : null,
    commits,
  };
  const r = classifyPullRequest(input);
  const number = typeof pr['number'] === 'number' ? `#${pr['number']}` : 'pull request';
  const title = `${number} ${input.title ?? ''}`.trim();

  if (o.format === 'json') {
    write(`${JSON.stringify({ pullRequest: { number: pr['number'] ?? null, title: input.title, commits: commits.length }, ...r }, null, 2)}\n`);
  } else {
    const authorText = author ? (author.login ?? author.name ?? '') : '';
    write(renderExplain({ sha: '', subject: title, author: authorText }, r, { color: o.color && o.format === 'text' }));
    if (note) process.stderr.write(`whowrote: ${note}\n`);
  }
  const toolNames = r.tools.filter((t) => t.kind !== 'bot').map((t) => t.name);
  writeSummary(o, `### whowrote: ${LABEL[r.verdict]}\n\n${displaySafe(title).replace(/[\\`*_[\]<>|#!~]/g, (ch) => `\\${ch}`)}${toolNames.length ? `\n\nAI tools: ${toolNames.join(', ')}` : ''}\n`);
  githubOutput({ verdict: r.verdict, ai: String(r.ai), tools: r.tools.map((t) => t.id).join(',') });
  return o.failOn.has(r.verdict) ? 1 : 0;
}

// --- main ------------------------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const dashdash = argv.indexOf('--');
  const own = dashdash === -1 ? argv : argv.slice(0, dashdash);
  const paths = dashdash === -1 ? [] : argv.slice(dashdash + 1);

  const { values, positionals } = parseArgs({
    args: own,
    allowPositionals: true,
    options: {
      C: { type: 'string', short: 'C' },
      since: { type: 'string' },
      until: { type: 'string' },
      'max-count': { type: 'string', short: 'n' },
      by: { type: 'string' },
      merges: { type: 'boolean', default: false },
      'first-parent': { type: 'boolean', default: false },
      commits: { type: 'boolean', default: false },
      format: { type: 'string' },
      'fail-on': { type: 'string', multiple: true },
      summary: { type: 'string' },
      event: { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.version) {
    write(`${VERSION}\n`);
    return 0;
  }
  if (values.help) {
    write(HELP);
    return 0;
  }

  const format = values.format ?? 'text';
  if (!['text', 'markdown', 'json'].includes(format)) throw new UsageError('--format must be text, markdown or json');
  if (values.by !== undefined && !PERIODS.includes(values.by as PeriodUnit)) throw new UsageError('--by must be week, month, quarter or year');
  let maxCount: number | undefined;
  if (values['max-count'] !== undefined) {
    maxCount = Number(values['max-count']);
    if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new UsageError('--max-count must be a positive whole number');
  }
  for (const [flag, v] of [['--since', values.since], ['--until', values.until]] as const) {
    if (v !== undefined && (v.trim() === '' || v.startsWith('-'))) throw new UsageError(`${flag} needs a date`);
  }

  const [first, ...rest] = positionals;
  const command = first !== undefined && COMMANDS.has(first) ? first : undefined;
  const args = command ? rest : positionals;
  const cwd = values.C ?? '.';
  const o: Options = {
    cwd,
    format: format as Format,
    color: useColor(!values['no-color']),
    failOn: parseFailOn(values['fail-on']),
    log: {
      cwd,
      revisions: command ? undefined : args,
      paths,
      since: values.since,
      until: values.until,
      maxCount,
      merges: values.merges,
      firstParent: values['first-parent'],
    },
    commits: values.commits,
  };
  if (values.summary) o.summary = resolve(values.summary);
  if (values.by) o.by = values.by as PeriodUnit;
  if (values.event) o.event = values.event;
  if (values.event && command !== 'pr') throw new UsageError('--event only works with whowrote pr');

  switch (command) {
    case undefined:
      return cmdStats(o);
    case 'explain':
      return cmdExplain(args, o);
    case 'actor':
      return cmdActor(args, o);
    case 'pr':
      return cmdPr(o);
    case 'tools':
      return cmdTools(o);
    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`whowrote: ${message}\n`);
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))) {
      process.stderr.write('Run whowrote --help for usage.\n');
    } else if (!(error instanceof GitError) && error instanceof Error && error.stack && process.env['DEBUG']) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 2;
  },
);
