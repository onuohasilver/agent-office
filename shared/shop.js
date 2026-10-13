// What the office economy pays and sells.
//
// Shared by the server (which pays, charges and keeps the books) and the
// browser (which shows the shop and draws what was bought), so a price or a
// rate can never mean one thing in the ledger and another on screen.

// Pay. An agent earns by the active minute (time the model was actually
// working, not time spent waiting on the boss or a colleague) plus a bonus
// for finishing, and both are scaled by the model that did the work: getting
// a job done on a lighter model is worth more than brute-forcing it on the
// heaviest. Only finished jobs pay. A failed or stopped job pays nothing.
// All money is naira. perMinute and finishBonus are the defaults; the boss
// sets them in Settings and setPay() applies them, in the server and, from
// the economy status, in the browser.
export const PAY = {
  perMinute: 1000,
  finishBonus: 2500,
  // Minutes beyond this on one job are not paid: a job that drags on is not
  // a job done better.
  maxMinutes: 60,
  // The office's cut of every naira an agent earns, for the boss to spend.
  potShare: 0.4,
  // A boss's "great work" on a finished job pays its finish bonus again.
  kudosOncePerJob: true,
};

export const naira = (v) => `₦${Math.round(Number(v) || 0).toLocaleString('en-NG')}`;
export function setPay(p = {}) {
  for (const k of ['perMinute', 'finishBonus']) if (Number.isFinite(p[k]) && p[k] >= 0) PAY[k] = p[k];
}

export const MODEL_PAY = { haiku: 3, sonnet: 1.75, opus: 1 };
export const modelTier = (model) => Object.keys(MODEL_PAY).find((t) => String(model || '').includes(t)) || '';
export const modelPay = (model) => MODEL_PAY[modelTier(model)] || 1;

// The cut, in whole naira. The agent's share is rounded down and the pot
// takes the rest, so the two always add up to what was earned.
export function split(gross) {
  const g = Math.max(0, Math.round(gross));
  const agent = Math.floor(g * (1 - PAY.potShare));
  return { gross: g, agent, pot: g - agent };
}

// Everything for sale. `scope` says who owns it and where it goes:
//   desk    on one agent's desk; an agent buys it with their own pay, or the
//           boss buys it for them out of the pot
//   office  somewhere in the room; bought out of the pot
//   floor / wall  the room's finish; bought out of the pot, one in use at a time
//   layout  a different floor plan; bought out of the pot, one in use at a time
export const ITEMS = [
  // desk
  { id: 'mug', scope: 'desk', name: 'Coffee mug', price: 2000, icon: '☕' },
  { id: 'duck', scope: 'desk', name: 'Rubber duck', price: 3000, icon: '🦆' },
  { id: 'cactus', scope: 'desk', name: 'Cactus', price: 3500, icon: '🌵' },
  { id: 'photo', scope: 'desk', name: 'Photo frame', price: 5000, icon: '🖼️' },
  { id: 'lamp', scope: 'desk', name: 'Desk lamp', price: 6000, icon: '💡' },
  { id: 'headphones', scope: 'desk', name: 'Headphones', price: 8000, icon: '🎧' },
  { id: 'lava', scope: 'desk', name: 'Lava lamp', price: 9000, icon: '🫧' },
  { id: 'bonsai', scope: 'desk', name: 'Bonsai', price: 12000, icon: '🌳' },
  { id: 'keyboard', scope: 'desk', name: 'Mechanical keyboard', price: 14000, icon: '⌨️' },
  { id: 'trophy', scope: 'desk', name: 'Little trophy', price: 15000, icon: '🏆' },
  { id: 'monitor', scope: 'desk', name: 'Second monitor', price: 20000, icon: '🖥️' },
  { id: 'chair', scope: 'desk', name: 'Gaming chair', price: 30000, icon: '💺' },
  { id: 'cat', scope: 'desk', name: 'Desk cat', price: 40000, icon: '🐈' },
  // office
  { id: 'neon', scope: 'office', name: 'Neon sign', price: 50000, icon: '🔆' },
  { id: 'vending', scope: 'office', name: 'Vending machine', price: 70000, icon: '🥤' },
  { id: 'arcade', scope: 'office', name: 'Arcade cabinet', price: 80000, icon: '🕹️' },
  { id: 'jukebox', scope: 'office', name: 'Jukebox', price: 90000, icon: '🎵' },
  { id: 'aquarium', scope: 'office', name: 'Aquarium', price: 120000, icon: '🐠' },
  { id: 'pingpong', scope: 'office', name: 'Ping-pong table', price: 150000, icon: '🏓' },
  // floor and walls
  { id: 'floor-oak', scope: 'floor', name: 'Oak floor', price: 0, color: '#ece3d4', icon: '🟫' },
  { id: 'floor-walnut', scope: 'floor', name: 'Walnut floor', price: 40000, color: '#b48a63', icon: '🟫' },
  { id: 'floor-terrazzo', scope: 'floor', name: 'Terrazzo', price: 40000, color: '#e6e1da', icon: '⬜' },
  { id: 'floor-concrete', scope: 'floor', name: 'Polished concrete', price: 40000, color: '#c9c9c4', icon: '⬛' },
  { id: 'wall-cream', scope: 'wall', name: 'Cream walls', price: 0, color: '#f5f0e8', icon: '🧱' },
  { id: 'wall-sage', scope: 'wall', name: 'Sage walls', price: 35000, color: '#d6e2d0', icon: '🧱' },
  { id: 'wall-navy', scope: 'wall', name: 'Navy walls', price: 35000, color: '#3d4f6e', icon: '🧱' },
  { id: 'wall-blush', scope: 'wall', name: 'Blush walls', price: 35000, color: '#f1d9d2', icon: '🧱' },
  // layouts
  { id: 'layout-classic', scope: 'layout', name: 'Classic', price: 0, icon: '🏢', blurb: 'Two rows of desks, the library and server room on the back wall.' },
  { id: 'layout-pods', scope: 'layout', name: 'Pods', price: 150000, icon: '🧩', blurb: 'Desks in two back-to-back clusters of four, a table and rug between them.' },
  { id: 'layout-studio', scope: 'layout', name: 'Studio', price: 250000, icon: '🎨', blurb: 'One long row of desks along the back, the floor left open for the table and the pool.' },
  { id: 'layout-campus', scope: 'layout', name: 'Campus', price: 400000, icon: '🏛️', blurb: 'Desks facing in round a courtyard, with the pool table at its heart.' },
];

