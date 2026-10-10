import * as THREE from 'three';

// Paper confetti for shipped jobs.
export class Confetti {
  constructor(scene) {
    this.scene = scene;
    this.bits = [];
    this.geo = new THREE.PlaneGeometry(0.14, 0.09);
  }

  burst(pos, colors) {
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true }));
      m.position.set(pos.x, 2.4, pos.z);
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
      m.userData = {
        v: new THREE.Vector3(Math.cos(a) * s, 4 + Math.random() * 4, Math.sin(a) * s),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        life: 2.2 + Math.random() * 0.8,
      };
      this.scene.add(m);
      this.bits.push(m);
    }
  }

  update(dt) {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const m = this.bits[i], u = m.userData;
      u.life -= dt;
      u.v.y -= 9 * dt;
      u.v.multiplyScalar(1 - dt * 1.2);
      m.position.addScaledVector(u.v, dt);
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.set(0, 0, 0); m.rotation.set(-Math.PI / 2, 0, m.rotation.z); }
      else { m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt; }
      m.material.opacity = Math.min(1, u.life / 0.6);
      if (u.life <= 0) {
        this.scene.remove(m);
        m.material.dispose();
        this.bits.splice(i, 1);
      }
    }
  }
}
