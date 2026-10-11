# Getting started

## What you need

- **Node.js 20 or newer.**
- **Claude Code**, installed and on your `PATH` as `claude`. Either sign in
  once by running `claude` in a terminal, or have an Anthropic API key ready
  (see [Claude access](claude-access.md)).
- **macOS or Linux.** Windows works under WSL.
- **git**, for the "what changed" card on each job.

## Install

```bash
npm install -g agent-office-studio
```

That gives you the `agent-office` command (`agent-office-studio` works too).
To try it without installing: `npx agent-office-studio`.

Check the machine is ready — this changes nothing:

```bash
agent-office doctor
```

## Run

Go to the folder that holds your projects and start the office there:

```bash
cd ~/code
agent-office
```

It opens <http://localhost:4317> in your browser (or the next free port, if
4317 is taken). Ctrl-C closes the office; running jobs stop cleanly and pick up
where they left off next time.

## Where your projects are

The office's projects are the folders directly inside the one you start it
in:

```
~/code/               ← agent-office runs here
├── storefront/       ← a project
└── payments-api/     ← a project
```

Name a project in the chat with `#`, e.g. `#storefront`. To start it over a
different folder without `cd`: `agent-office ~/work`.

## Where the office keeps things

Jobs, chat, channels, your team, Claude access and attachments live in the
**data folder**, `~/.agent-office`, so they survive updates. Use another with
`--data <dir>`. See [How the office works](how-it-works.md#where-things-are-kept).

## Options

```
agent-office [folder]      Start the office over [folder] (default: here)
agent-office doctor        Check this machine is ready
agent-office voice         Download the speech models

-p, --port <n>     Port (default 4317, or the next free one)
--no-open          Don't open the browser
--terminal         Turn on the in-app terminal
--data <dir>       Data folder (default ~/.agent-office)
```

Everything else is an environment variable: [Configuration](configuration.md).

## Optional extras

| Extra | What it adds | How |
|---|---|---|
| Voice | talk to the office, hear it answer | [Talking out loud](voice.md) |
| Terminal | a real shell in a drawer under the office | [The terminal](terminal.md) |
| Phone | the office on your phone, installed like an app | [On your phone](phone.md) |

## Next

Run [your first job](guides/your-first-job.md).

## From a clone instead

To work on the office itself, or run the latest unreleased code:

```bash
git clone https://github.com/onuohasilver/agent-office.git
cd agent-office
npm install
npm start            # builds, then serves on http://localhost:4317
```

A clone keeps its data in `data/` beside the code, and its projects are the
folders next to the clone (`OFFICE_ROOT` changes that). `npm run dev` serves
with hot reload on <http://localhost:5317>. See [Development](development.md).
