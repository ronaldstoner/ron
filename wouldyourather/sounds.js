// Procedural WebAudio sound engine — every sound is synthesized, no files needed.
let ctx = null;
let master, comp;
let muted = false;
let noiseBuf = null;
let drumTimer = null;
let drumBeat = 0;
let drumIntensity = 0;

// real recordings (see README for credits) — synth fallback until they decode
const samples = {};
async function fetchSample(name, url) {
  try {
    const r = await fetch(url);
    const ab = await r.arrayBuffer();
    samples[name] = await ctx.decodeAudioData(ab);
  } catch (e) { console.warn('sample failed, using synth:', name, e); }
}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55; // honor a mute set before audio was initialized (?mute=1)
  master.connect(comp);
  comp.connect(ctx.destination);

  // shared white-noise buffer
  const len = ctx.sampleRate * 1.5;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  fetchSample('quack', 'sounds/quack.mp3');
  fetchSample('quack2', 'sounds/quack2.mp3');
  fetchSample('quack3', 'sounds/quack3.mp3');
  fetchSample('whinny', 'sounds/whinny.ogg');
  fetchSample('whinny2', 'sounds/whinny2.oga');
  fetchSample('whinny3', 'sounds/whinny3.oga');
  fetchSample('gallop', 'sounds/gallop.ogg');
  fetchSample('trombone', 'sounds/trombone.ogg');
  fetchSample('fanfare', 'sounds/fanfare.mp3');
  fetchSample('uiClick', 'sounds/kenney/click1.wav');
  fetchSample('uiHover', 'sounds/kenney/rollover1.wav');
  for (let i = 0; i < 5; i++) {
    fetchSample('punch' + i, `sounds/kenney/impact_punch_medium_00${i}.ogg`);
    fetchSample('punchHeavy' + i, `sounds/kenney/impact_punch_heavy_00${i}.ogg`);
    fetchSample('wood' + i, `sounds/kenney/impact_wood_heavy_00${i}.ogg`);
    fetchSample('bodySlam' + i, `sounds/kenney/impact_soft_heavy_00${i}.ogg`);
    fetchSample('light' + i, `sounds/kenney/impact_generic_light_00${i}.ogg`);
    fetchSample('grass' + i, `sounds/kenney/footstep_grass_00${i}.ogg`);
  }
  for (let i = 0; i < 3; i++) fetchSample('softMed' + i, `sounds/kenney/impact_soft_medium_00${i}.ogg`);
  for (let i = 0; i < 6; i++) fetchSample('swish' + i, `sounds/fx/swish${i}.wav`);
  fetchSample('bell', 'sounds/fx/bell.wav');
  fetchSample('round1', 'sounds/fx/round1.ogg');
  fetchSample('fightVoice', 'sounds/fx/fight.ogg');
  fetchSample('youwin', 'sounds/fx/youwin.ogg');
  fetchSample('flawless', 'sounds/fx/flawless.ogg');
  fetchSample('ooh', 'sounds/fx/ooh.ogg');
  fetchSample('cheer', 'sounds/fx/cheer.mp3');
  fetchSample('boom0', 'sounds/fx/boom0.ogg');
  fetchSample('boom1', 'sounds/fx/boom1.ogg');
  fetchSample('crunch', 'sounds/fx/crunch.ogg');
  fetchSample('flap', 'sounds/fx/flap.wav');
  fetchSample('pain', 'sounds/fx/pain.ogg').then(() => segment('pain'));
  fetchSample('effort', 'sounds/fx/effort.ogg').then(() => segment('effort'));
  // AAA upgrade pack (fx2): real drums, cleaner creatures, martial swings
  fetchSample('drumBed', 'sounds/fx2/drums_taiko.oga').then(() => { if (samples.drumBed) startDrumBed(); });
  fetchSample('whinnyS1', 'sounds/fx2/whinny_s1.oga');
  fetchSample('whinnyS3', 'sounds/fx2/whinny_s3.oga');
  fetchSample('whinnyMulti', 'sounds/fx2/whinny_multi.oga');
  fetchSample('snortReal', 'sounds/fx2/snort.oga');
  fetchSample('swing0', 'sounds/fx2/swing0.ogg');
  fetchSample('swing1', 'sounds/fx2/swing1.ogg');
  fetchSample('ruffle0', 'sounds/fx2/ruffle0.ogg');
  fetchSample('ruffle1', 'sounds/fx2/ruffle1.ogg');
  fetchSample('chop', 'sounds/fx2/chop.ogg');
  fetchSample('gong', 'sounds/fx2/gong.ogg').then(() => { if (samples.gong) samples.gongRev = reverseBuffer(samples.gong); });
}

