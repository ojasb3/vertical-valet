// HTML overlay: gauges, home marker, radio display, toasts, title, pause and results.
import * as THREE from 'three';
import { LEVELS } from './levels.js';
import { TUNING } from './physics.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };

export class Hud {
  constructor(root, { mobile }) {
    this.root = root;
    this.mobile = mobile;
    root.innerHTML = `
      <div class="hud-play">
        <div class="tl"><div class="lvl"></div><div class="timer">00:00.0</div></div>
        <button class="radio" aria-label="Change radio station"><div class="r-freq"></div><div class="r-name"></div><div class="r-hint">${mobile ? 'tap to tune' : 'Q to tune'}</div></button>
        <div class="marker"><div class="m-ring"></div><div class="m-arrow"></div><div class="m-text"></div></div>
        <div class="ladder"><div class="l-home"><span>HOME</span></div><div class="l-car"></div><div class="l-fill"></div></div>
        <div class="bl"><div class="speed"><span class="sv">0</span><span class="su">km/h</span></div><div class="alt">ALT <b>0</b> m</div></div>
        <div class="fuel"><div class="f-label">THRUST FUEL</div><div class="f-bar"><div class="f-fill"></div></div></div>
        <div class="toast"></div>
        <div class="station-pop"><div class="sp-freq"></div><div class="sp-name"></div><div class="sp-tag"></div></div>
      </div>
      <div class="parked-ov">
        <div class="pk-title"><span class="w1">PARKED.</span><span class="w2">HOME.</span></div>
        <div class="card">
          <div class="row"><span>Time</span><b class="c-time"></b></div>
          <div class="row"><span>Precision</span><b class="c-prec"></b></div>
          <div class="row"><span>Fuel left</span><b class="c-fuel"></b></div>
          <div class="row total"><span>Score</span><b class="c-score"></b></div>
          <div class="c-best"></div>
          <div class="btns"><button class="b-retry">Retry</button><button class="b-next primary">Next level</button></div>
        </div>
      </div>
      <div class="pause-ov"><div class="p-box"><h2>PAUSED</h2><button class="b-resume primary">Resume</button><button class="b-restart">Restart level</button><button class="b-menu">Menu</button></div></div>
      <div class="title-ov">
        <div class="t-inner">
          <div class="logo"><span class="l1">VERTICAL</span><span class="l2">VALET</span></div>
          <div class="tagline">Your parking spot is on the side of a skyscraper.<br>Drive up the walls. Park it.</div>
          <button class="b-play primary">PLAY</button>
          <div class="levels"></div>
          <div class="help">${mobile
            ? '<b>Left thumb</b> steer + drive · <b>JUMP</b> tap to leap, hold for lift · <b>BOOST</b> rockets · tap the <b>radio</b>'
            : '<b>W A S D</b> drive · <b>Space</b> jump, hold for lift thrusters · <b>Shift</b> boost · <b>Q</b> radio · <b>R</b> restart · <b>Esc</b> pause'}</div>
        </div>
      </div>`;
    this.q = (s) => root.querySelector(s);
    this.toastEl = this.q('.toast');
    this.toastT = 0;
    this.marker = this.q('.marker');
    this.q('.radio').addEventListener('click', (e) => { e.stopPropagation(); this.onRadio && this.onRadio(); });
    this.q('.b-retry').addEventListener('click', () => this.onRetry && this.onRetry());
    this.q(".b-next").addEventListener("click", () => (this.hasNext ? this.onNext && this.onNext() : this.onRetry && this.onRetry()));
    this.q('.b-resume').addEventListener('click', () => this.onResume && this.onResume());
    this.q('.b-restart').addEventListener('click', () => this.onRetry && this.onRetry());
    this.q('.b-menu').addEventListener('click', () => this.onMenu && this.onMenu());
    this.q('.b-play').addEventListener('click', () => this.onStart && this.onStart(this.selected || 0));
    this.selected = 0;
    this.v = new THREE.Vector3();
  }

  setLevel(level) {
    this.level = level;
    this.q('.lvl').textContent = `LEVEL ${level.id} · ${level.name}`;
  }

  toast(text, dur = 2, cls = '') {
    this.toastEl.textContent = text;
    this.toastEl.className = 'toast show ' + cls;
    this.toastT = dur;
  }

  radio(st, silent) {
    this.q('.r-freq').textContent = st.freq ? st.freq + ' FM' : '';
    this.q('.r-name').textContent = st.name;
    this.q('.radio').style.setProperty('--sc', st.color);
    if (silent) return;
    const p = this.q('.station-pop');
    p.style.setProperty('--sc', st.color);
    this.q('.sp-freq').textContent = st.freq ? st.freq + ' FM' : '';
    this.q('.sp-name').textContent = st.name;
    this.q('.sp-tag').textContent = st.tag;
    this.popT = 0; // animated in update() from game time, so recordings stay in sync
  }

