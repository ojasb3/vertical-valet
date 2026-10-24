// Pooled additive particles (thruster exhaust, sparks, embers) in a single draw call.
import * as THREE from 'three';

const vert = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  uniform float uMax;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(uMax, aSize * uScale / max(0.5, -mv.z));
    vColor.a *= smoothstep(1.0, 4.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(d));
    gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
  }
`;

export class Particles {
  constructor(scene, max = 2500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.base = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.cold = new Uint8Array(max); // cold-gas puffs: blue-white instead of hot orange
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 600 }, uMax: { value: 64 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, opts) {
    const { life = 0.6, size = 1, color = [1, 0.6, 0.2], drag = 1.5, grav = 0 } = opts;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set(color, i * 3);
    this.life[i] = life;
    this.age[i] = 0;
    this.size0[i] = size;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.cold[i] = opts.cold ? 1 : 0;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      // hot white-yellow core cooling to orange then dark red
      const heat = Math.max(0, 1 - t * 1.6);
      const hc = this.cold[i] ? [0.35, 0.42, 0.55] : [0.6, 0.4, 0.25];
      this.col[i * 4] = this.base[i * 3] + heat * hc[0];
      this.col[i * 4 + 1] = this.base[i * 3 + 1] * (1 - t * 0.6) + heat * hc[1];
      this.col[i * 4 + 2] = this.base[i * 3 + 2] * (1 - t * (this.cold[i] ? 0.4 : 1)) + heat * hc[2];
      this.col[i * 4 + 3] = (1 - t) * (this.cold[i] ? 0.6 : 1.6);
      this.size[i] = this.size0[i] * (this.cold[i] ? 0.5 + t * 3.2 : 0.6 + t * 1.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  burst(p, n, opts) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((opts.speed || 8) * (0.3 + Math.random()));
      if (opts.dir) v.addScaledVector(opts.dir, opts.dirSpeed || 0);
      this.spawn(p, v, opts);
    }
  }
}

// Streaks that rush past the camera at high speed.
export class SpeedLines {
  constructor(camera, n = 70) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.seg = [];
    for (let i = 0; i < n; i++) this.seg.push(this.respawn({}, true));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.7, 0.95, 1.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    camera.add(this.lines);
  }
  respawn(s, anywhere) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 5;
    s.x = Math.cos(a) * r; s.y = Math.sin(a) * r * 0.75;
    s.z = anywhere ? -5 - Math.random() * 55 : -60;
    return s;
  }
  update(dt, speed) {
    const k = Math.min(1, Math.max(0, (speed - 26) / 22));
    this.mat.opacity = k * 0.55;
    this.lines.visible = k > 0.01;
    const len = 1.5 + speed * 0.12;
    this.seg.forEach((s, i) => {
      s.z += speed * 1.4 * dt;
      if (s.z > -2) this.respawn(s);
      this.pos.set([s.x, s.y, s.z, s.x, s.y, s.z - len], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
