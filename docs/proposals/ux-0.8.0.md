# 0.8.0 UX pass

Status: one line per item. States: todo / doing / review / done / blocked.
Branch per owner: ux/<area>, own worktree, no direct pushes to master.

## Tunde (server)
- [ ] todo: per-job token + cost tracking; per-job/per-day cap that pauses and asks
- [ ] todo: failure cause classification + suggested fix
- [ ] todo: "N jobs resumed" after restart
- [ ] todo: stuck-job detection
- [ ] todo: post API contracts in #ux-0-8-0

## Amara (UI)
- [ ] todo: cost counter in job drawer + cap prompt
- [ ] todo: diff view, Apply / Discard / Ask for changes (local jobs)
- [ ] todo: failure card with fix button
- [ ] todo: @agent / #project autocomplete
- [ ] todo: finished/blocked notifications
- [ ] todo: update banner
- [ ] todo: low-power mode + reduced motion

## Kai (first run)
- [ ] review: `agentoffice doctor` + startup preflight (server/preflight.js exports runPreflight/formatReport for `doctor --bundle`)
- [ ] review: zero-config project discovery (git repo = project; subfolders otherwise; add folders in UI; docs/getting-started.md)
- [ ] review: guided read-only first job (Plan only card in the empty chat)

## Zola (release)
- [ ] todo: /api/version npm check
- [ ] todo: `doctor --bundle` diagnostics
- [ ] todo: clean-install CI (pack, install, start, health, fake job)
- [ ] todo: 0.8.0 changelog + publish checklist