export const itemById = (id) => ITEMS.find((i) => i.id === id);
// What every office starts out owning and using.
export const DEFAULTS = { floor: 'floor-oak', wall: 'wall-cream', layout: 'layout-classic' };
// The scopes where one choice is in use at a time.
export const SINGLE = new Set(['floor', 'wall', 'layout']);

// Milestones. Each pays a one-off bonus, split like any pay.
export const ACHIEVEMENTS = [
  { id: 'first-job', name: 'First day', blurb: 'Finished a first job.', bonus: 2500, test: (s) => s.jobs >= 1 },
  { id: 'ten-jobs', name: 'Regular', blurb: 'Finished 10 jobs.', bonus: 10000, test: (s) => s.jobs >= 10 },
  { id: 'fifty-jobs', name: 'Veteran', blurb: 'Finished 50 jobs.', bonus: 40000, test: (s) => s.jobs >= 50 },
  { id: 'haiku-hero', name: 'Haiku hero', blurb: 'Finished 5 jobs on Haiku.', bonus: 15000, test: (s) => (s.byTier.haiku || 0) >= 5 },
  { id: 'lean', name: 'Lean machine', blurb: 'Finished a job on Haiku in under 2 active minutes.', bonus: 5000, test: (s, j) => j?.tier === 'haiku' && j.minutes < 2 },
  { id: 'kudos', name: 'Great work', blurb: 'Got kudos from the boss.', bonus: 5000, test: (s) => s.kudos >= 1 },
  { id: 'streak-3', name: 'On a roll', blurb: 'Finished jobs three days running.', bonus: 12000, test: (s) => s.streak >= 3 },
  { id: 'big-earner', name: 'Big earner', blurb: 'Earned ₦200,000 in all.', bonus: 20000, test: (s) => s.earned >= 200000 },
  { id: 'shopper', name: 'Treat yourself', blurb: 'Bought something for the desk.', bonus: 1500, test: (s) => s.bought >= 1 },
];

// Titles, from lifetime earnings. Shown on the name tag and in the chat.
export const LEVELS = [
  { at: 0, title: 'Intern' },
  { at: 25000, title: 'Associate' },
  { at: 100000, title: 'Specialist' },
  { at: 300000, title: 'Senior' },
  { at: 800000, title: 'Principal' },
  { at: 2000000, title: 'Distinguished' },
];
export function levelOf(earned) {
  let n = 0;
  LEVELS.forEach((l, i) => { if ((Number(earned) || 0) >= l.at) n = i; });
  return { n: n + 1, title: LEVELS[n].title, next: LEVELS[n + 1]?.at ?? null };
}

// A streak of working days lifts the wage (not the finish bonus).
export const STREAK_BOOST = [{ days: 14, boost: 0.2 }, { days: 7, boost: 0.1 }, { days: 3, boost: 0.05 }];
export const streakBoost = (days) => STREAK_BOOST.find((b) => days >= b.days)?.boost || 0;

// What a boss may tip from the pot in one go.
export const TIP = { min: 500, max: 50000, presets: [1000, 5000, 20000] };
