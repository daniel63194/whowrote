# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/). Registry additions are minor changes; a pattern that changes existing verdicts is called out.

## Unreleased

## 0.2.0

Finds AI involvement that commit messages don't show, without guessing.

- **GitHub pull requests.** `whowrote pr <number|owner/repo#n|url>` reads a pull request from GitHub. `--github` reads the pull request of every squash-merged commit in a history, in batches through GraphQL, so an agent's pull request (author, branch, description) counts even when the squash commit hides it. `explain --github` looks up each commit's pull request. `whowrote pr --event` lists the commits through the API when they aren't in the clone.
- **Agent branches.** `copilot/…` and `claude/…` branches, in pull requests and in merge commit messages, are evidence. New `branch` and `pr-author` signals.
- **Attribution notes.** git-ai authorship logs (`refs/notes/ai`, read by default) and Agent Trace records (`--notes <ref>`) give the tool, model and line counts. New `note` signal, `lines` on evidence and tools, and `parseNotes()`.
- **Agent setup.** Reports list the AI tools a repository is configured for, from files like `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md` and `AGENTS.md`. New `detectAgentSetup()`, and registry entries for Kiro, Amazon Q Developer and Junie, recognised by their config files.
- **Hints.** `--hints` reports weak signals separately (changes to agent config, Claude Code's PR layout, `cursor/`, `codex/` and `devin/` branches). They never change a verdict. New `hints` on results.
- **Declarations.** `AI-assisted: no`, `AI: none` and similar, or an Agent Trace record that credits only people, mark a result `declaredHuman`. Reports show "Declared no AI", and the Action has a `declared-human` output.
- Reports call the `human` verdict "No AI disclosed", which is what it means. The verdict values are unchanged.
- The subject line is no longer read for trailers, so `ai: add streaming` is a commit scope, not a disclosure.
- Registry: `branches`, `files` and `hints` fields; `windsurf` and `cascade` aliases for Devin's editor agent, `gemini` for Gemini CLI.
- Action: `github` and `hints` inputs.

## 0.1.0

First release.

- Registry of 36 tools: 16 AI coding agents (Claude, GitHub Copilot, Cursor, OpenAI Codex, Devin, Jules, Gemini CLI, Amp, opencode, Aider, OpenHands, Factory Droid, Mastra Code, Cline, Open SWE, Seer), 7 AI reviewers (CodeRabbit, Greptile, cubic, Ellipsis, Gemini Code Assist, Copilot code review, Cursor Bugbot) and 13 bots, each with evidence links and examples.
- `classifyCommit`, `classifyPullRequest`, `classifyActor`, `isHuman`, `isBot`, `isAI`, `identify`, `parseIdentity`, `tools` and `getTool`. GitHub REST and webhook objects are accepted as they are.
- Signals: author and co-author identities (logins, noreply emails, emails, specific name patterns), aider name markers, tool session trailers, `Assisted-by` / `AI-assisted` / `Made-with` / `Generated-by` trailers, disclosure lines ("🤖 Generated with …") and session links. Description-only disclosures are reported without changing the verdict.
- CLI: history breakdown with tools, models, bots and `--by week|month|quarter|year`; `explain`, `actor`, `pr` (GitHub events and `gh pr view --json`), `tools`; text, Markdown and JSON output; `--fail-on`.
- GitHub Action: label pull requests `ai-assisted` or `ai-agent`, fail on verdicts, or summarise the history.
- `whowrote/registry.json` with the full registry for other languages.
