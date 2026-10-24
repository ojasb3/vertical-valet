// Keyboard input. Touch controls live in touch.js and write into the same state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.state = { throttle: 0, steer: 0, jump: false, lift: false, boost: false };
    this.touch = { throttle: 0, steer: 0, jump: false, boost: false, active: false };
    this.pressed = new Set(); // one-shot keys this frame
    this.override = null; // the test bot writes here
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.jumpHeld = false;
  }

  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  read() {
    if (this.override) return this.override;
    const k = this.keys, t = this.touch;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const jumpHeld = k.has('Space') || t.jump;
    const s = this.state;
    s.throttle = Math.max(-1, Math.min(1, (up ? 1 : 0) - (down ? 1 : 0) + t.throttle));
    s.steer = Math.max(-1, Math.min(1, (left ? 1 : 0) - (right ? 1 : 0) + t.steer));
    s.jump = jumpHeld && !this.jumpHeld; // tap: jump off a surface
    s.lift = jumpHeld; // hold: lift thrusters in the air
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight') || t.boost;
    this.jumpHeld = jumpHeld;
    return s;
  }
}