  showTitle(on, save = {}) {
    this.root.classList.toggle('title', on);
    if (!on) return;
    const box = this.q('.levels');
    box.innerHTML = '';
    LEVELS.forEach((l, i) => {
      const b = el('button', 'lv' + (i === this.selected ? ' sel' : ''), `<span class="n">${l.id}</span><span class="nm">${l.name}</span><span class="best">${save['L' + l.id] ? 'BEST ' + save['L' + l.id] : 'NEW'}</span>`);
      b.addEventListener('click', () => { this.selected = i; this.onStart && this.onStart(i); });
      box.appendChild(b);
    });
  }

  showPause(on) { this.root.classList.toggle('paused', on); }

  showResult(r) {
    if (!r) this.root.classList.remove('parked');
  }

  parked(r, hasNext) {
    this.root.classList.add('parked');
    this.q('.c-time').textContent = fmt(r.time);
    this.q('.c-prec').textContent = `${r.precision}%  (${r.offset.toFixed(2)} m, ${r.heading.toFixed(1)}°)`;
    this.q('.c-fuel').textContent = `${Math.round(r.fuel)}%`;
    this.q('.c-score').textContent = r.score;
    this.q('.c-best').textContent = r.newBest ? 'NEW BEST' : `Best ${r.best}`;
    this.q('.b-next').textContent = hasNext ? 'Next level' : 'Play again';
    this.hasNext = hasNext;
  }

  // In capture mode CSS animations follow the game clock, so recorded frames stay in sync.
  syncAnimations(clock) {
    this.animStart ||= new WeakMap();
    for (const a of document.getAnimations()) {
      if (!this.animStart.has(a)) { this.animStart.set(a, clock); a.pause(); }
      a.currentTime = (clock - this.animStart.get(a)) * 1000;
    }
  }

  update(game, car, camera, dt) {
    if (this.capture) this.syncAnimations(game.time);
    if (this.popT !== undefined && this.popT !== null) {
      const t = (this.popT += dt), p = this.q('.station-pop');
      const k = Math.min(1, t / 0.26);
      p.style.opacity = t < 1.95 ? k : Math.max(0, 1 - (t - 1.95) / 0.65);
      p.style.transform = `translate(-50%, ${(1 - k) * 10}px) scale(${0.96 + 0.04 * k})`;
      if (t > 2.6) this.popT = null;
    }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('show'); }
    if (!game.level) return;
    this.q('.timer').textContent = fmt(game.t);
    this.q('.sv').textContent = Math.round(car.speed * 3.6);
    const alt = Math.max(0, car.p.y - TUNING.rideHeight);
    this.q('.alt b').textContent = Math.round(alt);
    const fuel = car.fuel / TUNING.fuelMax;
    const ff = this.q('.f-fill');
    ff.style.transform = `scaleX(${fuel})`;
    this.q('.fuel').classList.toggle('low', fuel < 0.2);
    this.q('.fuel').classList.toggle('burn', !!(car.firing.lift || car.firing.boost));
    // altitude ladder: car vs home height
    const bay = game.level.bay;
    const top = bay.y * 1.12;
    this.q('.l-home').style.bottom = `${(bay.y / top) * 100}%`;
    this.q('.l-car').style.bottom = `${Math.min(1, alt / top) * 100}%`;
    this.q('.l-fill').style.height = `${Math.min(1, alt / top) * 100}%`;
    // home marker: on the bay when visible, clamped to the screen edge otherwise
    const w = innerWidth, h = innerHeight;
    const v = this.v.set(...bay.centre);
    v.y += 2.5;
    const dist = v.distanceTo(car.p);
    v.project(camera);
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const m = 46, mTop = this.mobile ? 190 : 96, mBot = this.mobile ? 280 : 110;
    const inside = !behind && x > m && x < w - m && y > mTop && y < h - mBot;
    const cx = Math.min(w - m, Math.max(m, x)), cy = Math.min(h - mBot, Math.max(mTop, y));
    this.marker.style.transform = `translate(${cx}px, ${cy}px)`;
    this.marker.classList.toggle('edge', !inside);
    const ang = Math.atan2(y - h / 2, x - w / 2);
    this.q('.m-arrow').style.transform = `rotate(${ang}rad)`;
    const dy = bay.y - alt;
    this.q('.m-text').textContent = game.state === 'parked' ? '' : `HOME ${Math.round(dist)} m${Math.abs(dy) > 3 ? (dy > 0 ? ' ▲' : ' ▼') : ''}`;
    this.marker.style.opacity = game.state === 'play' ? 1 : 0;
  }
}
