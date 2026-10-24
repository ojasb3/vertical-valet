// Night city visuals. Every building face is drawn by one shader (procedural lit windows),
// so the whole city is a single draw call. Physics boxes and visuals come from the same data.
import * as THREE from 'three';

const buildingVert = /* glsl */ `
  attribute float aSeed;
  attribute vec3 aTint;
  attribute vec3 aSize; // building height, route flag, trim hue
  varying vec3 vPos;
  varying vec3 vNormal;
  varying float vSeed;
  varying vec3 vTint;
  varying vec3 vSize;
  #include <fog_pars_vertex>
  void main() {
    vPos = position;
    vNormal = normal;
    vSeed = aSeed;
    vTint = aTint;
    vSize = aSize;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const buildingFrag = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying float vSeed;
  varying vec3 vTint;
  varying vec3 vSize;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 col;
    float top = vSize.x;
    vec3 trim = hue(vSize.z) * (vSize.y > 0.5 ? 2.0 : 1.3);
    if (n.y > 0.5) {
      // roof: dark concrete, panel grid, glowing rim
      vec2 g = abs(fract(vPos.xz / 6.0) - 0.5);
      float line = smoothstep(0.47, 0.5, max(g.x, g.y));
      col = vec3(0.045, 0.047, 0.06) + line * 0.02;
      col *= 0.85 + 0.3 * hash(floor(vPos.xz / 6.0) + vSeed);
    } else if (n.y < -0.5) {
      col = vec3(0.03, 0.031, 0.04); // undersides (bay ceilings)
    } else {
      float u = abs(n.x) > 0.5 ? vPos.z : vPos.x;
      float side = abs(n.x) > 0.5 ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
      vec2 cell = vec2(u / 3.0, vPos.y / 3.6);
      vec2 id = floor(cell);
      vec2 f = fract(cell);
      vec2 fw = fwidth(cell);
      float aa = clamp(max(fw.x, fw.y) * 1.2, 0.0, 1.0);
      float winX = smoothstep(0.07, 0.07 + fw.x, f.x) * smoothstep(0.93, 0.93 - fw.x, f.x) * (1.0 - 0.85 * smoothstep(0.03 + fw.x, 0.0, abs(f.x - 0.5)));
      float winY = smoothstep(0.24, 0.24 + fw.y, f.y) * smoothstep(0.94, 0.94 - fw.y, f.y);
      float win = winX * winY;
      float r = hash(id + vec2(vSeed * 13.7, side * 7.1));
      float litProb = 0.14 + 0.22 * fract(vSeed * 3.7);
      // rows of offices switched on together look more real than pure noise
      float rowOn = step(0.35, hash(vec2(floor(id.x / 4.0), id.y) + vSeed));
      float lit = step(r, litProb) * mix(0.35, 1.0, rowOn);
      float h2 = hash(id * 1.31 + vSeed);
      vec3 warm = vec3(1.0, 0.66, 0.36), cool = vec3(0.5, 0.72, 1.0), white = vec3(0.95, 0.92, 0.85);
      vec3 lc = h2 < 0.55 ? warm : (h2 < 0.82 ? cool : white);
      lc *= (0.45 + 0.9 * hash(id + 3.1 + vSeed)) * (0.75 + 0.35 * smoothstep(0.3, 0.95, f.y));
      vec3 glass = vec3(0.02, 0.028, 0.05) + vec3(0.05, 0.06, 0.14) * f.y * (0.5 + 0.5 * hash(id * 0.7 + vSeed));
      vec3 wall = vTint * (0.05 + 0.02 * hash(vec2(floor(id.x / 3.0), vSeed))) * (f.y < 0.16 ? 1.6 : 1.0);
      wall *= abs(n.x) > 0.5 ? 1.0 : 0.8;
      vec3 winCol = mix(glass, lc, lit);
      col = mix(wall, winCol, win);
      // far away: average the pattern instead of shimmering
      vec3 avg = mix(wall, glass, 0.55) + lc * litProb * 0.4;
      col = mix(col, avg, aa);
      if (vSize.y > 1.5) {
        // glass curtain wall: no grip. Teal sheen, bright mullions, sliding reflections.
        vec2 gc = vec2(u / 1.6, vPos.y / 4.0);
        vec2 gf = fract(gc), gw = fwidth(gc);
        float mull = max(1.0 - smoothstep(0.0, gw.x * 1.5, min(gf.x, 1.0 - gf.x)), 1.0 - smoothstep(0.0, gw.y * 1.5, min(gf.y, 1.0 - gf.y)));
        float sheen = 0.5 + 0.5 * sin(vPos.y * 0.045 - u * 0.07 + uTime * 0.25);
        col = mix(vec3(0.015, 0.06, 0.09), vec3(0.05, 0.2, 0.26), smoothstep(0.0, top, vPos.y)) * (0.6 + 0.8 * sheen);
        col += vec3(0.35, 0.95, 1.0) * mull * (0.22 + 0.2 * sheen) * (1.0 - aa);
      }
      // street-level shopfronts glow
      if (vPos.y < 5.0) {
        float shop = smoothstep(0.6, 1.4, vPos.y) * smoothstep(4.6, 3.8, vPos.y);
        vec3 sc = hue(fract(vSeed * 7.3 + floor(u / 9.0) * 0.17)) * 0.5 + vec3(0.6, 0.5, 0.4);
        col = mix(col, sc * 0.75, shop * 0.85);
      }
      // warm haze from the street lights
      col += vec3(1.0, 0.55, 0.3) * 0.05 * exp(-vPos.y / 18.0);
      // neon rim under the roof edge
      float rim = smoothstep(top - 0.9, top - 0.6, vPos.y) * smoothstep(top - 0.1, top - 0.35, vPos.y);
      col = mix(col, trim, rim);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFrag = /* glsl */ `
  varying vec3 vDir;
  void main() {
    float y = vDir.y;
    vec3 top = vec3(0.01, 0.012, 0.04);
    vec3 mid = vec3(0.05, 0.03, 0.11);
    vec3 glow = vec3(0.32, 0.12, 0.22);
    vec3 col = mix(mid, top, smoothstep(0.0, 0.55, y));
    col = mix(glow, col, smoothstep(-0.05, 0.22, y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SIGN_WORDS = ['NOODLES', 'HOTEL', 'OPEN 24H', 'ARCADE', 'RAMEN', 'BAR', 'CINEMA', 'KARAOKE', 'DINER', 'TATTOO', 'LAUNDRY', 'JAZZ', 'MOTEL', 'SUSHI', 'TACOS', 'VINYL'];
function signTexture(word, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = 'bold 72px "Trebuchet MS", Arial, sans-serif';
  const w = Math.ceil(g.measureText(word).width) + 60;
  c.width = w; c.height = 120;
  g.font = 'bold 72px "Trebuchet MS", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, 104);
  g.fillStyle = '#fff';
  g.fillText(word, w / 2, 64);
  g.fillStyle = color;
  g.globalAlpha = 0.6;
  g.fillText(word, w / 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, aspect: w / 120 };
}

export function textTexture(text, { font = 'bold 96px "Trebuchet MS", Arial', color = '#fff', glow = '#0ff', pad = 40 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w; c.height = 160;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(text, w / 2, 84);
  g.fillText(text, w / 2, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / 160 };
}

export class City {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.group = null;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]);
    this.buildingMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: buildingVert, fragmentShader: buildingFrag, fog: true });
    scene.fog = new THREE.FogExp2(0x120b22, 0.0021);
    scene.background = new THREE.Color(0x05040c);
    // sky dome, stars and moon follow the camera
    this.sky = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.sky.add(dome);
    const sp = [];
    const rnd = mulberry(7);
    for (let i = 0; i < 1400; i++) {
      const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 2200, y * 2200, Math.sin(a) * r * 2200);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.sky.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfc8ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false })));
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, '#fffbe8'], [0.32, '#fff3d0'], [0.36, 'rgba(255,240,210,0.25)'], [1, 'rgba(255,240,210,0)']]), fog: false, depthWrite: false }));
    moon.position.set(-700, 900, 1500);
    moon.scale.setScalar(420);
    this.sky.add(moon);
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    this.poolTex = radialTexture([[0, "rgba(255,190,120,0.38)"], [0.5, "rgba(255,150,90,0.12)"], [1, 'rgba(255,140,80,0)']]);
    this.beamTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 256;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 256);
      const h = g.createLinearGradient(0, 0, 64, 0);
      h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = h;
      g.fillRect(0, 0, 64, 256);
      return new THREE.CanvasTexture(c);
    })();
  }

  build(level, world, rand) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const g = (this.group = new THREE.Group());
    this.level = level;
    // --- buildings: one merged geometry
    const pos = [], nor = [], seed = [], tint = [], size = [], idx = [];
    const tints = [[0.55, 0.62, 0.85], [0.7, 0.66, 0.78], [0.5, 0.58, 0.7], [0.75, 0.62, 0.66], [0.6, 0.7, 0.8]];
    let vi = 0;
    const quad = (a, b, c, d, n, s, t, sz) => {
      for (const v of [a, b, c, d]) { pos.push(...v); nor.push(...n); seed.push(s); tint.push(...t); size.push(...sz); }
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    };
    const groups = {};
    for (const b of world.boxes) {
      if (b.ground) continue;
      const [x0, y0, z0] = b.min.toArray(), [x1, y1, z1] = b.max.toArray();
      let s = rand() * 100;
      let t = tints[Math.floor(rand() * tints.length)];
      const route = b.glass ? 2 : b.deco ? 0 : 1;
      let hueV = route === 2 ? 0.0 : route ? [0.52, 0.86, 0.95, 0.58][Math.floor(rand() * 4)] : rand();
      if (b.group) { groups[b.group] ||= { s, t, hueV: 0.47 }; ({ s, t, hueV } = groups[b.group]); }
      const top = b.top || y1;
      const sz = [top, route, hueV];
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], s, t, sz);
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], s, t, sz);
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], s, t, sz);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], s, t, sz);
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], s, t, sz);
      if (y0 > 0.1) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], s, t, sz);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    bg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    bg.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
    bg.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 3));
    bg.setIndex(idx);
    g.add(new THREE.Mesh(bg, this.buildingMat));

    this.buildGround(g, level, rand);
    this.buildStreetLights(g, level, rand);
    this.buildSigns(g, level, world, rand);
    this.buildBay(g, level);
    this.buildTraffic(g, rand);
    this.scene.add(g);
  }

  buildGround(g, level, rand) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#121218';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    const asphalt = new THREE.CanvasTexture(c);
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.repeat.set(200, 200);
    asphalt.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.55, metalness: 0.0, color: 0x9a96a8 }));
    ground.rotation.x = -Math.PI / 2;
    g.add(ground);
    // lane markings along the main street (x = 0)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a7a50 });
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 3), lineMat, 160);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let z = -200; z < 280 && k < 160; z += 7, k++) {
      m.makeRotationX(-Math.PI / 2).setPosition(0, 0.02, z);
      dash.setMatrixAt(k, m);
    }
    dash.count = k;
    g.add(dash);
    const edge = new THREE.MeshBasicMaterial({ color: 0x666070 });
    for (const sx of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 480), edge);
      l.rotation.x = -Math.PI / 2;
      l.position.set(sx * 9.5, 0.02, 40);
      g.add(l);
    }
  }

  buildStreetLights(g, level, rand) {
    const spots = [];
    for (let z = -180; z < 260; z += 22) for (const sx of [-1, 1]) spots.push([sx * 11, z, sx]);
    const pole = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 8, 0.25), new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.6 }), spots.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.5) }), spots.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, sx], i) => {
      m.makeTranslation(x, 4, z); pole.setMatrixAt(i, m);
      m.makeTranslation(x - sx * 0.8, 8, z); head.setMatrixAt(i, m);
      m.makeRotationX(-Math.PI / 2).setPosition(x - sx * 3, 0.05, z); pool.setMatrixAt(i, m);
    });
    g.add(pole, head, pool);
  }

  buildSigns(g, level, world, rand) {
    const colors = ['#ff2bd6', '#26e8ff', '#ffb02e', '#7cff4f', '#ff4848', '#a77bff'];
    let placed = 0;
    for (const b of world.boxes) {
      if (b.ground || placed > 34) continue;
      if (rand() > (b.deco ? 0.25 : 0.9)) continue;
      // choose a side facing the main street axis
      const faces = [];
      if (b.min.x > 0) faces.push('-x'); else if (b.max.x < 0) faces.push('+x');
      faces.push(b.min.z > 0 ? '-z' : '+z');
      const face = faces[Math.floor(rand() * faces.length)];
      const word = SIGN_WORDS[Math.floor(rand() * SIGN_WORDS.length)];
      const col = colors[Math.floor(rand() * colors.length)];
      const { tex, aspect } = signTexture(word, col);
      const vertical = rand() < 0.35;
      const hgt = 2.2 + rand() * 1.6;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(2.2, 2.2, 2.2), depthWrite: false, fog: true }));
      const top = b.max.y;
      const y = Math.min(top - 3, 6 + rand() * Math.min(40, top - 8));
      if (y < 5) continue;
      const ax = face[1], s = face[0] === '+' ? 1 : -1;
      const lat = ax === 'x' ? 'z' : 'x';
      const p = new THREE.Vector3();
      p[ax] = (s > 0 ? b.max[ax] : b.min[ax]) + s * 0.15;
      p.y = y;
      const span = b.max[lat] - b.min[lat];
      if (span < hgt * aspect + 2) continue;
      p[lat] = b.min[lat] + 1 + hgt * aspect / 2 + rand() * (span - hgt * aspect - 2);
      mesh.position.copy(p);
      mesh.lookAt(p.clone().add(new THREE.Vector3(ax === 'x' ? s : 0, 0, ax === 'z' ? s : 0)));
      if (vertical) mesh.rotateZ(Math.PI / 2);
      g.add(mesh);
      placed++;
    }
  }

  buildBay(g, level) {
    const bay = level.bay;
    const grp = new THREE.Group();
    const ax = bay.ax, lat = bay.lat, s = bay.face[0] === '+' ? 1 : -1;
    const at = (a, l, y) => { const v = new THREE.Vector3(); v[ax] = a; v[lat] = l; v.y = y; return v; };
    const box = (w, h, d, p, color) => {
      const geo = ax === 'x' ? new THREE.BoxGeometry(d, h, w) : new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
      m.position.copy(p);
      grp.add(m);
      return m;
    };
    const frameCol = new THREE.Color(0.12, 1.15, 1.4);
    const lc = (bay.l0 + bay.l1) / 2;
    const fa = bay.faceV + s * 0.12;
    // frame around the opening
    this.bayFrame = [
      box(bay.w + 0.36, 0.18, 0.18, at(fa, lc, bay.y + bay.h + 0.09), frameCol),
      box(0.18, bay.h, 0.18, at(fa, bay.l0 - 0.09, bay.y + bay.h / 2), frameCol),
      box(0.18, bay.h, 0.18, at(fa, bay.l1 + 0.09, bay.y + bay.h / 2), frameCol),
      box(bay.w + 0.6, 0.12, 0.3, at(fa, lc, bay.y + 0.06), frameCol),
    ];
    // interior: lit floor, parking outline, ceiling panel, back wall glow
    const mid = bay.faceV - s * bay.d / 2;
    const floor = box(bay.w - 0.1, 0.04, bay.d - 0.1, at(mid, lc, bay.y + 0.02), new THREE.Color(0.08, 0.09, 0.12));
    floor.material = new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.35, metalness: 0.2 });
    const ceil = box(bay.w * 0.18, 0.04, bay.d * 0.75, at(mid, lc, bay.y + bay.h - 0.07), new THREE.Color(1.1, 1.2, 1.3));
    // garage liner: concrete side walls and ceiling, light bars, a slatted door at the back
    const concrete = new THREE.MeshStandardMaterial({ color: 0x343842, roughness: 0.8, metalness: 0.05, emissive: 0x06070a, side: THREE.DoubleSide });
    const nAx = new THREE.Vector3(); nAx[ax] = 1;
    const nLat = new THREE.Vector3(); nLat[lat] = 1;
    const plane = (w, h, centre, normal, material) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      m.position.copy(centre);
      m.lookAt(centre.clone().add(normal));
      grp.add(m);
      return m;
    };
    plane(bay.d, bay.h, at(mid, bay.l0 + 0.03, bay.y + bay.h / 2), nLat, concrete);
    plane(bay.d, bay.h, at(mid, bay.l1 - 0.03, bay.y + bay.h / 2), nLat.clone().negate(), concrete);
    const ceilGeo = new THREE.PlaneGeometry(ax === 'x' ? bay.d : bay.w, ax === 'x' ? bay.w : bay.d).rotateX(Math.PI / 2); // faces down
    const ceiling = new THREE.Mesh(ceilGeo, concrete);
    ceiling.position.copy(at(mid, lc, bay.y + bay.h - 0.03));
    grp.add(ceiling);
    const door = (() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#2a2f38'; g.fillRect(0, 0, 256, 128);
      for (let y = 0; y < 128; y += 12) { g.fillStyle = '#1b1f26'; g.fillRect(0, y, 256, 3); g.fillStyle = '#3b414c'; g.fillRect(0, y + 3, 256, 1); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.4, emissive: 0x0a0c10 });
    })();
    plane(bay.w - 0.1, bay.h - 0.05, at(bay.backV + s * 0.03, lc, bay.y + bay.h / 2), nAx.clone().multiplyScalar(s), door);
    for (const l of [bay.l0 + 0.08, bay.l1 - 0.08]) box(0.06, 0.08, bay.d * 0.8, at(mid, l, bay.y + bay.h - 0.7), new THREE.Color(0.5, 1.3, 1.5));
    // target rectangle on the floor (car footprint + margin)
    const ca = bay.centre[ax === 'x' ? 0 : 2], cl = bay.centre[ax === 'x' ? 2 : 0];
    const tgt = new THREE.Color(0.15, 1.6, 0.8);
    this.bayTarget = [
      box(0.15, 0.03, 5.6, at(ca, cl - 1.45, bay.y + 0.06), tgt),
      box(0.15, 0.03, 5.6, at(ca, cl + 1.45, bay.y + 0.06), tgt),
      box(3.05, 0.03, 0.15, at(ca + s * 2.8, cl, bay.y + 0.06), tgt),
      box(3.05, 0.03, 0.15, at(ca - s * 2.8, cl, bay.y + 0.06), tgt),
    ];
    // HOME sign above the bay
    const { tex, aspect } = textTexture('HOME', { glow: '#29ffd0', color: '#e9fffb' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * aspect, 2.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(2, 2, 2), depthWrite: false }));
    sign.position.copy(at(bay.faceV + s * 0.3, lc, bay.y + bay.h + 2.2));
    const nrm = new THREE.Vector3(); nrm[ax] = s;
    sign.lookAt(sign.position.clone().add(nrm));
    grp.add(sign);
    // light spilling from the bay
    const spill = new THREE.PointLight(0x8ff8ff, 7, 22, 1.6);
    spill.position.copy(at(bay.faceV - s * 2, lc, bay.y + bay.h - 1));
    grp.add(spill);
    // beacon beam, visible from the street
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.4, 600, 16, 1, true), new THREE.MeshBasicMaterial({ map: this.beamTex, color: new THREE.Color(0.2, 1.4, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.55 }));
    beam.position.copy(at(bay.faceV + s * 6, lc, bay.y + 300 + bay.h));
    grp.add(beam);
    this.beam = beam;
    g.add(grp);
    this.bayGroup = grp;
    this.bayMats = { frame: this.bayFrame.map((m) => m.material), target: this.bayTarget.map((m) => m.material) };
  }

  setBayState(state, t) {
    // 'idle' | 'near' | 'inside' | 'parked'
    const base = { idle: [0.12, 1.15, 1.4], near: [0.16, 1.5, 1.8], inside: [0.18, 1.2, 0.45], parked: [0.22, 1.25, 0.5] }[state];
    const pulse = state === "parked" ? 1 + 0.3 * Math.sin(t * 6) : state === 'inside' ? 1 + 0.25 * Math.sin(t * 8) : 1;
    for (const m of this.bayMats.frame) m.color.setRGB(base[0] * pulse, base[1] * pulse, base[2] * pulse);
    const tg = state === "inside" || state === "parked" ? [0.2 * pulse, 1.5 * pulse, 0.6] : [0.12, 1.2, 0.6];
    for (const m of this.bayMats.target) m.color.setRGB(...tg);
    this.beam.material.color.setRGB(...(state === 'parked' ? [0.4, 2.4, 0.8] : [0.2, 1.4, 1.2]));
  }

  buildTraffic(g, rand) {
    // light pairs gliding along roads far below: cheap, and they sell the height
    const lanes = [];
    for (const x of [-95, -175, 95, 175]) for (const dir of [-1, 1]) lanes.push({ axis: 'z', fixed: x + dir * 2.5, dir, from: -400, to: 600 });
    for (const z of [-115, 245, 330]) for (const dir of [-1, 1]) lanes.push({ axis: 'x', fixed: z + dir * 2.5, dir, from: -500, to: 500 });
    const n = this.quality > 0 ? 180 : 90;
    const geo = new THREE.BoxGeometry(1.8, 0.5, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.cars = new THREE.InstancedMesh(geo, mat, n * 2);
    this.traffic = [];
    for (let i = 0; i < n; i++) {
      const lane = lanes[i % lanes.length];
      this.traffic.push({ lane, t: rand(), speed: 12 + rand() * 10 });
    }
    const white = new THREE.Color(3, 2.8, 2.4), red = new THREE.Color(2.6, 0.15, 0.1);
    for (let i = 0; i < n; i++) { this.cars.setColorAt(i * 2, white); this.cars.setColorAt(i * 2 + 1, red); }
    this.cars.frustumCulled = false;
    g.add(this.cars);
    this.updateTraffic(0);
  }

  updateTraffic(dt) {
    if (!this.traffic) return;
    const m = new THREE.Matrix4();
    this.traffic.forEach((c, i) => {
      const L = c.lane;
      const len = L.to - L.from;
      c.t = (c.t + (dt * c.speed) / len) % 1;
      const d = L.from + c.t * len;
      const along = L.dir > 0 ? d : L.to - (d - L.from);
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? 1 : -1) * 2.2 * L.dir;
        const x = L.axis === 'z' ? L.fixed : along + off;
        const z = L.axis === 'z' ? along + off : L.fixed;
        m.makeRotationY(L.axis === 'z' ? 0 : Math.PI / 2).setPosition(x, 0.7, z);
        this.cars.setMatrixAt(i * 2 + k, m);
      }
    });
    this.cars.instanceMatrix.needsUpdate = true;
  }

  update(dt, camera, time) {
    this.uniforms.uTime.value = time;
    this.sky.position.copy(camera.position);
    this.updateTraffic(dt);
    if (this.beam) {
      const dx = camera.position.x - this.beam.position.x, dz = camera.position.z - this.beam.position.z;
      const d = Math.hypot(dx, dz);
      this.beam.material.opacity = 0.32 * Math.min(1, Math.max(0, (d - 35) / 90));
      this.beam.visible = this.beam.material.opacity > 0.01;
    }
  }
}

export function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
