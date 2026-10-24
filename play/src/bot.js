// Test bot: an autopilot Claude wrote to play-test the levels and record footage.
// It only presses the same controls a player has (throttle, steer, jump, lift, boost);
// it reads the car's state to decide, like a player watching the screen.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const V = (a) => new THREE.Vector3(...a);

// Route steps:
//  drive  — steer toward `to` on whatever surface the car is on, until `until`
//  jump   — tap jump once
//  air    — in flight: steer toward `to`, fire lift while below `liftBelow`
//  park   — slow down and stop on the bay mark, nose in
export const ROUTES = {
  1: [
    { do: 'drive', to: [0, 0, 22], until: (c) => c.key === '-z' },
    { do: 'drive', to: [3, 26, 20], until: (c) => c.key === '+y' },
    { do: 'drive', to: [4, 26, 52], until: (c) => c.p.z > 45.5 },
    { do: 'jump' },
    { do: 'air', to: [4, 40, 66], liftBelow: 30, until: (c) => c.grounded },
    { do: 'drive', to: [4, 56, 64], until: (c) => c.p.y > 52 && Math.abs(c.p.x - 4) < 0.6 },
    { do: 'drive', to: [4, 80, 64], until: (c) => c.key === '+y' && c.p.y > 60 },
    { do: 'park' },
  ],
  2: [
    { do: 'drive', to: [14, 0, 8], until: (c) => c.key === '-x' },
    { do: 'drive', to: [12, 30, 44], until: (c) => c.p.y > 26 && c.p.z > 34 },
    { do: 'jump' },
    { do: 'air', to: [-12, 52, 74], liftBelow: 48, until: (c) => c.grounded },
    { do: 'drive', to: [-12, 70, 94], until: (c) => c.p.y > 58 },
    { do: 'jump' },
    { do: 'air', to: [12, 84, 108], liftBelow: 78, until: (c) => c.grounded },
    { do: 'drive', to: [12, 108, 118], until: (c) => c.key === '+y' },
    { do: 'drive', to: [16, 108, 130], until: (c) => c.p.z > 124 },
    { do: 'jump' },
    { do: 'air', to: [8, 122, 148], liftBelow: 118, until: (c) => c.grounded },
    { do: 'drive', to: [4, 146, 146], until: (c) => c.p.y > 140 && Math.abs(c.p.x - 4) < 0.6 },
    { do: 'drive', to: [4, 180, 146], until: (c) => c.key === '+y' && c.p.y > 150 },
    { do: 'park' },
  ],
  3: [
    { do: 'drive', to: [0, 0, 12], until: (c) => c.key === '-z' },
    { do: 'drive', to: [-4, 34, 10], until: (c) => c.p.y > 32 },
    { do: 'jump' },
    { do: 'air', to: [-26, 60, 44], liftBelow: 56, until: (c) => c.grounded },
    { do: 'drive', to: [-26, 90, 70], until: (c) => c.p.y > 78 && c.p.z > 62 },
    { do: 'jump' },
    { do: 'air', to: [30, 112, 98], liftBelow: 104, until: (c) => c.grounded },
    { do: 'drive', to: [30, 140, 96], until: (c) => c.p.y > 128 },
    { do: 'jump' },
    { do: 'air', to: [-28, 150, 128], liftBelow: 146, until: (c) => c.grounded },
    { do: 'drive', to: [-28, 190, 146], until: (c) => c.p.y > 176 },
    { do: 'jump' },
    { do: 'air', to: [44, 200, 164], liftBelow: 196, until: (c) => c.grounded },
    { do: 'drive', to: [44, 236, 176], until: (c) => c.p.y > 224 },
    { do: 'jump' },
    { do: 'air', to: [28, 236, 175], liftBelow: 234, until: (c) => c.grounded },
    { do: 'drive', to: [28, 240, 175], until: (c) => c.p.y > 234 && Math.abs(c.p.z - 175) < 0.6 },
    { do: 'drive', to: [28, 280, 175], until: (c) => c.key === '+y' && c.p.y > 240 },
    { do: 'park' },
  ],
};

export class Bot {
  constructor(game, getCar) {
    this.game = game;
    this.getCar = getCar;
    this.reset();
  }

  reset() {
    this.i = 0;
    this.t = 0;
    this.out = { throttle: 0, steer: 0, jump: false, lift: false, boost: false };
  }

  info() {
    const car = this.getCar();
    return { p: car.p, grounded: car.grounded, key: car.surface ? car.surface.key : null, v: car.v, fuel: car.fuel };
  }

  // signed angle from a to b about axis n
  static angle(a, b, n) {
    return Math.atan2(n.dot(new THREE.Vector3().crossVectors(a, b)), a.dot(b));
  }

  update(dt) {
    const car = this.getCar();
    const route = ROUTES[this.game.level.id];
    const o = this.out;
    o.jump = false; o.lift = false; o.boost = false;
    const step = route[Math.min(this.i, route.length - 1)];
    const c = this.info();
    this.t += dt;
    const next = () => { this.i++; this.t = 0; };
    if (!step) return o;

    if (step.do === 'jump') {
      if (car.grounded) o.jump = true;
      next();
    } else if (step.do === 'drive') {
      const d = V(step.to).sub(car.p);
      d.addScaledVector(car.n, -d.dot(car.n));
      const a = Bot.angle(car.f, d, car.n);
      o.steer = Math.max(-1, Math.min(1, a * 2.2));
      o.throttle = Math.abs(a) > 1.4 && car.speed > 12 ? 0.2 : 1;
      if (step.until(c)) next();
    } else if (step.do === 'air') {
      if (car.grounded && this.t > 0.2) { next(); return o; }
      const h = car.heading || car.f;
      const d = V(step.to).sub(car.p).setY(0);
      const a = Bot.angle(h, d, UP);
      o.steer = Math.max(-1, Math.min(1, a * 2));
      o.throttle = 1;
      o.lift = car.p.y < step.liftBelow && car.fuel > 2;
      if (step.until(c) && this.t > 0.2) next();
    } else if (step.do === 'park') {
      const bay = this.game.level.bay;
      const target = V(bay.centre);
      const inward = V(bay.inward);
      const d = target.clone().sub(car.p);
      d.addScaledVector(car.n, -d.dot(car.n));
      const dist = d.dot(inward); // distance still to go, measured into the bay
      // aim at a point slightly beyond the mark so the nose straightens out
      const aim = target.clone().addScaledVector(inward, 6).sub(car.p);
      aim.addScaledVector(car.n, -aim.dot(car.n));
      const a = Bot.angle(car.f, aim, car.n);
      o.steer = Math.max(-1, Math.min(1, a * 3));
      const sp = car.v.dot(car.f);
      const want = Math.max(0, Math.min(14, dist * 1.6));
      o.throttle = Math.max(-1, Math.min(1, (want - sp) * 0.4));
    }
    return o;
  }
}
