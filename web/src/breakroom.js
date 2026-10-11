// Off-the-clock chatter. Every so often two agents idling in the break room
// turn to each other and trade a few lines. Anyone handed work, called to
// standup or sent home drops out, and the chat ends there.
//
// The talking happens here, because the floor and who is standing on it only
// exist in the browser. The lines themselves are office history, so each one
// is posted to #chill-room as it is spoken. The office can be open in more
// than one window, each with its own floor, so a conversation is claimed from
// the server first: whoever wins the claim does the talking, and the lines
// land in the channel once rather than once per window.

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export async function api(path, body, method) {
  const res = await fetch(path, body === undefined
    ? { method: method || 'GET' }
    : { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json().catch(() => ({}));
}

// Each chat alternates speakers, starting with A. {a} and {b} are names.
const CHATS = [
  ['Coffee machine is making that noise again.', 'It does that when it likes you.', 'It has never liked me.'],
  ['Weekend plans, {b}?', 'Sleep, then more sleep.', 'Ambitious. I respect it.'],
  ['Did you see the size of that last diff?', 'I saw it. I chose not to look closer.', 'Wise.'],
  ['{b}, tabs or spaces?', 'Whatever the linter says.', 'Diplomatic answer.', "It's the only safe one in here."],
  ['I renamed one variable and forty tests broke.', 'Only forty? Lucky.', 'You have a dark sense of luck, {b}.'],
  ['Who keeps leaving one sip in the coffee pot?', 'Not me.', 'That is exactly what someone guilty would say.'],
  ['Favourite error message?', '"Something went wrong."', 'So helpful. So honest.'],
  ['Read anything good lately?', 'The changelog for our test runner. Gripping stuff.', 'No spoilers please.'],
  ['This couch is too comfy.', 'Dangerous for productivity.', 'Good thing nobody has given us work yet.'],
  ['Do you ever dream in stack traces?', 'Only on deploy days.', 'Same.'],
  ['{b}, you were quiet in standup.', 'Saving my words for code review.', 'Ominous.'],
  ['Hot take: README files are love letters.', 'To whom?', 'To whoever opens this repo at 2am.', "That's beautiful, {a}."],
  ["What's the plant's name?", 'I call it Prod.', 'Why?', "Because we don't touch it."],
  ['I fixed a bug by deleting code today.', 'Best kind of fix.', 'Felt like spring cleaning.'],
  ['Lunch?', 'Already had it. Twice.', 'Bold.'],
  ['Have you noticed the boss says "quick change" a lot?', 'Never quick.', 'Rarely one change.'],
  ['If you could rewrite one thing from scratch?', 'The build config.', "Wouldn't we all."],
  ['How do you stay so calm, {b}?', 'Small commits.', 'That explains a lot.'],
];

// Chats that come out of the office's story (see LORE in server/index.js).
// `pair` chats belong to two people and start with the first named; `solo`
// chats are opened by one person, and anyone else can answer. Names are
// written in, so keep these in step with the lore, and free of pronouns.
const PAIR_CHATS = [
  { pair: ['tunde', 'obi'], lines: ['Still thinking about idempotency keys, {b}.', 'You always are. It is why I trust you with the ledger.', 'Say it again, but with a retry.', 'Same result. That is the whole point.'] },
  { pair: ['tunde', 'obi'], lines: ['Remember the first ledger?', 'Four of us and one whiteboard.', 'We never did erase that whiteboard.', "It's load-bearing now."] },
  { pair: ['kai', 'zola'], lines: ['Submission day, {b}. Checklist out?', 'Always out. Step one: breathe.', 'Step two: provisioning profile.', 'Step two is where we cry.'] },
  { pair: ['kai', 'zola'], lines: ['Another rejection email. I can feel it.', 'Read it first. Then panic.', 'That is not on the checklist.', 'I will add it.'] },
  { pair: ['ada', 'mira'], lines: ['I had a thought about the dashboard, {b}.', 'Is it a question? Please let it be a question.', 'It is a question.', 'Then I love it already. Go.'] },
  { pair: ['ada', 'tunde'], lines: ['Does the new screen survive a retry, {b}?', 'You asked before I did.', 'You taught me.', 'Noted. Quietly proud.'] },
  { pair: ['ada', 'kai'], lines: ['It should feel the same on web and app.', 'Thumbs do not agree.', 'Thumbs never do.', 'Move the button down, {a}.'] },
  { pair: ['mira', 'lin'], lines: ['Could you look at this early, {b}? Before it is finished?', 'You ask early. I like that.', 'Startup scars.', 'The good kind of scar.'] },
  { pair: ['mira', 'tunde'], lines: ['I could just own this whole feature, {b}.', 'Could you also wait for my green light?', 'That is the hard part.', 'It is the part that saves you.'] },
  { pair: ['mira', 'zola'], lines: ['Ship it now, {b}?', 'Not yet.', 'How about now?', 'Ask me after the checklist.'] },
  { pair: ['lin', 'obi'], lines: ['Another payload for you, {a}.', 'Guilty until proven valid.', 'You read my mind.', 'I read your schema.'] },
  { pair: ['lin', 'tunde'], lines: ['Your logs are very readable, {b}.', 'I log everything now.', 'I know. It started on a train.', 'Do not remind me.'] },
  { pair: ['zola', 'tunde'], lines: ['That alert again.', 'I saw it.', 'We nod?', 'We nod.'] },
  { pair: ['remi', 'mira'], lines: ['Found a bug in your feature, {b}.', 'Wonderful. Send me the steps.', 'No defence? No excuses?', 'I would rather have the bug than the excuse.'] },
];
const SOLO_CHATS = [
  { who: 'tunde', lines: ['Remember the Tuesday, {b}?', 'Nobody has forgotten the Tuesday.', 'That is why I log everything now.', 'Fair enough.'] },
  { who: 'kai', lines: ['Did you hear? An app rejected over one permission string.', 'Is this the one you keep telling us about?', 'Never gets old.', 'It does, {a}.'] },
  { who: 'ada', lines: ['Found a loading spinner I actually like.', 'Is it going in the folder?', 'It is going in the folder.', 'There is a folder?'] },
  { who: 'zola', lines: ['The release train ran on time again.', 'Because of the checklist.', 'Because of the checklist.', 'We all owe it a coffee.'] },
  { who: 'obi', lines: ['Webhooks are promises, {b}.', 'To whom?', 'To whichever team is waiting on them.', 'Heavy thought for a coffee break.'] },
  { who: 'mira', lines: ['One quick question, {b}.', 'Your questions are never quick.', 'This one is tiny.', 'Narrator: it was not.'] },
  { who: 'lin', lines: ['Anyone have a worry they have not told anyone?', 'Not yet.', 'My door is open, and so is the kettle.', 'Thanks, {a}.'] },
  { who: 'remi', lines: ['Anyone say "it works on my machine" today?', 'Not me.', 'Good. I was sharpening my pencil.', 'Please do not.'] },
];

// Every pair with a chat of its own gets it most of the time; otherwise a
// chat from whichever of the two has one, and the generic ones fill the rest.
function choose(a, b) {
  const mine = PAIR_CHATS.filter((c) => c.pair.includes(a.id) && c.pair.includes(b.id));
  const solo = SOLO_CHATS.filter((c) => c.who === a.id || c.who === b.id);
  const roll = Math.random();
  if (mine.length && roll < 0.55) { const c = pick(mine); return orient(c.pair[0], c.lines, a, b); }
  if (solo.length && roll < 0.8) { const c = pick(solo); return orient(c.who, c.lines, a, b); }
  return { who: [a, b], script: pick(CHATS) };
}

// The first line is spoken by `first`, whichever of the two was drawn first.
function orient(first, lines, a, b) {
  return { who: first === a.id ? [a, b] : [b, a], script: lines };
}

const free = (a) => !a.job && !a.meeting && !a.leaving && !a.path.length && a.want === 'lounge' && a.placeKey === 'lounge' && !a.playing;

export class BreakRoom {
  constructor() {
    this.next = rand(10, 20);
    this.chat = null;
    this.claiming = false;
  }

  update(agents, now) {
    if (this.chat) return this.step(now);
    if (this.claiming || now < this.next) return;
    const idle = agents.filter(free);
    if (idle.length < 2) return;
    const a = pick(idle);
    const b = pick(idle.filter((x) => x !== a));
    this.claim(a, b, now);
  }

  // Asking the server costs a moment, in which the two of them may well be
  // handed work; a claim nobody can use is handed straight back.
  async claim(a, b, now) {
    this.claiming = true;
    this.next = now + rand(20, 45);
    let id = null, script = null;
    try {
      ({ id, script } = await api('/api/chill', { who: [a.id, b.id] }));
    } catch {}
    this.claiming = false;
    if (!id) return;
    if (!free(a) || !free(b)) return this.release(id);
    this.start(a, b, id, script);
  }

  // The server writes the conversation when it can, with `a` speaking first;
  // otherwise it is one of the scripted chats above.
  start(first, second, id, written) {
    const { who: [a, b], script: lines } = Array.isArray(written) && written.length >= 2
      ? { who: [first, second], script: written }
      : choose(first, second);
    const script = lines.map((line) => line.replaceAll('{a}', a.name).replaceAll('{b}', b.name));
    for (const [me, them] of [[a, b], [b, a]]) {
      me.chatting = true;
      me.wanderAt = Infinity;
      // Turn to face each other, unless sat on the couch.
      if (me.pose !== 'couch') me.goal = { ...me.goal, face: Math.atan2(them.pos.x - me.pos.x, them.pos.z - me.pos.z) };
    }
    // `at` is a sim clock reading, and 0 means the first line goes now: the
    // claim just spent long enough being asked for.
    this.chat = { id, who: [a, b], script, line: 0, at: 0 };
  }

  step(now) {
    const c = this.chat;
    if (!c.who.every(free)) return this.end(now);
    if (now < c.at) return;
    if (c.line >= c.script.length) return this.end(now);
    const speaker = c.who[c.line % 2];
    const text = c.script[c.line];
    speaker.say(text, 'idle', 3200 + text.length * 30);
    // The bubble overhead is shortened to a glance; the channel gets the line.
    api(`/api/chill/${c.id}/line`, { from: speaker.id, text }).catch(() => {});
    c.at = now + 2.6 + text.length * 0.035;
    c.line++;
  }

  end(now) {
    this.release(this.chat.id);
    for (const a of this.chat.who) {
      a.chatting = false;
      if (free(a)) a.wanderAt = now + rand(8, 20);
    }
    this.chat = null;
    this.next = now + rand(20, 45);
  }

  // Letting the claim go keeps the next conversation from waiting it out.
  release(id) {
    api(`/api/chill/${id}`, undefined, 'DELETE').catch(() => {});
  }
}
