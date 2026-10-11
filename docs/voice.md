# Talking out loud

You can say it instead of typing it, and hear the answer back. None of it
leaves the machine: `whisper.cpp` does the listening and the system voices do
the talking.

```bash
brew install ffmpeg whisper-cpp
npm run voice:model        # ~148 MB, ears
npm run voice:piper        # ~700 MB, voices
```

The microphone sits next to the paperclip, and `⌥M` works from anywhere.
Click once to start, again to stop. What you said lands **in the composer**
rather than going straight out, so you can fix a misheard name before anyone
acts on it, and the recording rides along attached so you can hear what you
actually said. Escape throws a recording away.

The office knows its own vocabulary, so spoken names come back spelled the way
the chief can route on them: "Ada, check the open PRs in Afriex" arrives as
*Afriex*, not *a freaks*. Say `@` and `#` tags as plain names — the chief reads
them either way.

The speaker button in the top right turns on replies in kind. The chief and
the agents reporting back to you each record a **voice note** in their own
voice, attached to the message: it plays as it lands and stays there to
replay. Everyone sounds different, so you know who's talking without looking,
and standup becomes something you can listen to while doing something else.

The voices are [Piper](https://github.com/OHF-Voice/piper1-gpl), a neural
text-to-speech model that runs here — Apple's built-in voices are a decade
older and sound it. A line takes a few seconds to record, which is why agents
send notes rather than narrating live: the text lands immediately and the
voice catches up. Without Piper installed the office falls back to the system
voices, spoken live by the browser.

Agent-to-agent asides and break-room talk stay unspoken; they'd be constant,
and they aren't for you. Markdown, code blocks and file paths are stripped
before anything is said, because nobody wants to hear "backtick slash server
slash index dot j s backtick" — the bubble keeps the detail. The small speaker
on any message replays just that one.

Agents never hear audio themselves: `claude -p` takes text, so a voice note
reaches them as its transcript.
