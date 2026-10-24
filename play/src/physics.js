// Arcade car physics on a world of axis-aligned boxes.
// The car is "magnetic": while grounded it drives on the face it touches, whatever its
// orientation. Driving into a wall rolls it onto that wall (concave edge); driving past the
// end of a face wraps it over the edge onto the next face (convex edge) unless it is fast
// enough to launch. Fixed time step, fully deterministic for a given input stream.
import * as THREE from 'three';

export const TUNING = {
  gravity: 17,
  rideHeight: 0.62, // car centre above the surface
  radius: 1.05, // collision sphere while airborne
  accel: 24,
  brake: 46,
  reverseMax: 12,
  topSpeed: 36,
  boostAccel: 34,
  boostTop: 54,
  wallGravity: 0.65, // fraction of gravity felt along a wall
  steerRate: 2.5, // rad/s at low speed
  grip: 9,
  jumpSpeed: 15,
  liftAccel: 31, // air thrust, straight up
  airSteer: 1.9,
  airControl: 9,
  wrapMaxSpeed: 31, // above this the car launches off convex edges
  fuelMax: 100,
  jumpCost: 16,
  liftBurn: 30, // fuel per second
  boostBurn: 24,
  regenGround: 16,
  regenAir: 5,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

const AXES = ['x', 'y', 'z'];
const faceKey = (n) => {
  const a = Math.abs(n.x) > 0.5 ? 'x' : Math.abs(n.y) > 0.5 ? 'y' : 'z';
  return (n[a] > 0 ? '+' : '-') + a;
};
const faceNormal = (key) => {
  const n = new THREE.Vector3();
  n[key[1]] = key[0] === '+' ? 1 : -1;
  return n;
};

export class World {
  constructor(boxes) {
    this.boxes = boxes.map((o, i) => ({
      id: i,
      min: new THREE.Vector3(o.b[0], o.b[1], o.b[2]),
      max: new THREE.Vector3(o.b[3], o.b[4], o.b[5]),
      noStick: new Set(o.noStick || []),
      deco: !!o.deco,
      glass: !!o.glass,
      top: o.top,
      group: o.group,
    }));
    // ground: one huge slab
    this.boxes.push({ id: this.boxes.length, min: new THREE.Vector3(-2000, -50, -2000), max: new THREE.Vector3(2000, 0, 2000), noStick: new Set(), ground: true });
    // a coarse grid so collision tests stay cheap with hundreds of buildings
    this.cell = 40;
    this.grid = new Map();
    for (const b of this.boxes) {
      if (b.ground) continue;
      for (let gx = Math.floor(b.min.x / this.cell); gx <= Math.floor(b.max.x / this.cell); gx++)
        for (let gz = Math.floor(b.min.z / this.cell); gz <= Math.floor(b.max.z / this.cell); gz++) {
          const k = gx + ',' + gz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(b);
        }
    }
    this.ground = this.boxes[this.boxes.length - 1];
  }

  near(p, r = 4) {
    const out = new Set([this.ground]);
    for (let gx = Math.floor((p.x - r) / this.cell); gx <= Math.floor((p.x + r) / this.cell); gx++)
      for (let gz = Math.floor((p.z - r) / this.cell); gz <= Math.floor((p.z + r) / this.cell); gz++) {
        const l = this.grid.get(gx + ',' + gz);
        if (l) for (const b of l) out.add(b);
      }
    return out;
  }

  sticky(box, key) {
    return key !== '-y' && !box.noStick.has(key);
  }

  // Sphere vs boxes: returns the deepest contact {box, normal, depth, point}.
  sphereContact(p, r) {
    let best = null;
    for (const b of this.near(p, r + 1)) {
      const c = _v.copy(p).clamp(b.min, b.max);
      const d2 = c.distanceToSquared(p);
      if (d2 > r * r) continue;
      let n, depth;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        // snap to the dominant axis so normals are always face normals
        _w.copy(p).sub(c);
        const a = AXES.reduce((m, k) => (Math.abs(_w[k]) > Math.abs(_w[m]) ? k : m), 'x');
        n = new THREE.Vector3();
        n[a] = Math.sign(_w[a]);
        depth = r - d;
      } else {
        // centre inside the box: push out through the nearest face
        let m = Infinity;
        for (const a of AXES) {
          const lo = p[a] - b.min[a], hi = b.max[a] - p[a];
          if (lo < m) { m = lo; n = new THREE.Vector3(); n[a] = -1; }
          if (hi < m) { m = hi; n = new THREE.Vector3(); n[a] = 1; }
        }
        depth = r + m;
      }
      if (!best || depth > best.depth) best = { box: b, normal: n, depth, point: c.clone() };
    }
    return best;
  }

  // Is there a face with normal n under the contact point q (within tolerance)?
  supportAt(q, n, tol = 0.35) {
    const a = AXES.find((k) => Math.abs(n[k]) > 0.5);
    const s = Math.sign(n[a]);
    let best = null;
    for (const b of this.near(q, 2)) {
      const faceV = s > 0 ? b.max[a] : b.min[a];
      if (Math.abs(q[a] - faceV) > tol) continue;
      let inside = true;
      for (const k of AXES) if (k !== a && (q[k] < b.min[k] - 0.01 || q[k] > b.max[k] + 0.01)) inside = false;
      if (inside) best = b;
    }
    return best;
  }
}