// slice a voice-collection recording into individual grunts (silence-aware)
const segments = {};
function segment(name) {
  const buf = samples[name];
  if (!buf) return;
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = Math.floor(sr * 0.03);
  const segs = [];
  let start = -1, quiet = 0;
  for (let i = 0; i < d.length; i += win) {
    let peak = 0;
    for (let k = i; k < Math.min(i + win, d.length); k++) peak = Math.max(peak, Math.abs(d[k]));
    if (peak > 0.06) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= 5) {
      const len = (i - start) / sr;
      if (len > 0.12 && len < 2.5) segs.push([start / sr, len]);
      start = -1;
    }
  }
  if (start >= 0) segs.push([start / sr, (d.length - start) / sr]);
  segments[name] = segs;
}
function playSegment(name, { vol = 0.4, rate = 1 } = {}) {
  const buf = samples[name], segs = segments[name];
  if (!buf || !segs || !segs.length) return false;
  const [off, len] = segs[Math.floor(Math.random() * segs.length)];
  playBuf(buf, { offset: Math.max(off - 0.02, 0), dur: len / rate + 0.06, rate, vol });
  return true;
}

function pickSample(prefix, n) {
  const found = [];
  for (let i = 0; i < n; i++) if (samples[prefix + i]) found.push(samples[prefix + i]);
  return found.length ? found[Math.floor(Math.random() * found.length)] : null;
}

// play a slice of a sample; dur is wall-clock seconds. hp/lp add filtering.
function playBuf(buf, { rate = 1, vol = 0.4, offset = 0, dur = null, fadeOut = 0.09, hp = 0, lp = 0 } = {}) {
  const t0 = ctx.currentTime;
  const maxWall = (buf.duration - offset) / rate;
  const d = Math.min(dur || maxWall, maxWall);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  let node = src;
  if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (lp > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.001), t0 + 0.015);
  if (d > fadeOut + 0.03) g.gain.setValueAtTime(vol, t0 + d - fadeOut);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  node.connect(g); g.connect(master);
  src.start(t0, offset, d * rate + 0.05);
}

// reversed copy of a decoded buffer (WebAudio can't play negative playbackRate)
function reverseBuffer(buf) {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0, n = buf.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}
export function isMuted() { return muted; }

function now() { return ctx.currentTime; }

function env(g, t0, a, peak, dec, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
  g.gain.exponentialRampToValueAtTime(sus, t0 + a + dec);
}

function noise(t0, dur, { hp = 0, lp = 20000, peak = 0.3, dec = 0.15, rate = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rate;
  let node = src;
  if (lp < 20000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  const g = ctx.createGain();
  env(g, t0, 0.005, peak, dec);
  node.connect(g); g.connect(master);
  src.start(t0, Math.random() * 0.5, dur + 0.1);
  src.stop(t0 + dur + 0.15);
}

function tone(t0, { type = 'sine', f0 = 440, f1 = null, dur = 0.2, peak = 0.2, a = 0.01, vibHz = 0, vibAmt = 0, bp = null } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  let node = o;
  if (vibHz > 0) {
    const lfo = ctx.createOscillator(); lfo.frequency.value = vibHz;
    const lg = ctx.createGain(); lg.gain.value = vibAmt;
    lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.1);
  }
  if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = 1.2; node.connect(f); node = f; }
  const g = ctx.createGain();
  env(g, t0, a, peak, dur);
  node.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.2);
}

