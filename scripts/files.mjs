// The file editor's server side: confined to a project, conflict-safe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as files from '../server/files.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.mkdirSync(path.join(proj, '.git'));
fs.mkdirSync(path.join(proj, 'node_modules'));
fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'one\n');
fs.writeFileSync(path.join(proj, 'bin.dat'), Buffer.from([1, 0, 2]));
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside');
fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(proj, 'leak.txt'));
fs.symlinkSync(tmp, path.join(proj, 'out'));
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

const l = files.list(proj);
assert.deepEqual(l.entries.map((e) => e.name), ['src', 'bin.dat']); // folders first; .git, node_modules, escaping links hidden
assert.equal(files.read(proj, 'src/a.js').text, 'one\n');
assert.equal(code(() => files.read(proj, '../secret.txt')), 403);
assert.equal(code(() => files.read(proj, 'leak.txt')), 403);
assert.equal(code(() => files.read(proj, 'out/secret.txt')), 403);
assert.equal(code(() => files.write(proj, 'out/new.txt', 'x', null)), 403);
assert.equal(code(() => files.read(proj, '.git/config')), 403);
assert.equal(code(() => files.read(proj, 'bin.dat')), 415);
assert.equal(code(() => files.read(proj, 'nope.js')), 404);
assert.equal(code(() => files.read(proj, 'src')), 400);

const r = files.read(proj, 'src/a.js');
const w = files.write(proj, 'src/a.js', 'two\n', r.mtime);
assert.equal(fs.readFileSync(path.join(proj, 'src', 'a.js'), 'utf8'), 'two\n');
fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'agent edit\n');
fs.utimesSync(path.join(proj, 'src', 'a.js'), new Date(), new Date(Date.now() + 5000));
assert.equal(code(() => files.write(proj, 'src/a.js', 'mine', w.mtime)), 409);
assert.equal(fs.readFileSync(path.join(proj, 'src', 'a.js'), 'utf8'), 'agent edit\n');
files.write(proj, 'deep/new/b.txt', 'hi', null);
assert.equal(code(() => files.write(proj, 'deep/new/b.txt', 'again', null)), 409);
assert.equal(code(() => files.write(proj, 'big.txt', 'x'.repeat(files.MAX_BYTES + 1), null)), 413);
assert.equal(fs.readdirSync(path.join(proj, 'src')).filter((n) => n.endsWith('.tmp')).length, 0);
fs.rmSync(tmp, { recursive: true });
console.log('files: ok');
