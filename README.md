# whowrote

**Human, bot or AI agent?** whowrote tells you who wrote a commit or a pull request, from the signals it discloses: `Co-authored-by: Claude` trailers, agent accounts like Copilot and Devin, session links, `[bot]` accounts. It is a [sourced registry](registry/) of AI coding tools and bots, a zero-dependency library, a CLI that breaks down a repository's history, and a GitHub Action that labels pull requests.

[![npm](https://img.shields.io/npm/v/whowrote)](https://www.npmjs.com/package/whowrote)
[![CI](https://github.com/daniel63194/whowrote/actions/workflows/ci.yml/badge.svg)](https://github.com/daniel63194/whowrote/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/daniel63194/whowrote/badge)](https://scorecard.dev/viewer/?uri=github.com/daniel63194/whowrote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```console
$ npx whowrote --since 2026-04-01 --until 2026-09-30 --by quarter      # in a clone of microsoft/vscode
whowrote · vscode · 11,338 commits · 2026-04-01 → 2026-09-30

  Human            5,549   48.9%  ████████████
  AI-assisted      5,095   44.9%  ███████████
  AI agent           393    3.5%  █
  Bot                301    2.7%  █

  AI tools                            commits  models
  GitHub Copilot                        5,430
  Claude (Anthropic)                       59  Claude Opus 4.8 (27) · Claude Opus 5 (20) · Claude Opus 4 (3) · +7 more
  Cursor (Anysphere)                        5

  Bots                                commits
  vs-code-engineering[bot]                156
  Dependabot                              139
  GitHub Actions                            6

  Period      Commits   Human  AI-assisted  AI agent    Bot
  2026-Q2       5,739   64.2%        30.4%      2.4%   2.9%
  2026-Q3       5,599   33.3%        59.8%      4.5%   2.4%
```

- **Every verdict comes with its evidence.** `whowrote explain <commit>` shows the exact trailer, account or link behind it.
- **Sourced.** Each tool in the registry links to vendor docs or public commits that show the signal, and carries examples that run as tests, including near misses: Claude Monet, Devin Griffin and Jules Verne are people.
- **No guessing.** whowrote reads what commits disclose. It does not judge code style, so it never accuses anyone of using AI.
- **Zero dependencies**, fast (15,000 commits in under two seconds), and safe on untrusted input: crafted messages can't make it hang or rewrite your terminal. The library has no Node.js imports, so it also runs in browsers, Deno, Bun and edge functions.

## Who it's for

- **Projects with an AI policy.** [Ghostty's AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md) says all AI usage must be disclosed; the Linux kernel asks for an [`Assisted-by:` tag](https://docs.kernel.org/process/coding-assistants.html). Label disclosed pull requests automatically, or fail CI if your project does not accept AI-written changes.
- **Contributor lists and changelogs** that should credit people, not Dependabot or Copilot: `contributors.filter(isHuman)`.
- **Dashboards and research**: how much of a codebase AI agents write, which tools and models, and how that changes month by month.
- **Review routing**: send agent-authored pull requests to a stricter review queue.

## Command line

Run it in any git repository. Node.js 20.19 or later and git are needed.

```sh
npx whowrote                            # the whole history of HEAD
npx whowrote --since "90 days ago" --by month
npx whowrote v1.0.0..HEAD -- src/       # a range, limited to a folder
npx whowrote --commits                  # also list each AI and bot commit
npx whowrote explain HEAD~3 a1b2c3d     # why each commit got its verdict
npx whowrote actor "dependabot[bot]" "Jane Doe <jane@example.com>"
npx whowrote tools                      # everything whowrote recognises
```

```console
$ npx whowrote explain 0c9c0a4
0c9c0a4295a9 Stop agent-host customization discovery retries for deleted worktrees (#339986)
  verdict   AI agent
  author    Copilot <198982749+Copilot@users.noreply.github.com>
  evidence  author      GitHub Copilot               Copilot <198982749+Copilot@users.noreply.github.com>
            co-author   GitHub Copilot               Copilot <223556219+Copilot@users.noreply.github.com>
```

<details>
<summary>All options</summary>

```text
Usage:
  whowrote [<revision-range>...] [-- <path>...]   Break down a repository's history
  whowrote explain [<commit>...]                  Show the evidence behind each commit's verdict
  whowrote actor <identity>...                    Classify accounts and git identities
  whowrote pr [--event <file>]                    Classify a pull request from a GitHub event or
                                                  `gh pr view --json author,title,body,commits` (- for stdin)
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
  --fail-on <verdicts>         Exit with code 1 if any commit (or the pull request) has one of these
                               verdicts: ai, ai-agent, ai-assisted, bot (comma-separated)
  --summary <file>             Also append the Markdown report to this file (e.g. $GITHUB_STEP_SUMMARY)
  --no-color                   Plain output
```

Exit codes: `0` success, `1` a `--fail-on` verdict was found, `2` usage or git error.

A shallow clone only has part of the history. Use `git fetch --unshallow`, or `fetch-depth: 0` with `actions/checkout`, to see all of it.

</details>

Check a pull request before merging it:

```sh
gh pr view 123 --json author,title,body,commits | npx whowrote pr --event -
```

## Library

```sh
npm install whowrote
```

```js
import { classifyCommit, classifyPullRequest, isHuman } from 'whowrote';

classifyCommit({
  author: 'Jane Doe <jane@example.com>',
  message: 'Fix retry\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
});
// {
//   verdict: 'ai-assisted',
//   ai: true,
//   tools: [{ id: 'claude', name: 'Claude', vendor: 'Anthropic', kind: 'ai-agent', signals: ['co-author'], models: ['Claude Opus 4.6'], … }],
//   evidence: [{ signal: 'co-author', value: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>', tool: 'claude', kind: 'ai', scope: 'code', model: 'Claude Opus 4.6' }],
// }

['octocat', 'dependabot[bot]', 'Copilot', 'renovate-bot'].filter(isHuman); // ['octocat']
```

Objects from the GitHub REST API and webhooks work as they are:

```js
const { data: commits } = await octokit.rest.pulls.listCommits({ owner, repo, pull_number });
const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
classifyPullRequest({ author: pr.user, title: pr.title, body: pr.body, commits }).verdict; // 'ai-agent'

// In a GitHub App or Probot webhook handler:
classifyPullRequest(context.payload.pull_request);
```

| Export | What it does |
| --- | --- |
| `classifyCommit({ message, author, committer })` | Classifies a commit. `author` and `committer` are `"Name <email>"` strings or `{ name, email, login, type }`. Also accepts GitHub REST commit objects. |
| `classifyPullRequest({ author, title, body, commits })` | Classifies a pull request; `commits` is optional. Also accepts GitHub pull request objects. |
| `classifyActor(identity)` | Classifies an account or git identity on its own. |
| `isHuman(identity)`, `isBot(identity)`, `isAI(identity)` | Booleans for filtering. `isBot` is true for automation **and** AI agent accounts. |
| `identify(identity)` | The registry tool an identity belongs to, or `undefined`. |
| `parseIdentity(text)` | `"Jane <jane@example.com>"` → `{ name, email }`. |
| `tools`, `getTool(id)` | The registry: id, name, vendor, kind, url, description. |

Each result has a `verdict`, `ai` (true for both AI verdicts), the registry `tools` involved with their `signals` and `models`, and every piece of `evidence`. The full registry, with its evidence links and examples, ships as `whowrote/registry.json` for tools in other languages.

## Verdicts

| Verdict | Meaning | Example signal |
| --- | --- | --- |
| `human` | Nothing discloses AI involvement or automation. This is **not** proof that no AI was used. | |
| `ai-assisted` | A person is the author, and AI involvement is disclosed. | `Co-authored-by: Claude <noreply@anthropic.com>`, `Assisted-by: LLM`, `🤖 Generated with [Claude Code]`, `Made-with: Cursor`, an applied CodeRabbit suggestion |
| `ai-agent` | An AI agent's own identity is the author. | Author `Copilot <…+Copilot@users.noreply.github.com>`, `devin-ai-integration[bot]`, `claude[bot]` |
| `bot` | An automation account, with no AI involvement disclosed. | `dependabot[bot]`, `renovate-bot`, any `[bot]` or `Bot` account |

How whowrote decides:

1. **The author.** An AI tool's identity makes it `ai-agent`; a bot makes it `bot`, or `ai-agent` if the change also discloses an AI agent (a workflow that ran one). Identities match by GitHub login, by the login inside a `…@users.noreply.github.com` address, by email, or by a name pattern specific enough not to catch people (`Claude Opus 4.6`, not `Claude`). Bots the registry doesn't list are recognised by `[bot]` logins, GitHub's `Bot` type, and names like `Release Bot` or `renovate-bot`.
2. **Trailers anywhere in the message**, so squash merges count: AI co-authors, tool session trailers (`Claude-Session`, `Copilot-Session`, `Amp-Thread-ID`, …) and generic disclosures (`Assisted-by`, `AI-assisted`, `Made-with`, `Generated-by`). `AI-assisted: no` and `Assisted-by: Jane <jane@example.com>` don't count.
3. **Disclosure lines and links**: "🤖 Generated with [Claude Code](…)", "Made with [Cursor](…)", "> This pull request was created with GitHub Copilot", Devin and Codex session links. A disclosure line must start the line, so prose like "notifications are generated by Codex" doesn't count.
4. **Message-only disclosures** such as "(Commit message generated by Copilot)" or a Bugbot summary say that AI wrote the *description*, so they are reported as evidence with `scope: 'message'` but don't change the verdict.

The committer is ignored unless it is an AI tool, because GitHub, merge queues and rebases commit on people's behalf.

## GitHub Action

Label pull requests that disclose AI involvement, and add a summary to the run:

```yaml
name: whowrote
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
permissions:
  contents: read
  pull-requests: write # for the label
jobs:
  whowrote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # so the pull request's commits can be read
          persist-credentials: false
      - uses: daniel63194/whowrote@v0.1.0
        id: whowrote
        with:
          label: true          # adds "ai-assisted" or "ai-agent"
          # fail-on: ai        # for projects that don't accept AI-written changes
      - run: echo "Verdict: ${{ steps.whowrote.outputs.verdict }}"
```

Pull requests from forks get a read-only token, so labelling them needs `pull_request_target`. With that trigger, don't check out or run the pull request's code: whowrote then reads the author and the description from the event.

On other events the action breaks down the history (`with: { since: "30 days ago", by: week }`) and writes it to the job summary.

| Input | Default | |
| --- | --- | --- |
| `command` | `pr` on pull request events, else `history` | What to classify. |
| `label` | `false` | Add an `ai-assisted` or `ai-agent` label (`pr` mode). |
| `fail-on` | | Fail on these verdicts: `ai`, `ai-agent`, `ai-assisted`, `bot`. |
| `since`, `range`, `by` | | History mode: date, revision range, and breakdown period. |
| `summary` | `true` | Write the report to the job summary. |
| `version` | this action's version | whowrote version from npm. |

Outputs (`pr` mode): `verdict`, `ai` (`true`/`false`) and `tools` (comma-separated ids).

## What whowrote recognises

<!-- registry-table:start (generated by `npm run registry`) -->
| Tool | Vendor | Kind | Recognised by | Entry |
| --- | --- | --- | --- | --- |
| [Aider](https://aider.chat) | Aider | AI agent | `aider@aider.chat`, name marker | [aider](registry/aider.json) |
| [Amp](https://ampcode.com) | Amp | AI agent | `amp@ampcode.com`, `Amp-Thread-ID:`, 1 footer | [amp](registry/amp.json) |
| [Claude](https://claude.com/product/claude-code) | Anthropic | AI agent | `claude[bot]`, `noreply@anthropic.com`, `Claude-Session:`, name pattern, 1 footer | [claude](registry/claude.json) |
| [Cline](https://cline.bot) | Cline | AI agent | `cline-agent` | [cline](registry/cline.json) |
| [Cursor](https://cursor.com) | Anysphere | AI agent | `cursoragent@cursor.com`, 2 footers | [cursor](registry/cursor.json) |
| [Devin](https://devin.ai) | Cognition | AI agent | `devin-ai-integration[bot]`, name pattern, 1 footer | [devin](registry/devin.json) |
| [Factory Droid](https://factory.ai) | Factory | AI agent | `factory-droid[bot]` | [factory-droid](registry/factory-droid.json) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Google | AI agent | `gemini-cli[bot]` | [gemini-cli](registry/gemini-cli.json) |
| [GitHub Copilot](https://github.com/features/copilot) | GitHub | AI agent | `Copilot`, `copilot-swe-agent[bot]`, `copilot@github.com`, `Copilot-Session:`, `Agent-Logs-Url:`, name pattern, 3 footers | [github-copilot](registry/github-copilot.json) |
| [Jules](https://jules.google) | Google | AI agent | `google-labs-jules[bot]` | [jules](registry/jules.json) |
| [Mastra Code](https://mastra.ai) | Mastra | AI agent | `noreply@mastra.ai`, name pattern | [mastra-code](registry/mastra-code.json) |
| [Open SWE](https://github.com/langchain-ai/open-swe) | LangChain | AI agent | `open-swe[bot]` | [open-swe](registry/open-swe.json) |
| [OpenAI Codex](https://openai.com/codex) | OpenAI | AI agent | `chatgpt-codex-connector[bot]`, `noreply@openai.com`, `codex@openai.com`, 1 footer | [openai-codex](registry/openai-codex.json) |
| [opencode](https://opencode.ai) | SST | AI agent | `opencode-agent[bot]`, `noreply@opencode.ai` | [opencode](registry/opencode.json) |
| [OpenHands](https://www.all-hands.dev) | All Hands AI | AI agent | `openhands@all-hands.dev` | [openhands](registry/openhands.json) |
| [Seer](https://docs.sentry.io/product/ai-in-sentry/seer/) | Sentry | AI agent | `seer-by-sentry[bot]` | [sentry-seer](registry/sentry-seer.json) |
| [CodeRabbit](https://coderabbit.ai) | CodeRabbit | AI reviewer | `coderabbitai[bot]`, `noreply@coderabbit.ai` | [coderabbit](registry/coderabbit.json) |
| [Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review) | GitHub | AI reviewer | `copilot-pull-request-reviewer[bot]` | [github-copilot-review](registry/github-copilot-review.json) |
| [cubic](https://cubic.dev) | cubic | AI reviewer | `cubic-dev-ai[bot]` | [cubic](registry/cubic.json) |
| [Cursor Bugbot](https://cursor.com/bugbot) | Anysphere | AI reviewer | `cursor[bot]`, 1 footer | [cursor-bugbot](registry/cursor-bugbot.json) |
| [Ellipsis](https://www.ellipsis.dev) | Ellipsis | AI reviewer | `ellipsis-dev[bot]` | [ellipsis](registry/ellipsis.json) |
| [Gemini Code Assist](https://developers.google.com/gemini-code-assist/docs/review-github-code) | Google | AI reviewer | `gemini-code-assist[bot]` | [gemini-code-assist](registry/gemini-code-assist.json) |
| [Greptile](https://greptile.com) | Greptile | AI reviewer | `greptile-apps[bot]` | [greptile](registry/greptile.json) |
| [All Contributors](https://allcontributors.org) | All Contributors | Bot | `allcontributors[bot]` | [all-contributors](registry/all-contributors.json) |
| [Dependabot](https://docs.github.com/en/code-security/dependabot) | GitHub | Bot | `dependabot[bot]`, `dependabot-preview[bot]`, `support@dependabot.com` | [dependabot](registry/dependabot.json) |
| [GitHub](https://github.com) | GitHub | Bot | `web-flow`, `noreply@github.com` | [github](registry/github.json) |
| [GitHub Actions](https://docs.github.com/en/actions) | GitHub | Bot | `github-actions[bot]`, `github-actions`, `action@github.com`, `actions@github.com`, `github-actions@github.com` | [github-actions](registry/github-actions.json) |
| [Graphite](https://graphite.dev) | Graphite | Bot | `graphite-app[bot]` | [graphite](registry/graphite.json) |
| [Imgbot](https://imgbot.net) | Imgbot | Bot | `imgbot[bot]`, `imgbotapp`, `imgbothelp@gmail.com` | [imgbot](registry/imgbot.json) |
| [Mergify](https://mergify.com) | Mergify | Bot | `mergify[bot]` | [mergify](registry/mergify.json) |
| [pre-commit.ci](https://pre-commit.ci) | pre-commit.ci | Bot | `pre-commit-ci[bot]` | [pre-commit-ci](registry/pre-commit-ci.json) |
| [release-please](https://github.com/googleapis/release-please) | Google | Bot | `release-please[bot]` | [release-please](registry/release-please.json) |
| [Renovate](https://docs.renovatebot.com) | Mend | Bot | `renovate[bot]`, `renovate-bot`, `bot@renovateapp.com`, `renovate@whitesourcesoftware.com` | [renovate](registry/renovate.json) |
| [semantic-release](https://semantic-release.gitbook.io) | semantic-release | Bot | `semantic-release-bot`, `semantic-release-bot@martynus.net` | [semantic-release](registry/semantic-release.json) |
| [Snyk](https://snyk.io) | Snyk | Bot | `snyk-bot`, `snyk-bot@snyk.io` | [snyk](registry/snyk.json) |
| [Vercel](https://vercel.com) | Vercel | Bot | `vercel[bot]` | [vercel](registry/vercel.json) |
<!-- registry-table:end -->

Something missing or wrong? [Add a tool](CONTRIBUTING.md#adding-a-tool): it is one JSON file with a link to the evidence. AI tools that don't sign their work (most editor autocompletions) can't be recognised, and that is a limit of disclosure, not of whowrote.

## Limits and responsible use

- whowrote can only see what is **disclosed**. Tools that leave no trace, or people who remove the trailer, look human. Treat percentages as a lower bound for AI involvement.
- Anyone can write any trailer or name in a commit. whowrote reports what a commit **claims**; it does not verify signatures.
- Please don't use it to rank or police individual people. It deliberately has no per-person breakdown, and "AI-assisted" says nothing about quality: disclosure is a good habit, and a tool that punishes it teaches people to stop disclosing.

## Contributing

The registry grows with the tools. New tools, better patterns and misclassification reports are all welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