// ---------------- game sounds ----------------

// per-file onset (seconds) where the actual quack starts, so playback never begins in leading room-tone
const QUACKS = [
  { key: 'quack', onset: 1.15, len: 0.85 },
  { key: 'quack2', onset: 0.50, len: 1.0 },
  { key: 'quack3', onset: 0.38, len: 0.85 },
];
function quackBank() { return QUACKS.filter(q => samples[q.key]); }

// pitch: 1 = normal duck, ~0.35 = colossal duck. Plays a CLEAN, recognizable real quack — no filtering/smearing.
export function quack(pitch = 1, loud = 0.5) {
  if (!ctx) return;
  const bank = quackBank();
  if (bank.length) {
    const q = bank[Math.floor(Math.random() * bank.length)];
    const buf = samples[q.key];
    const giant = pitch < 0.6;
    // "big duck" = a modest pitch-down that still reads clearly as a quack (not a 0.5x mush)
    const rate = giant ? 0.72 + Math.random() * 0.12 : 0.95 + Math.random() * 0.2;
    const offset = Math.min(q.onset + Math.random() * 0.05, Math.max(buf.duration - 0.3, 0));
    playBuf(buf, { rate, vol: loud, offset, dur: q.len });
    if (giant) tone(now(), { type: 'sine', f0: 50, f1: 40, dur: 0.18, peak: loud * 0.25 }); // faint low body; the clean quack stays on top
    return;
  }
  const t0 = now();
  tone(t0, { type: 'sawtooth', f0: 340 * pitch, f1: 180 * pitch, dur: 0.16 / Math.sqrt(pitch), peak: loud * 0.5, bp: 900 * pitch, a: 0.012 });
  tone(t0 + 0.02, { type: 'square', f0: 190 * pitch, f1: 120 * pitch, dur: 0.18 / Math.sqrt(pitch), peak: loud * 0.25, bp: 600 * pitch });
  if (pitch < 0.6) { // giant duck gets a sub layer
    tone(t0, { type: 'sine', f0: 70, f1: 45, dur: 0.4, peak: loud * 0.8 });
    noise(t0, 0.25, { lp: 500, peak: loud * 0.25, dec: 0.25 });
  }
}

export function bigQuackRoar() { // charge telegraph = a few angry clean quacks in quick succession
  if (!ctx) return;
  const bank = quackBank();
  if (bank.length) {
    for (let i = 0; i < 3; i++) {
      const q = bank[Math.floor(Math.random() * bank.length)];
      setTimeout(() => { if (ctx && !muted) playBuf(samples[q.key], { rate: 0.64 + Math.random() * 0.08, vol: 0.8, offset: q.onset, dur: q.len }); }, i * 150);
    }
    tone(now(), { type: 'sine', f0: 54, f1: 34, dur: 0.6, peak: 0.5 }); // one low body swell under the roar
    return;
  }
  const t0 = now();
  for (let i = 0; i < 3; i++) {
    const p = 0.34 - i * 0.03;
    tone(t0 + i * 0.16, { type: 'sawtooth', f0: 340 * p, f1: 160 * p, dur: 0.3, peak: 0.5, bp: 800 * p });
    tone(t0 + i * 0.16, { type: 'sine', f0: 75 - i * 8, f1: 40, dur: 0.42, peak: 0.7 });
  }
}

