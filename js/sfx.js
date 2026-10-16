// Minimal WebAudio foley: shovel scrapes, picks, tamps, pours — plus soft wind.
export class SFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this._lastDig = 0; this._lastPack = 0; this._lastPour = 0;
  }
  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // noise buffer reused by every one-shot
    const len = this.ctx.sampleRate * 1.0;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // wind bed
    const wind = this.ctx.createBufferSource();
    wind.buffer = this.noise; wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
    const wg = this.ctx.createGain(); wg.gain.value = 0.055;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  burst({ freq = 700, q = 1.2, dur = 0.16, gain = 0.25, type = 'bandpass', sweep = 0.5 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(90, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  dig(dt) {
    const now = performance.now();
    if (now - this._lastDig < 320) return;
    this._lastDig = now;
    this.burst({ freq: 640 + Math.random() * 260, q: 1.1, dur: 0.20, gain: 0.20, sweep: 0.45 });
    if (Math.random() < 0.5) this.burst({ freq: 1500, q: 3.0, dur: 0.09, gain: 0.09, sweep: 0.7 });
  }
  pick() {
    const now = performance.now();
    if (now - this._lastDig < 340) return;
    this._lastDig = now;
    this.burst({ freq: 2600, q: 6.0, dur: 0.10, gain: 0.16, sweep: 0.35 });
    this.burst({ freq: 420, q: 1.4, dur: 0.22, gain: 0.18, sweep: 0.5 });
  }
  pack(dt) {
    const now = performance.now();
    if (now - this._lastPack < 260) return;
    this._lastPack = now;
    this.burst({ freq: 300, q: 1.0, dur: 0.13, gain: 0.28, type: 'lowpass', sweep: 0.55 });
    this.burst({ freq: 1100, q: 2.2, dur: 0.07, gain: 0.10, sweep: 0.6 });
  }
  shave(dt) {
    const now = performance.now();
    if (now - this._lastPack < 200) return;
    this._lastPack = now;
    this.burst({ freq: 1900, q: 1.6, dur: 0.12, gain: 0.11, sweep: 0.8 });
  }
  rake() { this.burst({ freq: 2400, q: 1.4, dur: 0.22, gain: 0.09, sweep: 0.6 }); }
  pour(dt) {
    const now = performance.now();
    if (now - this._lastPour < 420) return;
    this._lastPour = now;
    this.burst({ freq: 900, q: 0.7, dur: 0.28, gain: 0.13, type: 'lowpass', sweep: 0.6 });
  }
}
