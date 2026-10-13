# Security policy

whowrote reads untrusted text (commit messages, names, pull request descriptions) and its verdicts can gate CI, so a crafted input that crashes it, hangs it or rewrites its output can be a security bug.

## Reporting a vulnerability

Please **do not open a public issue** for vulnerabilities. Report them privately through [GitHub Security Advisories](https://github.com/daniel63194/whowrote/security/advisories/new).

You can expect an acknowledgement within 3 working days and a plan within 10. Fixes are released as soon as they are ready, with credit to you unless you prefer otherwise.

## In scope

- A commit message, identity, pull request body, branch name or git note that makes whowrote hang, use excessive memory, or throw (for example a regular expression that backtracks).
- Terminal escape sequences or Markdown that get through to the terminal, the job summary or a label.
- Command or argument injection into `git`, through revisions, paths, notes refs or Action inputs.
- A GitHub token sent anywhere other than the GitHub API that whowrote was configured to use (`api.github.com`, `WHOWROTE_GITHUB_API`, or `GITHUB_API_URL` and `GITHUB_GRAPHQL_URL` in Actions).
- The GitHub Action labelling or failing a pull request it should not, because of input from the pull request.

## Not a vulnerability

whowrote reports what commits **disclose**, and anyone can write any trailer or name. A commit that pretends to be from an AI tool, or hides that it is, is expected behaviour, not a bypass. A pattern that is too broad or too narrow is a [misclassification](https://github.com/daniel63194/whowrote/issues/new?template=misclassified.yml): please report it publicly.

## Supported versions

Only the latest minor release receives fixes.
