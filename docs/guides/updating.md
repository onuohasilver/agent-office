# Updating

Your office — jobs, chat, channels, XP, team profiles, Claude access — lives
in the data folder (`~/.agent-office`), which updates never touch.

## The installed command

```bash
npm install -g agent-office-studio@latest
```

Then stop the office (Ctrl-C) and start it again. Running jobs stop cleanly
and resume when it comes back.

Read the [changelog](../../CHANGELOG.md) for what changed and anything you
need to do. `agent-office --version` says what you're on.

### A particular version

```bash
npm install -g agent-office-studio@0.2.0
```

## A clone

```bash
cd agent-office
git pull
npm install
npm run build
```

Then restart it with `npm start`. To stay on a release, check out its tag
(`git checkout v0.2.0`) instead of pulling. A clone's data is in `data/`.

## If something breaks

- **Keep a way back:** copy the data folder before updating. Going back is
  then: stop the office, install the previous version, restore the folder,
  start.
