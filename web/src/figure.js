import * as THREE from 'three';

// A small stylized person: jointed limbs (hips/knees, shoulders/elbows),
// a face that can blink and emote, and a hairstyle and outfit of their own.
// Forward is local +z.

const mats = new Map();
function m(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
  return mats.get(key);
}
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.001, len), 5, 12);
const sphere = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);

// Body measurements the sitting maths needs: hip joint above the body
// origin, thigh and shin length, ankle height standing, thigh thickness.
const HIP_Y = 0.93, THIGH = 0.45, SHIN = 0.44, ANKLE = 0.06, THIGH_R = 0.1;
// The seat height this body is built for: knees at a right angle, feet flat
// on the floor. Every chair in the office is made to it.
export const SEAT = 0.46;

// Per-person looks. Anyone not listed gets a sensible default.
export const LOOKS = {
  ada: { hair: 'afro', pants: '#3a3f5c', shoes: '#26211d' },
  tunde: { hair: 'short', pants: '#4b4136', shoes: '#1c1c1c', extra: 'lanyard' },
  mira: { hair: 'bob', pants: '#2f3b52', shoes: '#5b4636' },
  kai: { hair: 'spiky', pants: '#38383d', shoes: '#e9e6df', extra: 'hood' },
  zola: { hair: 'ponytail', pants: '#4d3f5e', shoes: '#2b2b2b' },
  remi: { hair: 'bun', pants: '#3f4f60', shoes: '#704d38', extra: 'glasses' },
  obi: { hair: 'buzz', pants: '#2c3a32', shoes: '#1d1d1d', extra: 'headphones' },
  lin: { hair: 'long', pants: '#3b3b4a', shoes: '#2a2a2a' },
  chief: { hair: 'side', pants: '#22232e', shoes: '#141414', extra: 'suit' },
};

function limb(parent, x, y, upper, lower, r1, r2, matUpper, matLower, endFn) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  parent.add(pivot);
  mesh(capsule(r1, upper - r1), matUpper, pivot, 0, -upper / 2);
  const joint = new THREE.Group();
  joint.position.y = -upper;
  pivot.add(joint);
  mesh(capsule(r2, lower - r2), matLower, joint, 0, -lower / 2);
  const end = new THREE.Group();
  end.position.y = -lower;
  joint.add(end);
  endFn?.(end);
  return { pivot, joint, end };
}

export class Figure {
  constructor(staff) {
    const look = LOOKS[staff.id] || { hair: 'short', pants: '#34384a', shoes: '#222' };
    this.look = look;
    const skin = m(staff.skin, { roughness: 0.6 });
    const shirt = m(staff.shirt);
    const sleeve = m(shade(staff.shirt, 0.9));
    const pants = m(look.pants);
    const shoes = m(look.shoes, { roughness: 0.5 });
    const hair = m(staff.hair, { roughness: 0.85 });

    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);

    // Hips carry the legs and the torso.
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    const pelvis = mesh(capsule(0.2, 0.06), pants, this.hips, 0, 0.02);
    pelvis.scale.set(1, 1, 0.8);

