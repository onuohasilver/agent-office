// Dev builds only (see the import.meta.env.DEV guard in visitors.js): fake
// `visitors` messages, until the server side sends real ones.
//
//   window.__visitors.send(offices)   hand the floor any offices you like
//   window.__visitors.demo()          two offices, nine agents, states cycling
//   window.__visitors.unlink(link)    as if that office had unlinked
//   window.__visitors.clear()         everyone walks out
//
// Opening the office with ?visitors in the URL starts the demo.

const look = (shirt, hair, skin) => ({ shirt, hair, skin });

const OFFICES = [
  {
    link: 'lnk_a1', handle: 'ngozi',
    agents: [
      { id: 'kai', name: 'Kai', role: 'Mobile engineer', look: look('#3d7ea6', '#1d1d1d', '#8d5524'), state: 'working', job: { title: 'Fix the iOS push permission string' } },
      { id: 'ada', name: 'Ada', role: 'Designer', look: look('#e07a5f', '#2b1d14', '#6b4226'), state: 'break', job: null },
      { id: 'tunde', name: 'Tunde', role: 'Backend engineer', look: look('#81b29a', '#111111', '#5c3a21'), state: 'meeting', job: { title: 'Ledger reconciliation' } },
      { id: 'zola', name: 'Zola', role: 'Release and tooling', look: look('#9b5de5', '#3b2f2a', '#a8714a'), state: 'idle', job: null },
      { id: 'remi', name: 'Remi', role: 'QA', look: look('#f2cc8f', '#6b4f3a', '#e0ac69'), state: 'away', job: null },
    ],
  },
  {
    link: 'lnk_b2', handle: 'hexworks',
    agents: [
      { id: 'kai', name: 'Kai', role: 'Mobile engineer', look: look('#2a9d8f', '#4a3728', '#f1c27d'), state: 'working', job: { title: 'Android 15 edge-to-edge' } },
      { id: 'bram', name: 'Bram', role: 'Platform engineer', look: look('#264653', '#c9a26b', '#ffdbac'), state: 'meeting', job: { title: 'Plan the Postgres upgrade' } },
      { id: 'sol', name: 'Sol', role: 'Data engineer', look: look('#e76f51', '#222222', '#c68642'), state: 'working', job: { title: 'Backfill the events table' } },
      { id: 'ivy', name: 'Ivy', role: 'Support engineer', look: look('#457b9d', '#8b4513', '#f1c27d'), state: 'break', job: null },
    ],
  },
];

const STATES = ['working', 'idle', 'break', 'meeting'];

export function install(visitors) {
  let timer = null;
  const send = (offices) => visitors.handle({ t: 'visitors', offices });
  const api = {
    send,
    demo() {
      const offices = structuredClone(OFFICES);
      send(offices);
      clearInterval(timer);
      // Every few seconds someone changes what they're doing.
      timer = setInterval(() => {
        const o = offices[Math.floor(Math.random() * offices.length)];
        const a = o.agents[Math.floor(Math.random() * o.agents.length)];
        a.state = Math.random() < 0.15 ? 'away' : STATES[Math.floor(Math.random() * STATES.length)];
        send(offices);
      }, 6000);
    },
    stop() { clearInterval(timer); },
    unlink(link) {
      clearInterval(timer);
      visitors.handle({ t: 'links', links: visitors.offices.filter((o) => o.link !== link).map((o) => ({ id: o.link })) });
    },
    clear() { clearInterval(timer); send([]); },
  };
  window.__visitors = api;
  if (new URLSearchParams(location.search).has('visitors')) setTimeout(() => api.demo(), 1500);
}
