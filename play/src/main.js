import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LEVELS, skyline } from './levels.js';
import { World, Car, TUNING } from './physics.js';
import { Input } from './input.js';
import { Bot } from './bot.js';
import { City, mulberry } from './world.js';
import { CarView } from './car.js';
import { Particles, SpeedLines } from "./fx.js";
import { Audio, STATIONS } from './audio.js';
import { Touch } from './touch.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // time advances only when the recorder asks
const VIEW = params.get('view'); // 'build' = fixed framing for the build timelapse
const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const QUALITY = params.has('low') ? 0 : MOBILE ? 1 : 2;
const STEP = 1 / 120;
// recorder: scripted radio switches, e.g. radio=3:1,6:2 tunes station 1 at 3 s and station 2 at 6 s
const RADIO_AT = (params.get("radio") || "").split(",").filter(Boolean).map((s) => s.split(":").map(Number));
const UP = new THREE.Vector3(0, 1, 0);

// ---------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: QUALITY === 2, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
let pixelRatio = Math.min(devicePixelRatio, QUALITY === 2 ? 1.75 : 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3200);
scene.add(new THREE.HemisphereLight(0x5a6aa8, 0x2a1a20, 0.9));
const moonLight = new THREE.DirectionalLight(0xa8b8ff, 0.9);
moonLight.position.set(-300, 500, 600);
scene.add(moonLight);

// environment for glossy paint: a dark room with neon panels
(() => {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05050a);
  const panel = (c, p, s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(...s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(...p); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(new THREE.Color(3, 0.6, 2.4), [8, 2, 4], [6, 2]);
  panel(new THREE.Color(0.4, 2.2, 3), [-8, 3, -2], [6, 2]);
  panel(new THREE.Color(0.5, 0.45, 0.9), [0, 9, 0], [8, 8]);
  panel(new THREE.Color(0.6, 0.7, 1.4), [0, 2, -9], [12, 3]);
  panel(new THREE.Color(1.2, 0.5, 0.3), [2, -6, 6], [14, 2]);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.05).texture;
})();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- game objects
const city = new City(scene, QUALITY);
const carView = new CarView(scene);
const fx = new Particles(scene, QUALITY ? 2500 : 1200);
scene.add(camera);
const speedLines = new SpeedLines(camera);
const shadow = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, "rgba(0,0,0,0.85)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  scene.add(m);
  return m;
})();
const input = new Input();
const audio = new Audio();
const hud = new Hud(document.getElementById("hud"), { mobile: MOBILE });
hud.capture = CAPTURE;
const touch = new Touch(input, document.getElementById('touch'), { onRadio: () => switchRadio(), onReset: () => restart(), onPause: () => pause() });

const save = (() => { try { return JSON.parse(localStorage.getItem('vv-save') || '{}'); } catch { return {}; } })();
const persist = () => { try { localStorage.setItem('vv-save', JSON.stringify(save)); } catch { /* private mode */ } };

const game = {
  levelIndex: Math.max(0, Math.min(LEVELS.length - 1, (Number(params.get('level')) || 1) - 1)),
  t: 0, state: 'title', time: 0, slowmo: 1, parkedAt: 0,
};
let world, car, bot = null;

function buildLevel(i) {
  const level = LEVELS[i];
  const rand = mulberry(1000 + i);
  const boxes = level.boxes.concat(skyline(level, rand));
  world = new World(boxes);
  city.build(level, world, mulberry(77 + i));
  car = new Car(world);
  car.reset(level.start);
  game.level = level;
  game.levelIndex = i;
  game.t = 0;
  game.result = null;
  game.parkTimer = 0;
  game.inBay = false;
  game.fuelWarn = 0;
  game.maxAlt = 0;
  if (bot) bot.reset();
  hud.setLevel(level);
  snapCamera();
}

function restart() {
  buildLevel(game.levelIndex);
  game.state = 'play';
  hud.showResult(null);
  hud.toast(game.level.hint, 4);
}

function startLevel(i) {
  audio.start();
  buildLevel(i);
  game.state = 'play';
  hud.showTitle(false);
  hud.showResult(null);
  hud.showPause(false);
  hud.toast(game.level.hint, 4.5);
}

function pause() {
  if (game.state === 'play') { game.state = 'paused'; hud.showPause(true); }
  else if (game.state === 'paused') { game.state = 'play'; hud.showPause(false); }
}

function switchRadio() {
  audio.start();
  const i = (audio.station + 1) % STATIONS.length;
  audio.tune(i);
  hud.radio(STATIONS[i]);
  save.station = i; persist();
}

