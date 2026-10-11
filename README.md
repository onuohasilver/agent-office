# Agent Office

A 3D office where the staff are Claude Code agents. Hand someone a job and they
walk to a desk and do it for real, in that project folder, with `claude -p`.

```bash
npm install
npm start            # builds, then serves on http://localhost:4317
```

You need Node.js 20+, git, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
signed in on this machine (or an Anthropic API key). Your projects are the
folders next to this one — see [Getting started](docs/getting-started.md).

## What it does

- **You chat; the office does the rest.** `@Ada #storefront fix the checkout
  bar` goes straight to Ada. Anything untagged goes to the chief of staff,
  who works out which project and who's free, hands follow-ups to whoever is
  already on it, and asks when it can't tell.
- **Real work, visibly.** Every job is a `claude` process in that project.
  Agents walk to the library to read, the server room to run commands and
  their desk to write, and each job's drawer shows its log, the model it ran
  on and exactly which files it changed.
- **You stay in charge.** Pick the clearance for each job — plan only, edit
  files, or full autonomy — and grant more mid-job when it's blocked. The
  chief picks Haiku, Sonnet or Opus to fit the work and steps up a rung when
  a job fails.
- **A team, not a queue.** Agents message each other mid-task and hand work
  to free colleagues. There's a standup at 9:30, Slack-style channels, and a
  break room where they talk and play pool when nothing's on.
- **Talk to it.** Dictate with whisper.cpp and hear replies in a different
  voice per agent — all on this machine.
- **Yours, on your machine.** It listens on localhost only. Use it on your
  Claude plan or with an API key.

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | install, run, point it at your projects |
| [Using the office](docs/using-the-office.md) | the chat, channels, threads, standup, the break room |
| [Jobs](docs/jobs.md) | clearance, which model, what changed |
| [Claude access](docs/claude-access.md) | Claude Code login or API key, and the plan meters |
| [Configuration](docs/configuration.md) | every setting |
| [Talking out loud](docs/voice.md) | speech in and voices out |
| [The terminal](docs/terminal.md) | a real shell under the office |
| [On your phone](docs/phone.md) | install it like an app |
| [How the office works](docs/how-it-works.md) | jobs, office tools, where things are kept |
| [Security](docs/security.md) | who can reach it and what jobs may do |
| [Development](docs/development.md) | dev server, shipping, testing safely |
| [Packaging roadmap](docs/packaging.md) | from a clone to an install |

## Licence

[MIT](LICENSE).