// pitch: 1 = normal horse, ~2.2 = tiny horse
export function whinny(pitch = 2.2, loud = 0.35) {
  if (!ctx) return;
  // multi-whinny recording: grab a random natural burst from it, plus the short single-neigh files
  if (samples.whinnyMulti && Math.random() < 0.5) {
    const buf = samples.whinnyMulti;
    const off = Math.random() * Math.max(buf.duration - 1.2, 0.1);
    const rate = Math.max(1.0, Math.min(pitch * 0.6, 1.5)); // small but unmistakably a HORSE, never chipmunk
    playBuf(buf, { rate, vol: loud, offset: off, dur: 0.45 + Math.random() * 0.4, hp: 200 });
    return;
  }
  const bufs = [samples.whinnyS1, samples.whinnyS3, samples.whinny, samples.whinny2, samples.whinny3].filter(Boolean);
  if (bufs.length) {
    const buf = bufs[Math.floor(Math.random() * bufs.length)];
    // sell "tiny" with shortness + highpass, NOT extreme pitch
    const rate = Math.max(1.0, Math.min(pitch * 0.6, 1.5));
    playBuf(buf, { rate, vol: loud, dur: 0.4 + Math.random() * 0.5, hp: 200 });
    return;
  }
  const t0 = now();
  tone(t0, { type: 'sawtooth', f0: 900 * pitch, f1: 420 * pitch, dur: 0.38 / Math.sqrt(pitch / 2), peak: loud * 0.4, vibHz: 14, vibAmt: 90 * pitch, bp: 1400 * pitch, a: 0.03 });
  tone(t0 + 0.05, { type: 'triangle', f0: 1300 * pitch, f1: 600 * pitch, dur: 0.3, peak: loud * 0.2, vibHz: 16, vibAmt: 120 * pitch });
}

export function snort(pitch = 2) {
  if (!ctx) return;
  if (samples.snortReal) { playBuf(samples.snortReal, { rate: 1.1 + pitch * 0.12, vol: 0.5, hp: 150 }); return; }
  noise(now(), 0.12, { lp: 900 * pitch, hp: 200, peak: 0.18, dec: 0.1 });
}

export function gallopTick(vol = 0.1, pitch = 1) {
  if (!ctx) return;
  const buf = pickSample('grass', 5);
  if (buf) { playBuf(buf, { rate: pitch * (1.1 + Math.random() * 0.5), vol: vol * 2.2 }); return; }
  const t0 = now();
  noise(t0, 0.05, { lp: 500 * pitch, peak: vol, dec: 0.045 });
  tone(t0, { type: 'sine', f0: 150 * pitch, f1: 80 * pitch, dur: 0.06, peak: vol * 0.8 });
}

// looping stampede ambience (real recording of six galloping horses, pitched up)
let gallopSrc = null, gallopGain = null;
export function startGallop() {
  if (!ctx || gallopSrc || !samples.gallop) return;
  gallopSrc = ctx.createBufferSource();
  gallopSrc.buffer = samples.gallop;
  gallopSrc.loop = true;
  gallopSrc.playbackRate.value = 1.35; // duck-sized hooves
  gallopGain = ctx.createGain();
  gallopGain.gain.value = 0;
  gallopSrc.connect(gallopGain); gallopGain.connect(master);
  gallopSrc.start();
}
export function setGallopVol(v) {
  if (gallopGain) gallopGain.gain.setTargetAtTime(Math.min(v, 0.5), ctx.currentTime, 0.4);
}
export function stopGallop() {
  if (gallopSrc) { try { gallopSrc.stop(); } catch (e) {} gallopSrc = null; gallopGain = null; }
}

export function whoosh() {
  if (!ctx) return;
  const buf = pickSample('swish', 6);
  if (buf) { playBuf(buf, { rate: 0.85 + Math.random() * 0.4, vol: 0.4 }); return; }
  const t0 = now();
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
  f.frequency.setValueAtTime(350, t0);
  f.frequency.exponentialRampToValueAtTime(2600, t0 + 0.14);
  const g = ctx.createGain(); env(g, t0, 0.02, 0.28, 0.14);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 0.4, 0.3); src.stop(t0 + 0.3);
}

export function hitFlesh(big = false) {
  if (!ctx) return;
  const buf = pickSample(big ? 'punchHeavy' : 'punch', 5);
  if (buf) {
    playBuf(buf, { rate: 0.9 + Math.random() * 0.25, vol: big ? 0.75 : 0.5 });
    if (big) tone(now(), { type: 'sine', f0: 100, f1: 45, dur: 0.2, peak: 0.4 }); // extra weight
    return;
  }
  const t0 = now();
  noise(t0, 0.025, { hp: 2800, peak: big ? 0.3 : 0.22, dec: 0.02 }); // sharp transient crack
  tone(t0, { type: 'sine', f0: big ? 110 : 170, f1: 50, dur: big ? 0.22 : 0.12, peak: big ? 0.6 : 0.35 });
  noise(t0, 0.08, { lp: 2200, peak: big ? 0.3 : 0.2, dec: 0.06 });
}

