# Contributing

Thanks for wanting to help. Bug reports, ideas and pull requests are all
welcome.

## Before you start

- **Bugs and ideas** go in [issues](https://github.com/onuohasilver/agent-office/issues).
  Search first; add to an existing one rather than opening a duplicate.
- **Security problems** don't: see [SECURITY.md](SECURITY.md).
- **Bigger changes** — a new feature, a new dependency, anything that changes
  how the office is run — open an issue first so we can agree on the shape
  before you spend time on it.

## Setting up

You need Node.js 20+, git and Claude Code. Then:

```bash
git clone https://github.com/onuohasilver/agent-office.git
cd agent-office
npm install
npm run dev      # http://localhost:5317, hot reload
```

[Development](docs/development.md) covers how the pieces fit, shipping web
and server changes, and testing without touching an office you're using.

## Checking your change

```bash
npm run build
npm test         # a smoke test against a stand-in claude; costs no tokens
```

Then try it in the running office. The smoke test catches a broken server; it
can't tell you whether the change feels right on screen.

## How the code is written

- **Plain JavaScript, ES modules, no framework.** The server is Node's `http`
  plus `ws`; the browser is three.js and the DOM. Please don't add a framework
  or a build step beyond Vite.
- **Few dependencies.** Each one is something every user installs. Say why in
  the PR if you add one.
- **Match the code around you**: its naming, its comment density, its idiom.
  Comments explain *why*, not *what*.
- **Local first.** The server listens on localhost and checks every request's
  host and origin, because it can run Claude with full autonomy. Anything that
  widens who can reach it needs a very good reason and a note in
  [Security](docs/security.md).

## Commits and pull requests

- One change per PR, small enough to review in one sitting.
- Commit subjects say what changed, in plain words: *"Hide the plan meters
  when an API key is in use"*. The body says why, and anything a reviewer
  would otherwise have to work out.
- Update the docs when you change how something is used or configured, and add
  a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased* if users would
  notice.
- CI must pass. Fill in the PR template; "how it was checked" matters most.

## Licence

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