// ---------- camera
const cam = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), fov: 62, shake: 0 };
const tmpV = new THREE.Vector3();

function camTarget() {
  const grounded = car.grounded;
  const f = grounded ? car.f : (car.heading || car.f);
  const n = car.n;
  const onWall = grounded && n.y < 0.5;
  const sp = car.speed;
  const back = 8.6 + Math.min(4, sp * 0.06);
  const want = car.p.clone().addScaledVector(f, -back);
  if (grounded) want.addScaledVector(n, onWall ? 4.4 : 3.2).addScaledVector(UP, onWall ? 1.6 : 0.9);
  else want.addScaledVector(UP, 3.4);
  const look = car.p.clone().addScaledVector(f, 5).addScaledVector(grounded ? n : UP, 0.9);
  if (!grounded) look.addScaledVector(car.v, 0.12);
  // tilt the horizon only part-way onto walls, so height still reads as height
  const up = grounded ? n.clone().lerp(UP, onWall ? 0.45 : 0).normalize() : UP.clone();
  return { want, look, up };
}

function avoidWalls(from, to) {
  // pull the camera in front of any building between it and the car
  const dir = to.clone().sub(from);
  for (let k = 1; k <= 6; k++) {
    const p = from.clone().addScaledVector(dir, k / 6);
    const c = world.sphereContact(p, 0.6);
    if (c && !c.box.ground) return from.clone().addScaledVector(dir, Math.max(0, (k - 1.2) / 6));
  }
  return to;
}

function snapCamera() {
  const t = camTarget();
  cam.pos.copy(t.want); cam.look.copy(t.look); cam.up.copy(t.up);
}

function updateCamera(dt) {
  const CAM = params.get('cam');
  if (CAM && game.state === 'play') {
    // cinematic cameras for hero shots (recorder only)
    const hv = car.v.clone().setY(0);
    const h = (hv.lengthSq() > 4 ? hv : (car.heading || car.f).clone().setY(0)).normalize();
    let want, look = car.p.clone().addScaledVector(car.v, 0.15);
    if (CAM === 'side') {
      const side = new THREE.Vector3().crossVectors(UP, h).multiplyScalar(Number(params.get('sideSign') || 1));
      want = car.p.clone().addScaledVector(side, 17).addScaledVector(h, -4).add(new THREE.Vector3(0, 2.5, 0));
    } else if (CAM === 'drone') {
      want = car.p.clone().addScaledVector(h, -26).add(new THREE.Vector3(0, 16, 0));
    } else {
      want = new THREE.Vector3(...CAM.split(',').map(Number));
    }
    if (!CAM.includes(',')) want = avoidWalls(car.p, want);
    cam.pos.lerp(want, CAM.includes(',') ? 1 : 1 - Math.exp(-dt * 3));
    cam.look.lerp(look, 1 - Math.exp(-dt * 8));
    camera.position.copy(cam.pos); camera.up.set(0, 1, 0); camera.lookAt(cam.look);
    camera.fov = Number(params.get('fov') || 50); camera.updateProjectionMatrix();
    return;
  }
  if (VIEW === 'car') {
    // close-up turntable around the car (for checking the model)
    const a = Number(params.get('ang') || 0.6) + game.time * 0.2;
    camera.position.copy(car.p).add(new THREE.Vector3(Math.sin(a) * 6.5, 1.6, Math.cos(a) * 6.5));
    camera.up.set(0, 1, 0); camera.lookAt(car.p.x, car.p.y - 0.2, car.p.z);
    camera.fov = 40; camera.updateProjectionMatrix();
    return;
  }
  if (VIEW === 'build') {
    camera.position.set(-6, 9, -78);
    camera.up.set(0, 1, 0);
    camera.lookAt(3, 40, 60);
    camera.fov = 62; camera.updateProjectionMatrix();
    return;
  }
  let fovWant = (camera.aspect < 1 ? 74 : 60) + Math.min(16, car.speed * 0.3);
  if (game.state === 'title') {
    // slow orbit showing the tower and its bay
    const bay = game.level.bay;
    const c = new THREE.Vector3(...bay.centre);
    const a = game.time * 0.08;
    const out = new THREE.Vector3(...bay.inward).multiplyScalar(-1);
    const side = new THREE.Vector3().crossVectors(UP, out);
    const pos = c.clone().addScaledVector(out, 70 + Math.sin(a) * 10).addScaledVector(side, Math.sin(a * 0.7) * 40).add(new THREE.Vector3(0, 10 + Math.sin(a * 0.5) * 12, 0));
    camera.position.copy(pos); camera.up.set(0, 1, 0); camera.lookAt(c.x, c.y + 4, c.z);
    camera.fov = fovWant; camera.updateProjectionMatrix();
    return;
  }
  if (game.state === 'parked') {
    const bay = game.level.bay;
    const c = car.p.clone();
    const out = new THREE.Vector3(...bay.inward).multiplyScalar(-1);
    const side = new THREE.Vector3().crossVectors(UP, out);
    const k = Math.min(1, (game.time - game.parkedAt) / 3);
    const ease = 1 - Math.pow(1 - k, 3);
    const a = -0.9 + ease * 1.4 + (game.time - game.parkedAt) * 0.03;
    const tall = camera.aspect < 1;
    const want = c.clone().addScaledVector(out, tall ? 5 + ease * 6.5 : 6 + ease * 11).addScaledVector(side, Math.sin(a) * (tall ? 4 : 7)).add(new THREE.Vector3(0, 1.3 + ease * (tall ? 1.6 : 2.2), 0));
    cam.pos.lerp(want, 1 - Math.exp(-dt * 3));
    cam.look.lerp(c.clone().add(new THREE.Vector3(0, 1.3, 0)), 1 - Math.exp(-dt * 4));
    cam.up.lerp(UP, 1 - Math.exp(-dt * 3)).normalize();
    fovWant = camera.aspect < 1 ? 70 : 55;
  } else {
    const t = camTarget();
    t.want = avoidWalls(car.p, t.want);
    cam.pos.lerp(t.want, 1 - Math.exp(-dt * (car.grounded ? 7 : 4.5)));
    cam.look.lerp(t.look, 1 - Math.exp(-dt * 12));
    cam.up.lerp(t.up, 1 - Math.exp(-dt * 3.5)).normalize();
  }
  cam.fov += (fovWant - cam.fov) * (1 - Math.exp(-dt * 3));
  cam.shake = Math.max(0, cam.shake - dt * 2.5);
  camera.position.copy(cam.pos);
  if (cam.shake > 0) camera.position.add(tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(cam.shake * 0.5));
  camera.up.copy(cam.up);
  camera.lookAt(cam.look);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  const k = QUALITY === 2 ? 0.5 : 0.35;
  bloom.resolution.set(w * pixelRatio * k, h * pixelRatio * k);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fx.uniforms.uScale.value = h * pixelRatio * 0.9;
  fx.uniforms.uMax.value = h * pixelRatio * 0.06;
}
addEventListener('resize', resize);
resize();

