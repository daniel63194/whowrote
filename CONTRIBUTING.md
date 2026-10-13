# Contributing to whowrote

Thanks for helping. The most useful contributions are:

1. **A tool whowrote doesn't know yet**, or a new signal for one it does (a new co-author email, a new bot account, a new "Generated with" footer).
2. **Misclassifications**: a commit or pull request that got the wrong verdict. Please [report it](https://github.com/daniel63194/whowrote/issues/new?template=misclassified.yml) with a link to the public commit.

## Development

You need Node.js 22.12+ and git for the dev tooling. The published package runs on Node.js 20.19+.

```sh
git clone https://github.com/daniel63194/whowrote
cd whowrote
npm ci
npm test          # builds, then runs the tests
npm run typecheck
```

Try your build on a real repository:

```sh
node dist/cli.js -C ../some-repo --since "6 months ago" --commits
node dist/cli.js -C ../some-repo explain <sha>
```

The package has **no runtime dependencies**, and that is deliberate: it is meant to be a small building block in other tools. Please don't add any.

## Adding a tool

Each tool is one file in [`registry/`](registry/), named after its id. Copy a similar entry and edit it.

```json
{
  "id": "example-agent",
  "name": "Example Agent",
  "vendor": "Example Inc.",
  "kind": "ai-agent",
  "url": "https://example.com",
  "description": "One sentence: which products this covers.",
  "aliases": ["example agent"],
  "logins": ["example-agent[bot]"],
  "emails": ["agent@example.com"],
  "names": [],
  "trailers": ["Example-Session"],
  "footers": [{ "pattern": "\\bexample\\.com/sessions/" }],
  "models": [],
  "evidence": ["https://docs.example.com/git-attribution", "https://github.com/some/repo/commit/abc123"],
  "examples": [
    {
      "commit": { "author": "Jane Doe <jane@example.com>", "message": "Fix\n\nCo-authored-by: Example Agent <agent@example.com>" },
      "verdict": "ai-assisted"
    }
  ]
}
```

| Field | What it's for |
| --- | --- |
| `kind` | `ai-agent` (writes code), `ai-reviewer` (reviews pull requests; its applied suggestions count as AI assistance), or `bot` (automation without AI). |
| `aliases` | Lowercase names that people write in disclosure lines and trailers: `Assisted-by: Example Agent`, `🤖 Generated with [Example Agent](…)`. The tool's `name` and `id` are aliases already. |
| `logins` | GitHub logins, including `[bot]`. Logins inside `…@users.noreply.github.com` addresses are matched too, so you don't need to list those emails. |
| `emails` | Exact email addresses the tool uses as author or co-author. Only list addresses that belong to the tool, never to its staff. |
| `names` | Regular expressions for names that identify the tool by themselves. Make them specific: `^Claude (?:Opus\|Sonnet)\b` is fine, `^Claude` would catch people called Claude. |
| `nameMarkers` | Patterns that mark a person's name as AI-assisted, like aider's `Jane Doe (aider)`. |
| `trailers` | Trailer keys that belong only to this tool, like `Claude-Session`. `Co-authored-by`, `Assisted-by`, `Made-with` and the like are read for every tool already. |
| `footers` | Patterns searched for anywhere in a message, usually session links. Add `"scope": "message"` when the text only says that the message or description was generated. |
| `models` | Patterns with a `(?<model>…)` group that pull the model out of a co-author name, e.g. `^aider \((?<model>[^()]+)\)$`. |
| `evidence` | At least one link that shows the signal: vendor docs, or public commits that carry it. |
| `examples` | Run as tests. Add one per signal, plus a **near miss** with verdict `human` when the tool's name is also a person's name or a common word. |

Then run `npm run registry` (it validates every entry, regenerates `src/registry-data.ts` and updates the table in the README) and `npm test`.

Patterns run on untrusted text, so `npm run registry` rejects the risky shapes: nested quantifiers like `(a+)+`, `.*`, backreferences, and anchors in footers. The fuzz tests also time every pattern on long input.

## Changing how classification works

The logic lives in `src/classify.ts`, identity matching in `src/identity.ts` and `src/registry.ts`. Changes that alter verdicts need tests in `test/classify.test.ts` for the case you fix **and** the near misses around it. Please also run the CLI on two or three active repositories that use AI tools and say in the pull request what changed.

| File | What it does |
| --- | --- |
| `src/identity.ts` | Parses identities, reads logins from noreply emails, recognises unlisted bots. |
| `src/registry.ts` | Compiles the registry and matches identities and names. |
| `src/classify.ts` | Trailers, footers, disclosure lines and verdicts. |
| `src/git.ts` | Streams `git log` (the only module that runs a program). |
| `src/stats.ts`, `src/report.ts` | Counting, and text, Markdown and JSON output (escapes untrusted text). |
| `src/cli.ts` | The command line. |

## Pull requests

- Keep each pull request focused on one change.
- Behaviour changes come with tests.
- `npm test` and `npm run typecheck` must pass.
- Add a line to `CHANGELOG.md` under "Unreleased" for anything users will notice.
- If an AI tool helped you, a `Co-authored-by` trailer or a note in the description is appreciated. This project would be a strange place to hide it.

## Releasing (maintainers)

Releases are staged with [stagecheck](https://github.com/daniel63194/stagecheck), never published directly:

1. `npm version <patch|minor|major>`, push the branch and open a pull request; merge it, then push the tag (`git push origin v<version>`).
2. The release workflow tests the package, reviews the tarball with stagecheck, and stages it with `npm stage publish` (trusted publishing, with provenance).
3. On your machine, run `npx stagecheck`, read the review, and approve with 2FA.

The first release cannot use trusted publishing, because npm can only trust a workflow for a package that exists. Stage it from your machine instead:

```sh
npm ci && npm test
npm login
npx stagecheck ci --stage-publish -- --access public
npx stagecheck            # review and approve
```

Then add `release.yml` as a trusted publisher on npmjs.com, and push the `v0.1.0` tag: the release workflow sees that the version is already on npm, skips staging and creates the GitHub release.
