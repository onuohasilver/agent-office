# Claude access

The key button beside Appearance chooses how the office signs in to Claude:

- **Claude Code login** — the login Claude Code keeps on this machine, so jobs
  run on your Claude plan and the plan meters show how much of it is used.
- **API key** — an Anthropic API key, billed to that API account. Paste it
  once; it's checked with Anthropic, kept in `auth.json` in the data folder
  (readable only by you) and never sent back to the browser. A key already in
  `ANTHROPIC_API_KEY` is used until you paste another. The plan meters hide,
  because there's no plan.

The choice applies to every `claude` the office starts: jobs, the chief,
standup and break-room talk. With the login chosen, a stray
`ANTHROPIC_API_KEY` in your shell is kept away from them, since `claude` would
otherwise prefer it. Jobs already running finish the way they started. The
in-app terminal is your own shell and never gets the office's key.

## Plan usage

Under the level bar, two meters show how much of your Claude plan is used:
**This session** (the 5-hour window) and **This week**, each with when it
resets and a countdown. They turn amber at 70% and red at 90%. The server reads
the same numbers as Claude Code's `/usage`, using the login Claude Code keeps
on this machine (the macOS keychain, `~/.claude/.credentials.json`, or
`CLAUDE_CODE_OAUTH_TOKEN`). It checks every two minutes and shortly after each
turn finishes.

The meters only apply to the Claude Code login. They use the same endpoint
Claude Code does, which isn't a published API, so if it stops answering the
meters say so and the rest of the office carries on.