// contact shadow: on the face we drive on, or on whatever is below while flying
const _sq = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
function updateShadow() {
  let n = car.n, d = 0;
  const p = car.p.clone();
  if (car.grounded) p.addScaledVector(n, -TUNING.rideHeight + 0.04);
  else {
    n = UP;
    let top = 0;
    for (const b of world.near(car.p, 2)) if (!b.ground && car.p.x > b.min.x && car.p.x < b.max.x && car.p.z > b.min.z && car.p.z < b.max.z && b.max.y <= car.p.y) top = Math.max(top, b.max.y);
    d = car.p.y - top;
    p.y = top + 0.04;
  }
  const fwd = car.f.clone().addScaledVector(n, -car.f.dot(n));
  if (fwd.lengthSq() < 1e-4) fwd.set(1, 0, 0).addScaledVector(n, -n.x);
  fwd.normalize();
  const x = new THREE.Vector3().crossVectors(fwd, n);
  _m4.makeBasis(x, fwd, n);
  shadow.quaternion.setFromRotationMatrix(_m4);
  shadow.position.copy(p);
  const k = Math.max(0, 1 - d / 25);
  shadow.material.opacity = 0.75 * k;
  shadow.scale.setScalar(1 + d * 0.04);
  shadow.visible = k > 0.02;
}

// ---------- parking
function bayFrame() {
  const bay = game.level.bay;
  const c = new THREE.Vector3(...bay.centre);
  const inward = new THREE.Vector3(...bay.inward);
  const rel = car.p.clone().sub(c);
  const along = rel.dot(inward);
  const side = rel.clone().addScaledVector(inward, -along).setY(0).length();
  const fl = car.f.clone().setY(0);
  const heading = fl.lengthSq() > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, fl.normalize().dot(inward)))) : Math.PI;
  const inBay = car.grounded && car.surface.key === '+y' && Math.abs(car.p.y - TUNING.rideHeight - bay.y) < 0.3 &&
    Math.abs(along) < bay.d * 0.6 && side < bay.w / 2;
  return { along, side, heading, inBay, dist: c.distanceTo(car.p) };
}

