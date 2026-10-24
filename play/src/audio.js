// Sound: synthesized car sounds (no files) and the in-car radio.
//
// Radio songs: each station lists files to try in order. To use the real songs, drop
// station-rock.mp3 / station-synthwave.mp3 / station-chill.mp3 (or .ogg) into assets/radio/
// (or run `node tools/import-music.mjs`). Until then the placeholder loops play.
export const STATIONS = [
  { id: 'rock', name: 'WALLRIDE', freq: '104.7', tag: 'Rock for climbing towers at full thrust', color: '#ff5a3c',
    files: ['assets/radio/station-rock.mp3', 'assets/radio/station-rock.ogg', 'assets/radio/placeholder-rock.mp3'] },
  { id: 'synthwave', name: 'NEON CLIMB', freq: '88.8', tag: 'Synthwave after midnight', color: '#ff3bd4',
    files: ['assets/radio/station-synthwave.mp3', 'assets/radio/station-synthwave.ogg', 'assets/radio/placeholder-synthwave.mp3'] },
  { id: 'chill', name: 'SKYLINE LOUNGE', freq: '96.1', tag: 'Chill for precision parking', color: '#3de0ff',
    files: ['assets/radio/station-chill.mp3', 'assets/radio/station-chill.ogg', 'assets/radio/placeholder-chill.mp3'] },
  { id: 'off', name: 'RADIO OFF', freq: '', tag: '', color: '#8890a0', files: [] },
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.station = 0;
    this.buffers = {};
    this.epoch = 0;
    this.muted = false;
  }

  // Must be called from a user gesture (browsers block audio until then).
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    // radio bus: a touch of car-speaker EQ
    this.radioBus = ctx.createGain();
    this.radioBus.gain.value = 0.55;
    const lo = ctx.createBiquadFilter();
    lo.type = 'highpass'; lo.frequency.value = 55;
    const hi = ctx.createBiquadFilter();
    hi.type = 'lowshelf'; hi.frequency.value = 180; hi.gain.value = 3;
    this.radioBus.connect(lo).connect(hi).connect(this.master);

    // noise source shared by thrusters and wind
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // engine: two detuned oscillators through a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 500; this.engFilter.Q.value = 4;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.detune.value = -1200;
    const o2g = ctx.createGain(); o2g.gain.value = 0.5;
    this.osc1.connect(this.engFilter); this.osc2.connect(o2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.osc1.start(); this.osc2.start();
    // electric whine on top (it is an electric roadster after all)
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.sfx); this.whine.start();

    // thruster roar
    this.thrGain = ctx.createGain(); this.thrGain.gain.value = 0;
    this.thrFilter = ctx.createBiquadFilter(); this.thrFilter.type = 'bandpass'; this.thrFilter.frequency.value = 700; this.thrFilter.Q.value = 0.7;
    loopNoise().connect(this.thrFilter).connect(this.thrGain).connect(this.sfx);
    // wind
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400;
    loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.sfx);

    this.epoch = ctx.currentTime;
    this.tune(this.station, true);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  update(car, input, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = car.speed;
    const th = Math.abs(input.throttle || 0);
    const on = car.grounded ? 1 : 0.5;
    this.osc1.frequency.setTargetAtTime(38 + sp * 2.4 + th * 18, t, 0.06);
    this.osc2.frequency.setTargetAtTime(38 + sp * 2.4 + th * 18, t, 0.06);
    this.engFilter.frequency.setTargetAtTime(300 + th * 900 + sp * 20, t, 0.08);
    this.engGain.gain.setTargetAtTime((0.035 + th * 0.05) * on, t, 0.08);
    this.whine.frequency.setTargetAtTime(300 + sp * 38, t, 0.05);
    this.whineGain.gain.setTargetAtTime(Math.min(0.025, sp * 0.0009) * on, t, 0.1);
    const fire = Math.max(car.firing.lift, car.firing.boost);
    this.thrGain.gain.setTargetAtTime(fire * 0.32, t, 0.04);
    this.thrFilter.frequency.setTargetAtTime(car.firing.boost ? 1300 : 650, t, 0.05);
    const wind = Math.min(1, sp / 45) * (car.grounded ? 0.5 : 1);
    this.windGain.gain.setTargetAtTime(wind * wind * 0.22, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + wind * 1600, t, 0.15);
  }

  blip({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.3, delay = 0, bus } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, f = 1000, q = 1, gain = 0.3, type = 'bandpass', delay = 0, f1 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  play(name, s = 1) {
    switch (name) {
      case 'jump':
        this.noise({ dur: 0.45, f: 400, f1: 2400, q: 0.8, gain: 0.5 });
        this.blip({ type: 'sawtooth', f0: 90, f1: 40, dur: 0.3, gain: 0.25 });
        break;
      case 'stick':
        this.blip({ type: 'sine', f0: 120, f1: 38, dur: 0.22, gain: 0.35 + s * 0.5 });
        this.noise({ dur: 0.08, f: 3200, q: 2, gain: 0.25 + s * 0.3 });
        this.blip({ type: 'square', f0: 1400, f1: 900, dur: 0.06, gain: 0.06, delay: 0.03 });
        break;
      case 'bump':
        this.blip({ type: 'sine', f0: 90, f1: 30, dur: 0.25, gain: 0.3 + s * 0.4 });
        this.noise({ dur: 0.15, f: 900, q: 0.8, gain: 0.3 * s + 0.1 });
        break;
      case 'wrap':
        this.noise({ dur: 0.12, f: 1800, q: 3, gain: 0.12 });
        break;
      case 'launch':
        this.noise({ dur: 0.6, f: 300, f1: 1200, q: 0.6, gain: 0.25 });
        break;
      case 'lowfuel':
        this.blip({ type: 'square', f0: 880, dur: 0.08, gain: 0.08 });
        this.blip({ type: 'square', f0: 660, dur: 0.08, gain: 0.08, delay: 0.1 });
        break;
      case 'inbay':
        this.blip({ type: 'triangle', f0: 1046, dur: 0.12, gain: 0.12 });
        break;
      case 'parked': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((f, i) => {
          this.blip({ type: 'triangle', f0: f, dur: 0.9, gain: 0.22, delay: i * 0.09 });
          this.blip({ type: 'sine', f0: f * 2, dur: 0.6, gain: 0.06, delay: i * 0.09 + 0.02 });
        });
        this.blip({ type: 'sine', f0: 65, f1: 60, dur: 1.4, gain: 0.35 });
        break;
      }
      case 'click':
        this.blip({ type: 'square', f0: 1200, f1: 800, dur: 0.04, gain: 0.08 });
        break;
      case 'radio':
        this.noise({ dur: 0.32, f: 2500, q: 0.5, gain: 0.28 });
        this.blip({ type: 'sine', f0: 1760, dur: 0.07, gain: 0.08, delay: 0.3 });
        break;
    }
  }

  async loadStation(i) {
    const st = STATIONS[i];
    if (this.buffers[st.id] !== undefined) return this.buffers[st.id];
    this.buffers[st.id] = null;
    for (const url of st.files) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers[st.id] = buf;
        st.loaded = url;
        return buf;
      } catch (e) { /* try the next file */ }
    }
    return null;
  }

  // GTA-style: every station keeps "playing" while you listen to another one.
  async tune(i, silent) {
    this.station = i;
    if (!this.ctx) return;
    if (!silent) this.play('radio');
    if (this.src) { const old = this.src; this.srcGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); setTimeout(() => old.stop(), 300); this.src = null; }
    const st = STATIONS[i];
    if (st.id === 'off') return;
    const buf = await this.loadStation(i);
    if (!buf || this.station !== i) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.setTargetAtTime(1, this.ctx.currentTime + 0.25, 0.1);
    if (!silent && st.ident) this.playIdent(st, g);
    s.connect(g).connect(this.radioBus);
    const offset = (this.ctx.currentTime - this.epoch + i * 17.3) % buf.duration;
    s.start(0, offset);
    this.src = s; this.srcGain = g;
  }

  // the station ident (a short jingle) plays over the song, which ducks until it ends
  async playIdent(st, songGain) {
    try {
      if (!st.identBuf) st.identBuf = await this.ctx.decodeAudioData(await (await fetch(st.ident)).arrayBuffer());
    } catch (e) { return; }
    if (this.src === null || STATIONS[this.station] !== st) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = st.identBuf;
    s.connect(this.radioBus);
    s.start(t + 0.2);
    songGain.gain.cancelScheduledValues(t);
    songGain.gain.setTargetAtTime(0.3, t, 0.05);
    songGain.gain.setTargetAtTime(1, t + 0.2 + st.identBuf.duration - 0.3, 0.25);
  }

  next() { return this.tune((this.station + 1) % STATIONS.length); }
}
