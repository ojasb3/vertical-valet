// Touch controls: a floating stick under the left thumb (steer + drive),
// JUMP (tap to leap, hold for lift thrust) and BOOST on the right.
export class Touch {
  constructor(input, root, { onRadio, onReset, onPause }) {
    this.input = input;
    root.innerHTML = `
      <div class="t-stick-zone"><div class="t-base"><div class="t-knob"></div></div><div class="t-hint">drag to steer &amp; drive</div></div>
      <button class="t-btn t-jump"><span>JUMP</span><small>hold = lift</small></button>
      <button class="t-btn t-boost"><span>BOOST</span></button>
      <div class="t-top"><button class="t-small t-reset" aria-label="Restart">↺</button><button class="t-small t-pause" aria-label="Pause">II</button></div>`;
    const zone = root.querySelector('.t-stick-zone');
    const base = root.querySelector('.t-base');
    const knob = root.querySelector('.t-knob');
    let id = null, ox = 0, oy = 0;
    const R = 60;
    const t = input.touch;
    zone.addEventListener('pointerdown', (e) => {
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      zone.setPointerCapture(id);
      base.style.left = ox + 'px'; base.style.top = oy + 'px';
      zone.classList.add('active');
      t.active = true;
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = dx / R, sy = -dy / R;
      t.steer = -Math.sign(sx) * Math.min(1, Math.max(0, Math.abs(sx) - 0.12) / 0.75);
      // a small push forward already drives; pull back to brake/reverse
      t.throttle = sy > 0.15 ? 1 : sy < -0.35 ? -1 : 0;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; t.steer = 0; t.throttle = 0;
      knob.style.transform = '';
      zone.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    const hold = (sel, key) => {
      const b = root.querySelector(sel);
      b.addEventListener('pointerdown', (e) => { t[key] = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); e.preventDefault(); });
      const up = () => { t[key] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    };
    hold('.t-jump', 'jump');
    hold('.t-boost', 'boost');
    root.querySelector('.t-reset').addEventListener('click', onReset);
    root.querySelector('.t-pause').addEventListener('click', onPause);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
