// A 1-unit walk grid over the office floor, with A* and line-of-sight
// smoothing so people cut corners like people do.

export class Grid {
  // ox, oz: the world x/z of the grid's corner; centred on the origin unless given.
  constructor(w, d, ox = -w / 2, oz = -d / 2) {
    this.w = w;
    this.d = d;
    this.ox = ox;
    this.oz = oz;
    this.cells = new Uint8Array(w * d);
  }

  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.d; }
  blocked(i, j) { return !this.inside(i, j) || this.cells[j * this.w + i] === 1; }
  cellOf(x, z) { return [Math.floor(x - this.ox), Math.floor(z - this.oz)]; }
  center(i, j) { return [this.ox + i + 0.5, this.oz + j + 0.5]; }

  block(x0, x1, z0, z1) {
    const [i0, j0] = this.cellOf(x0, z0);
    const [i1, j1] = this.cellOf(x1 - 1e-6, z1 - 1e-6);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (this.inside(i, j)) this.cells[j * this.w + i] = 1;
  }

  nearestFree(i, j) {
    if (!this.blocked(i, j)) return [i, j];
    const seen = new Set([j * this.w + i]);
    const queue = [[i, j]];
    while (queue.length) {
      const [ci, cj] = queue.shift();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (!this.inside(ni, nj) || seen.has(nj * this.w + ni)) continue;
        if (!this.blocked(ni, nj)) return [ni, nj];
        seen.add(nj * this.w + ni);
        queue.push([ni, nj]);
      }
    }
    return [i, j];
  }

  clear(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(len / 0.2);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (this.blocked(i, j)) return false;
    }
    return true;
  }

  // Returns world-space [x, z] waypoints ending exactly at (bx, bz).
  path(ax, az, bx, bz) {
    const start = this.nearestFree(...this.cellOf(ax, az));
    const goal = this.nearestFree(...this.cellOf(bx, bz));
    const key = (i, j) => j * this.w + i;
    const h = (i, j) => Math.hypot(i - goal[0], j - goal[1]);
    const g = new Map([[key(...start), 0]]);
    const from = new Map();
    const open = [[h(...start), ...start]];
    const closed = new Set();
    let found = false;

    while (open.length) {
      let best = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[best][0]) best = k;
      const [, i, j] = open.splice(best, 1)[0];
      const k0 = key(i, j);
      if (closed.has(k0)) continue;
      closed.add(k0);
      if (i === goal[0] && j === goal[1]) { found = true; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (this.blocked(ni, nj)) continue;
        if (di && dj && (this.blocked(i + di, j) || this.blocked(i, j + dj))) continue;
        const nk = key(ni, nj);
        const cost = g.get(k0) + (di && dj ? Math.SQRT2 : 1);
        if (cost < (g.get(nk) ?? Infinity)) {
          g.set(nk, cost);
          from.set(nk, k0);
          open.push([cost + h(ni, nj), ni, nj]);
        }
      }
    }

    const pts = [];
    if (found) {
      let k = key(...goal);
      while (k !== undefined) {
        pts.unshift(this.center(k % this.w, Math.floor(k / this.w)));
        k = from.get(k);
      }
    }
    pts.push([bx, bz]);

    // String-pull: skip waypoints we can see past.
    const out = [];
    let cur = [ax, az];
    let idx = 0;
    while (idx < pts.length) {
      let far = idx;
      for (let k = pts.length - 1; k > idx; k--) {
        if (this.clear(cur[0], cur[1], pts[k][0], pts[k][1])) { far = k; break; }
      }
      out.push(pts[far]);
      cur = pts[far];
      idx = far + 1;
    }
    return out;
  }
}