    const foot = (end) => {
      const f = mesh(new THREE.BoxGeometry(0.15, 0.09, 0.26), shoes, end, 0, -0.02, 0.05);
      f.geometry.translate(0, 0, 0);
    };
    this.legL = limb(this.hips, -0.11, -0.02, 0.45, 0.44, 0.1, 0.085, pants, pants, foot);
    this.legR = limb(this.hips, 0.11, -0.02, 0.45, 0.44, 0.1, 0.085, pants, pants, foot);

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    const profile = [[0.001, 0], [0.19, 0.0], [0.225, 0.08], [0.23, 0.24], [0.22, 0.36], [0.255, 0.5], [0.24, 0.58], [0.15, 0.645], [0.001, 0.66]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const chest = mesh(new THREE.LatheGeometry(profile, 20), look.extra === 'suit' ? m('#2b2d42') : shirt, this.torso, 0, 0.04);
    chest.scale.z = 0.8;
    mesh(new THREE.TorusGeometry(0.11, 0.03, 8, 20), look.extra === 'suit' ? m('#f4f1ea') : m(shade(staff.shirt, 0.8)), this.torso, 0, 0.67).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 12), skin, this.torso, 0, 0.73);

    const hand = (end) => mesh(sphere(0.07, 12, 10), skin, end, 0, -0.02);
    const armMat = look.extra === 'suit' ? m('#2b2d42') : sleeve;
    this.armL = limb(this.torso, -0.29, 0.58, 0.32, 0.3, 0.072, 0.062, armMat, look.extra === 'suit' || look.extra === 'hood' ? armMat : skin, hand);
    this.armR = limb(this.torso, 0.29, 0.58, 0.32, 0.3, 0.072, 0.062, armMat, look.extra === 'suit' || look.extra === 'hood' ? armMat : skin, hand);

    this.buildHead(staff, skin, hair);
    this.buildExtras(staff, look, hair);

    // Props
    this.book = mesh(new THREE.BoxGeometry(0.34, 0.05, 0.26), m('#3d7ea6'), this.torso, 0, 0.3, 0.36);
    this.book.rotation.x = -0.6;
    this.book.visible = false;
    this.mug = mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.13, 12), m('#ffffff'), this.armR.end, 0, -0.06, 0.07);
    this.mug.visible = false;

    this.blinkAt = 1 + Math.random() * 3;
    this.blink = 0;
    this.cur = {};
  }

  buildHead(staff, skin, hair) {
    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    this.torso.add(this.head);
    const skull = mesh(sphere(0.33, 28, 20), skin, this.head, 0, 0.3);
    skull.scale.set(1, 0.97, 0.94);
    for (const s of [-1, 1]) mesh(sphere(0.06, 10, 8), skin, this.head, s * 0.32, 0.29, -0.01).scale.set(0.6, 1, 1);
    mesh(sphere(0.032, 10, 8), m(shade(staff.skin, 0.88), { roughness: 0.6 }), this.head, 0, 0.27, 0.31);

    // Eyes: dark ovals with a catchlight. Blinking squashes them.
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.115, 0.33, 0.285);
      eye.rotation.y = s * 0.28;
      this.head.add(eye);
      const ball = new THREE.Mesh(sphere(0.042, 14, 10), m('#17181c', { roughness: 0.3 }));
      ball.scale.set(0.82, 1.2, 0.5);
      eye.add(ball);
      const glint = new THREE.Mesh(sphere(0.013, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      glint.position.set(0.012, 0.018, 0.02);
      eye.add(glint);
      this.eyes.push(eye);
    }
    this.brows = [];
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(capsule(0.014, 0.08), m(shade(staff.hair, 0.9)));
      b.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set(s * 0.115, 0.425, 0.275);
      holder.rotation.y = s * 0.28;
      holder.add(b);
      this.head.add(holder);
      this.brows.push(holder);
    }
    // Mouth: a soft arc; flipping it frowns, scaling it grins or talks.
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 18, Math.PI), m('#5b2a2a', { roughness: 0.5 }));
    this.mouth.position.set(0, 0.205, 0.292);
    this.mouth.rotation.z = Math.PI;
    this.head.add(this.mouth);
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({ color: '#ff8d7a', transparent: true, opacity: 0.22, depthWrite: false }));
      cheek.position.set(s * 0.19, 0.24, 0.245);
      cheek.rotation.y = s * 0.62;
      this.head.add(cheek);
    }

    const cap = (r = 0.345, cover = 0.52, tilt = -0.25) => {
      const c = mesh(new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI * cover), hair, this.head, 0, 0.31, -0.01);
      c.rotation.x = tilt;
      c.scale.set(1, 1, 0.97);
      return c;
    };
    switch (this.look.hair) {
      case 'afro':
        cap(0.35, 0.55);
        mesh(sphere(0.43, 24, 18), hair, this.head, 0, 0.47, -0.08).scale.set(1, 0.85, 0.95);
        break;
      case 'bob': {
        cap(0.36, 0.56, -0.32);
        for (const s of [-1, 1]) mesh(capsule(0.09, 0.2), hair, this.head, s * 0.29, 0.22, -0.1).scale.set(0.75, 1, 1.1);
        mesh(capsule(0.05, 0.3), hair, this.head, 0, 0.55, 0.17).rotation.z = Math.PI / 2;
        break;
      }
      case 'spiky':
        cap(0.35, 0.5);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const spike = mesh(new THREE.ConeGeometry(0.07, 0.22, 6), hair, this.head, Math.cos(a) * 0.17, 0.6, Math.sin(a) * 0.17 - 0.03);
          spike.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
        }
        break;
      case 'ponytail': {
        cap(0.35, 0.55);
        mesh(sphere(0.07, 10, 8), m('#e07a5f'), this.head, 0, 0.42, -0.33);
        const tail = mesh(capsule(0.08, 0.32), hair, this.head, 0, 0.22, -0.4);
        tail.rotation.x = 0.35;
        this.tail = tail;
        break;
      }
      case 'bun':
        cap(0.35, 0.55);
        mesh(sphere(0.14, 16, 12), hair, this.head, 0, 0.66, -0.1);
        break;
      case 'buzz':
        cap(0.338, 0.5, -0.3);
        break;
      case 'long': {
        cap(0.36, 0.58, -0.2);
        const back = mesh(capsule(0.16, 0.42), hair, this.head, 0, 0.1, -0.2);
        back.scale.set(1.75, 1, 0.6);
        break;
      }
      case 'side': {
        cap(0.35, 0.5);
        const part = mesh(capsule(0.07, 0.3), hair, this.head, 0.06, 0.58, 0.12);
        part.rotation.set(0.2, 0, Math.PI / 2 - 0.25);
        break;
      }
      default:
        cap(0.35, 0.5);
    }
  }

  buildExtras(staff, look, hair) {
    if (look.extra === 'glasses' || look.extra === 'suit') {
      const frame = m('#1b1b1f', { roughness: 0.4 });
      for (const s of [-1, 1]) {
        const rim = mesh(new THREE.TorusGeometry(0.06, 0.011, 6, 18), frame, this.head, s * 0.115, 0.33, 0.3);
        rim.rotation.y = s * 0.28;
      }
      mesh(capsule(0.009, 0.06), frame, this.head, 0, 0.34, 0.315).rotation.z = Math.PI / 2;
    }
    if (look.extra === 'suit') {
      const tie = mesh(new THREE.BoxGeometry(0.06, 0.3, 0.02), m('#b23a3a'), this.torso, 0, 0.47, 0.19);
      tie.rotation.x = -0.12;
      mesh(new THREE.BoxGeometry(0.16, 0.18, 0.02), m('#f4f1ea'), this.torso, 0, 0.56, 0.175).rotation.x = -0.15;
    }
    if (look.extra === 'headphones') {
      const band = mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 24, Math.PI), m('#22252b'), this.head, 0, 0.32, 0);
      band.rotation.y = Math.PI / 2;
      band.rotation.x = -0.15;
      for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 18), m('#e05f4a'), this.head, s * 0.34, 0.3, 0).rotation.z = Math.PI / 2;
    }
    if (look.extra === 'lanyard') {
      const strap = mesh(new THREE.TorusGeometry(0.16, 0.01, 6, 20, Math.PI), m('#2a6fb0'), this.torso, 0, 0.62, 0.12);
      strap.rotation.set(-0.25, 0, Math.PI);
      mesh(new THREE.BoxGeometry(0.1, 0.13, 0.015), m('#ffffff'), this.torso, 0, 0.42, 0.205).rotation.x = -0.1;
    }
    if (look.extra === 'hood') {
      const hood = mesh(new THREE.TorusGeometry(0.2, 0.06, 10, 24), m(shade(staff.shirt, 0.85)), this.torso, 0, 0.64, -0.05);
      hood.rotation.x = Math.PI / 2 + 0.35;
      hood.scale.set(1, 1, 0.7);
    }
  }

  // ---------- motion ----------

  // Sitting is worked out from the height of the seat, so nobody sinks into
  // the furniture: the thighs rest on the cushion and the shins reach down
  // for the floor, straightening as the seat gets higher.
  static sit(seatY = SEAT, thigh = -1.4) {
    const hip = seatY + THIGH_R;
    const knee = hip - THIGH * Math.cos(thigh);
    const shin = -Math.acos(Math.min(1, Math.max(-1, (knee - ANKLE) / SHIN)));
    return { y: hip - HIP_Y, hip: thigh, knee: shin - thigh };
  }

  pose(name, dt, t, state = {}) {
    const k = Math.min(1, dt * 10);
    let hipL = 0, hipR = 0, kneeL = 0, kneeR = 0;
    let shL = 0.05, shR = 0.05, elL = -0.12, elR = -0.12, outL = -0.07, outR = 0.07;
    let y = 0, lean = 0, headX = 0, headY = 0, headZ = 0;
    const breath = Math.sin(t * 1.7) * 0.012;
    this.book.visible = name === 'read';
    this.mug.visible = name === 'mug';

    switch (name) {
      case 'walk': {
        const s = Math.sin(t * 9.5), c = Math.cos(t * 9.5);
        hipL = s * 0.5; hipR = -s * 0.5;
        kneeL = Math.max(0, -c) * 0.9 + 0.05; kneeR = Math.max(0, c) * 0.9 + 0.05;
        shL = -s * 0.45; shR = s * 0.45; elL = elR = -0.35;
        y = Math.abs(c) * 0.05; lean = 0.06;
        headY = Math.sin(t * 4.75) * 0.04;
        break;
      }
      case 'desk': {
        const s = Figure.sit(state.seatY, -1.45);
        hipL = hipR = s.hip; kneeL = kneeR = s.knee; y = s.y; lean = 0.08;
        if (state.typing) {
          shL = -0.5 + Math.sin(t * 17) * 0.05; shR = -0.5 + Math.sin(t * 17 + 2) * 0.05;
          elL = -1.15 + Math.sin(t * 19) * 0.12; elR = -1.15 + Math.sin(t * 19 + 1.6) * 0.12;
          outL = -0.18; outR = 0.18;
          headX = 0.12 + Math.sin(t * 0.7) * 0.03;
        } else if (state.waiting) {
          shR = -0.95; elR = -2.25; outR = 0.05; shL = -0.4; elL = -1.0;
          headY = Math.sin(t * 0.6) * 0.45; headX = -0.05;
        } else {
          shL = shR = -0.35; elL = elR = -0.9; outL = -0.2; outR = 0.2; lean = -0.04;
          headY = Math.sin(t * 0.35) * 0.3;
        }
        break;
      }
      case 'couch': {
        // Sunk back into the cushions, knees a little apart.
        const s = Figure.sit(state.seatY, -1.3);
        hipL = hipR = s.hip; kneeL = kneeR = s.knee; y = s.y; lean = -0.18;
        shL = shR = -0.2; elL = elR = -0.75; outL = -0.15; outR = 0.15;
        headY = Math.sin(t * 0.3) * 0.5; headZ = Math.sin(t * 0.21) * 0.06;
        break;
      }
      case 'sit': {
        // Upright on a chair or stool, hands in the lap.
        const s = Figure.sit(state.seatY, -1.42);
        hipL = hipR = s.hip; kneeL = kneeR = s.knee; y = s.y; lean = 0.03;
        shL = shR = -0.32; elL = elR = -0.95; outL = -0.16; outR = 0.16;
        headY = Math.sin(t * 0.4) * 0.4; headZ = Math.sin(t * 0.27) * 0.05;
        break;
      }
      case 'read':
        shL = shR = -0.55; elL = elR = -1.35; outL = -0.12; outR = 0.12; headX = 0.4; headY = Math.sin(t * 0.6) * 0.12;
        break;
      case 'type':
        shL = -0.75 + Math.sin(t * 14) * 0.08; shR = -0.75 + Math.sin(t * 14 + 2) * 0.08;
        elL = -0.9; elR = -0.9; outL = -0.15; outR = 0.15; headX = 0.08;
        break;
      case 'gaze':
        shL = shR = 0.3; elL = elR = -0.25; outL = -0.12; outR = 0.12; headX = -0.18; headY = Math.sin(t * 0.45) * 0.35;
        break;
      case 'write':
        shR = -2.2 + Math.sin(t * 6) * 0.2; elR = -0.5 + Math.sin(t * 9) * 0.15; outR = 0.25;
        headY = Math.sin(t * 1.2) * 0.1; headX = -0.08;
        break;
      case 'mug': {
        const sip = Math.sin(t * 0.8) > 0.75;
        shR = sip ? -0.85 : -0.45; elR = sip ? -2.05 : -1.55; outR = 0.1;
        headX = sip ? -0.15 : 0.02; headY = sip ? 0 : Math.sin(t * 0.4) * 0.3;
        break;
      }
      case 'talk':
        shR = -0.55 + Math.sin(t * 4) * 0.2; elR = -1.1 + Math.sin(t * 5.3) * 0.2; outR = 0.2;
        shL = -0.1; elL = -0.4; headZ = Math.sin(t * 2.2) * 0.06; headX = -0.04;
        break;
      case 'celebrate':
        shL = shR = -2.75; elL = elR = -0.25; outL = -0.35; outR = 0.35;
        y = Math.abs(Math.sin(t * 8)) * 0.32; headX = -0.15;
        kneeL = kneeR = y > 0.05 ? 0.4 : 0.1; hipL = hipR = -kneeL * 0.5;
        break;
      case 'slump':
        headX = 0.45; lean = 0.22; shL = shR = 0.12; elL = elR = -0.05;
        break;
      default:
        headY = Math.sin(t * 0.5) * 0.25;
    }

    const c = this.cur;
    const ease = (key, v, kk = k) => (c[key] = c[key] === undefined ? v : c[key] + (v - c[key]) * kk);
    const walking = name === 'walk';
    const kk = walking ? Math.min(1, dt * 18) : k;
    this.legL.pivot.rotation.x = ease('hipL', hipL, kk);
    this.legR.pivot.rotation.x = ease('hipR', hipR, kk);
    this.legL.joint.rotation.x = ease('kneeL', kneeL, kk);
    this.legR.joint.rotation.x = ease('kneeR', kneeR, kk);
    this.armL.pivot.rotation.x = ease('shL', shL, kk);
    this.armR.pivot.rotation.x = ease('shR', shR, kk);
    this.armL.pivot.rotation.z = ease('outL', outL);
    this.armR.pivot.rotation.z = ease('outR', outR);
    this.armL.joint.rotation.x = ease('elL', elL, kk);
    this.armR.joint.rotation.x = ease('elR', elR, kk);
    this.torso.rotation.x = ease('lean', lean);
    this.torso.scale.y = 1 + breath;
    this.head.rotation.x = ease('headX', headX, k * 0.6);
    this.head.rotation.y = ease('headY', headY, k * 0.4);
    this.head.rotation.z = ease('headZ', headZ, k * 0.6);
    this.body.position.y = walking || name === 'celebrate' ? y : ease('y', y);
    if (this.tail) this.tail.rotation.x = 0.35 + Math.sin(t * (walking ? 9.5 : 1.5)) * (walking ? 0.12 : 0.03);
  }

  // mood: neutral | happy | think | worried | talk
  express(mood, dt, t) {
    // Blink every few seconds, never while beaming.
    if (t > this.blinkAt) { this.blink = 0.14; this.blinkAt = t + 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    const closed = this.blink > 0;
    const k = Math.min(1, dt * 12);
    const c = this.cur;
    const ease = (key, v) => (c[key] = c[key] === undefined ? v : c[key] + (v - c[key]) * k);

    let eyeY = 1, browY = 0, browTilt = 0, mouthX = 1, mouthY = 1, frown = false;
    if (mood === 'happy') { eyeY = 0.3; browY = 0.025; mouthX = 1.45; mouthY = 1.6; }
    else if (mood === 'think') { browY = 0.02; browTilt = 0.25; mouthX = 0.55; eyeY = 0.9; }
    else if (mood === 'worried') { browTilt = -0.35; browY = 0.01; frown = true; mouthX = 0.8; }
    else if (mood === 'talk') { mouthX = 0.8; mouthY = 0.6 + Math.abs(Math.sin(t * 13)) * 1.6; browY = Math.sin(t * 3) * 0.008; }
    if (closed && mood !== 'happy') eyeY = 0.1;

    const ey = ease('eyeY', eyeY);
    for (const e of this.eyes) e.scale.y = ey;
    const by = ease('browY', browY), bt = ease('browTilt', browTilt);
    this.brows.forEach((b, i) => {
      b.position.y = 0.425 + by;
      b.rotation.z = (i ? -1 : 1) * bt;
    });
    this.mouth.rotation.z = frown ? 0 : Math.PI;
    this.mouth.position.y = frown ? 0.18 : 0.205;
    this.mouth.scale.set(ease('mouthX', mouthX), ease('mouthY', mouthY), 1);
  }
}
