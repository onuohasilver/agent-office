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

async function api(path, body, method) {
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

const free = (a) => !a.job && !a.meeting && !a.leaving && !a.path.length && a.want === 'lounge' && a.placeKey === 'lounge';

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
    let id = null;
    try {
      ({ id } = await api('/api/chill', { who: [a.id, b.id] }));
    } catch {}
    this.claiming = false;
    if (!id) return;
    if (!free(a) || !free(b)) return this.release(id);
    this.start(a, b, id);
  }

  start(a, b, id) {
    const script = pick(CHATS).map((line) => line.replaceAll('{a}', a.name).replaceAll('{b}', b.name));
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