export function woodCrash() { // fence meets duck
  if (!ctx) return;
  const b1 = pickSample('wood', 5);
  if (b1) {
    playBuf(b1, { rate: 0.85 + Math.random() * 0.2, vol: 0.7 });
    const b2 = pickSample('wood', 5);
    if (b2) setTimeout(() => ctx && playBuf(b2, { rate: 0.7, vol: 0.45 }), 90);
    return;
  }
  const t0 = now();
  noise(t0, 0.15, { lp: 1800, hp: 150, peak: 0.5, dec: 0.13 });
  tone(t0, { type: 'sine', f0: 120, f1: 45, dur: 0.3, peak: 0.5 });
}

export function thudBig() {
  if (!ctx) return;
  const t0 = now();
  const buf = pickSample('bodySlam', 5);
  if (buf) playBuf(buf, { rate: 0.8, vol: 0.7 });
  tone(t0, { type: 'sine', f0: 90, f1: 32, dur: 0.5, peak: 0.9 });
  noise(t0, 0.3, { lp: 400, peak: 0.4, dec: 0.28 });
}

export function playerHurt() {
  if (!ctx) return;
  if (Math.random() < 0.5) playSegment('pain', { vol: 0.45, rate: 0.95 + Math.random() * 0.2 });
  const buf = pickSample('softMed', 3);
  if (buf) playBuf(buf, { rate: 1.2 + Math.random() * 0.3, vol: 0.3 });
  const t0 = now();
  tone(t0, { type: 'square', f0: 300, f1: 160, dur: 0.12, peak: 0.2, bp: 700 });
  noise(t0, 0.08, { lp: 3000, hp: 300, peak: 0.15, dec: 0.07 });
}

export function bite() {
  if (!ctx) return;
  const buf = pickSample('light', 5);
  if (buf) { playBuf(buf, { rate: 1.3 + Math.random() * 0.4, vol: 0.4 }); return; }
  const t0 = now();
  noise(t0, 0.04, { hp: 2500, peak: 0.22, dec: 0.03 });
  tone(t0 + 0.01, { type: 'sine', f0: 220, f1: 90, dur: 0.07, peak: 0.22 });
}

export function ding() {
  if (!ctx) return;
  tone(now(), { type: 'triangle', f0: 1150, f1: 1150, dur: 0.35, peak: 0.15, a: 0.005 });
}

export function popFeather() {
  if (!ctx) return;
  const r = pickSample('ruffle', 2);
  if (r) { playBuf(r, { rate: 1.1 + Math.random() * 0.4, vol: 0.35, hp: 400 }); return; }
  noise(now(), 0.09, { hp: 1200, lp: 8000, peak: 0.12, dec: 0.08 });
}

// sharp air whoosh for a swung punch/kick (distinct from the connecting impact)
export function swingWhoosh(big = false) {
  if (!ctx) return;
  const s = pickSample('swing', 2);
  if (s) { playBuf(s, { rate: big ? 0.7 : 0.95 + Math.random() * 0.3, vol: big ? 0.5 : 0.35 }); return; }
  whoosh();
}

// heavy swing riser for the duck's charge / DIRECT HIT
export function chargeWhoosh() {
  if (!ctx) return;
  const s = pickSample('swing', 2);
  if (s) playBuf(s, { rate: 0.4, vol: 0.6, lp: 2000 });
  const t0 = now();
  // rising doppler swell
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(180, t0);
  f.frequency.exponentialRampToValueAtTime(1400, t0 + 0.5);
  const g = ctx.createGain(); env(g, t0, 0.15, 0.45, 0.4);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 0.3, 0.65); src.stop(t0 + 0.7);
}

