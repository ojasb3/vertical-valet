// Hand-designed routes. Units are metres; +y is up. Every building is an axis-aligned box.
// A box is [minX, minY, minZ, maxX, maxY, maxZ]. Building faces stick to the car's tyres,
// except faces listed in `noStick` (bay interiors), and undersides never stick.
//
// The garage bay is cut into a tower facade: the car climbs the facade below it, rolls over
// the lip onto the bay floor and stops nose-in. `bay.face` is the facade normal.

function towerWithBay({ x0, z0, x1, z1, h, face, bayY, bayAt, bayW = 9, bayH = 5.5, bayD = 11 }) {
  // Splits a tower into blocks around a recessed bay on one face.
  // face: '+x' | '-x' | '+z' | '-z'; bayAt: centre of the bay along the facade.
  const boxes = [];
  const ax = face[1]; // axis of the facade normal
  const sign = face[0] === '+' ? 1 : -1;
  const lat = ax === 'x' ? 'z' : 'x'; // axis along the facade
  const lo = { x: x0, z: z0 }, hi = { x: x1, z: z1 };
  const faceV = sign > 0 ? hi[ax] : lo[ax];
  const backV = faceV - sign * bayD;
  const l0 = bayAt - bayW / 2, l1 = bayAt + bayW / 2;
  const mk = (a0, a1, b0, b1, y0, y1, noStick = []) => {
    // a = facade-normal axis range, b = lateral axis range
    const r = ax === 'x' ? [a0, y0, b0, a1, y1, b1] : [b0, y0, a0, b1, y1, a1];
    boxes.push({ b: r, noStick, top: h, group: "tower" });
  };
  const aIn = [Math.min(faceV, backV), Math.max(faceV, backV)];
  const aAll = [lo[ax], hi[ax]];
  const sideNear = (sign > 0 ? '+' : '-') + ax;
  // lower block (its top is the bay floor)
  mk(aAll[0], aAll[1], lo[lat], hi[lat], 0, bayY);
  // upper block
  mk(aAll[0], aAll[1], lo[lat], hi[lat], bayY + bayH, h);
  // pillars either side of the bay
  mk(aAll[0], aAll[1], lo[lat], l0, bayY, bayY + bayH, ['+' + lat]);
  mk(aAll[0], aAll[1], l1, hi[lat], bayY, bayY + bayH, ['-' + lat]);
  // back wall of the bay
  const back = sign > 0 ? [aAll[0], backV] : [backV, aAll[1]];
  mk(back[0], back[1], l0, l1, bayY, bayY + bayH, [sideNear]);
  const centre = { x: 0, y: bayY, z: 0 };
  centre[ax] = faceV - sign * (bayD * 0.55);
  centre[lat] = bayAt;
  const inward = { x: 0, y: 0, z: 0 };
  inward[ax] = -sign;
  return {
    boxes,
    bay: {
      centre: [centre.x, centre.y, centre.z], inward: [inward.x, inward.y, inward.z],
      face, faceV, backV, l0, l1, lat, ax, y: bayY, h: bayH, w: bayW, d: bayD,
    },
  };
}

const ALL_FACES = ["+x", "-x", "+y", "+z", "-z"];
const glass = (b) => ({ b, noStick: ALL_FACES, glass: true });

function lvl(def) {
  const t = towerWithBay(def.tower);
  const boxes = def.buildings.map((b) => (Array.isArray(b) ? { b, noStick: [] } : b)).concat(t.boxes);
  return { ...def, boxes, bay: t.bay };
}

export const LEVELS = [
  lvl({
    id: 1,
    name: 'FIRST CLIMB',
    hint: 'Drive into a wall to stick to it. Climb, jump the gap, roll into your bay.',
    par: 25,
    start: { p: [0, 0, -40], heading: [0, 0, 1] },
    buildings: [
      [-16, 0, 20, 16, 26, 50], // A: climb its face, cross the roof
      [-60, 0, -20, -24, 38, 60],
      [24, 0, -10, 62, 44, 48],
      [-70, 0, 70, -30, 55, 120],
      [34, 0, 66, 80, 60, 118],
    ],
    tower: { x0: -18, z0: 64, x1: 18, z1: 96, h: 120, face: '-z', bayY: 62, bayAt: 4 },
  }),
  lvl({
    id: 2,
    name: 'THE CANYON',
    hint: 'Wall-jump across the street. Each side is taller than the last.',
    par: 60,
    start: { p: [0, 0, -30], heading: [0, 0, 1] },
    buildings: [
      [12, 0, 0, 44, 36, 44], // R1
      glass([-48, 0, 14, -12, 80, 56]), // no grip: jump past it
      [-48, 0, 60, -12, 70, 100], // L1
      [12, 0, 86, 46, 108, 130], // R2
      [-52, 0, -40, -12, 22, 10],
      [12, 0, -50, 40, 16, -10],
      [-56, 0, 104, -14, 90, 140],
    ],
    tower: { x0: -26, z0: 146, x1: 26, z1: 186, h: 210, face: "-z", bayY: 156, bayAt: 4 },
  }),
  lvl({
    id: 3,
    name: 'SKY DOCK',
    hint: 'Long gaps: hold JUMP in the air to fire the lift thrusters. Watch your fuel.',
    par: 80,
    start: { p: [0, 0, -30], heading: [0, 0, 1] },
    buildings: [
      [-14, 0, 10, 14, 42, 40], // S1 straight ahead
      glass([-8, 0, 44, 10, 125, 76]), // glass spire in the middle of the route
      [-60, 0, 30, -26, 90, 70], // S2 left
      [30, 0, 60, 66, 140, 100], // S3 right
      [-62, 0, 110, -28, 190, 150], // S4 left
      [44, 0, 150, 80, 236, 196], // S5 right, beside the dock alley
      [-30, 0, -60, -12, 30, -20],
      [16, 0, -60, 40, 24, -16],
      [-90, 0, 160, -70, 120, 210],
    ],
    tower: { x0: -10, z0: 150, x1: 28, z1: 200, h: 300, face: '+x', bayY: 246, bayAt: 175 },
  }),
];

// Far skyline: decoration that also collides (so nothing is fake), generated per level.
export function skyline(level, rand) {
  const out = [];
  const taken = level.boxes.map((o) => o.b);
  const overlaps = (b) => taken.some((t) => b[0] < t[3] + 6 && b[3] > t[0] - 6 && b[2] < t[5] + 6 && b[5] > t[2] - 6);
  for (let i = 0; i < 260; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 110 + rand() * 340;
    const cx = Math.cos(ang) * r, cz = 80 + Math.sin(ang) * r;
    const w = 14 + rand() * 26, d = 14 + rand() * 26;
    const h = 20 + Math.pow(rand(), 1.6) * (r > 250 ? 260 : 160);
    const b = [cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2];
    if (Math.abs(cx) < 13 && cz > -120 && cz < 260) continue; // keep the main street open
    if (overlaps(b)) continue;
    taken.push(b);
    out.push({ b, noStick: [], deco: true });
  }
  return out;
}
