# Changelog

Notable changes to Agent Office. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

## 0.2.0 — 2026-10-12

### Fixed
- A job whose agent flagged a question, decision or blocker is no longer
  reported as done when their turn ends. The chief posts "Waiting on you"
  instead, and no shipped count, XP or celebration is given until it resumes.

### Leaderboard
- An optional leaderboard: join under a claimed handle and compare jobs
  finished, tokens used and agent time, weekly and all time. Off until you
  join; only per-day counters are shared. The service is a Cloudflare Worker in
  `leaderboard/`. A local ledger (`data/activity.json`) now keeps those counters.

## 0.1.0 — 2026-10-11

The first public release.

### The office
- A 3D office where each agent is a Claude Code session. Agents walk to the
  library to read, the server room to run commands and their desk to write.
- Chat with `@agent` and `#project` tags; a chief of staff routes everything
  else, hands follow-ups to whoever is on the job, and asks when unsure.
- Slack-style channels and threads; attachments, including screenshots the
  chief can read.
- A daily standup at the whiteboard, and a break room where idle agents talk
  (in #chill-room) and play eight-ball.
- Levels: shipped jobs earn XP, and each level hires another agent.
- Themes, light and dark mode, and an installable app for desktop and phone.

### Jobs
- Clearance per job: plan only, edit files, or full autonomy, with the option
  to grant more mid-job.
- The chief picks Haiku, Sonnet or Opus to fit the work and steps up a rung
  when a job fails.
- Agents message each other and hand work to free colleagues.
- "What changed": each job's diff, from working-tree snapshots that never
  touch the repo's own index or history.
- Jobs resume after a server restart.

### Setup
- Claude access: the Claude Code login on the machine, or an Anthropic API key.
- Plan usage meters for the Claude Code login.
- Voice: dictation with whisper.cpp and a Piper voice per agent, all local.
- An opt-in terminal in a drawer under the office.
