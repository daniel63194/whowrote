# whowrote

**Human, bot or AI agent?** whowrote tells you who wrote a commit or a pull request, from the signals it discloses: `Co-authored-by: Claude` trailers, agent accounts like Copilot and Devin, the branches agents create, session links, attribution notes from tools like git-ai, and `[bot]` accounts. It is a [sourced registry](registry/) of AI coding tools and bots, a zero-dependency library, a CLI that breaks down a repository's history, and a GitHub Action that labels pull requests.

[![npm](https://img.shields.io/npm/v/whowrote)](https://www.npmjs.com/package/whowrote)
[![CI](https://github.com/daniel63194/whowrote/actions/workflows/ci.yml/badge.svg)](https://github.com/daniel63194/whowrote/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/daniel63194/whowrote/badge)](https://scorecard.dev/viewer/?uri=github.com/daniel63194/whowrote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```console
$ npx whowrote --since 2026-04-01 --until 2026-09-30 --by quarter      # in a clone of microsoft/vscode
whowrote · vscode · 11,336 commits · 2026-04-01 → 2026-09-30

  No AI disclosed      5,547   48.9%  ████████████
  AI-assisted          5,095   44.9%  ███████████
  AI agent               393    3.5%  █
  Bot                    301    2.7%  █

  AI tools                            commits  models
  GitHub Copilot                        5,430
  Claude (Anthropic)                       59  Claude Opus 4.8 (27) · Claude Opus 5 (20) · Claude Opus 4 (3) · +7 more
  Cursor (Anysphere)                        5

  Bots                                commits
  vs-code-engineering[bot]                156
  Dependabot                              139
  GitHub Actions                            6

  Agent setup at HEAD                files
  Claude (Anthropic)                 .mcp.json
  GitHub Copilot                     .github/copilot-instructions.md, .github/instructions/oss.instructions.md, +32 more
  Shared agent instructions          AGENTS.md, src/vs/platform/agentHost/AGENTS.md, +6 more

  Period      Commits  No AI disclosed  AI-assisted  AI agent    Bot
  2026-Q2       5,736            64.2%        30.4%      2.4%   2.9%
  2026-Q3       5,600            33.3%        59.8%      4.5%   2.4%
```

- **Every verdict comes with its evidence.** `whowrote explain <commit>` shows the exact trailer, account, branch, link or note behind it.
- **Sourced.** Each tool in the registry links to vendor docs or public commits that show the signal, and carries examples that run as tests, including near misses: Claude Monet, Devin Griffin and Jules Verne are people.
- **No guessing.** whowrote reads what commits and pull requests disclose. It does not judge code style, so it never accuses anyone of using AI. Weaker signals are kept apart as [hints](#hints) and never change a verdict.
- **Zero dependencies**, fast (15,000 commits in under two seconds), and safe on untrusted input: crafted messages can't make it hang or rewrite your terminal. The library has no Node.js imports, so it also runs in browsers, Deno, Bun and edge functions.

## Who it's for

- **Projects with an AI policy.** [Ghostty's AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md) says all AI usage must be disclosed; the Linux kernel asks for an [`Assisted-by:` tag](https://docs.kernel.org/process/coding-assistants.html). Label disclosed pull requests automatically, count contributors who declare `AI-assisted: no`, or fail CI if your project does not accept AI-written changes.
- **Contributor lists and changelogs** that should credit people, not Dependabot or Copilot: `contributors.filter(isHuman)`.
- **Dashboards and research**: how much of a codebase AI agents write, which tools and models, and how that changes month by month.
- **Review routing**: send agent-authored pull requests to a stricter review queue.

## Command line

Run it in any git repository. Node.js 20.19 or later and git are needed.

```sh
npx whowrote                            # the whole history of HEAD
npx whowrote --since "90 days ago" --by month
npx whowrote v1.0.0..HEAD -- src/       # a range, limited to a folder
npx whowrote --github                   # also read each squash-merged commit's pull request
npx whowrote --hints                    # also show weak signals (never counted)
npx whowrote --commits                  # also list each AI and bot commit
npx whowrote explain HEAD~3 a1b2c3d     # why each commit got its verdict
npx whowrote pr 123                     # a pull request on GitHub (or owner/repo#123, or its URL)
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
  whowrote pr <number|owner/repo#n|url>           Classify a pull request from GitHub
  whowrote pr --event <file>                      ... from a GitHub event payload, or
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
  --github                     Also read each commit's pull request on GitHub (author, description,
                               branch): finds agent pull requests that squash merges hide. Needs a
                               token for history (GITHUB_TOKEN, GH_TOKEN or gh auth login)
  --repo <owner/name>          GitHub repository (default: from the origin remote)
  --notes <ref>                Read attribution notes from this ref (default: refs/notes/ai, git-ai's)
  --no-notes                   Don't read git notes
  --hints                      Show weak signals (agent config changes, agent PR layouts). They never
                               change a verdict
  --commits                    List each AI and bot commit (with --format json: every commit)
  --format <text|markdown|json>
  --fail-on <verdicts>         Exit with code 1 if any commit (or the pull request) has one of these
                               verdicts: ai, ai-agent, ai-assisted, bot (comma-separated)
  --summary <file>             Also append the Markdown report to this file (e.g. $GITHUB_STEP_SUMMARY)
  --no-color                   Plain output
```

Exit codes: `0` success, `1` a `--fail-on` verdict was found, `2` usage, git or GitHub error.

A shallow clone only has part of the history. Use `git fetch --unshallow`, or `fetch-depth: 0` with `actions/checkout`, to see all of it.

</details>

## Beyond commit messages

Squash merges and agents that don't sign their commits leave little in git. whowrote can read four more sources.

**Pull requests on GitHub.** `whowrote pr 123` reads a pull request's author, head branch, description and commits. `--github` does the same for every squash-merged commit in the history (the ones whose subject ends in `(#123)`), in batches through the GraphQL API. This finds what squash merges hide: a pull request opened by the Copilot coding agent on a `copilot/…` branch, or a description that says "🤖 Generated with Claude Code". Public pull requests can be read without a token; `--github` on a history uses GraphQL, which needs one (`GITHUB_TOKEN`, `GH_TOKEN` or `gh auth login`). Set `WHOWROTE_GITHUB_API` or `GITHUB_API_URL` for GitHub Enterprise.

**Branches agents create.** The Copilot coding agent works on `copilot/…` branches and the Claude GitHub app on `claude/…` branches. A pull request from one of them, or a merge commit that names one ("Merge pull request #12 from octo/copilot/fix"), counts as evidence. Names that are also common words, like `cursor/…`, are only hints.

**Attribution notes.** Some tools record which lines an AI wrote, as git notes, while you work. whowrote reads [git-ai](https://usegitai.com/docs/get-started/how-git-ai-works) authorship logs from `refs/notes/ai` by default, and [Agent Trace](https://agent-trace.dev) records from any notes ref you name with `--notes`. They give the tool, the model and the number of lines. `git clone` doesn't fetch notes, so fetch them first:

```sh
git fetch origin 'refs/notes/*:refs/notes/*'
```

**Agent setup.** Every report lists the AI tools the repository is configured for, from files like `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, `GEMINI.md` and `AGENTS.md`. That says the tools are set up, not that a particular change was written with them.

### Hints

Some signals often go with AI use but prove nothing: a commit that changes `CLAUDE.md`, a pull request with Claude Code's "Summary / Test plan" layout, a `codex/…` branch. With `--hints`, whowrote reports them separately, as weak signals among the commits with no AI disclosed. They never change a verdict, a label or a `--fail-on` result. In a test across 200,000 commits, the strongest layout hint appeared in only 2.6% of the commits that disclosed AI, and in 0.7% of the others. That is why hints stay hints.

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
//   declaredHuman: false,
//   tools: [{ id: 'claude', name: 'Claude', vendor: 'Anthropic', kind: 'ai-agent', signals: ['co-author'], models: ['Claude Opus 4.6'], … }],
//   evidence: [{ signal: 'co-author', value: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>', tool: 'claude', kind: 'ai', scope: 'code', model: 'Claude Opus 4.6' }],
//   hints: [],
// }

['octocat', 'dependabot[bot]', 'Copilot', 'renovate-bot'].filter(isHuman); // ['octocat']
```

Objects from the GitHub REST API and webhooks work as they are:

```js
const { data: commits } = await octokit.rest.pulls.listCommits({ owner, repo, pull_number });
const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number });
classifyPullRequest({ author: pr.user, title: pr.title, body: pr.body, branch: pr.head.ref, commits }).verdict; // 'ai-agent'

// In a GitHub App or Probot webhook handler:
classifyPullRequest(context.payload.pull_request);
```

| Export | What it does |
| --- | --- |
| `classifyCommit({ message, author, committer, notes, pullRequest, files })` | Classifies a commit. `author` and `committer` are `"Name <email>"` strings or `{ name, email, login, type }`. The rest is optional: `notes` (git notes text), `pullRequest` (`{ author, title, body, branch }` of the pull request it came from), `files` (changed paths, for hints). Also accepts GitHub REST commit objects. |
| `classifyPullRequest({ author, title, body, branch, commits, files })` | Classifies a pull request; everything but `author` is optional. Also accepts GitHub pull request objects. |
| `classifyActor(identity)` | Classifies an account or git identity on its own. |
| `isHuman(identity)`, `isBot(identity)`, `isAI(identity)` | Booleans for filtering. `isBot` is true for automation **and** AI agent accounts. |
| `identify(identity)` | The registry tool an identity belongs to, or `undefined`. |
| `parseNotes(text)` | Reads git-ai and Agent Trace records: tool, model and line counts. |
| `detectAgentSetup(paths)` | The AI tools a file list (e.g. `git ls-files`) is configured for. |
| `parseIdentity(text)` | `"Jane <jane@example.com>"` → `{ name, email }`. |
| `tools`, `getTool(id)` | The registry: id, name, vendor, kind, url, description. |

Each result has a `verdict`, `ai` (true for both AI verdicts), `declaredHuman`, the registry `tools` involved with their `signals`, `models` and noted `lines`, every piece of `evidence`, and the `hints`. The full registry, with its evidence links and examples, ships as `whowrote/registry.json` for tools in other languages.

## Verdicts

| Verdict | Shown as | Meaning | Example signal |
| --- | --- | --- | --- |
| `human` | No AI disclosed | Nothing discloses AI involvement or automation. This is **not** proof that no AI was used. | |
| `human` with `declaredHuman` | Declared no AI | The author declares that no AI was used, and nothing says otherwise. | `AI-assisted: no`, `AI: none`, an Agent Trace record that credits only people |
| `ai-assisted` | AI-assisted | A person is the author, and AI involvement is disclosed. | `Co-authored-by: Claude <noreply@anthropic.com>`, `Assisted-by: LLM`, `🤖 Generated with [Claude Code]`, `Made-with: Cursor`, a `claude/…` branch, a git-ai note, an applied CodeRabbit suggestion |
| `ai-agent` | AI agent | An AI agent's own identity is the author, or opened the pull request. | Author `Copilot <…+Copilot@users.noreply.github.com>`, `devin-ai-integration[bot]`, `claude[bot]` |
| `bot` | Bot | An automation account, with no AI involvement disclosed. | `dependabot[bot]`, `renovate-bot`, any `[bot]` or `Bot` account |

How whowrote decides:

1. **The author.** An AI tool's identity makes it `ai-agent`; a bot makes it `bot`, or `ai-agent` if the change also discloses an AI agent (a workflow that ran one). The same goes for the author of the pull request a commit came from, when it is known. Identities match by GitHub login, by the login inside a `…@users.noreply.github.com` address, by email, or by a name pattern specific enough not to catch people (`Claude Opus 4.6`, not `Claude`). Bots the registry doesn't list are recognised by `[bot]` logins, GitHub's `Bot` type, and names like `Release Bot` or `renovate-bot`.
2. **Trailers anywhere in the message**, so squash merges count: AI co-authors, tool session trailers (`Claude-Session`, `Copilot-Session`, `Amp-Thread-ID`, …) and generic disclosures (`Assisted-by`, `AI-assisted`, `AI-used`, `Made-with`, `Generated-by`). `AI-assisted: no` declares that no AI was used; `Assisted-by: Jane <jane@example.com>` credits a person and doesn't count. The subject line is skipped, so `ai: add streaming` is just a commit scope.
3. **Disclosure lines and links**: "🤖 Generated with [Claude Code](…)", "Made with [Cursor](…)", "> This pull request was created with GitHub Copilot", Devin and Codex session links. A disclosure line must start the line, so prose like "notifications are generated by Codex" doesn't count.
4. **Branches and attribution notes**, as described [above](#beyond-commit-messages).
5. **Message-only disclosures** such as "(Commit message generated by Copilot)" or a Bugbot summary say that AI wrote the *description*, so they are reported as evidence with `scope: 'message'` but don't change the verdict.

A declaration never outweighs disclosed AI: `AI-assisted: no` next to `Co-authored-by: Claude` is `ai-assisted`. The committer is ignored unless it is an AI tool, because GitHub, merge queues and rebases commit on people's behalf.

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
      - uses: daniel63194/whowrote@v0.2.0
        id: whowrote
        with:
          label: true          # adds "ai-assisted" or "ai-agent"
          # fail-on: ai        # for projects that don't accept AI-written changes
      - run: echo "Verdict: ${{ steps.whowrote.outputs.verdict }}"
```

Pull requests from forks get a read-only token, so labelling them needs `pull_request_target`. With that trigger, don't check out or run the pull request's code: whowrote then reads the author, branch and description from the event, and lists the commits through the API.

On other events the action breaks down the history (`with: { since: "30 days ago", by: week, github: true }`) and writes it to the job summary.

| Input | Default | |
| --- | --- | --- |
| `command` | `pr` on pull request events, else `history` | What to classify. |
| `label` | `false` | Add an `ai-assisted` or `ai-agent` label (`pr` mode). |
| `fail-on` | | Fail on these verdicts: `ai`, `ai-agent`, `ai-assisted`, `bot`. |
| `since`, `range`, `by` | | History mode: date, revision range, and breakdown period. |
| `github` | `false` | History mode: read squash-merged commits' pull requests on GitHub. |
| `hints` | `false` | Report weak signals too. |
| `summary` | `true` | Write the report to the job summary. |
| `token` | `github.token` | Used for labels and the GitHub API. |
| `version` | this action's version | whowrote version from npm. |

Outputs (`pr` mode): `verdict`, `ai` (`true`/`false`), `declared-human` (`true`/`false`) and `tools` (comma-separated ids).

## What whowrote recognises

<!-- registry-table:start (generated by `npm run registry`) -->
| Tool | Vendor | Kind | Recognised by | Entry |
| --- | --- | --- | --- | --- |
| [Aider](https://aider.chat) | Aider | AI agent | `aider@aider.chat`, name marker, `.aider.conf.yml` (+3 more config paths) | [aider](registry/aider.json) |
| [Amazon Q Developer](https://aws.amazon.com/q/developer/) | Amazon Web Services | AI agent | `.amazonq/**` | [amazon-q](registry/amazon-q.json) |
| [Amp](https://ampcode.com) | Amp | AI agent | `amp@ampcode.com`, `Amp-Thread-ID:`, 1 footer | [amp](registry/amp.json) |
| [Claude](https://claude.com/product/claude-code) | Anthropic | AI agent | `claude[bot]`, `noreply@anthropic.com`, `Claude-Session:`, name pattern, 1 footer, branch `claude/…`, `**/CLAUDE.md` (+2 more config paths) | [claude](registry/claude.json) |
| [Cline](https://cline.bot) | Cline | AI agent | `cline-agent`, `.clinerules` (+1 more config path) | [cline](registry/cline.json) |
| [Cursor](https://cursor.com) | Anysphere | AI agent | `cursoragent@cursor.com`, 2 footers, `.cursorrules` (+2 more config paths) | [cursor](registry/cursor.json) |
| [Devin](https://devin.ai) | Cognition | AI agent | `devin-ai-integration[bot]`, name pattern, 1 footer, `.devin/**` (+2 more config paths) | [devin](registry/devin.json) |
| [Factory Droid](https://factory.ai) | Factory | AI agent | `factory-droid[bot]` | [factory-droid](registry/factory-droid.json) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Google | AI agent | `gemini-cli[bot]`, `**/GEMINI.md` (+2 more config paths) | [gemini-cli](registry/gemini-cli.json) |
| [GitHub Copilot](https://github.com/features/copilot) | GitHub | AI agent | `Copilot`, `copilot-swe-agent[bot]`, `copilot@github.com`, `Copilot-Session:`, `Agent-Logs-Url:`, name pattern, 3 footers, branch `copilot/…`, `.github/copilot-instructions.md` (+3 more config paths) | [github-copilot](registry/github-copilot.json) |
| [Jules](https://jules.google) | Google | AI agent | `google-labs-jules[bot]` | [jules](registry/jules.json) |
| [Junie](https://www.jetbrains.com/junie/) | JetBrains | AI agent | `.junie/**` | [junie](registry/junie.json) |
| [Kiro](https://kiro.dev) | Amazon Web Services | AI agent | `.kiro/**` | [kiro](registry/kiro.json) |
| [Mastra Code](https://mastra.ai) | Mastra | AI agent | `noreply@mastra.ai`, name pattern | [mastra-code](registry/mastra-code.json) |
| [Open SWE](https://github.com/langchain-ai/open-swe) | LangChain | AI agent | `open-swe[bot]` | [open-swe](registry/open-swe.json) |
| [OpenAI Codex](https://openai.com/codex) | OpenAI | AI agent | `chatgpt-codex-connector[bot]`, `noreply@openai.com`, `codex@openai.com`, 1 footer | [openai-codex](registry/openai-codex.json) |
| [opencode](https://opencode.ai) | SST | AI agent | `opencode-agent[bot]`, `noreply@opencode.ai`, `opencode.json` (+2 more config paths) | [opencode](registry/opencode.json) |
| [OpenHands](https://www.all-hands.dev) | All Hands AI | AI agent | `openhands@all-hands.dev`, `.openhands/**` | [openhands](registry/openhands.json) |
| [Seer](https://docs.sentry.io/product/ai-in-sentry/seer/) | Sentry | AI agent | `seer-by-sentry[bot]` | [sentry-seer](registry/sentry-seer.json) |
| [CodeRabbit](https://coderabbit.ai) | CodeRabbit | AI reviewer | `coderabbitai[bot]`, `noreply@coderabbit.ai`, `.coderabbit.yaml` (+1 more config path) | [coderabbit](registry/coderabbit.json) |
| [Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review) | GitHub | AI reviewer | `copilot-pull-request-reviewer[bot]` | [github-copilot-review](registry/github-copilot-review.json) |
| [cubic](https://cubic.dev) | cubic | AI reviewer | `cubic-dev-ai[bot]` | [cubic](registry/cubic.json) |
| [Cursor Bugbot](https://cursor.com/bugbot) | Anysphere | AI reviewer | `cursor[bot]`, 1 footer | [cursor-bugbot](registry/cursor-bugbot.json) |
| [Ellipsis](https://www.ellipsis.dev) | Ellipsis | AI reviewer | `ellipsis-dev[bot]` | [ellipsis](registry/ellipsis.json) |
| [Gemini Code Assist](https://developers.google.com/gemini-code-assist/docs/review-github-code) | Google | AI reviewer | `gemini-code-assist[bot]`, `.gemini/config.yaml` (+1 more config path) | [gemini-code-assist](registry/gemini-code-assist.json) |
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

Something missing or wrong? [Add a tool](CONTRIBUTING.md#adding-a-tool): it is one JSON file with a link to the evidence. Some tools (Kiro, Amazon Q, Junie) are only recognised by their config files so far, because nobody has found their commit signals yet.

## Limits and responsible use

- whowrote can only see what is **disclosed**. Tools that leave no trace, or people who remove the trailer, look like "No AI disclosed". Treat percentages as a lower bound for AI involvement.
- Anyone can write any trailer, name, branch or note. whowrote reports what a commit **claims**; it does not verify signatures.
- Please don't use it to rank or police individual people. It deliberately has no per-person breakdown, and "AI-assisted" says nothing about quality: disclosure is a good habit, and a tool that punishes it teaches people to stop disclosing.

## Contributing

The registry grows with the tools. New tools, better patterns and misclassification reports are all welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
