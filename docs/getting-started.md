# Getting started

## What you need

- **Node.js 20 or newer.**
- **Claude Code**, installed and on your `PATH` as `claude`. Either sign in
  once by running `claude` in a terminal, or have an Anthropic API key ready
  (see [Claude access](claude-access.md)).
- **macOS or Linux.** Windows works under WSL.
- **git**, for the "what changed" card on each job.

## Install and run

```bash
git clone https://github.com/onuohasilver/agent-office.git
cd agent-office
npm install
npm start            # builds, then serves on http://localhost:4317
```

Open the link it prints, `Agent Office open on http://localhost:4317/?key=…`.
The key keeps other accounts on the machine out; your browser remembers it, so
after that <http://localhost:4317> is enough. Lost the link? `agentoffice --link`,
or from a clone, the key is in `data/office-key`.

## Where your projects are

The office's projects are the subfolders of one folder, `OFFICE_ROOT`. By
default that is the folder the office itself sits in, so a layout like this
works with no settings:

```
~/code/
├── agent-office/
├── storefront/      ← a project
└── payments-api/    ← a project
```

Point it somewhere else with `OFFICE_ROOT=~/work npm start`. Name a project in
the chat with `#`, e.g. `#storefront`.

## Optional extras

| Extra | What it adds | How |
|---|---|---|
| Voice | talk to the office, hear it answer | [Talking out loud](voice.md) |
| Terminal | a real shell in a drawer under the office | [The terminal](terminal.md) |
| Phone | the office on your phone, installed like an app | [On your phone](phone.md) |

## Next

Run [your first job](guides/your-first-job.md).

## Developing

`npm run dev` serves with hot reload on <http://localhost:5317>. See
[Development](development.md).
