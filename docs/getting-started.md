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

## Check your setup

```bash
agentoffice doctor
```

It checks Node 20+, git, that `claude` is installed and signed in (or that
`ANTHROPIC_API_KEY` is set) and that your port is free. Each problem is one
line with the exact fix, and the command exits 1 if anything needs fixing. The
same checks run every time the office starts, but only as warnings: the office
starts anyway.

## Where your projects are

Start the office from where your work is:

- **Inside a git repo** (any folder in it), that repo is your project. Nothing
  to configure: `cd ~/code/storefront && agentoffice`, then `#storefront` in
  the chat.
- **Anywhere else**, the subfolders of the folder you run it from are your
  projects, as they always were:

```
~/code/              ← run agentoffice here
├── storefront/      ← a project
└── payments-api/    ← a project
```

Either way you can add another folder from the **Projects** tab (*Add a
folder*, with its full path, `~/work/billing` works). The office remembers it
across restarts. A folder named like one you already have is listed as
`parent-name`.

`OFFICE_ROOT` still works the old way and wins over the git repo: with
`OFFICE_ROOT=~/work npm start`, or `OFFICE_ROOT=~/code agentoffice` from inside
a repo, the subfolders of that folder are the projects. Use it if you started
the office from inside a repo that holds your projects as subfolders.

## Your first job

The first time you open the office, the chat offers a **first job**: *Summarise
it*. It runs with **Plan only** clearance, so the agent reads the project and
tells you what it is, and cannot edit a file or run a command. Skip it with
*Not now*. When you are ready to make a change, follow
[your first job](guides/your-first-job.md).

## Optional extras

| Extra | What it adds | How |
|---|---|---|
| Voice | talk to the office, hear it answer | [Talking out loud](voice.md) |
| Phone | the office on your phone, installed like an app | [On your phone](phone.md) |

## Next

Run [your first job](guides/your-first-job.md).

## Developing

`npm run dev` serves with hot reload on <http://localhost:5317>. See
[Development](development.md).
