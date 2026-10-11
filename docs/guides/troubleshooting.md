# Troubleshooting

Find the message you're seeing, or the symptom.

## The office won't start

**`Error: listen EADDRINUSE: address already in use 127.0.0.1:4317`**
Something is already on that port — usually another office. Find it with
`lsof -i :4317`, or start this one elsewhere: `PORT=4400 npm start`.

**The page says "No build yet."**
The server is running but `dist/` is empty. Run `npm run build`, or use
`npm start`, which builds first.

**The page loads but the office is blank.**
Open the browser console. The office needs WebGL; if it's disabled (some
remote desktops and VMs), the 3D view can't draw.

## Jobs don't run

**A job fails with "Could not start claude: spawn claude ENOENT".**
Claude Code isn't on the `PATH` the office was started with. Check
`which claude` in the same terminal. If it lives somewhere unusual, point the
office at it: `CLAUDE_BIN=/path/to/claude npm start`.

**Jobs fail straight away with an authentication error.**
On the **Claude Code login**: run `claude` in a terminal and sign in, then
retry. On an **API key**: open the key button beside Appearance and check
which key is in use; paste a new one if it was revoked.

**"That project folder is gone."**
The project was moved or renamed after the job was created. Projects are the
folders directly inside `OFFICE_ROOT`; see
[Getting started](../getting-started.md#where-your-projects-are).

**A project doesn't show up.**
It must be a folder directly inside `OFFICE_ROOT` — not nested deeper. The
server prints `OFFICE_ROOT` when it starts: *"projects in …"*.

**A job keeps getting blocked.**
Its clearance doesn't allow what it's trying to do — *Edit files* refuses
shell commands. Grant more from the job's drawer, or give the next job
*Full autonomy* if it needs to run tests or builds.

**No "What changed" card.**
The project isn't a git repository. Run `git init` in it.

## The plan meters

**"Sign in to Claude Code to see usage."**
No Claude Code login was found on this machine. Run `claude` and sign in.

**"Claude Code login expired."**
Run `claude` once; it refreshes the login.

**"Usage unavailable (429)."**
The usage endpoint is rate-limiting. The office backs off and tries again on
its own; jobs aren't affected.

**The meters are gone.**
Claude access is set to *API key*. There's no plan to measure; usage is in
your Anthropic Console.

## Voice

**The microphone does nothing, or "No speech model installed."**
Install the listening side: `brew install ffmpeg whisper-cpp`, then
`npm run voice:model`. See [Talking out loud](../voice.md).

**"Piper is not installed" or "Piper has no voices downloaded."**
Run `npm run voice:piper` (needs Python 3). Until then, replies use the
browser's built-in voices.

**The browser won't allow the microphone.**
Browsers only allow it on `localhost` or HTTPS. Open the office at
`http://localhost:4317`, not an IP address.

## The terminal won't open

**There's no terminal button, or it says the terminal is off.**
It's off by default. Start the office with `OFFICE_TERMINAL=1 npm start`.

**"node-pty is not installed."**
It's a native module and needs build tools. On macOS:
`xcode-select --install`, then `npm install`. On Linux: install
`build-essential` and `python3`, then `npm install`.

## On a phone

**"Local only." (HTTP 403)**
The office only accepts its own hostnames. Add the one you're using:
`OFFICE_ALLOWED_HOSTS=my-mac.tail1234.ts.net npm start`. See
[On your phone](../phone.md).

## Still stuck?

Search the [issues](https://github.com/onuohasilver/agent-office/issues), or
open one with the server output and the browser console. Please remove keys,
tokens and private paths first.
