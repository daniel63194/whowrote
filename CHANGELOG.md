# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/). Registry additions are minor changes; a pattern that changes existing verdicts is called out.

## Unreleased

## 0.1.0

First release.

- Registry of 36 tools: 16 AI coding agents (Claude, GitHub Copilot, Cursor, OpenAI Codex, Devin, Jules, Gemini CLI, Amp, opencode, Aider, OpenHands, Factory Droid, Mastra Code, Cline, Open SWE, Seer), 7 AI reviewers (CodeRabbit, Greptile, cubic, Ellipsis, Gemini Code Assist, Copilot code review, Cursor Bugbot) and 13 bots, each with evidence links and examples.
- `classifyCommit`, `classifyPullRequest`, `classifyActor`, `isHuman`, `isBot`, `isAI`, `identify`, `parseIdentity`, `tools` and `getTool`. GitHub REST and webhook objects are accepted as they are.
- Signals: author and co-author identities (logins, noreply emails, emails, specific name patterns), aider name markers, tool session trailers, `Assisted-by` / `AI-assisted` / `Made-with` / `Generated-by` trailers, disclosure lines ("🤖 Generated with …") and session links. Description-only disclosures are reported without changing the verdict.
- CLI: history breakdown with tools, models, bots and `--by week|month|quarter|year`; `explain`, `actor`, `pr` (GitHub events and `gh pr view --json`), `tools`; text, Markdown and JSON output; `--fail-on`.
- GitHub Action: label pull requests `ai-assisted` or `ai-agent`, fail on verdicts, or summarise the history.
- `whowrote/registry.json` with the full registry for other languages.