function checkPark(dt) {
  const b = bayFrame();
  game.bay = b;
  if (b.inBay && !game.inBay) { audio.play('inbay'); hud.toast('STOP ON THE MARK', 1.6); }
  game.inBay = b.inBay;
  if (b.inBay && car.speed < 0.8) game.parkTimer += dt;
  else game.parkTimer = 0;
  if (game.parkTimer > 0.6) {
    game.state = 'parked';
    game.parkedAt = game.time;
    const offset = Math.hypot(b.along, b.side);
    const posScore = Math.max(0, 1 - offset / 3.5);
    const angScore = Math.max(0, 1 - b.heading / (Math.PI / 4));
    const precision = Math.round(100 * (posScore * 0.6 + angScore * 0.4));
    const timeBonus = Math.max(0, Math.round((game.level.par - game.t) * 30));
    const fuelBonus = Math.round(car.fuel * 5);
    const score = 1000 + precision * 15 + timeBonus + fuelBonus;
    const key = 'L' + game.level.id;
    const best = save[key] || 0;
    if (score > best && !bot) { save[key] = score; persist(); }
    game.result = { time: game.t, offset, heading: b.heading * 180 / Math.PI, precision, fuel: car.fuel, score, timeBonus, fuelBonus, best: Math.max(best, score), newBest: score > best };
    audio.play('parked');
    fx.burst(car.p.clone().add(new THREE.Vector3(0, 1.5, 0)), 36, { speed: 6, life: 1.1, size: 0.5, color: [0.1, 0.6, 0.35], drag: 1.6, grav: 3 });
    hud.parked(game.result, game.levelIndex < LEVELS.length - 1);
  }
}

// ---------- simulation
function handleEvents() {
  for (const e of car.events) {
    if (e.type === 'stick') {
      audio.play('stick', e.s);
      cam.shake = Math.max(cam.shake, 0.25 + e.s * 0.9);
      fx.burst(car.p.clone().addScaledVector(car.n, -0.5), 10 + Math.round(e.s * 30), { speed: 6 + e.s * 10, life: 0.5, size: 0.7, color: [1, 0.55, 0.15], drag: 2, grav: 12, dir: car.n.clone(), dirSpeed: 4 });
      if (car.n.y < 0.5) carView.sideKick = 0.4 + e.s * 0.6;
      if (e.s > 0.45 && car.n.y < 0.5) hud.toast('WALL GRIP', 0.9, 'small');
    } else if (e.type === 'jump') {
      audio.play('jump');
      carView.kick = 1;
      fx.burst(car.p.clone().addScaledVector(car.n, -0.6), 24, { speed: 7, life: 0.5, size: 1.4, color: [1, 0.5, 0.15], drag: 3 });
    } else if (e.type === 'bump') {
      audio.play('bump', e.s);
      cam.shake = Math.max(cam.shake, e.s * 0.8);
    } else if (e.type === 'wrap') audio.play('wrap');
    else if (e.type === 'launch') audio.play('launch');
    else if (e.type === 'fell') { car.reset(game.level.start); snapCamera(); }
  }
  car.events.length = 0;
}

function simulate(dt) {
  if (input.consume('KeyM')) { audio.setMuted(!audio.muted); hud.toast(audio.muted ? 'SOUND OFF' : 'SOUND ON', 1, 'small'); }
  if (input.consume('KeyQ') || input.consume('Tab')) switchRadio();
  if (game.state === 'title') {
    for (let i = 1; i <= LEVELS.length; i++) if (input.consume('Digit' + i)) startLevel(i - 1);
    if (input.consume('Enter') || input.consume('Space')) startLevel(game.levelIndex);
    return;
  }
  if (input.consume('KeyR')) { restart(); return; }
  if (input.consume('Escape') || input.consume('KeyP')) pause();
  if (game.state === 'parked' && (input.consume('Enter') || input.consume('KeyN'))) {
    if (game.levelIndex < LEVELS.length - 1) startLevel(game.levelIndex + 1);
    else restart();
    return;
  }
  for (let i = 1; i <= LEVELS.length; i++) if (input.consume('Digit' + i)) { startLevel(i - 1); return; }
  if (game.state === 'paused') return;
  if (bot) input.override = game.state === 'play' ? bot.update(dt) : { throttle: 0, steer: 0, jump: false, lift: false, boost: false };
  const inp = input.read();
  game.lastInput = inp;
  if (game.state === "parked") { car.v.multiplyScalar(Math.exp(-dt * 12)); car.firing.lift = car.firing.boost = 0; return; }
  car.step(dt, inp);
  inp.jump = false;
  handleEvents();
  if (game.state === "play") {
    while (RADIO_AT.length && game.t >= RADIO_AT[0][0]) { const [, i] = RADIO_AT.shift(); audio.tune(i); hud.radio(STATIONS[i]); }
    game.t += dt;
    game.maxAlt = Math.max(game.maxAlt, car.p.y);
    checkPark(dt);
    if (car.fuel < 20 && game.fuelWarn <= 0 && (car.firing.lift || car.firing.boost)) { audio.play('lowfuel'); game.fuelWarn = 1.2; }
    game.fuelWarn -= dt;
  }
}