export class Car {
  constructor(world) {
    this.world = world;
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3(0, 1, 0); // surface normal (or air up)
    this.f = new THREE.Vector3(0, 0, 1); // forward, tangent to the surface
    this.quat = new THREE.Quaternion();
    this.surface = null; // { box, key }
    this.fuel = TUNING.fuelMax;
    this.noStick = 0;
    this.airTime = 0;
    this.events = []; // 'stick', 'jump', 'wrap', 'launch', 'bump' with strength
    this.firing = { lift: 0, boost: 0 };
    this.wheelSpin = 0;
    this.steerVis = 0;
    this.time = 0;
  }

  reset(start) {
    this.p.set(start.p[0], start.p[1] + TUNING.rideHeight, start.p[2]);
    this.v.set(0, 0, 0);
    this.n.set(0, 1, 0);
    this.f.set(...start.heading).normalize();
    this.surface = { box: this.world.ground, key: '+y' };
    this.fuel = TUNING.fuelMax;
    this.noStick = 0;
    this.airTime = 0;
    this.events.length = 0;
    this.updateQuat(1);
  }

  get grounded() { return !!this.surface; }
  get speed() { return this.v.length(); }

  emit(type, s = 1) { this.events.push({ type, s }); }

  basis() {
    const m = new THREE.Matrix4();
    const x = new THREE.Vector3().crossVectors(this.n, this.f).normalize();
    const z = new THREE.Vector3().crossVectors(x, this.n).normalize();
    m.makeBasis(x, this.n, z);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  updateQuat(k) {
    this.quat.slerp(this.basis(), k);
  }

  // Rotate the whole frame (forward, velocity) from one surface normal to another.
  rollOnto(nNew) {
    _q.setFromUnitVectors(this.n, nNew);
    this.f.applyQuaternion(_q);
    this.v.applyQuaternion(_q);
    this.n.copy(nNew);
    this.f.addScaledVector(this.n, -this.f.dot(this.n)).normalize();
  }

  step(dt, input) {
    this.time += dt;
    this.noStick = Math.max(0, this.noStick - dt);
    this.firing.lift = 0;
    this.firing.boost = 0;
    const T = TUNING;
    if (this.surface) this.stepGround(dt, input);
    else this.stepAir(dt, input);
    // fuel regenerates, faster on a surface
    if (!this.firing.lift && !this.firing.boost)
      this.fuel = Math.min(T.fuelMax, this.fuel + (this.surface ? T.regenGround : T.regenAir) * dt);
    this.wheelSpin += (this.surface ? this.v.dot(this.f) : this.wheelSpin * 0) * dt / 0.36;
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 10);
    if (this.p.y < -40) this.emit('fell');
  }

