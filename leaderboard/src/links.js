// Links between offices, as each side sees them. Shared by the Worker and the
// Mailbox, which both read the links table.

// One row of the links table, joined with both handles, seen from `me`.
// `role` is my role in the link; `invite` only goes to the side that made it.
export function linkView(row, me) {
  const mine = row.a_user === me;
  return {
    id: row.id,
    peer: mine ? row.b_handle : row.a_handle,
    kind: row.kind,
    role: row.kind === 'link' ? 'peer' : mine ? 'host' : 'guest',
    ...(mine ? { invite: row.invite_id } : {}),
    createdAt: row.created_at,
  };
}

const LINK_ROWS = `SELECT l.id, l.a_user, l.b_user, l.kind, l.invite_id, l.created_at, ua.handle AS a_handle, ub.handle AS b_handle
  FROM links l JOIN users ua ON ua.id = l.a_user JOIN users ub ON ub.id = l.b_user`;

// Every link `me` is on, as [{ view, peerUid }].
export async function linksOf(db, me) {
  const { results } = await db.prepare(`${LINK_ROWS} WHERE l.a_user = ? OR l.b_user = ? ORDER BY l.created_at`).bind(me, me).all();
  return results.map((r) => ({ view: linkView(r, me), peerUid: r.a_user === me ? r.b_user : r.a_user }));
}

export async function linkById(db, id) {
  return db.prepare(`${LINK_ROWS} WHERE l.id = ?`).bind(id).first();
}

// Whether link `id` still exists with `me` on it.
export async function linkAlive(db, id, me) {
  return !!(await db.prepare('SELECT 1 AS ok FROM links WHERE id = ? AND (a_user = ? OR b_user = ?)').bind(id, me, me).first());
}
