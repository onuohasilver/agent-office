# Security

Agent Office runs Claude in your projects, can give it full autonomy, and can
hand out a shell. Security problems matter here more than most.

## Reporting a problem

**Please don't open a public issue.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/onuohasilver/agent-office/security/advisories/new).

Include what an attacker could do, and the steps to show it. You'll get an
answer within a week. Once a fix is out, you'll be credited in the release
notes unless you'd rather not be.

## What counts

Especially welcome:

- anything that lets a **web page, another site or another machine** reach the
  office's API or websocket, start a job, or open a terminal
- anything that lets an **agent** go beyond the clearance its job was given,
  reach the terminal, or read the API key
- anything that **leaks the API key** or Claude credentials: to the browser,
  logs, `state.json`, the chat or a child process that shouldn't have it

Not in scope: what Claude does inside a job you started with *Full autonomy*
(that is the point of the setting), and exposing the office on a network
yourself against the advice in [docs/security.md](docs/security.md).

## Supported versions

Fixes go into the latest release only.

## How it is meant to work

[docs/security.md](docs/security.md) describes the security model: who can
reach the office, what jobs may do, how credentials are kept, and the terminal.