  stepGround(dt, input) {
    const T = TUNING;
    const n = this.n;
    // steering: rotate forward about the surface normal
    let sp = this.v.dot(this.f);
    const steerK = T.steerRate / (1 + Math.abs(sp) * 0.028);
    const yaw = input.steer * steerK * dt * (sp < -0.5 ? -1 : 1) * Math.min(1, Math.abs(sp) / 3 + 0.25);
    _q.setFromAxisAngle(n, yaw);
    this.f.applyQuaternion(_q);
    this.v.applyQuaternion(_q);
    // split velocity into forward and sideways, bleed sideways (grip)
    sp = this.v.dot(this.f);
    _v.copy(this.v).addScaledVector(this.f, -sp).addScaledVector(n, -this.v.dot(n));
    _v.multiplyScalar(Math.exp(-T.grip * dt));
    // throttle and brakes
    const th = input.throttle;
    if (th > 0) sp += (sp < 0 ? T.brake : T.accel * Math.max(0.15, 1 - sp / T.topSpeed)) * th * dt;
    else if (th < 0) sp += (sp > 0.5 ? -T.brake : -T.accel * 0.6 * Math.max(0, 1 + sp / T.reverseMax)) * -th * dt;
    else sp -= Math.sign(sp) * Math.min(Math.abs(sp), (2 + Math.abs(sp) * 0.05) * dt);
    if (input.boost && this.fuel > 0) {
      sp += T.boostAccel * Math.max(0, 1 - sp / T.boostTop) * dt;
      this.fuel = Math.max(0, this.fuel - T.boostBurn * dt);
      this.firing.boost = 1;
    }
    this.v.copy(this.f).multiplyScalar(sp).add(_v);
    // gravity along the surface (walls pull you back down)
    _w.set(0, -T.gravity, 0);
    _w.addScaledVector(n, -_w.dot(n)).multiplyScalar(n.y > 0.7 ? 1 : T.wallGravity);
    this.v.addScaledVector(_w, dt);
    if (sp > T.boostTop) this.v.multiplyScalar(0.995);

    // jump
    if (input.jump && this.fuel >= T.jumpCost * 0.5) {
      this.fuel = Math.max(0, this.fuel - T.jumpCost);
      this.v.addScaledVector(n, T.jumpSpeed);
      if (n.y < 0.7) this.v.y += 4; // wall jumps get a little lift
      this.leave(0.3);
      this.emit('jump');
      return;
    }

    const next = _w.copy(this.p).addScaledVector(this.v, dt);
    this.p.copy(next);

    // concave edges: is the nose (or body) pushing into another face?
    const nose = this.p.clone().addScaledVector(this.f, 1.5 * Math.sign(this.v.dot(this.f) || 1));
    for (const probe of [nose, this.p]) {
      const c = this.world.sphereContact(probe, 0.55);
      if (!c) continue;
      if (c.normal.dot(n) > 0.9) continue; // the face we drive on
      const key = faceKey(c.normal);
      const into = -this.v.dot(c.normal);
      if (this.world.sticky(c.box, key) && c.normal.dot(n) < 0.3) {
        // roll onto the new face
        this.rollOnto(c.normal);
        const a = AXES.find((k) => Math.abs(c.normal[k]) > 0.5);
        this.p[a] = c.point[a] + c.normal[a] * T.rideHeight;
        this.surface = { box: c.box, key };
        this.emit('stick', Math.min(1, into / 25));
        return;
      }
      // not sticky: bump off it
      this.p.addScaledVector(c.normal, c.depth + 0.01);
      const vn = this.v.dot(c.normal);
      if (vn < 0) this.v.addScaledVector(c.normal, -vn * 1.35);
      this.v.multiplyScalar(0.85);
      if (into > 2) this.emit('bump', Math.min(1, into / 20));
    }

    // support: still on a face with our normal?
    const q = this.p.clone().addScaledVector(n, -T.rideHeight);
    const sup = this.world.supportAt(q, n);
    if (sup) {
      const a = AXES.find((k) => Math.abs(n[k]) > 0.5);
      const faceV = n[a] > 0 ? sup.max[a] : sup.min[a];
      this.p[a] = faceV + n[a] * T.rideHeight;
      this.v.addScaledVector(n, -this.v.dot(n));
      this.surface = { box: sup, key: faceKey(n) };
      return;
    }

    // convex edge: wrap over onto the adjacent face of the box we were on, or launch
    const box = this.surface.box;
    let exit = null, over = 0;
    for (const k of AXES) {
      if (Math.abs(n[k]) > 0.5) continue;
      if (q[k] > box.max[k] && q[k] - box.max[k] > over) { over = q[k] - box.max[k]; exit = '+' + k; }
      if (q[k] < box.min[k] && box.min[k] - q[k] > over) { over = box.min[k] - q[k]; exit = '-' + k; }
    }
    const speed = this.v.length();
    if (exit && exit !== '-y' && speed < T.wrapMaxSpeed && this.world.sticky(box, exit)) {
      const nNew = faceNormal(exit);
      const edge = q.clone().clamp(box.min, box.max);
      this.rollOnto(nNew);
      this.p.copy(edge).addScaledVector(this.n, T.rideHeight);
      this.surface = { box, key: exit };
      this.emit('wrap');
      return;
    }
    this.leave(0.12);
    this.emit('launch', Math.min(1, speed / 40));
  }

