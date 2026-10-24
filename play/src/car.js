// The car's look: a built-in placeholder roadster, swapped for the Blender model
// (assets/car/roadster.glb) when that file exists. Local axes: +z forward, +y up.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LENGTH = 4.6; // metres, nose to tail

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  // cold-gas jet (like the car stage's plumes): white core fading through pale blue to nothing
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(200,230,255,0.8)');
  grd.addColorStop(0.55, 'rgba(120,180,255,0.35)');
  grd.addColorStop(1, 'rgba(90,150,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

export class CarView {
  constructor(scene) {
    this.root = new THREE.Group(); // follows physics position/orientation
    this.body = new THREE.Group(); // gets suspension tilt
    this.root.add(this.body);
    scene.add(this.root);
    this.wheels = [];
    this.nozzles = []; // { obj, dir: 'lift'|'boost', flame }
    this.flameTex = flameTexture();
    this.paint = new THREE.MeshPhysicalMaterial({ color: 0x9c0a16, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.2 });
    this.buildPlaceholder();
    // headlights: one spot light keeps it cheap
    this.headlight = new THREE.SpotLight(0xdde8ff, 120, 70, 0.55, 0.5, 1.4);
    this.headlight.position.set(0, 0.0, 2.55);
    this.headlight.target.position.set(0, -0.6, 14);
    this.root.add(this.headlight, this.headlight.target);
    this.key = new THREE.PointLight(0xc8d8ff, 22, 9, 1.5);
    this.key.position.set(0, 3.2, -2.5);
    this.root.add(this.key);
    this.under = new THREE.PointLight(0x47e8ff, 6, 6, 2);
    this.under.position.set(0, -0.95, 0); // well below the glossy floor panel, or it mirrors as a hot square
    this.root.add(this.under);
    this.tilt = new THREE.Euler();
  }

  clearModel() {
    for (const c of [...this.body.children]) this.body.remove(c);
    this.wheels = [];
    this.nozzles = [];
  }

  buildPlaceholder() {
    this.clearModel();
    const H = -0.62; // ground level in car space
    // side profile, z forward
    const prof = [
      [-2.28, 0.26], [2.22, 0.24], [2.32, 0.36], [2.18, 0.5], [1.3, 0.72], [0.62, 0.8],
      [-0.8, 0.86], [-1.7, 0.9], [-2.22, 0.84], [-2.3, 0.6],
    ];
    const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.14, bevelSegments: 4, steps: 1, curveSegments: 4 });
    bodyGeo.translate(0, 0, -0.81);
    bodyGeo.rotateY(Math.PI / 2); // shape x -> world z
    bodyGeo.scale(-1, 1, 1);
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, this.paint);
    body.position.y = H + 0.02;
    this.body.add(body);
    const glassProf = [[0.66, 0.8], [0.05, 1.2], [-0.75, 1.22], [-1.45, 0.9], [-1.4, 0.82], [0.6, 0.78]];
    const gShape = new THREE.Shape(glassProf.map(([z, y]) => new THREE.Vector2(z, y)));
    const glassGeo = new THREE.ExtrudeGeometry(gShape, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 4 });
    glassGeo.translate(0, 0, -0.6);
    glassGeo.rotateY(Math.PI / 2);
    glassGeo.scale(-1, 1, 1);
    glassGeo.computeVertexNormals();
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({ color: 0x0a0d14, metalness: 0.2, roughness: 0.05, clearcoat: 1 }));
    glass.position.y = H + 0.02;
    this.body.add(glass);
    // light strips
    const strip = (w, color, z, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.06), new THREE.MeshBasicMaterial({ color }));
      m.position.set(0, H + y, z);
      this.body.add(m);
      return m;
    };
    strip(1.5, new THREE.Color(1.5, 1.6, 1.9), 2.3, 0.5);
    this.tail = strip(1.7, new THREE.Color(3, 0.1, 0.12), -2.42, 0.66);
    // wheels
    const tyre = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.8 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.25, metalness: 0.9 });
    for (const [x, z] of [[0.9, 1.42], [-0.9, 1.42], [0.92, -1.42], [-0.92, -1.42]]) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.3, 20), tyre);
      t.rotation.z = Math.PI / 2;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.32, 12), rim);
      r.rotation.z = Math.PI / 2;
      w.add(t, r);
      w.position.set(x, H + 0.37, z);
      w.userData = { front: z > 0, axis: 'x' };
      this.body.add(w);
      this.wheels.push(w);
    }
    // thruster nozzles: two rear (boost) and four under the sills (lift)
    const nozMat = new THREE.MeshStandardMaterial({ color: 0x30333a, metalness: 0.9, roughness: 0.3, emissive: new THREE.Color(0, 0, 0) });
    const add = (pos, dir) => {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.25, 12, 1, true), nozMat.clone());
      n.position.set(...pos);
      if (dir === 'boost') n.rotation.x = Math.PI / 2;
      this.body.add(n);
      this.addNozzle(n, dir, CarView.DIRS[dir]);
    };
    add([0.45, H + 0.42, -2.36], 'boost');
    add([-0.45, H + 0.42, -2.36], 'boost');
    for (const [x, z] of [[0.62, 0.7], [-0.62, 0.7], [0.62, -0.75], [-0.62, -0.75]]) add([x, H + 0.2, z], 'lift');
  }

  // kind: 'lift' | 'boost' | 'sideL' | 'sideR'; dir: exhaust direction in car space
  addNozzle(obj, kind, dir, glowMats = []) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(kind === 'boost' ? 0.2 : 0.15, 1.6, 12, 1, true), new THREE.MeshBasicMaterial({ map: this.flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.3, 1.5, 1.9) }));
    flame.geometry.translate(0, -0.8, 0); // the cone grows along -y from the nozzle
    flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    flame.visible = false;
    // side jets often point straight at a camera, where an additive cone stacks into a bright square
    if (kind === 'sideL' || kind === 'sideR') flame.material.opacity = 0.3;
    this.body.add(flame);
    if (!glowMats.length && obj.isMesh) glowMats = [obj.material];
    this.nozzles.push({ obj, kind, dir: dir.clone(), flame, glowMats, glow: 0 });
  }

  // placeholder nozzles call addNozzle with these directions
  static DIRS = { lift: new THREE.Vector3(0, -1, 0), boost: new THREE.Vector3(0, 0, -1) };

  // Swap in the Blender model (see ../car/out/NOTES.md): metres, +Y up, nose toward -Z,
  // tyres touching y = 0, wheel_* spin about local X, thruster_* carry extras.exhaust_dir.
  async loadModel(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    this.clearModel();
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI; // glTF nose -Z -> car space nose +Z
    holder.position.y = -0.62; // ground in car space (ride height)
    holder.add(model);
    this.body.add(holder);
    this.model = model;
    this.body.updateMatrixWorld(true);
    const toBody = (v) => new THREE.Vector3(-v.x, v.y, -v.z); // model space -> car space
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.name === 'paint_red') { m.envMapIntensity = 2.8; m.clearcoatRoughness = Math.max(m.clearcoatRoughness || 0, 0.14); this.paint = m; }
      if (m.name === 'glass_tint') { m.envMapIntensity = 0.7; m.roughness = Math.max(m.roughness, 0.18); } // a mirror canopy shows the env panels as hot squares
      if (m.name === 'led_white') {
        m.emissiveIntensity = 3.5; // authored for Cycles; bloom needs less
        // the cabin's screen shares this material with the headlight strips and blooms through
        // the glass: move the triangles inside the cabin onto a dim copy
        const g = o.geometry, idx = g.index, pos = g.attributes.position;
        if (idx) {
          const keep = [], dim = [], v = new THREE.Vector3();
          for (let i = 0; i < idx.count; i += 3) {
            v.set(0, 0, 0);
            for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + k)));
            v.divideScalar(3);
            (Math.abs(v.z) < 1.3 && v.y > 0.3 ? dim : keep).push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
          }
          if (dim.length) {
            g.setIndex(keep.concat(dim));
            g.clearGroups();
            g.addGroup(0, keep.length, 0);
            g.addGroup(keep.length, dim.length, 1);
            const d = m.clone();
            d.emissiveIntensity = 0.25;
            o.material = [m, d];
          }
        }
      }
      if (m.name === 'tail_red') { o.material = m.clone(); this.tailMat = o.material; this.tailBase = 3.5; }
    });
    for (const name of ['FL', 'FR', 'RL', 'RR']) {
      const w = model.getObjectByName('wheel_' + name);
      if (w) { w.rotation.order = 'YXZ'; w.userData = { front: name[0] === 'F', spin: true }; this.wheels.push(w); }
      const c = model.getObjectByName('caliper_' + name);
      if (c && name[0] === 'F') { c.rotation.order = 'YXZ'; c.userData = { front: true, spin: false }; this.wheels.push(c); }
    }
    model.traverse((o) => {
      if (!/^thruster_/.test(o.name) || /^thruster_/.test(o.parent.name)) return;
      const glowMats = [];
      o.traverse((m) => {
        if (m.isMesh && m.material.name === 'thruster_glow') { m.material = m.material.clone(); m.material.emissiveIntensity = 0; glowMats.push(m.material); }
      });
      const ed = o.userData.exhaust_dir;
      const dir = toBody(ed ? new THREE.Vector3(...ed) : new THREE.Vector3(0, -1, 0)).normalize();
      const kind = /rear/.test(o.name) ? 'boost' : /under/.test(o.name) ? 'lift' : /side_L/.test(o.name) ? 'sideL' : 'sideR';
      const anchor = new THREE.Object3D();
      this.body.add(anchor);
      anchor.position.copy(this.body.worldToLocal(o.getWorldPosition(new THREE.Vector3())));
      this.addNozzle(anchor, kind, dir, glowMats);
    });
    this.headlight.position.set(0, -0.15, 2.45); // just ahead of the nose, or it lights the cabin
    this.key.intensity = 0; // its highlight on the mirror-smooth canopy blooms into a hot spot
    return true;
  }

  update(dt, car, input, fx, time) {
    this.root.position.copy(car.p);
    this.root.quaternion.copy(car.quat);
    // body lean: pitch with acceleration, roll with steering
    const sp = car.v.dot(car.f);
    const want = car.grounded ? { x: -(input.throttle || 0) * 0.025, z: -car.steerVis * Math.min(1, Math.abs(sp) / 20) * 0.05 } : { x: 0, z: 0 };
    this.tilt.x += (want.x - this.tilt.x) * Math.min(1, dt * 6);
    this.tilt.z += (want.z - this.tilt.z) * Math.min(1, dt * 6);
    this.body.rotation.set(this.tilt.x, 0, this.tilt.z);
    const steer = car.steerVis * 0.38;
    for (const w of this.wheels) {
      if (this.model) {
        // model space: spin about local X (negative = rolling forward), steer about Y
        w.rotation.set(w.userData.spin ? -car.wheelSpin : 0, w.userData.front ? steer : 0, 0);
      } else {
        w.rotation.order = 'YXZ';
        w.rotation.set(car.wheelSpin, w.userData.front ? steer : 0, 0);
      }
    }
    // thrusters: glow, flames and exhaust particles
    const lift = car.firing.lift, boost = car.firing.boost;
    this.kick = Math.max(0, (this.kick || 0) - dt * 4);
    this.sideKick = Math.max(0, (this.sideKick || 0) - dt * 3);
    const airSteer = car.grounded ? 0 : input.steer || 0;
    const tmp = new THREE.Vector3(), dirW = new THREE.Vector3();
    for (const nz of this.nozzles) {
      const on = nz.kind === 'lift' ? Math.max(lift, this.kick)
        : nz.kind === 'boost' ? boost
          : Math.max(this.sideKick, Math.max(0, nz.kind === 'sideL' ? -airSteer : airSteer) * 0.7);
      nz.glow += (on - nz.glow) * Math.min(1, dt * 12);
      const f = nz.flame;
      f.visible = nz.glow > 0.03;
      f.position.copy(nz.obj.position);
      const flick = 0.8 + Math.random() * 0.35;
      const len = (nz.kind === 'boost' ? 1.7 : nz.kind === 'lift' ? 1.25 : 0.45) * nz.glow * flick;
      f.scale.set(nz.glow * (0.9 + Math.random() * 0.2), len, nz.glow * (0.9 + Math.random() * 0.2));
      for (const m of nz.glowMats) {
        if (this.model) m.emissiveIntensity = (nz.kind === 'sideL' || nz.kind === 'sideR' ? 2 : 5) * nz.glow; // higher blooms into a square
        else m.emissive.setRGB(3 * nz.glow, 1.2 * nz.glow, 0.4 * nz.glow);
      }
      if (nz.glow > 0.2 && fx && nz.kind !== 'sideL' && nz.kind !== 'sideR') {
        nz.obj.getWorldPosition(tmp);
        dirW.copy(nz.dir).applyQuaternion(this.root.quaternion);
        const n = nz.kind === 'lift' ? (Math.random() < 0.6 ? 1 : 0) : 2;
        for (let i = 0; i < n; i++) {
          const v = dirW.clone().multiplyScalar(14 + Math.random() * 8).add(car.v.clone().multiplyScalar(0.6));
          v.x += (Math.random() - 0.5) * 3; v.y += (Math.random() - 0.5) * 3; v.z += (Math.random() - 0.5) * 3;
          fx.spawn(tmp.clone().addScaledVector(dirW, 0.4), v, { life: 0.35 + Math.random() * 0.25, size: nz.kind === 'lift' ? 1.1 : 1.4, color: [0.22, 0.32, 0.5], drag: 3.5, cold: true });
        }
      }
    }
    this.under.intensity += ((car.grounded ? 6 : 0) - this.under.intensity) * Math.min(1, dt * 8); // underglow only near a surface
    const braking = (input.throttle || 0) < 0 && car.grounded;
    if (this.tail) this.tail.material.color.setRGB(braking ? 3 : 1.6, 0.06, 0.08);
    if (this.tailMat) this.tailMat.emissiveIntensity = this.tailBase * (braking ? 2.5 : 1);
  }
}