let acc = 0;
function frame(dtReal) {
  dtReal = Math.min(dtReal, 0.1);
  // a moment of slow motion as the car settles into its bay
  const since = game.time - game.parkedAt;
  game.slowmo = game.state === 'parked' && since < 1.6 ? 0.35 + 0.65 * Math.min(1, since / 1.6) : 1;
  const dt = dtReal * game.slowmo;
  game.time += dtReal;
  acc += dt;
  while (acc >= STEP) { simulate(STEP); acc -= STEP; }
  car.updateQuat(Math.min(1, dt * 14));
  carView.update(dt, car, game.lastInput || input.state, fx, game.time);
  fx.update(dt);
  updateShadow();
  updateCamera(dtReal);
  speedLines.update(dt, game.state === "play" && !params.has("clean") ? car.speed : 0);
  city.update(dt, camera, game.time);
  if (game.level && city.bayMats) city.setBayState(game.state === 'parked' ? 'parked' : game.inBay ? 'inside' : game.bay && game.bay.dist < 40 ? 'near' : 'idle', game.time);
  audio.update(car, game.lastInput || input.state, dt);
  hud.update(game, car, camera, dtReal);
  document.body.classList.toggle("playing", game.state !== "title");
  bloom.strength += ((game.state === "parked" ? 0.45 : 0.7) - bloom.strength) * Math.min(1, dtReal * 3);
  composer.render();
}

// ---------- boot
if (params.has('bot')) bot = new Bot(game, () => car);
buildLevel(game.levelIndex);
if (save.station !== undefined) audio.station = save.station;
hud.radio(STATIONS[audio.station], true);
hud.onStart = (i) => startLevel(i);
hud.onNext = () => startLevel(Math.min(LEVELS.length - 1, game.levelIndex + 1));
hud.onRetry = () => startLevel(game.levelIndex);
hud.onMenu = () => { game.state = 'title'; hud.showResult(null); hud.showPause(false); hud.showTitle(true, save); };
hud.onResume = () => pause();
hud.onRadio = () => switchRadio();
if ((CAPTURE || params.has('play') || bot) && !params.has('title')) { game.state = 'play'; hud.showTitle(false); hud.toast(game.level.hint, 4); }
else hud.showTitle(true, save);
document.body.classList.toggle("touch", MOBILE);
document.body.classList.toggle("capture", CAPTURE);
document.body.classList.toggle("clean", params.has("clean"));

// assets/manifest.json (written by tools/import-assets.mjs) lists the real car and songs
game.carModel = 'placeholder';
game.assets = fetch('assets/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then(async (m) => {
  if (m && m.radio) for (const st of STATIONS) if (m.radio[st.id]) st.files = m.radio[st.id];
  if (m && m.car) {
    try { await carView.loadModel(m.car); game.carModel = m.car; } catch (e) { console.warn('car model failed, using placeholder', e); }
  }
  game.assetsReady = true;
});

let last = performance.now();
let perfT = 0, perfN = 0;
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  frame(dt);
  // adaptive resolution: drop the pixel ratio if the frame rate sags
  perfT += dt; perfN++;
  if (perfT > 3) {
    const fps = perfN / perfT;
    if (fps < 45 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    perfT = 0; perfN = 0;
  }
  requestAnimationFrame(loop);
}

// Recorder API: capture scripts step time explicitly so footage is smooth on any machine.
window.VV = {
  game, get car() { return car; }, input, LEVELS, TUNING, audio, hud, camera,
  advance(frames = 1, fps = 30) { for (let i = 0; i < frames; i++) frame(1 / fps); },
  load(i) { startLevel(i); },
  status() {
    return { t: +game.t.toFixed(2), state: game.state, step: bot && bot.i, p: car.p.toArray().map((x) => +x.toFixed(1)),
      key: car.surface && car.surface.key, sp: +car.speed.toFixed(1), fuel: +car.fuel.toFixed(0), result: game.result, model: game.carModel };
  },
};
if (CAPTURE) frame(1 / 30);
else requestAnimationFrame(loop);
window.VV.ready = true;