  leave(noStick) {
    this.surface = null;
    this.noStick = noStick;
    this.airTime = 0;
    // air heading: horizontal part of velocity, else of the car's forward
    _v.set(this.v.x, 0, this.v.z);
    if (_v.lengthSq() < 4) _v.set(this.f.x, 0, this.f.z);
    if (_v.lengthSq() < 0.01) _v.set(this.n.x, 0, this.n.z);
    this.heading = _v.normalize().clone();
  }

  stepAir(dt, input) {
    const T = TUNING;
    this.airTime += dt;
    this.v.y -= T.gravity * dt;
    // yaw the heading and swing the horizontal velocity with it (arcade air steering)
    const yaw = input.steer * T.airSteer * dt;
    _q.setFromAxisAngle(UP, yaw);
    this.heading.applyQuaternion(_q);
    const vy = this.v.y;
    this.v.y = 0;
    this.v.applyQuaternion(_q.setFromAxisAngle(UP, yaw * 0.6));
    this.v.addScaledVector(this.heading, input.throttle * T.airControl * dt);
    this.v.y = vy;
    if (input.lift && this.fuel > 0) {
      this.v.y += T.liftAccel * dt;
      this.v.addScaledVector(this.heading, 4 * dt);
      this.fuel = Math.max(0, this.fuel - T.liftBurn * dt);
      this.firing.lift = 1;
    }
    if (input.boost && this.fuel > 0) {
      this.v.addScaledVector(this.heading, T.boostAccel * 0.8 * dt);
      this.fuel = Math.max(0, this.fuel - T.boostBurn * dt);
      this.firing.boost = 1;
    }
    this.v.multiplyScalar(Math.exp(-0.06 * dt));

    // move in sub-steps so fast cars never tunnel through thin bay walls
    const steps = Math.max(1, Math.ceil((this.v.length() * dt) / 0.4));
    for (let i = 0; i < steps; i++) {
      this.p.addScaledVector(this.v, dt / steps);
      const c = this.world.sphereContact(this.p, T.radius);
      if (!c) continue;
      const key = faceKey(c.normal);
      const into = -this.v.dot(c.normal);
      if (this.noStick <= 0 && this.world.sticky(c.box, key)) {
        this.land(c, into);
        return;
      }
      this.p.addScaledVector(c.normal, c.depth + 0.01);
      if (into > 0) this.v.addScaledVector(c.normal, into * (key === '-y' ? 1.2 : 1.3));
      this.v.multiplyScalar(0.9);
      if (into > 3) this.emit('bump', Math.min(1, into / 20));
    }
    // air attitude: upright, nose along the heading, pitched with the climb
    const pitch = Math.atan2(this.v.y, Math.hypot(this.v.x, this.v.z) + 6) * 0.6;
    const fwd = this.heading.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch)).normalize();
    this.n.lerp(UP, Math.min(1, dt * 3)).normalize();
    this.f.lerp(fwd, Math.min(1, dt * 4));
    this.f.addScaledVector(this.n, -this.f.dot(this.n)).normalize();
  }

  land(c, into) {
    const T = TUNING;
    const n = c.normal;
    const vt = this.v.clone().addScaledVector(n, -this.v.dot(n));
    let fwd;
    if (n.y > 0.7) {
      fwd = vt.lengthSq() > 4 ? vt.clone() : this.f.clone().addScaledVector(n, -this.f.dot(n));
    } else {
      // on walls bias the nose upward, so hitting a wall while falling still climbs
      const upOnWall = UP.clone().addScaledVector(n, -UP.dot(n)).normalize();
      fwd = vt.clone().addScaledVector(upOnWall, Math.max(6, this.v.length() * 0.6));
    }
    if (fwd.lengthSq() < 1e-4) fwd.copy(this.heading || this.f).addScaledVector(n, -(this.heading || this.f).dot(n));
    fwd.normalize();
    const keep = Math.max(vt.length() * 0.85, n.y > 0.7 ? 0 : Math.min(this.v.length() * 0.55, 22));
    this.n.copy(n);
    this.f.copy(fwd);
    this.v.copy(fwd).multiplyScalar(keep);
    this.p.copy(c.point).addScaledVector(n, T.rideHeight);
    this.surface = { box: c.box, key: faceKey(n) };
    this.emit('stick', Math.min(1, into / 22));
  }
}
