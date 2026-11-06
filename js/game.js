// Your character, and the ghost (host simulates it, everyone else copies it)
import { pushOut } from './world.js';

export const PLAYER_R = 0.35;
const WALK = 2.6, RUN = 4.4;
export const HUNT_TIME = 25;   // seconds the ghost hunts once angry
const COOLDOWN = 20;           // seconds before it can calm down and anger again
const REPEL_TIME = 12;         // seconds a crucifix pushes it back

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function nearestTo(list, x, z) {
  let best = null, bestD = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// ---------- Your character ----------
export class Me {
  constructor(camera) {
    this.camera = camera;
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.sanity = 100;
    this.dead = false;
    this.flashOn = true;
    this.uvOn = false;

    this.flash = new THREE.SpotLight(0xfff2cc, 2.2, 22, 0.42, 0.4, 1.2);
    this.uv = new THREE.SpotLight(0xb388ff, 2.2, 16, 0.5, 0.5, 1.2);
    [this.flash, this.uv].forEach(l => {
      l.target.position.set(0, 0, -1);
      camera.add(l);
      camera.add(l.target);
    });
    this.applyLights();
  }

  applyLights() {
    this.flash.visible = this.flashOn && !this.uvOn;
    this.uv.visible = this.uvOn;
  }

  reset(spawn) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = 0; this.pitch = 0;
    this.sanity = 100;
    this.dead = false;
    this.flashOn = true;
    this.uvOn = false;
    this.applyLights();
  }

  look(dx, dy) {
    if (this.dead) return;
    this.yaw -= dx * 0.0025;
    this.pitch = clamp(this.pitch - dy * 0.0025, -1.3, 1.3);
  }

  update(dt, keys, world) {
    if (this.dead) {
      this.camera.position.set(this.x, 0.4, this.z);
      this.camera.rotation.set(-1.4, this.yaw, 0, 'YXZ');
      return;
    }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0;
    if (keys.KeyW) { mx += fx; mz += fz; }
    if (keys.KeyS) { mx -= fx; mz -= fz; }
    if (keys.KeyA) { mx -= rx; mz -= rz; }
    if (keys.KeyD) { mx += rx; mz += rz; }

    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const speed = (keys.ShiftLeft || keys.ShiftRight) ? RUN : WALK;
      const p = pushOut(world, this.x + (mx / len) * speed * dt, this.z + (mz / len) * speed * dt, PLAYER_R);
      this.x = p.x;
      this.z = p.z;
    }
    this.camera.position.set(this.x, 1.6, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

// ---------- The ghost, simulated by the host only ----------
export class GhostSim {
  constructor(def, start, world) {
    this.def = def;
    this.world = world;
    this.x = start.x;
    this.z = start.z;
    this.yaw = 0;
    this.anger = 0;
    this.state = 'dormant';   // dormant -> hunting -> cooldown -> dormant
    this.until = 0;
    this.repelUntil = 0;
    this.visible = false;
    this.hunting = false;
    this.wander = this.randomPoint();
    this.lastPrint = { x: this.x, z: this.z };
  }

  randomPoint() {
    const [x1, x2, z1, z2] = this.world.bounds;
    return {
      x: x1 + 2 + Math.random() * (x2 - x1 - 4),
      z: z1 + 2 + Math.random() * (z2 - z1 - 4)
    };
  }

  // players: [{ id, x, z, dead }]. Returns events for the host to send out.
  update(dt, now, players) {
    const events = [];
    const alive = players.filter(p => !p.dead);

    // Anger builds while hunters stand close, and slowly fades otherwise
    const near = alive.filter(p => Math.hypot(p.x - this.x, p.z - this.z) < 6).length;
    this.anger = clamp(this.anger + near * dt * 6 - dt * 2, 0, 100);

    if (this.state === 'dormant' && this.anger >= 100 && alive.length) {
      this.state = 'hunting';
      this.until = now + HUNT_TIME;
      this.anger = 0;
      events.push({ name: 'huntStart' });
    } else if (this.state === 'hunting' && (now >= this.until || !alive.length)) {
      this.state = 'cooldown';
      this.until = now + COOLDOWN;
    } else if (this.state === 'cooldown' && now >= this.until) {
      this.state = 'dormant';
    }

    const repelled = now < this.repelUntil;
    const target = nearestTo(alive, this.x, this.z);
    let tx, tz, speed;

    if (repelled && target) {
      const dx = this.x - target.x, dz = this.z - target.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = this.x + (dx / d) * 4;
      tz = this.z + (dz / d) * 4;
      speed = 3.6;
    } else if (this.state === 'hunting' && target) {
      tx = target.x;
      tz = target.z;
      speed = 3.2;
    } else {
      if (Math.hypot(this.wander.x - this.x, this.wander.z - this.z) < 0.8) this.wander = this.randomPoint();
      tx = this.wander.x;
      tz = this.wander.z;
      speed = 0.7;
    }

    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, speed * dt);
    const p = pushOut(this.world, this.x + (dx / d) * step, this.z + (dz / d) * step, 0.6);
    const moved = Math.hypot(p.x - this.x, p.z - this.z);
    this.x = p.x;
    this.z = p.z;
    if (moved > 0.001) this.yaw = Math.atan2(dx, dz);

    // Footprints appear while it moves, for ghosts that leave fingerprints
    if (this.def.evidence.includes('fingers') &&
        Math.hypot(this.x - this.lastPrint.x, this.z - this.lastPrint.z) > 1.2) {
      this.lastPrint = { x: this.x, z: this.z };
      events.push({ name: 'print', x: this.x, z: this.z });
    }

    this.visible = alive.some(p => Math.hypot(p.x - this.x, p.z - this.z) < 4) || this.state === 'hunting';
    this.hunting = this.state === 'hunting' && !repelled;
    return events;
  }
}

// ---------- The ghost as everyone sees it ----------
export class GhostView {
  constructor(scene) {
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xbfe9ff, emissive: 0x2a6f9a, transparent: true, opacity: 0.7
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 16), bodyMat);
    body.position.y = 1.3;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), bodyMat);
    tail.position.y = 0.6;
    tail.rotation.x = Math.PI;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x7ff5ff });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), this.eyeMat);
    e1.position.set(-0.2, 1.4, 0.5);
    const e2 = e1.clone();
    e2.position.x = 0.2;
    this.group.add(body, tail, e1, e2);
    this.group.visible = false;
    scene.add(this.group);

    this.x = 0; this.z = 0; this.yaw = 0;
    this.tx = undefined;
    this.visible = false;
    this.hunting = false;
  }

  set(s) {
    if (this.tx === undefined) {
      this.x = s.x; this.z = s.z; this.yaw = s.yaw;
    }
    this.tx = s.x; this.tz = s.z; this.tyaw = s.yaw;
    this.visible = !!s.visible;
    this.hunting = !!s.hunting;
  }

  update(dt, t) {
    if (this.tx === undefined) return;
    const k = Math.min(1, dt * 10);
    this.x += (this.tx - this.x) * k;
    this.z += (this.tz - this.z) * k;
    let d = this.tyaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    this.group.position.set(this.x, Math.sin(t * 2) * 0.08, this.z);
    this.group.rotation.y = this.yaw;
    this.group.visible = this.visible || this.hunting;
    this.eyeMat.color.set(this.hunting ? 0xff3344 : 0x7ff5ff);
  }
}