// reversed-gong sub riser into a slow-mo kill
export function slowmoRiser() {
  if (!ctx || !samples.gongRev) return;
  playBuf(samples.gongRev, { rate: 0.9, vol: 0.4, offset: Math.max(samples.gongRev.duration - 1.6, 0), dur: 1.5, fadeOut: 0.3 });
}

export function kick() {
  if (!ctx) return;
  const chp = samples.chop;
  if (chp) playBuf(chp, { rate: 0.9 + Math.random() * 0.2, vol: 0.4 }); // sharp transient
  else if (samples.crunch && Math.random() < 0.5) playBuf(samples.crunch, { rate: 1.5, vol: 0.2 });
  const buf = pickSample('punchHeavy', 5);
  if (buf) { playBuf(buf, { rate: 0.75, vol: 0.6 }); return; }
  const t0 = now();
  noise(t0, 0.06, { hp: 400, lp: 3000, peak: 0.25, dec: 0.05 });
  tone(t0 + 0.01, { type: 'sine', f0: 140, f1: 55, dur: 0.16, peak: 0.45 });
}

export function bonk() {
  if (!ctx) return;
  const t0 = now();
  tone(t0, { type: 'sine', f0: 320, f1: 140, dur: 0.18, peak: 0.35 });
  tone(t0, { type: 'triangle', f0: 900, f1: 880, dur: 0.05, peak: 0.15 });
}

export function fanfare() {
  if (!ctx) return;
  if (samples.fanfare) {
    playBuf(samples.fanfare, { offset: 0.15, dur: 7.5, vol: 0.55, fadeOut: 1.2 });
    return;
  }
  const t0 = now();
  const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
  const times = [0, .14, .28, .42, .62, .82, .96, 1.1];
  notes.forEach((f, i) => {
    tone(t0 + times[i], { type: 'square', f0: f, f1: f, dur: i === notes.length - 1 ? 0.7 : 0.18, peak: 0.14, a: 0.01 });
    tone(t0 + times[i], { type: 'triangle', f0: f / 2, f1: f / 2, dur: 0.2, peak: 0.1 });
  });
  for (let i = 0; i < 6; i++) noise(t0 + 1.1 + i * 0.05, 0.05, { hp: 4000, peak: 0.05, dec: 0.05 });
}

export function sadTrombone() {
  if (!ctx) return;
  if (samples.trombone) {
    playBuf(samples.trombone, { vol: 0.6 });
    return;
  }
  const t0 = now();
  const notes = [233, 220, 208, 155];
  notes.forEach((f, i) => {
    const dur = i === 3 ? 0.9 : 0.32;
    tone(t0 + i * 0.38, { type: 'sawtooth', f0: f, f1: i === 3 ? f * 0.94 : f, dur, peak: 0.22, bp: 500, vibHz: i === 3 ? 5 : 0, vibAmt: 8, a: 0.05 });
  });
}

export function stompQuake() {
  if (!ctx) return;
  const boom = pickSample('boom', 2);
  if (boom) playBuf(boom, { rate: 0.9, vol: 0.9 });
  const b1 = pickSample('bodySlam', 5);
  if (b1) playBuf(b1, { rate: 0.6, vol: 0.6 });
  const t0 = now();
  tone(t0, { type: 'sine', f0: 60, f1: 25, dur: 0.9, peak: 1.0 });
  noise(t0, 0.5, { lp: 300, peak: 0.5, dec: 0.45 });
  noise(t0 + 0.05, 0.3, { lp: 1200, hp: 100, peak: 0.25, dec: 0.28 });
}

export function uiClick() {
  if (!ctx) return;
  if (samples.uiClick) { playBuf(samples.uiClick, { vol: 0.4 }); return; }
  tone(now(), { type: 'square', f0: 700, f1: 700, dur: 0.05, peak: 0.1 });
}
export function uiHover() {
  if (!ctx || !samples.uiHover) return;
  playBuf(samples.uiHover, { vol: 0.2 });
}

export function countBeep(final = false) {
  if (!ctx) return;
  if (final) {
    if (samples.bell) playBuf(samples.bell, { vol: 0.6 });
    if (samples.fightVoice) setTimeout(() => ctx && playBuf(samples.fightVoice, { vol: 0.8 }), 250);
    if (!samples.bell) tone(now(), { type: 'square', f0: 880, f1: 880, dur: 0.5, peak: 0.18, a: 0.005 });
    return;
  }
  tone(now(), { type: 'square', f0: 440, f1: 440, dur: 0.15, peak: 0.18, a: 0.005 });
}

export function roundOne() {
  if (!ctx || !samples.round1) return;
  playBuf(samples.round1, { vol: 0.8 });
}

export function crowdOoh() {
  if (!ctx || !samples.ooh) return;
  playBuf(samples.ooh, { vol: 0.45, rate: 0.95 + Math.random() * 0.15 });
}

export function victoryVoice(flawless = false) {
  if (!ctx) return;
  const v = flawless ? samples.flawless : samples.youwin;
  if (v) playBuf(v, { vol: 0.85 });
  if (samples.cheer) setTimeout(() => ctx && playBuf(samples.cheer, { vol: 0.4, dur: 8, fadeOut: 2 }), 500);
}

export function wingFlap() {
  if (!ctx || !samples.flap) return;
  playBuf(samples.flap, { rate: 0.9, vol: 0.5 });
}

export function effortGrunt() {
  if (!ctx) return;
  playSegment('effort', { vol: 0.3, rate: 1 + Math.random() * 0.15 });
}

// ---------------- battle drums (real looping taiko bed) ----------------
let drumSrc = null, drumGain = null, drumsWanted = false;
function startDrumBed() { // called once the sample decodes, if a fight already wants drums
  if (!ctx || drumSrc || !samples.drumBed || !drumsWanted) return;
  drumSrc = ctx.createBufferSource();
  drumSrc.buffer = samples.drumBed;
  drumSrc.loop = true;
  drumGain = ctx.createGain();
  drumGain.gain.value = 0.0001;
  drumSrc.connect(drumGain); drumGain.connect(master);
  drumSrc.start();
  setDrumIntensity(drumIntensity);
}
export function startDrums() {
  if (!ctx) return;
  drumsWanted = true;
  if (samples.drumBed) startDrumBed();
  else if (!drumTimer) { // synth fallback until the real bed decodes
    let nextT = now() + 0.1;
    drumTimer = setInterval(() => {
      if (!ctx || muted || drumSrc) return;
      const interval = 0.36 - drumIntensity * 0.08;
      while (nextT < now() + 0.25) {
        const b = drumBeat % 8, vol = 0.10 + drumIntensity * 0.12;
        if (b === 0 || b === 4) { tone(nextT, { type: 'sine', f0: 95, f1: 40, dur: 0.25, peak: vol * 1.6 }); noise(nextT, 0.1, { lp: 350, peak: vol * 0.5, dec: 0.1 }); }
        drumBeat++; nextT += interval;
      }
    }, 120);
  }
}
export function stopDrums() {
  drumsWanted = false;
  if (drumTimer) { clearInterval(drumTimer); drumTimer = null; }
  if (drumGain) drumGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  if (drumSrc) { const s = drumSrc; setTimeout(() => { try { s.stop(); } catch (e) {} }, 600); drumSrc = null; drumGain = null; }
}
let musicOn = true;
export function setDrumIntensity(v) {
  drumIntensity = Math.max(0, Math.min(1, v));
  if (drumGain && musicOn) drumGain.gain.setTargetAtTime(0.18 + drumIntensity * 0.4, ctx.currentTime, 0.25);
}
export function setMusicEnabled(on) {
  musicOn = on;
  if (drumGain) drumGain.gain.setTargetAtTime(on ? (0.18 + drumIntensity * 0.4) : 0.0001, ctx ? ctx.currentTime : 0, 0.2);
}
export function isMusicOn() { return musicOn; }
