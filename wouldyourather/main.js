// WOULD YOU RATHER: THE DUEL
// 1 horse-sized duck vs 100 duck-sized horses. You watch. The simulation decides.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SFX from './sounds.js';

// ---------------------------------------------------------------- utils
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _v1 = V3(), _v2 = V3(), _v3 = V3();
const ANIM_STEP = 1 / 32; // skeletal-animation LOD interval (~32fps) for the horse swarm

// ---------------------------------------------------------------- config
const ARENA_R = 24;
const params = new URLSearchParams(location.search);
const AUTO_PICK = params.get('pick'); // deep-link straight into a mode: ?pick=duck | ?pick=horses
const DEBUG = params.has('debug');    // ?debug exposes test hooks; off in normal use
const PROF = params.has('prof');      // ?prof shows a per-subsystem frame-time breakdown overlay
if (params.get('mute')) SFX.setMuted(true);

const CFG = {
  player: { hp: 132, speed: 5.2, swingTime: 0.55, swingRange: 2.0, swingArc: 1.25, dmgPony: [3, 6], dmgDuck: [9, 15], spinCd: 9, regen: 0 },
  duck: { hp: 365, height: 4.3, speed: 3.8, peckDmg: [6, 9], chargeDmg: 20, stompDmg: 11 },
  pony: { count: 100, hp: 22, height: 0.62, speed: [2.6, 4.2], biteDmg: [1.32, 1.98] },
};

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 8, 20);

// ---- responsive framing: Hor+ FOV + aspect-based dolly so portrait/mobile still frames the fight
const BASE_VFOV = 52;
const isTouch = matchMedia('(pointer: coarse)').matches;
const MAX_DPR = isTouch ? 1.5 : 2;
const framing = { distMul: 1, heightMul: 1 };
function applyViewport() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  camera.aspect = aspect;
  // Constant vertical FOV on every aspect: the subject stays the same on-screen size as desktop.
  // Portrait therefore renders "zoomed in like desktop" (cropped horizontally), not dollied out.
  camera.fov = BASE_VFOV;
  framing.distMul = 1; framing.heightMul = 1;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
  renderer.setSize(w, h);
  const hint = document.getElementById('rotateHint');
  const menuVisible = !document.getElementById('menu').classList.contains('hidden');
  if (hint) hint.style.display = (isTouch && aspect < 0.85 && menuVisible) ? 'block' : 'none';
}
applyViewport();
let _rRAF = 0;
function onResize() { cancelAnimationFrame(_rRAF); _rRAF = requestAnimationFrame(applyViewport); }
addEventListener('resize', onResize);
addEventListener('orientationchange', onResize);
if (window.visualViewport) visualViewport.addEventListener('resize', onResize);

// sky
{
  const cv = document.createElement('canvas'); cv.width = 2; cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#68a3e8'); grad.addColorStop(0.55, '#a8cdf0'); grad.addColorStop(1, '#e8f2e0');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
}
scene.fog = new THREE.Fog(0xcfe0dc, 60, 190);

// lights
scene.add(new THREE.HemisphereLight(0xcde3ff, 0x5a7a4a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(18, 32, 12);
sun.castShadow = true;
// 1024² is plenty for a fast melee (nobody studies shadow edges), and quarters the shadow-pass
// fragment fill vs 2048². Frustum tightened to just past the arena (R=24) so the smaller map keeps
// its texel density — crisp shadows, a fraction of the GPU cost.
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------------------------------------------------------------- arena
function buildArena() {
  const arena = new THREE.Group();
  // grass disc with painted texture
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#6da944'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(${randInt(70, 120)},${randInt(130, 175)},${randInt(45, 75)},.5)`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, randInt(2, 6), randInt(2, 6));
  }
  // dirt patches
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${randInt(120, 150)},${randInt(95, 115)},60,${rand(.15, .4)})`;
    g.beginPath(); g.ellipse(Math.random() * 1024, Math.random() * 1024, randInt(15, 70), randInt(10, 45), Math.random() * 3, 0, 7); g.fill();
  }
  // center dirt + chalk ring
  g.fillStyle = 'rgba(146,113,72,.85)';
  g.beginPath(); g.arc(512, 512, 110, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 10;
  g.beginPath(); g.arc(512, 512, 470, 0, 7); g.stroke();
  const gtex = new THREE.CanvasTexture(cv);
  gtex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_R + 4, 64),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  arena.add(ground);
  // outer grass
  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(200, 48),
    new THREE.MeshStandardMaterial({ color: 0x5d9440, roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02;
  arena.add(outer);
  // fence
  const postGeo = new THREE.BoxGeometry(0.18, 1.1, 0.18);
  const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.9 });
  const N = 36, FR = ARENA_R + 1.2;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p = new THREE.Mesh(postGeo, wood);
    p.position.set(Math.cos(a0) * FR, 0.55, Math.sin(a0) * FR);
    p.castShadow = true;
    arena.add(p);
    for (const h of [0.45, 0.9]) {
      const x0 = Math.cos(a0) * FR, z0 = Math.sin(a0) * FR, x1 = Math.cos(a1) * FR, z1 = Math.sin(a1) * FR;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const r = new THREE.Mesh(railGeo, wood);
      r.scale.y = len;
      r.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
      r.rotation.z = Math.PI / 2;
      r.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      arena.add(r);
    }
  }
  // trees
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3e7a33, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const a = rand(0, Math.PI * 2), d = rand(ARENA_R + 7, ARENA_R + 22);
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 7), trunkMat);
    trunk.position.y = 1.5; t.add(trunk);
    for (let l = 0; l < 3; l++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4 - l * 0.6, 2.4, 8), leafMat);
      cone.position.y = 3.4 + l * 1.5; cone.castShadow = true; t.add(cone);
    }
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.scale.setScalar(rand(0.8, 1.5));
    arena.add(t);
  }
  // rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const a = rand(0, Math.PI * 2), d = rand(ARENA_R * 0.55, ARENA_R * 0.9);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.35, 0.8)), rockMat);
    r.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d);
    r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    r.castShadow = true;
    arena.add(r);
  }
  // drifting clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Group();
    for (let b = 0; b < randInt(3, 5); b++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(2.5, 5), 10, 8), cloudMat);
      s.position.set(rand(-6, 6), rand(-1, 1.5), rand(-2.5, 2.5));
      s.scale.y = 0.55;
      c.add(s);
    }
    c.position.set(rand(-90, 90), rand(28, 48), rand(-90, 90));
    c.userData.drift = rand(0.3, 0.9);
    clouds.push(c);
    arena.add(c);
  }
  scene.add(arena);
}
const clouds = [];

// ---------------------------------------------------------------- particles
const softTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(32, 32, 31, 0, 7); g.fill();
  return new THREE.CanvasTexture(cv);
})();
const featherTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(36, 16, 26, 10, 0, 0, 7); g.fill();
  g.fillRect(2, 14, 20, 4);
  return new THREE.CanvasTexture(cv);
})();

const particles = [];
const particleGroup = new THREE.Group();
scene.add(particleGroup);
const planeGeo = new THREE.PlaneGeometry(1, 1);

function spawnParticle({ pos, vel, size = 0.3, color = 0xffffff, life = 1, tex = null, grav = -9, spin = 0, billboard = false, fade = true, sizeY = null }) {
  let p = particles.find(q => !q.alive);
  if (!p) {
    if (particles.length > 420) return;
    p = { mesh: new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })), alive: false };
    particleGroup.add(p.mesh);
    particles.push(p);
  }
  p.alive = true;
  p.t = 0; p.life = life; p.grav = grav; p.spin = spin; p.billboard = billboard; p.fade = fade;
  p.vel = p.vel || V3(); p.vel.copy(vel);
  p.mesh.visible = true;
  p.mesh.position.copy(pos);
  p.mesh.scale.set(size, sizeY || size, size);
  p.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
  // Only toggling the map on/off changes a shader define (USE_MAP); guarding needsUpdate on that
  // avoids a per-spawn program re-derivation, which is what stuttered on multi-hit/launch frames.
  if (p.mesh.material.map !== tex) { p.mesh.material.map = tex; p.mesh.material.needsUpdate = true; }
  p.mesh.material.color.set(color);
  p.mesh.material.opacity = 1;
}

function updateParticles(dt) {
  for (const p of particles) {
    if (!p.alive) continue;
    p.t += dt;
    if (p.t >= p.life) { p.alive = false; p.mesh.visible = false; continue; }
    p.vel.y += p.grav * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.02 && p.grav !== 0) { p.mesh.position.y = 0.02; p.vel.set(0, 0, 0); p.grav = 0; p.spin = 0; }
    if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt; }
    if (p.billboard) p.mesh.quaternion.copy(camera.quaternion);
    if (p.fade) p.mesh.material.opacity = 1 - (p.t / p.life) ** 2;
  }
}

function dustPuff(pos, n = 6, size = 0.5) {
  const bx = pos.x, by = pos.y, bz = pos.z; // cache: callers may pass the shared _v1 temp
  for (let i = 0; i < n; i++) {
    spawnParticle({
      pos: _v1.set(bx + rand(-.3, .3), by + rand(0, .2), bz + rand(-.3, .3)),
      vel: V3(rand(-1.5, 1.5), rand(0.5, 2.2), rand(-1.5, 1.5)),
      size: rand(size * 0.6, size * 1.4), color: 0xcbb894, life: rand(.5, 1.0), tex: softTex, grav: -1.5, billboard: true,
    });
  }
}
function featherBurst(pos, n = 10, big = false) {
  const bx = pos.x, by = pos.y, bz = pos.z; // cache: callers may pass the shared _v1 temp
  for (let i = 0; i < n; i++) {
    spawnParticle({
      pos: _v1.set(bx + rand(-.5, .5), by + rand(0, 1), bz + rand(-.5, .5)),
      vel: V3(rand(-3, 3), rand(1, big ? 7 : 4), rand(-3, 3)),
      size: rand(.25, big ? .8 : .45), sizeY: rand(.12, .25),
      color: Math.random() < 0.7 ? 0xffe14d : 0xfff8e0,
      life: rand(1.2, 2.4), tex: featherTex, grav: rand(-1.5, -0.7), spin: rand(3, 9),
    });
  }
  SFX.popFeather();
}
function sparkBurst(pos, n = 5, color = 0xffffff) {
  for (let i = 0; i < n; i++) {
    spawnParticle({
      pos, vel: V3(rand(-4, 4), rand(1, 5), rand(-4, 4)),
      size: rand(.08, .2), color, life: rand(.25, .5), tex: softTex, grav: -12, billboard: true,
    });
  }
}
function confettiRain(center) {
  const colors = [0xff5252, 0xffd54a, 0x4cd964, 0x53a9ff, 0xff8ae0, 0xffffff];
  const cx = center.x, cz = center.z;
  for (let i = 0; i < 160; i++) {
    setTimeout(() => {
      if (phase !== 'end') return; // a prompt rematch shouldn't rain confetti into the next fight
      spawnParticle({
        pos: V3(cx + rand(-11, 11), rand(9, 15), cz + rand(-11, 11)),
        vel: V3(rand(-.8, .8), rand(-2.5, -1.2), rand(-.8, .8)),
        size: rand(.12, .3), color: pick(colors), life: rand(3.5, 6.5), grav: 0, spin: rand(4, 12),
      });
    }, i * 22);
  }
}

// ---------------------------------------------------------------- damage popups
const popups = [];
let showMarkers = true; // toggle for the floating hit numbers / word labels above heads
let lastWordPopupAt = -9; // rate-limit word popups (POW/WHACK/…) so they don't stack; numbers are exempt
// Per-frame popup budget: a spin into a packed swarm can damage 15+ horses in one frame; each popup
// is a canvas redraw + GPU texture upload, and they just overlap anyway. Cap the redraws per frame.
const POPUP_BUDGET = 8;
let _popupFrame = -1, _popupCount = 0;
const POPUP_SCALE = 0.95;   // every popup (numbers + words) renders at this one size
const POPUP_OPACITY = 0.78; // translucent so overlapping popups blend instead of occluding each other
function damagePopup(pos, text, color = '#ffdd44', scale = 1) { // `scale` kept for call sites but normalized below
  if (!showMarkers) return; // hit markers / number labels toggled off
  if (frameNo !== _popupFrame) { _popupFrame = frameNo; _popupCount = 0; }
  if (_popupCount >= POPUP_BUDGET) return; // frame budget hit — extra numbers would just overlap
  _popupCount++;
  let p = popups.find(q => !q.alive);
  if (!p) {
    if (popups.length > 48) { p = popups.reduce((a, b) => (b.t > a.t ? b : a)); } // steal the oldest, not a live one
    else {
      const cv = document.createElement('canvas');
      const tex = new THREE.CanvasTexture(cv);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      p = { sprite, cv, tex, alive: false };
      scene.add(sprite);
      popups.push(p);
    }
  }
  text = String(text);
  // words may overlay now that they're translucent + uniform; a tiny gate just prevents a same-frame pile-up
  if (/[A-Za-z]/.test(text)) {
    if (battleTime - lastWordPopupAt < 0.12) return;
    lastWordPopupAt = battleTime;
  }
  const g = p.cv.getContext('2d');
  const fontPx = 56;
  g.font = `900 ${fontPx}px "Arial Black", sans-serif`;
  // size the canvas to the text so wide words ("WHACK") never get clipped
  const tw = g.measureText(text).width;
  const W = Math.ceil(tw + 44), H = Math.ceil(fontPx + 34);
  // Reassigning canvas size reallocates + clears the backing store; only pay that when it changed,
  // otherwise a cheap clearRect is enough to redraw over the previous glyphs.
  if (p.cv.width !== W || p.cv.height !== H) { p.cv.width = W; p.cv.height = H; }
  else g.clearRect(0, 0, W, H);
  g.font = `900 ${fontPx}px "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 11; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, W / 2, H / 2);
  g.fillStyle = color; g.fillText(text, W / 2, H / 2);
  p.tex.needsUpdate = true;
  p.aspect = W / H;
  p.alive = true; p.t = 0;
  p.sprite.visible = true;
  p.sprite.center.set(0.5, 0.5);
  // graceful anti-stacking: if recent popups already sit near this spot, rise above them into a
  // readable rising column instead of piling on the same point (fixes the horde-cleave clutter).
  let sy = pos.y;
  for (const q of popups) {
    if (q === p || !q.alive || q.t > 0.6 || q.sx === undefined) continue;
    const dx = q.sx - pos.x, dz = q.sz - pos.z;
    if (dx * dx + dz * dz < 0.85) sy = Math.max(sy, q.stackY + 0.5);
  }
  if (sy - pos.y > 1.9) sy = pos.y + rand(0, 0.4); // cap the column height so it never towers
  p.sx = pos.x; p.sz = pos.z; p.stackY = sy;
  p.sprite.position.set(pos.x + rand(-.08, .08), sy + 0.3, pos.z + rand(-.08, .08));
  p.baseScale = POPUP_SCALE; // uniform size for all popups regardless of the caller's `scale`
  p.sprite.material.opacity = POPUP_OPACITY;
}
function updatePopups(dt) {
  for (const p of popups) {
    if (!p.alive) continue;
    p.t += dt;
    if (p.t > 0.9) { p.alive = false; p.sprite.visible = false; continue; }
    p.sprite.position.y += dt * 1.6;
    const s = p.baseScale * (1 + Math.min(p.t * 6, 1) * 0.25); // subtle pop; identical for every popup
    const hgt = 0.82 * s;
    p.sprite.scale.set(hgt * (p.aspect || 2), hgt, 1); // width follows the text so nothing is squished/clipped
    p.sprite.material.opacity = POPUP_OPACITY * (1 - Math.max(0, (p.t - 0.5) / 0.4));
  }
}

// ---------------------------------------------------------------- UI helpers
const $ = (id) => document.getElementById(id);
const ui = {
  loading: $('loading'), menu: $('menu'), hud: $('hud'), countdown: $('countdown'),
  bossname: $('bossname'), bossfill: $('bossfill'), playerfill: $('playerfill'),
  stats: $('stats'), commentary: $('commentary'), announceFeed: $('announceFeed'),
  end: $('end'), endtitle: $('endtitle'), endsub: $('endsub'), endstats: $('endstats'),
  vignette: $('vignette'), playername: $('playername'), combo: $('combo'), endgrade: $('endgrade'),
};

let commentaryTimer = 0;
function say(text, dur = 2.6) {
  ui.commentary.textContent = text;
  ui.commentary.style.opacity = 1;
  commentaryTimer = dur;
}
// cascading announcement feed: newest is largest at the bottom, the previous two
// stack above it in diminishing size + opacity, each auto-expiring
const announceMsgs = [];
function relayoutAnnounce() {
  const n = announceMsgs.length;
  announceMsgs.forEach((m, i) => {
    const age = n - 1 - i; // 0 = newest
    m.el.style.setProperty('--s', age === 0 ? 1 : age === 1 ? 0.6 : 0.42);
    if (!m.el.classList.contains('out')) m.el.style.opacity = age === 0 ? 1 : age === 1 ? 0.68 : 0.4;
  });
}
function announce(text) {
  const feed = ui.announceFeed;
  if (!feed) return;
  // de-dupe an identical message fired twice in the same instant
  const last = announceMsgs[announceMsgs.length - 1];
  if (last && last.el.textContent === text && last.t < 0.25) { last.t = 0; return; }
  const el = document.createElement('div');
  el.className = 'amsg';
  el.textContent = text;
  feed.appendChild(el);
  const m = { el, t: 0 };
  announceMsgs.push(m);
  requestAnimationFrame(() => el.classList.add('in'));
  while (announceMsgs.length > 3) { const old = announceMsgs.shift(); old.el.remove(); }
  relayoutAnnounce();
}
function updateAnnounce(dt) {
  for (let i = announceMsgs.length - 1; i >= 0; i--) {
    const m = announceMsgs[i];
    m.t += dt;
    if (m.t > 2.6 && !m.el.classList.contains('out')) m.el.classList.add('out');
    if (m.t > 3.0) { m.el.remove(); announceMsgs.splice(i, 1); relayoutAnnounce(); }
  }
}
let vignetteT = 0;
function flashVignette(intensity = 0.9) { vignetteT = Math.max(vignetteT, Math.min(intensity, 1)); } // max() = rapid small hits don't strobe to full red

// combo meter: Dave's landed hits without taking damage
let comboT = 0, comboDisplayed = 0, comboAcc = 0, comboBreakT = 0, comboBreakVal = 0;
function resetCombo() { stats.combo = 0; comboT = 0; comboDisplayed = 0; comboAcc = 0; comboBreakT = 0; }
function registerHits(n) {
  const prev = stats.combo;
  stats.combo += n;
  if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
  comboT = 2.2;
  // announce the highest milestone CROSSED (a multi-hit cleave can jump past an exact total)
  const M = [[50, '💥 50-HIT MASSACRE!'], [35, '💥 35 HITS! INHUMAN!'], [20, '🔥 20 HITS! UNTOUCHABLE!'], [10, '🔥 10 HIT COMBO!']];
  for (const [th, msg] of M) if (prev < th && stats.combo >= th) { announce(msg); break; }
}
function comboBreak() {
  if (stats.combo >= 3) { comboBreakT = 1.1; comboBreakVal = stats.combo; } // flash "COMBO BROKEN" under the counter
  stats.combo = 0; comboT = 0; comboDisplayed = 0; comboAcc = 0;
}
function hideCombo() { const el = ui.combo; if (el) { el.classList.add('hidden'); el.style.opacity = 0; el.classList.remove('broken'); } }
function updateComboUI(dt) {
  const el = ui.combo;
  if (!el) return;
  const nEl = el.firstElementChild, lblEl = el.lastElementChild;
  // only ever visible mid-battle; cleared/hidden everywhere else (menu, countdown, end)
  if (phase !== 'battle') { hideCombo(); comboDisplayed = 0; comboBreakT = 0; return; }

  // "COMBO BROKEN" flash, in place, in red — replaces the narrative-text message
  if (comboBreakT > 0) {
    comboBreakT -= dt;
    el.classList.remove('hidden'); el.classList.add('broken');
    nEl.textContent = comboBreakVal; lblEl.textContent = 'COMBO BROKEN';
    el.style.opacity = comboBreakT > 0.4 ? 1 : Math.max(comboBreakT / 0.4, 0);
    return;
  }
  el.classList.remove('broken'); lblEl.textContent = 'HIT COMBO';

  if (comboT > 0 && stats.combo >= 3) {
    comboT -= dt;
    // dynamic count-up: tick the displayed number toward the real value so you watch it accrue
    comboAcc += dt;
    let bumped = false;
    while (comboDisplayed < stats.combo && comboAcc >= 0.045) { comboDisplayed++; comboAcc -= 0.045; bumped = true; }
    if (comboDisplayed > stats.combo) comboDisplayed = stats.combo;
    if (bumped) { nEl.textContent = comboDisplayed; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    if (comboDisplayed >= 3) { el.classList.remove('hidden'); el.style.opacity = comboT > 0.5 ? 1 : comboT / 0.5; }
    else hideCombo();
  } else {
    hideCombo();
    comboDisplayed = 0; comboAcc = 0;
  }
}

const QUIPS = {
  duckIdle: [
    'The duck sizes him up. It has fought before.',
    'Somewhere, a pond is missing its king.',
    'Dave is starting to regret his choices.',
    'That beak has seen things.',
    'Local man discovers ducks remember everything.',
    'The duck is not even mad. That’s what scares Dave.',
  ],
  horsesIdle: [
    'The tiny horses smell fear. And apples.',
    'Each horse is small. The grudge is not.',
    'Dave wishes he’d picked the duck.',
    'A thousand tiny hooves. Well. Four hundred.',
    'They gallop in italics.',
    'The stampede is adorable. The stampede is lethal.',
  ],
  playerLow: ['Dave is running on vibes alone!', 'This is looking grim for humanity!', 'Someone call Dave’s emergency contact!'],
  duckCharge: ['INCOMING FREIGHT QUACK!', 'The duck has entered its final form!', 'BRACE! BRACE! BRACE!'],
  stomp: ['SEISMIC WATERFOWL EVENT!', 'The ground remembers that one.'],
};

// ---------------------------------------------------------------- assets
const loader = new GLTFLoader();
const assets = {};
function loadGLB(url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
// Skinned-mesh clones measure wrong (stale bone matrices), so we measure each
// asset ONCE on the freshly-loaded original and reuse those dims for every clone.
function measureAsset(sceneObj) {
  sceneObj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(sceneObj);
  return { h: box.max.y - box.min.y, minY: box.min.y };
}
function applyNorm(model, dim, h) {
  const s = h / dim.h;
  model.scale.setScalar(s);
  model.position.y = -dim.minY * s;
  return s;
}

// The horse GLB is one mesh split into 8 primitives = 8 materials = 8 draw calls per horse.
// Every part gets overridden to a single flat tint at spawn, so the 8 materials are visually
// redundant — merge their (identical-attribute, shared-skeleton) geometries into ONE SkinnedMesh
// so each of the 100 horses renders in a single draw call instead of eight. ~8x fewer draws.
function mergeSkinnedMeshes(root) {
  const meshes = [];
  root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  if (meshes.length < 2) return; // already single-draw (or not skinned)
  const first = meshes[0];
  const merged = mergeGeometries(meshes.map(m => m.geometry), false); // false = no groups → one material
  if (!merged) { console.warn('mergeSkinnedMeshes: geometry merge failed, keeping split meshes'); return; }
  const skinned = new THREE.SkinnedMesh(merged, first.material);
  skinned.name = (first.name || 'mesh') + '_merged';
  skinned.bind(first.skeleton, first.bindMatrix); // skinIndex already references this shared skeleton
  first.parent.add(skinned);
  skinned.position.copy(first.position);
  skinned.quaternion.copy(first.quaternion);
  skinned.scale.copy(first.scale);
  for (const m of meshes) m.parent && m.parent.remove(m); // drop the 8 originals
}

// ---------------------------------------------------------------- game state
let mode = null;              // 'duck' | 'horses'
let phase = 'loading';        // loading | menu | countdown | battle | end
let battleGroup = null;
let player = null, duck = null, ponies = [];
let shockwaves = [];
let timeScale = 1, slowmoT = 0, hitstopT = 0;
let battleTime = 0;
let stats = { kills: 0, dmgDealt: 0, swings: 0, combo: 0, maxCombo: 0 };
let killTimes = [];
let idleQuipT = 6;

// ---------------------------------------------------------------- camera director
const cam = { azimuth: 0.6, azimuthDrift: 0.035, userAz: 0, dist: 15, userDist: 0, height: 5.2, shake: 0, pos: V3(0, 8, 20), look: V3() };
const DIST_OVERRIDE = DEBUG ? parseFloat(params.get('dist') || '0') : 0; // debug-only fixed camera distance
function shake(amt) { cam.shake = Math.max(cam.shake, amt); }

// orbit (1 finger / mouse drag) + pinch-zoom (2 fingers) + wheel zoom (desktop)
const activePointers = new Map();
let pinchPrev = 0;
function pinchDist() { const v = [...activePointers.values()]; return v.length < 2 ? 0 : Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y); }
canvas.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  if (activePointers.size === 2) pinchPrev = pinchDist();
});
canvas.addEventListener('pointermove', (e) => {
  const prev = activePointers.get(e.pointerId);
  if (!prev) return;
  if (activePointers.size === 1) {
    cam.userAz -= (e.clientX - prev.x) * 0.005;
    cam.height = clamp(cam.height + (e.clientY - prev.y) * 0.02, 2, 18);
  }
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    const d = pinchDist();
    if (pinchPrev) cam.userDist = clamp(cam.userDist - (d - pinchPrev) * 0.03, -7, 14);
    pinchPrev = d;
  }
});
function endPointer(e) { activePointers.delete(e.pointerId); if (activePointers.size < 2) pinchPrev = 0; }
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
addEventListener('wheel', (e) => { cam.userDist = clamp(cam.userDist + e.deltaY * 0.01, -7, 14); }, { passive: true });

function updateCamera(dt) {
  if (DEBUG && window.__freecam) return; // debug-only: let a test harness pin the camera
  let focus = _v1.set(0, 1, 0);
  let target = _v2.set(0, 2, 8);
  if (player) target.copy(player.root.position);
  if (phase === 'battle' || phase === 'end') {
    if (mode === 'duck' && duck) {
      focus.copy(player.root.position).lerp(duck.root.position, 0.32);
      focus.y = 1.8;
    } else if (mode === 'horses') {
      const c = V3();
      let n = 0;
      for (const p of ponies) { if (!p.dead) { c.add(p.root.position); n++; } }
      if (n) c.divideScalar(n);
      focus.copy(player.root.position).lerp(c, 0.3);
      focus.y = 1.2;
    } else {
      focus.copy(player.root.position); focus.y = 1.5;
    }
  }
  cam.azimuth += cam.azimuthDrift * dt;
  const az = cam.azimuth + cam.userAz;
  const dist = (DIST_OVERRIDE || clamp(cam.dist + cam.userDist, 5, 34)) * framing.distMul;
  const px = player ? player.root.position.x : 0;
  const pz = player ? player.root.position.z : 0;
  const desired = V3(
    px + Math.sin(az) * dist,
    cam.height * framing.heightMul,
    pz + Math.cos(az) * dist
  );
  const k = 1 - Math.exp(-2.2 * dt);
  cam.pos.lerp(desired, k);
  cam.look.lerp(focus, 1 - Math.exp(-3.5 * dt));
  camera.position.copy(cam.pos);
  if (cam.shake > 0.001) {
    camera.position.x += rand(-1, 1) * cam.shake;
    camera.position.y += rand(-1, 1) * cam.shake * 0.6;
    camera.position.z += rand(-1, 1) * cam.shake;
    cam.shake *= Math.exp(-6 * dt);
  }
  camera.lookAt(cam.look);
}

// ---------------------------------------------------------------- PLAYER
class Player {
  constructor() {
    this.root = new THREE.Group();
    const model = SkeletonUtils.clone(assets.dave.scene);
    applyNorm(model, assets.daveDim, 1.8);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.model = model;
    this.root.add(model);
    battleGroup.add(this.root);

    this.mixer = new THREE.AnimationMixer(model);
    const bind = (suffix) => {
      const c = assets.anims.animations.find(cl => cl.name === suffix || cl.name.endsWith('|' + suffix));
      return c ? this.mixer.clipAction(c) : null;
    };
    this.ATTACKS = ['Punch_Left', 'Punch_Right', 'Kick_Left']; // jab, cross, roundhouse — as is tradition
    this.actions = {};
    for (const n of ['Idle_Neutral', 'Run', 'Run_Left', 'Run_Right', 'Run_Back', 'Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right', 'Roll', 'Death', 'Wave', 'HitRecieve']) this.actions[n] = bind(n);
    this.locoNames = ['Idle_Neutral', 'Run', 'Run_Left', 'Run_Right', 'Run_Back'];
    for (const n of this.locoNames) if (this.actions[n]) { this.actions[n].play(); this.actions[n].setEffectiveWeight(n === 'Idle_Neutral' ? 1 : 0); }
    // one-shot clips are weight-managed explicitly every frame: exactly ONE ever
    // contributes, so a finished clamped clip can never dilute Death/attacks.
    this.oneShotNames = ['Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right', 'Roll', 'Death', 'Wave', 'HitRecieve'];
    this.oneShot = null; this.osW = 0; this.osTarget = 0;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.oneShot && !this.dead && this.downT <= 0) this.osTarget = 0; // begin fade-out
    });

    // slash arc visual
    this.slash = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 2.2, 20, 1, 0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    this.slash.rotation.x = -Math.PI / 2;
    this.slash.position.y = 1.0;
    this.root.add(this.slash);

    this.hp = CFG.player.hp;
    this.maxHp = CFG.player.hp;
    this.vel = V3();
    this.yaw = 0;
    this.attackT = -1;       // -1 idle, else 0..1 through swing
    this.attackHitDone = false;
    this.combo = 0;
    this.spinT = -1;
    this.spinCd = rand(4, 7);
    this.dodgeT = -1;
    this.dodgeDir = V3();
    this.retreatT = 0;
    this.retreatCd = 0;
    this.lastHurtT = 999;
    this.dead = false;
    this.cheering = false;
    this.downT = -1;        // >0 while knocked down
    this.knockCd = 0;
    this.recentHurts = [];
    this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = rand(2, 4);

    // per-battle temperament: same Dave, different mood
    this.temper = pick(['brave', 'cautious', 'showboat']);
    this.tune = {
      brave:    { retreatHp: 30, dodge: 0.7, spin: 0.7, taunt: false },
      cautious: { retreatHp: 55, dodge: 1.6, spin: 1.2, taunt: false },
      showboat: { retreatHp: 40, dodge: 1.0, spin: 0.55, taunt: true },
    }[this.temper];
    this.tauntT = rand(6, 10);
  }

  playOnce(name, dur = null) {
    const a = this.actions[name];
    if (!a) return;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = dur ? a.getClip().duration / dur : 1;
    a.enabled = true;
    a.play();
    this.oneShot = a;
    this.osTarget = 1;
  }

  // drive one-shot weights: active one ramps to 1, every other forced to 0+disabled
  applyOneShotWeights(dt) {
    this.osW += (this.osTarget - this.osW) * Math.min(dt / 0.09, 1);
    if (this.osTarget === 0 && this.osW < 0.02) { this.osW = 0; this.oneShot = null; }
    for (const n of this.oneShotNames) {
      const a = this.actions[n]; if (!a) continue;
      if (a === this.oneShot) { a.enabled = true; a.setEffectiveWeight(this.osW); }
      else { a.setEffectiveWeight(0); a.enabled = false; }
    }
    return this.osW;
  }
  zeroLoco() { for (const n of this.locoNames) if (this.actions[n]) this.actions[n].setEffectiveWeight(0); }

  startCheer() {
    if (this.dead || this.cheering) return;
    this.cheering = true;
    const a = this.actions['Wave'];
    if (a) { a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.timeScale = 1; a.enabled = true; a.play(); this.oneShot = a; this.osTarget = 1; }
  }

  knockdown(dur) {
    if (this.dead || this.downT > 0 || this.knockCd > 0 || this.dodgeT >= 0) return;
    this.downT = dur;
    this.knockCd = 9;
    this.attackT = -1; this.spinT = -1;
    this.playOnce('Death', 0.5); // fast pratfall
    announce(pick(['💫 DAVE IS DOWN!', '💫 KNOCKDOWN!']));
    say(pick(['Get up, Dave!', 'Dave is having a lie-down. Mid-battle.', 'The ground: also Dave’s enemy.']), 2);
    damagePopup(_v1.copy(this.root.position).setY(2.1), pick(['WHAM!', 'BONK!', 'SPLAT!']), '#ff9944', 1.1);
    SFX.thudBig();
    SFX.crowdOoh();
    shake(0.3);
    dustPuff(this.root.position, 12, 0.8);
  }

  hurt(dmg, fromPos, knock = 3) {
    if (this.dead || this.dodgeT >= 0) return;
    if (this.downT > 0) dmg *= 0.5; // hits on a downed man glance off. mostly.
    this.hp -= dmg;
    this.lastHurtT = 0;
    comboBreak(); // taking a hit breaks the combo (shows "COMBO BROKEN" under the counter)
    damagePopup(_v1.copy(this.root.position).setY(1.9), Math.round(dmg), '#ff5b5b', 0.85);
    flashVignette(clamp(0.1 + dmg * 0.03, 0.1, 1)); // faint for a bite, strong for a charge/stomp
    SFX.playerHurt();
    if (fromPos) {
      _v2.copy(this.root.position).sub(fromPos).setY(0).normalize();
      this.vel.addScaledVector(_v2, knock);
    }
    shake(Math.min(0.06 + dmg * 0.008, 0.3));
    if (dmg >= 8 && this.downT <= 0 && this.attackT < 0 && !this.oneShot) this.playOnce('HitRecieve', 0.45);
    this.recentHurts.push(battleTime);
    this.recentHurts = this.recentHurts.filter(t => battleTime - t < 1.0);
    if (mode === 'horses' && this.recentHurts.length >= 4) this.knockdown(1.6);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.playOnce('Death');
      SFX.thudBig();
      dustPuff(this.root.position, 10, 0.7);
      endBattle(false);
    }
  }

  startSwing() {
    if (this.attackT >= 0 || this.spinT >= 0 || this.dead) return;
    this.attackT = 0;
    this.attackHitDone = false;
    this.whooshed = false; // fresh whoosh window even if the prior swing was interrupted
    this.combo = (this.combo + 1) % 3;
    this.playOnce(this.ATTACKS[this.combo], CFG.player.swingTime * 1.35);
    if (this.combo === 2) SFX.kick();
    if (Math.random() < 0.22) SFX.effortGrunt();
    stats.swings++;
  }
  startSpin() {
    if (this.spinT >= 0 || this.dead) return;
    this.spinT = 0;
    this.spinHitDone = false; // a knockdown could interrupt a prior spin after its hit frame, leaving this true
    this.spinCd = CFG.player.spinCd * this.tune.spin * rand(0.9, 1.2);
    this.playOnce('Kick_Right', 0.72); // roundhouse
    stats.swings++;
    SFX.swingWhoosh(true);
  }
  startDodge(dir) {
    if (this.dodgeT >= 0 || this.dead) return;
    this.dodgeT = 0;
    this.dodgeDir.copy(dir).setY(0).normalize();
    // pick the dodge clip matching the direction relative to facing
    this.playOnce('Roll', 0.5);
    SFX.whoosh();
  }

  applySwingDamage() {
    const range = mode === 'duck' ? CFG.player.swingRange + 1.2 : CFG.player.swingRange;
    const fwd = _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // _v3 so hitPos (_v1) can't alias fwd
    let hitAny = false;
    if (mode === 'duck' && duck && !duck.dead) {
      const to = _v2.copy(duck.root.position).sub(this.root.position).setY(0);
      const d = to.length() - duck.bodyR;
      if (d < range && to.normalize().dot(fwd) > 0.35) {
        const dmg = randInt(CFG.player.dmgDuck[0], CFG.player.dmgDuck[1]);
        duck.hurt(dmg, this.root.position);
        const hitPos = _v1.copy(this.root.position).addScaledVector(fwd, 1.6).setY(1.4);
        sparkBurst(hitPos, 7, 0xfff1a8);
        spawnShockwave(hitPos, 0.25, { damage: false, speed: 5, maxR: 1.5, color: 0xffffff, y: 1.4 });
        if (Math.random() < 0.3) damagePopup(_v2.copy(hitPos).setY(2.4), pick(['POW!', 'THWACK!', 'BAM!']), '#ffffff', 1.0);
        if (this.combo === 2) damagePopup(_v2.copy(hitPos).setY(2.0), 'BOOT!', '#8fd0ff', 1.0);
        hitAny = true;
        registerHits(1);
      }
    } else {
      let hits = 0;
      for (const p of ponies) {
        if (p.dead || hits >= 5) continue;
        const to = _v2.copy(p.root.position).sub(this.root.position).setY(0);
        const d = to.length();
        if (d < range && to.normalize().dot(fwd) > 0.3) {
          const dmg = randInt(CFG.player.dmgPony[0], CFG.player.dmgPony[1]);
          p.hurt(dmg, this.root.position, 10.5);
          hits++; hitAny = true;
        }
      }
      if (hits >= 2) {
        const hitPos = _v1.copy(this.root.position).addScaledVector(fwd, 1.4).setY(0.5);
        spawnShockwave(hitPos, 0.2, { damage: false, speed: 5, maxR: 1.3, color: 0xffffff, y: 0.5 });
      }
      if (hits >= 4) damagePopup(_v1.copy(this.root.position).addScaledVector(fwd, 1.5).setY(1.6), pick(['POW!', 'BAM!', 'WHACK!']), '#ffffff', 1.0);
      if (hits) registerHits(hits);
    }
    if (hitAny) SFX.hitFlesh(mode === 'duck');
  }

  applySpinDamage() {
    let hits = 0;
    for (const p of ponies) {
      if (p.dead) continue;
      const d = p.root.position.distanceTo(this.root.position);
      if (d < 2.9) { p.hurt(randInt(4, 7), this.root.position, 15); hits++; }
    }
    if (mode === 'duck' && duck && !duck.dead) {
      const d = duck.root.position.distanceTo(this.root.position) - duck.bodyR;
      if (d < 3.2) { duck.hurt(randInt(7, 11), this.root.position); hits++; }
    }
    if (hits) { SFX.hitFlesh(true); shake(0.15); registerHits(hits); }
  }

  // --------------- AI brains
  think(dt) {
    const pos = this.root.position;
    let moveDir = _v1.set(0, 0, 0);
    let wantFace = null;
    this.strafeTimer -= dt;
    if (this.strafeTimer < 0) { this.strafeSign *= -1; this.strafeTimer = rand(1.5, 3.5); }

    if (mode === 'duck' && duck && !duck.dead) {
      const to = _v2.copy(duck.root.position).sub(pos).setY(0);
      const dist = to.length() - duck.bodyR;
      to.normalize();
      // lock eyes only when it matters; otherwise run naturally
      wantFace = (dist < 5 || this.attackT >= 0 || (this.retreatT > 0 && dist < 6)) ? Math.atan2(to.x, to.z) : null;
      // dodge duck attacks
      if (duck.state === 'chargeWindup' || duck.state === 'charging') {
        const perp = V3(-to.z, 0, to.x).multiplyScalar(this.strafeSign);
        if (this.dodgeT < 0 && duck.state === 'charging' && dist < 7) this.startDodge(perp);
        moveDir.copy(perp).addScaledVector(to, -0.6);
      } else if (duck.state === 'stompWindup') {
        if (dist < 8) moveDir.copy(to).multiplyScalar(-1);
      } else if (duck.state === 'peckWindup' && dist < 3.4 && Math.random() < 3.0 * this.tune.dodge * dt) {
        const perp = V3(-to.z, 0, to.x).multiplyScalar(this.strafeSign);
        if (this.dodgeT < 0) this.startDodge(perp.add(to.clone().multiplyScalar(-0.5)));
      } else if (this.retreatT > 0) {
        this.retreatT -= dt;
        moveDir.copy(to).multiplyScalar(-1).addScaledVector(V3(-to.z, 0, to.x), this.strafeSign * 0.8);
      } else if (dist > 2.6) {
        moveDir.copy(to).addScaledVector(V3(-to.z, 0, to.x), this.strafeSign * 0.35);
      } else {
        // in range: swing!
        if (this.attackT < 0 && this.spinT < 0) {
          this.startSwing();
          if (this.combo === 0) this.retreatT = rand(0.7, 1.6); // back off after 3-hit combo
        }
        moveDir.copy(V3(-to.z, 0, to.x)).multiplyScalar(this.strafeSign * 0.5);
      }
      if (this.hp < 30 && duck.state === 'chase' && dist < 5) {
        moveDir.addScaledVector(to, -1.2); // caution when low
      }
    } else if (mode === 'horses') {
      // nearest pony & local pressure
      let nearest = null, nd = 1e9, pressure = 0;
      const centroid = V3();
      let n = 0;
      for (const p of ponies) {
        if (p.dead) continue;
        const d = p.root.position.distanceTo(pos);
        if (d < nd) { nd = d; nearest = p; }
        if (d < 3.0) pressure++;
        centroid.add(p.root.position); n++;
      }
      if (n) centroid.divideScalar(n);
      if (nearest) {
        const to = _v2.copy(nearest.root.position).sub(pos).setY(0).normalize();
        wantFace = (nd < 3.5 || this.attackT >= 0) ? Math.atan2(to.x, to.z) : null;
        if (this.spinT < 0 && this.spinCd <= 0 && pressure >= 4) {
          this.startSpin();
          announce(pick(['🌪 SPIN TO WIN!', '🌪 BLENDER MODE!', '🌪 THE OL’ ROTOR!']));
        } else if (this.hp < this.tune.retreatHp && pressure >= 6 && this.retreatT <= 0 && this.retreatCd <= 0) {
          this.retreatT = rand(1.1, 1.7);
          this.retreatCd = 6;
        }
        if (this.retreatT > 0) {
          this.retreatT -= dt;
          const away = _v2.copy(pos).sub(centroid).setY(0).normalize();
          const wallness = Math.hypot(pos.x, pos.z) / ARENA_R;
          moveDir.copy(away).addScaledVector(_v1.copy(pos).setY(0).normalize(), -wallness * 1.4);
          if (nd < 1.9 && this.attackT < 0 && this.spinT < 0) this.startSwing(); // kite-swing
        } else if (nd > 1.9) {
          moveDir.copy(to).addScaledVector(V3(-to.z, 0, to.x), this.strafeSign * 0.45);
        } else {
          if (this.attackT < 0 && this.spinT < 0) this.startSwing();
          moveDir.copy(V3(-to.z, 0, to.x)).multiplyScalar(this.strafeSign * 0.7).addScaledVector(to, -0.2);
        }
      }
    }
    return { moveDir: moveDir.clone(), wantFace };
  }

  update(dt) {
    this.slash.material.opacity = 0; // reset before any early-return so no ring lingers over a fallen/cheering Dave
    if (this.dead || this.cheering) {
      this.vel.set(0, 0, 0);
      this.zeroLoco();
      this.applyOneShotWeights(dt);
      this.mixer.update(dt);
      return;
    }
    this.lastHurtT += dt;
    this.spinCd -= dt;
    this.retreatCd -= dt;
    this.knockCd -= dt;

    // knocked down: helpless until he clambers up
    if (this.downT > 0) {
      this.downT -= dt;
      this.vel.multiplyScalar(Math.exp(-4 * dt));
      this.root.position.addScaledVector(this.vel, dt);
      const dr = Math.hypot(this.root.position.x, this.root.position.z); // don't let a knockdown slide him past the fence
      if (dr > ARENA_R - 1) this.root.position.multiplyScalar((ARENA_R - 1) / dr);
      this.zeroLoco();
      this.applyOneShotWeights(dt);
      this.mixer.update(dt);
      if (this.downT <= 0) {
        const a = this.actions['Death']; // played in reverse = getting back up
        if (a) {
          a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false;
          a.time = a.getClip().duration; a.timeScale = -1.7;
          a.enabled = true; a.play();
          this.oneShot = a; this.osTarget = 1;
        }
        say(pick(['He’s up! Somehow!', 'Dave remembers how legs work!']), 1.6);
      }
      return;
    }
    // Dave never regains health — every hit is permanent, in both fights

    // showboats gotta showboat
    if (this.tune.taunt && phase === 'battle') {
      this.tauntT -= dt;
      if (this.tauntT <= 0) {
        this.tauntT = rand(8, 14);
        const safeish = mode === 'duck' ? (duck && !duck.dead && duck.state === 'chase') : true;
        if (safeish && !this.oneShot && this.attackT < 0 && this.spinT < 0) {
          this.playOnce('Wave', 1.0);
          say(pick(['Dave taunts. Why, Dave. WHY.', 'Dave is SHOWBOATING.', 'Confidence level: unearned.']), 2);
        }
      }
    }

    const { moveDir, wantFace } = this.think(dt);
    let speed = CFG.player.speed;

    // dodge overrides
    if (this.dodgeT >= 0) {
      this.dodgeT += dt / 0.45;
      if (this.dodgeT >= 1) this.dodgeT = -1;
      else { moveDir.copy(this.dodgeDir); speed = 10; }
    }

    if (moveDir.lengthSq() > 0.001) {
      moveDir.normalize();
      this.vel.x += (moveDir.x * speed - this.vel.x) * Math.min(8 * dt, 1);
      this.vel.z += (moveDir.z * speed - this.vel.z) * Math.min(8 * dt, 1);
    } else {
      this.vel.x *= Math.exp(-6 * dt);
      this.vel.z *= Math.exp(-6 * dt);
    }
    this.root.position.addScaledVector(this.vel, dt);
    // keep in arena
    const r = Math.hypot(this.root.position.x, this.root.position.z);
    if (r > ARENA_R - 1) {
      this.root.position.multiplyScalar((ARENA_R - 1) / r);
    }
    this.root.position.y = 0;

    // facing
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (this.spinT >= 0) {
      this.spinT += dt / 0.6;
      this.yaw += (Math.PI * 2 / 0.6) * dt; // exactly one revolution over the 0.6s window → ends facing the enemy
      if (this.spinT > 0.45 && !this.spinHitDone) { this.applySpinDamage(); this.spinHitDone = true; }
      if (this.spinT >= 1) { this.spinT = -1; this.spinHitDone = false; }
    } else if (this.dodgeT >= 0) {
      // the only roll clip is a forward somersault, so turn to face the roll-travel dir (Souls-style directional roll)
      this.yaw = lerpAngle(this.yaw, Math.atan2(this.dodgeDir.x, this.dodgeDir.z), 16 * dt);
    } else if (this.attackT >= 0 && wantFace !== null) {
      this.yaw = lerpAngle(this.yaw, wantFace, 16 * dt);          // attacking: snap to face the target
    } else if (spd > 1.0) {
      // RUNNING: face the travel direction so the forward run clip's feet point where he goes
      // (facing the enemy while moving sideways is what twisted the feet). Small yaw catch-up = clean feet.
      this.yaw = lerpAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 12 * dt);
    } else if (wantFace !== null) {
      this.yaw = lerpAngle(this.yaw, wantFace, 9 * dt);           // idling near the enemy: turn to watch it
    }
    this.root.rotation.y = this.yaw;

    // locomotion blend: forward / strafe / backpedal relative to facing.
    // one-shot weights drive damp so an attack/roll fully overrides locomotion.
    const damp = 1 - this.applyOneShotWeights(dt);
    const m = clamp(spd / CFG.player.speed, 0, 1);
    // Dave faces where he runs, so a single clean forward Run (no directional-clip blending, which is
    // what twisted the feet) covers all locomotion; Idle when nearly stopped.
    const w = { Run: m, Idle_Neutral: 1 - m };
    for (const n of this.locoNames) if (this.actions[n]) this.actions[n].setEffectiveWeight((w[n] || 0) * damp);
    // sync the run cycle to actual velocity so feet don't skate
    const cyc = clamp(spd / CFG.player.speed, 0.6, 1.35);
    for (const n of ['Run', 'Run_Left', 'Run_Right', 'Run_Back']) if (this.actions[n]) this.actions[n].timeScale = cyc;
    this.mixer.update(dt);

    // strike damage window (the clip supplies the visuals)
    this.slash.material.opacity = 0;
    if (this.attackT >= 0) {
      this.attackT += dt / CFG.player.swingTime;
      const t = this.attackT;
      if (t >= 1) { this.attackT = -1; }
      else {
        if (t > 0.12 && t < 0.2 && !this.whooshed) { SFX.swingWhoosh(this.combo === 2); this.whooshed = true; }
        if (t >= 0.42 && !this.attackHitDone) { this.attackHitDone = true; this.applySwingDamage(); this.whooshed = false; }
        const strike = clamp((t - 0.3) / 0.25, 0, 1);
        const rec = clamp((t - 0.62) / 0.38, 0, 1);
        if (strike > 0 && rec < 1) {
          this.slash.material.opacity = 0.35 * (1 - rec) * strike;
          this.slash.rotation.z = -strike * 2.4 + (this.combo === 1 ? 2 : 0);
        }
      }
    }
    if (this.spinT >= 0) {
      this.slash.material.opacity = 0.5;
      this.slash.rotation.z += 14 * dt;
    }
  }
}

// ---------------------------------------------------------------- DUCK
class Duck {
  constructor() {
    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    const model = SkeletonUtils.clone(assets.duck.scene);
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.material = o.material.clone();
      }
    });
    this.inner.add(model);
    this.inner.rotation.y = -Math.PI / 2; // duck model faces +X → make it face +Z
    const wrap = new THREE.Group();
    wrap.add(this.inner);
    applyNorm(wrap, measureAsset(wrap), CFG.duck.height);
    this.body = wrap;
    this.root.add(wrap);
    battleGroup.add(this.root);
    this.root.position.set(0, 0, -12);

    const box = new THREE.Box3().setFromObject(this.root);
    this.bodyR = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.32;

    this.mats = [];
    model.traverse(o => { if (o.isMesh) this.mats.push(o.material); });

    this.hp = CFG.duck.hp;
    this.maxHp = CFG.duck.hp;
    this.state = 'chase';
    this.stateT = 0;
    this.yaw = 0;
    this.bob = 0;
    this.vel = V3();
    this.chargeCd = rand(5, 8);
    this.stompCd = rand(9, 13);
    this.peckCd = 0;
    this.quackCd = rand(1, 3);
    this.enraged = false;
    this.dead = false;
    this.flashT = 0;
    this.chargeDir = V3();
    this.hitPlayerThisCharge = false;
    this.recentHits = [];
    this.counterCd = 0;
    this.baseS = this.body.scale.x;
    this.hurtPulse = 0;
  }

  hurt(dmg, fromPos) {
    if (this.dead) return;
    this.hp -= dmg;
    stats.dmgDealt += dmg;
    this.flashT = 0.12;
    this.hurtPulse = 1;
    // punish button-mashing: 3 hits inside 1.5s triggers a counter
    this.recentHits.push(battleTime);
    this.recentHits = this.recentHits.filter(t => battleTime - t < 1.5);
    if (this.recentHits.length >= 3 && this.counterCd <= 0 && this.state === 'chase') {
      this.counterCd = 7;
      this.recentHits = [];
      this.setState('hopback');
      say(pick(['The duck countermoves!', 'It has studied the blade.', 'Tactical waterfowl maneuvering!']), 2);
    }
    damagePopup(_v1.copy(this.root.position).setY(CFG.duck.height + 0.4), Math.round(dmg), '#ffdd44', 0.85);
    featherBurst(_v1.copy(this.root.position).setY(CFG.duck.height * 0.6), 6);
    if (Math.random() < 0.55) SFX.quack(rand(0.3, 0.42), 0.4); // a hurt quack ~half the hits, so rapid hits don't overwhelm
    if (!this.enraged && this.hp < this.maxHp * 0.45) {
      this.enraged = true;
      announce('🔥 THE DUCK IS ENRAGED 🔥');
      say('Its eyes... they glow like pond water at midnight.');
      SFX.bigQuackRoar();
      shake(0.25);
      for (const m of this.mats) { m.emissive = new THREE.Color(0x661111); }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      slowmoT = 1.6;
      SFX.slowmoRiser();
      featherBurst(_v1.copy(this.root.position).setY(2), 60, true);
      SFX.thudBig();
      endBattle(true);
    }
  }

  update(dt) {
    const p = this.root.position;
    if (this.dead) {
      // dramatic flop
      this.body.rotation.z = Math.min(this.body.rotation.z + dt * 2.4, Math.PI / 2);
      p.y = Math.max(p.y - dt * 2, 0);
      return;
    }
    // player defeated → stop attacking, do a smug victory waddle
    if (player && player.dead) {
      this.vwT = (this.vwT || 0) + dt;
      this.body.rotation.x = 0;
      p.y = Math.abs(Math.sin(this.vwT * 4.5)) * 0.55;              // little hops
      this.body.rotation.z = Math.sin(this.vwT * 4.5) * 0.16;       // waddle side to side
      this.yaw += dt * 0.7;                                          // slowly turn to survey the field
      this.root.rotation.y = this.yaw;
      if (p.y < 0.04 && Math.sin(this.vwT * 4.5) >= 0) {
        if (!this._landed) { this._landed = true; dustPuff(_v2.copy(p).setY(0.05), 3, 0.7); if (Math.random() < 0.4) SFX.quack(0.34, 0.5); }
      } else this._landed = false;
      return;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.mats) if (m.emissive) m.emissive.setRGB(0.55, 0.22, 0.16);
    } else {
      for (const m of this.mats) if (m.emissive) m.emissive.setRGB(this.enraged ? 0.35 : 0, this.enraged ? 0.05 : 0, this.enraged ? 0.05 : 0);
    }

    // squash & stretch on hits
    if (this.hurtPulse > 0.01) {
      this.hurtPulse *= Math.exp(-9 * dt);
      const q = this.hurtPulse * 0.09;
      this.body.scale.set(this.baseS * (1 + q), this.baseS * (1 - q * 1.5), this.baseS * (1 + q));
    } else this.body.scale.setScalar(this.baseS);

    const spdMul = this.enraged ? 1.35 : 1;
    const cdMul = this.enraged ? 0.6 : 1;
    this.stateT += dt;
    this.chargeCd -= dt; this.stompCd -= dt; this.peckCd -= dt; this.counterCd -= dt; this.quackCd -= dt;

    const toPlayer = _v1.copy(player.root.position).sub(p).setY(0);
    const dist = toPlayer.length() - this.bodyR;
    toPlayer.normalize();
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);

    if (this.quackCd < 0 && this.state === 'chase') {
      this.quackCd = rand(2.5, 6) * cdMul;
      SFX.quack(this.enraged ? 0.3 : 0.36, 0.5);
    }

    switch (this.state) {
      case 'chase': {
        this.yaw = lerpAngle(this.yaw, targetYaw, 3.5 * dt);
        const spd = CFG.duck.speed * spdMul;
        this.vel.x += (Math.sin(this.yaw) * spd - this.vel.x) * Math.min(4 * dt, 1);
        this.vel.z += (Math.cos(this.yaw) * spd - this.vel.z) * Math.min(4 * dt, 1);
        p.addScaledVector(this.vel, dt);
        this.bob += dt * 9 * spdMul;
        // waddle hop
        p.y = Math.abs(Math.sin(this.bob)) * 0.3;
        this.body.rotation.z = Math.sin(this.bob * 0.5) * 0.07;
        if (p.y < 0.05 && Math.sin(this.bob) < 0 && Math.random() < 0.2) dustPuff(_v2.copy(p).setY(0.05), 2, 0.6);
        // choose attack
        if (dist < 3.4 && this.peckCd <= 0) { this.setState('peckWindup'); }
        else if (this.chargeCd <= 0 && dist > 5) { this.setState('chargeWindup'); }
        else if (this.stompCd <= 0 && dist < 7) { this.setState('stompWindup'); }
        break;
      }
      case 'hopback': {
        // quick hop away, then immediate revenge peck
        p.addScaledVector(_v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -8 * dt);
        p.y = Math.sin(Math.min(this.stateT / 0.32, 1) * Math.PI) * 0.8;
        if (this.stateT > 0.32) { p.y = 0; this.peckCd = 0; this.setState('peckWindup'); }
        break;
      }
      case 'peckWindup': {
        this.yaw = lerpAngle(this.yaw, targetYaw, 6 * dt);
        this.body.rotation.x = -this.stateT / 0.3 * 0.35;
        if (this.stateT > 0.3) this.setState('peckStrike');
        break;
      }
      case 'peckStrike': {
        this.body.rotation.x = -0.35 + (this.stateT / 0.14) * 1.0;
        p.addScaledVector(_v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), dt * 11);
        if (this.stateT > 0.14) {
          const to = _v2.copy(player.root.position).sub(p).setY(0);
          const d = to.length() - this.bodyR;
          const fwd = _v3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // separate temp so `to` (_v2) isn't clobbered
          if (d < 3.1 && to.normalize().dot(fwd) > -0.35) {
            player.hurt(randInt(CFG.duck.peckDmg[0], CFG.duck.peckDmg[1]), p, 7);
            SFX.bite();
          }
          dustPuff(_v2.copy(p).addScaledVector(V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), this.bodyR + 1).setY(0.05), 4, 0.5);
          SFX.quack(rand(0.3, 0.4), 0.55); // the peck attack quacks
          this.peckCd = rand(0.8, 1.7) * cdMul;
          this.setState('peckRecover');
        }
        break;
      }
      case 'peckRecover': {
        this.body.rotation.x *= Math.exp(-8 * dt);
        if (this.stateT > 0.5) { this.body.rotation.x = 0; this.setState('chase'); }
        break;
      }
      case 'chargeWindup': {
        this.yaw = lerpAngle(this.yaw, targetYaw, 4 * dt);
        this.body.rotation.x = Math.sin(this.stateT * 4) * 0.1 - 0.28; // rear back
        p.y = Math.abs(Math.sin(this.stateT * 22)) * 0.12;
        if (this.stateT < 0.05) {
          SFX.bigQuackRoar();
          say(pick(QUIPS.duckCharge), 2);
          shake(0.1);
        }
        if (this.stateT > 0.85) {
          // lead the target: aim at where Dave is heading
          const lead = _v2.copy(player.root.position).addScaledVector(player.vel, 0.45).sub(p).setY(0).normalize();
          this.yaw = Math.atan2(lead.x, lead.z);
          this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.hitPlayerThisCharge = false;
          SFX.chargeWhoosh(); // whoosh as the duck launches into the charge
          this.setState('charging');
        }
        break;
      }
      case 'charging': {
        this.body.rotation.x = 0.15;
        const chargeSpeed = 15 * spdMul;
        if (this.stateT < 0.02) SFX.wingFlap();
        p.addScaledVector(this.chargeDir, chargeSpeed * dt);
        this.bob += dt * 26;
        p.y = Math.abs(Math.sin(this.bob)) * 0.18;
        // heavy dust trail + wake
        dustPuff(_v2.copy(p).addScaledVector(this.chargeDir, -this.bodyR).setY(0.1), 3, 1.1);
        sparkBurst(_v2.copy(p).setY(0.4), 1, 0xffffff);
        shake(0.04);
        // hit player?
        if (!this.hitPlayerThisCharge) {
          const d = _v2.copy(player.root.position).sub(p).setY(0).length() - this.bodyR;
          if (d < 1.7) {
            this.hitPlayerThisCharge = true;
            player.hurt(CFG.duck.chargeDmg, p, 13);
            player.knockdown(2.0);
            SFX.swingWhoosh(true);
            SFX.thudBig();
            shake(0.35);
            announce('💥 DIRECT HIT');
          }
        }
        const r = Math.hypot(p.x, p.z);
        if (r > ARENA_R - this.bodyR - 0.5 || this.stateT > 1.3) {
          this.body.rotation.x = 0; // clear the charge lean so the duck doesn't stay tilted forward
          if (r > ARENA_R - this.bodyR - 0.5) {
            // slam into the fence — stunned!
            SFX.thudBig(); SFX.woodCrash(); shake(0.4);
            dustPuff(_v2.copy(p).setY(0.3), 14, 1.2);
            featherBurst(_v2.copy(p).setY(1.5), 8);
            say(pick(['The duck ate the fence! Punish it, Dave!', 'CRASH! Right into the woodwork!', 'The fence did NOT consent to this.']), 2.2);
            p.multiplyScalar((ARENA_R - this.bodyR - 0.6) / r);
            this.setState('stunned');
          } else this.setState('chase');
          this.chargeCd = rand(7, 12) * cdMul;
        }
        break;
      }
      case 'stunned': {
        this.body.rotation.z = Math.sin(this.stateT * 10) * 0.12;
        p.y = 0;
        if (this.stateT > 1.5) { this.body.rotation.z = 0; this.setState('chase'); }
        break;
      }
      case 'stompWindup': {
        this.yaw = lerpAngle(this.yaw, targetYaw, 2 * dt);
        p.y = this.stateT / 0.45 * 2.4; // leap!
        this.body.rotation.x = -0.2;
        if (this.stateT < 0.03) { say(pick(QUIPS.stomp), 2); SFX.wingFlap(); }
        if (this.stateT > 0.45) this.setState('stompFall');
        break;
      }
      case 'stompFall': {
        p.y = Math.max(2.4 - (this.stateT / 0.22) * 2.4, 0);
        if (p.y <= 0) {
          this.body.rotation.x = 0;
          SFX.stompQuake();
          shake(0.5);
          dustPuff(_v2.copy(p).setY(0.1), 22, 1.4);
          spawnShockwave(p.clone(), this.bodyR + 0.5);
          this.stompCd = rand(10, 16) * cdMul;
          this.setState('chase');
        }
        break;
      }
    }

    this.root.rotation.y = this.yaw;
    // keep in arena while not charging
    if (this.state !== 'charging') {
      const r = Math.hypot(p.x, p.z);
      const lim = ARENA_R - this.bodyR * 0.7;
      if (r > lim) p.multiplyScalar(lim / r);
    }
    // push player out of body
    if (!player.dead) {
      const to = _v2.copy(player.root.position).sub(p).setY(0);
      const d = to.length();
      const minD = this.bodyR + 0.5;
      if (d < minD && d > 0.01) {
        player.root.position.addScaledVector(to.normalize(), (minD - d));
      }
    }
  }

  setState(s) { this.state = s; this.stateT = 0; }
}

// ---------------------------------------------------------------- shockwaves
// Pooled: one shared ring geometry (all shockwaves are the same shape, only scaled) + reused meshes
// in a persistent group. Avoids a per-hit geometry/material alloc + GPU buffer churn + dispose that
// used to hitch exactly when hits landed. Lives outside battleGroup so clearBattle never disposes it.
const SHOCKWAVE_GEO = new THREE.RingGeometry(0.8, 1.35, 40);
SHOCKWAVE_GEO.isShared = true;
const shockwaveGroup = new THREE.Group();
scene.add(shockwaveGroup);
const shockwavePool = [];
function spawnShockwave(pos, startR, opts = {}) {
  const { damage = true, speed = 13, maxR = 9, color = 0xd8c9a0, y = 0.08 } = opts;
  let s = shockwavePool.find(q => !q.active);
  if (!s) {
    const mesh = new THREE.Mesh(SHOCKWAVE_GEO, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    shockwaveGroup.add(mesh);
    s = { mesh, active: false, origin: new THREE.Vector3() };
    shockwavePool.push(s);
  }
  s.active = true;
  s.mesh.visible = true;
  s.mesh.material.color.set(color);
  s.mesh.material.opacity = 0.85;
  s.mesh.position.copy(pos).setY(y);
  s.mesh.scale.setScalar(startR);
  s.origin.copy(pos).setY(0); // copy, not reference — callers pass the shared _v1 temp
  s.r = startR; s.hit = !damage; s.speed = speed; s.maxR = maxR;
  shockwaves.push(s);
}
function updateShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.r += s.speed * dt;
    s.mesh.scale.setScalar(s.r);
    s.mesh.material.opacity = 0.85 * (1 - s.r / s.maxR);
    if (!s.hit && !player.dead && phase === 'battle') {
      const d = player.root.position.distanceTo(s.origin);
      if (Math.abs(d - s.r) < 0.9 && player.dodgeT < 0) {
        s.hit = true;
        player.hurt(CFG.duck.stompDmg, s.origin, 9);
        player.knockdown(1.5);
      } else if (d < s.r) s.hit = true; // wave passed while dodging
    }
    if (s.r > s.maxR) {
      s.mesh.visible = false; s.active = false; // return to pool (no dispose)
      shockwaves.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- PONY
const PONY_TINTS = [0xffffff, 0xc59a6d, 0x8a5a2b, 0x4a3728, 0xd9d9d9, 0xb0703c, 0xe8c9a0];
let biteCount = 0; // ponies currently lunging — caps swarm burst damage
let stampedeT = 0, stampedeCd = 14, lastStandDone = false; // herd tactics
let lastBiteAt = -9; // global rate limiter for starting attack ANIMATIONS
let lastDmgAt = -9;  // separate global limiter for DAMAGE, so a bigger visible swarm doesn't spike DPS
class Pony {
  constructor(i) {
    this.root = new THREE.Group();
    // Quaternius horse natively faces +Z, which is exactly the velocity heading the code assumes — no offset.
    // The wrapper stays so model.rotation.x is a clean nose pitch (rear) and rotation.z a roll (death tip).
    const raw = SkeletonUtils.clone(assets.horse.scene);
    raw.rotation.y = 0;
    const model = new THREE.Group();
    model.add(raw);
    this.sizeF = rand(0.72, 1.32);   // visible size variety, still clearly "tiny" (never ant, never duck-sized)
    applyNorm(model, assets.horseDim, CFG.pony.height * this.sizeF);
    const tint = new THREE.Color(pick(PONY_TINTS)); // one tint per horse (hoisted so multi-mesh models stay one color)
    this.mats = [];
    raw.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color = tint;
        o.frustumCulled = true;
        if (i < 32) o.castShadow = true;
        this.mats.push(o.material);
        this.mat = o.material;
        this.meshObj = o;
      }
    });
    this.model = model;   // the wrapper: rear/tip visuals rotate this (its +Z = horse forward)
    this.root.add(model);
    battleGroup.add(this.root);

    const a = (i / CFG.pony.count) * Math.PI * 2 + rand(-0.1, 0.1);
    const d = rand(ARENA_R * 0.55, ARENA_R * 0.92);
    this.root.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);

    // animation state machine — real Idle / Gallop / Attack / Death clips
    this.mixer = new THREE.AnimationMixer(raw);
    this.actions = {};
    for (const key of ['Gallop', 'Idle', 'Attack_Headbutt', 'Attack_Kick', 'Death', 'Idle_HitReact_Left']) {
      const clip = assets.horseClips[key];
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    this.cur = null;
    this.setAnim('Gallop', 0);
    this.mixer.update(rand(0, 1)); // desync gallop phases
    // Animation LOD: advance this rig's skeleton at ~30fps, phase-staggered so the 100 mixers
    // don't all recompute bone matrices on the same frame. Movement stays full-rate; only the
    // skeletal pose is throttled, which is imperceptible on a swarm of tiny, fast horses.
    this._animAcc = rand(0, ANIM_STEP);

    this.hp = CFG.pony.hp;
    this.speed = rand(CFG.pony.speed[0], CFG.pony.speed[1]) * (1.2 - this.sizeF * 0.2); // smaller = a touch faster
    this.vel = V3();
    this.yaw = rand(0, Math.PI * 2);
    this.vy = 0;
    this.airborne = false;
    this.angVel = V3();
    this.biteCd = rand(0.8, 2.6);
    this.state = 'seek';
    this.stateT = 0;
    this.dead = false;
    this.deadT = 0;
    this.flashT = 0;
    this.rear = false;
    this.getupT = 0; this.downSign = 1;
    this.circleSign = Math.random() < 0.5 ? -1 : 1;
    this.wanderA = rand(0, Math.PI * 2);
    this.biteRest = [0.35, 0.85]; // cooldown between lunges — short so the swarm is visibly attacking
  }

  // Animation LOD: accumulate frame time and only advance the skeleton once per ANIM_STEP,
  // passing the whole accumulated delta so the clip still plays at the correct speed.
  _stepMixer(dt) {
    this._animAcc += dt;
    if (this._animAcc >= ANIM_STEP) { this.mixer.update(this._animAcc); this._animAcc = 0; }
  }

  setAnim(name, fade = 0.16) {
    const a = this.actions[name];
    if (!a || a === this.cur) return;
    const once = (name === 'Attack_Headbutt' || name === 'Attack_Kick' || name === 'Death');
    a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1);
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    if (fade > 0 && this.cur) a.crossFadeFrom(this.cur, fade, false);
    a.play();
    this.cur = a;
  }

  // reflect an airborne body off the circular arena wall so ragdolls never fly past the fence
  wallBounce() {
    const p = this.root.position;
    const r = Math.hypot(p.x, p.z);
    const lim = ARENA_R - 0.5;
    if (r <= lim || r < 0.001) return;
    const nx = p.x / r, nz = p.z / r;                       // outward normal
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn > 0) {                                           // moving outward → reflect inward (restitution 0.55)
      this.vel.x -= 1.55 * vn * nx;
      this.vel.z -= 1.55 * vn * nz;
      if (this.angVel) this.angVel.multiplyScalar(0.8);
      dustPuff(_v2.copy(p).setY(0.35), 4, 0.6);
      SFX.gallopTick(0.08, 1.5);
    }
    p.x = nx * lim; p.z = nz * lim;                         // keep inside the fence
  }

  tryBite(dist) {
    if (dist < 1.7 && this.biteCd <= 0 && biteCount < 26 && battleTime - lastBiteAt > 0.03) {
      this.state = 'bite'; this.stateT = 0; this.bitDone = false; biteCount++; lastBiteAt = battleTime;
      // REAR = up on hind legs, front hooves striking (procedural tilt, neutral clip so the head stays UP);
      // HEADBUTT = the head-thrust clip. Never both — the clip's head-down would fight the rear.
      this.rear = Math.random() < 0.5;
      this.setAnim(this.rear ? 'Idle' : 'Attack_Headbutt', 0.05);
      return true;
    }
    return false;
  }

  hurt(dmg, fromPos, knock = 7) {
    if (this.dead) return;
    this.hp -= dmg;
    stats.dmgDealt += dmg;
    this.flashT = 0.1;
    damagePopup(_v1.copy(this.root.position).setY(1.0), Math.round(dmg), '#ffdd44', 0.85);
    sparkBurst(_v1.copy(this.root.position).setY(0.5), 3, 0xffe0a0);
    const dir = _v2.copy(this.root.position).sub(fromPos).setY(0).normalize();
    const dead = this.hp <= 0;
    const mega = dead && Math.random() < 0.09;                 // rare: yeeted clear across the arena
    const power = mega ? rand(3.4, 4.8) : dead ? rand(1.7, 2.6) : 1;
    this.vel.addScaledVector(dir, knock * power);
    this.vel.x += rand(-2.5, 2.5); this.vel.z += rand(-2.5, 2.5); // scatter so they don't all fly the same way
    this.vy = mega ? rand(12, 17) : dead ? rand(7.5, 12.5) : rand(3, 5);
    this.airborne = true;
    this.bounces = 0;
    const s = mega ? 2.4 : dead ? 1.5 : 0.8;
    this.angVel.set(rand(-17, 17) * s, rand(-15, 15) * s, rand(-17, 17) * s); // wild 3-axis helicopter tumble
    if (mega) damagePopup(_v1.copy(this.root.position).setY(1.3), 'YEEET!', '#ffd54a', 1.05);
    // getting knocked out of a bite always frees the attack slot (dead or not) so the counter can't leak
    if (this.state === 'bite') { biteCount = Math.max(0, biteCount - 1); this.state = 'seek'; }
    if (this.hp <= 0) {
      this.dead = true;
      this.deadT = 0;
      stats.kills++;
      killTimes.push(battleTime);
      SFX.whinny(rand(2.4, 3.2), 0.3);
      this.setAnim('Death', 0.05); // real collapse animation
      onPonyKilled();
    } else if (Math.random() < 0.4) SFX.whinny(rand(2.2, 3), 0.18);
  }

  update(dt, grid) {
    const p = this.root.position;
    if (this.dead) {
      this.deadT += dt;
      this._stepMixer(dt); // let the Death collapse animation play (throttled)
      const raw = this.model.children[0];
      // squash on ground impacts (set on each bounce)
      if (this.squashT > 0) { this.squashT -= dt; const q = Math.max(this.squashT, 0) / 0.14; raw.scale.set(1 + q * 0.4, 1 - q * 0.45, 1 + q * 0.4); }
      else raw.scale.set(1, 1, 1);
      if (this.airborne) {
        this.vy -= 26 * dt;
        p.y += this.vy * dt;
        p.addScaledVector(this.vel, dt);
        this.wallBounce();
        this.model.rotation.x += this.angVel.x * dt;
        this.model.rotation.y += this.angVel.y * dt;
        this.model.rotation.z += this.angVel.z * dt;
        if (p.y <= 0) {
          p.y = 0;
          if (this.vy < -3.5 && this.bounces < 3) {
            this.bounces++;                          // BOUNCE — comedic ragdoll
            this.vy = -this.vy * 0.46;
            this.vel.multiplyScalar(0.55);
            this.angVel.multiplyScalar(0.62);
            this.squashT = 0.14;
            dustPuff(p, 5, 0.5);
            SFX.gallopTick(0.1, rand(1.2, 1.8));
            if (Math.random() < 0.28) SFX.whinny(rand(2.7, 3.5), 0.12); // comedic yelp on impact
          } else {
            this.airborne = false;
            this.settleAt = this.deadT; // start the fade clock only once it's done flying
            this.vel.set(0, 0, 0);
            dustPuff(p, 6, 0.5);
          }
        }
      } else {
        // settle any residual tumble; the Death clip collapses the body, then fade out
        this.model.rotation.x *= Math.exp(-8 * dt);
        this.model.rotation.z *= Math.exp(-8 * dt);
        const sinceSettle = this.deadT - (this.settleAt || 0);
        if (sinceSettle > 1.0) {
          const op = 1 - (sinceSettle - 1.0) / 0.8;
          if (this.mat) { this.mat.transparent = true; this.mat.opacity = Math.max(op, 0); }
          if (op <= 0) { this.root.visible = false; this.gone = true; }
        }
      }
      return;
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.mat && this.mat.emissive) this.mat.emissive.setRGB(0.8, 0.6, 0.4);
    } else if (this.mat && this.mat.emissive) this.mat.emissive.setRGB(0, 0, 0);

    // physics: airborne from knockback
    if (this.airborne) {
      this.vy -= 22 * dt;
      p.y += this.vy * dt;
      p.addScaledVector(this.vel, dt);
      this.wallBounce();
      this.model.rotation.x += this.angVel.x * dt;
      this.model.rotation.z += this.angVel.z * dt;
      if (p.y <= 0) {
        p.y = 0; this.airborne = false;
        this.model.rotation.x = 0; this.model.rotation.z = 0; // clear the tumble so it doesn't gallop permanently tilted
        this.vel.multiplyScalar(0.3);
        dustPuff(p, 4, 0.4);
        this.state = 'seek'; this.stateT = 0;
        // a quick stumble, and only sometimes — variance without making the horde helpless
        this.getupT = Math.random() < 0.55 ? rand(0.1, 0.35) : 0;
        if (this.getupT > 0) { this.downSign = Math.random() < 0.5 ? -1 : 1; if (this.cur !== this.actions['Idle']) this.setAnim('Idle', 0.08); }
      }
      return;
    }

    // brief knocked-down stumble: rock over and pop back up within a fraction of a second
    if (this.getupT > 0) {
      this.getupT -= dt;
      this.vel.multiplyScalar(Math.exp(-9 * dt));
      p.addScaledVector(this.vel, dt);
      this.model.rotation.z = (this.getupT / 0.35) * 1.2 * this.downSign; // tips proportional to time left, rocks upright
      if (this.mat && this.mat.emissive) this.mat.emissive.setRGB(0, 0, 0);
      this._stepMixer(dt);
      if (this.getupT <= 0) this.model.rotation.z = 0;
      return;
    }

    this.stateT += dt;
    this.biteCd -= dt;
    const toP = _v1.copy(player.root.position).sub(p).setY(0);
    const dist = toP.length();
    toP.normalize();

    // steering
    const desired = _v2.set(0, 0, 0);
    if (player.dead) {
      // victory lap! circle the fallen
      const tangent = _v3.set(-toP.z, 0, toP.x).multiplyScalar(this.circleSign);
      desired.copy(tangent).multiplyScalar(this.speed).addScaledVector(toP, (dist - 3.5) * 0.6);
    } else if (this.state === 'bite') {
      if (this.stateT > 0.26 && !this.bitDone) {
        this.bitDone = true;
        if (dist < 1.3) {
          SFX.bite();
          // damage is globally rate-limited — the swarm LUNGES constantly but only a few land per second
          if (battleTime - lastDmgAt > 0.17) {
            lastDmgAt = battleTime;
            player.hurt(rand(CFG.pony.biteDmg[0], CFG.pony.biteDmg[1]), p, 1.6);
          }
        }
      }
      if (this.stateT > 0.42) { this.state = 'circle'; this.stateT = 0; this.biteCd = rand(this.biteRest[0], this.biteRest[1]); biteCount = Math.max(0, biteCount - 1); }
    } else if (this.state === 'circle') {
      if (stampedeT > 0) { this.state = 'seek'; this.stateT = 0; }
      // crowd in close (standoff ~1.1) and keep lunging from here, not just from seek
      const tangent = _v3.set(-toP.z, 0, toP.x).multiplyScalar(this.circleSign);
      desired.copy(tangent).multiplyScalar(this.speed * 0.7).addScaledVector(toP, (dist - 1.1) * 2.2);
      if (this.tryBite(dist)) { /* lunged */ }
      else if (this.stateT > rand(0.5, 1.1)) { this.state = 'seek'; this.stateT = 0; }
    } else { // seek
      this.wanderA += rand(-2, 2) * dt;
      desired.copy(toP).multiplyScalar(this.speed * (stampedeT > 0 ? 1.55 : 1));
      desired.x += Math.cos(this.wanderA) * 0.35; // less wander → they charge more head-on
      desired.z += Math.sin(this.wanderA) * 0.35;
      this.tryBite(dist);
    }

    // separation from flock neighbors
    const cx = Math.floor(p.x / 1.2), cz = Math.floor(p.z / 1.2);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const cell = grid.get((cx + ox) * 1000 + (cz + oz));
      if (!cell) continue;
      for (const q of cell) {
        if (q === this || q.dead) continue;
        const dx = p.x - q.root.position.x, dz = p.z - q.root.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.49 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          desired.x += (dx / d) * (0.7 - d) * 6;
          desired.z += (dz / d) * (0.7 - d) * 6;
        }
      }
    }

    this.vel.x += (desired.x - this.vel.x) * Math.min(5 * dt, 1);
    this.vel.z += (desired.z - this.vel.z) * Math.min(5 * dt, 1);
    p.addScaledVector(this.vel, dt);
    const r = Math.hypot(p.x, p.z);
    if (r > ARENA_R - 0.6) p.multiplyScalar((ARENA_R - 0.6) / r);

    const spd = Math.hypot(this.vel.x, this.vel.z);
    // face travel direction while running (natural forward gallop); face the player while lunging
    if (this.state === 'bite') {
      this.yaw = lerpAngle(this.yaw, Math.atan2(toP.x, toP.z), 15 * dt);
    } else if (spd > 0.15) {
      this.yaw = lerpAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 13 * dt);
    }
    this.root.rotation.y = this.yaw;

    // procedural REAR on some bites: lift front hooves off the ground (nose up), then slam down
    if (this.state === 'bite' && this.rear) {
      const up = this.stateT < 0.16 ? this.stateT / 0.16 : Math.max(0, 1 - (this.stateT - 0.16) / 0.26);
      this.model.rotation.x = -up * 0.8; // negative = front/head UP, rearing on hind legs (verified sign)
    } else {
      this.model.rotation.x *= Math.exp(-10 * dt);
    }

    // locomotion clip: gallop when moving, idle when nearly stopped (attack clip owns the bite state)
    if (this.state !== 'bite') {
      this.setAnim(spd > 1.1 ? 'Gallop' : 'Idle');
    }
    if (this.cur === this.actions['Gallop']) this.cur.setEffectiveTimeScale(clamp(spd / 3, 0.5, 1.9));
    this._stepMixer(dt);
  }
}

let killstreakAnnounced = new Set();
function onPonyKilled() {
  const alive = ponies.filter(p => !p.dead).length;
  // killstreak: kills in last 2.5s
  const recent = killTimes.filter(t => battleTime - t < 2.5).length;
  if (recent === 3) announce(pick(['🐴 TRIPLE TRAMPLE!', '🐴 HAT TRICK!']));
  else if (recent === 5) announce('🐴 PENTA-PONY!!');
  else if (recent === 8) announce('🐴 OCTO-CANTER!!!');
  else if (recent === 12) announce('🐴 UNBRIDLED CARNAGE');
  if (stats.kills === 1) { announce('FIRST BLOOD 🗡'); say('The first tiny horse has fallen. 99 grudges remain.'); }
  for (const [n, line] of [[75, '75 horses remain. They are reorganizing.'], [50, 'HALFWAY! The herd grows desperate.'], [25, 'Only 25 left. The horses whisper of retreat. They refuse.'], [10, 'TEN REMAIN. The bravest of the brave.'], [3, 'Three. Little. Horses.']]) {
    if (alive === n && !killstreakAnnounced.has(n)) { killstreakAnnounced.add(n); say(line, 3); }
  }
  if (alive <= 25 && alive > 0 && !lastStandDone) {
    lastStandDone = true;
    for (const q of ponies) if (!q.dead) { q.speed *= 1.3; q.biteRest = [1.1, 1.9]; }
    announce('🐴 NOTHING LEFT TO LOSE');
    say('The last horses have entered their final form.', 3);
  }
  if (alive === 0) endBattle(true);
}

// ---------------------------------------------------------------- gallop ambience
let gallopT = 0;
function updateHorseSounds(dt) {
  if (mode !== 'horses' || phase !== 'battle') return;
  const alive = ponies.filter(p => !p.dead && !p.airborne).length;
  SFX.setGallopVol(alive ? 0.08 + (alive / 100) * 0.3 : 0);
  if (!alive) return;
  // occasional individual hoof scuffs near the action
  gallopT -= dt;
  if (gallopT <= 0) {
    gallopT = rand(0.25, 0.7);
    SFX.gallopTick(clamp(0.03 + alive * 0.0008, 0, 0.1), rand(1.4, 1.9));
  }
  // random whinnies
  if (Math.random() < dt * 0.4) SFX.whinny(rand(2, 3.2), 0.12);
  if (Math.random() < dt * 0.15) SFX.snort(rand(1.5, 2.5));
}

// ---------------------------------------------------------------- battle lifecycle
function clearBattle() {
  if (battleGroup) {
    // free the previous battle's GPU resources: dispose per-entity cloned materials and any
    // uniquely-built geometry (slash ring, shockwaves). Shared model geometry (tagged isShared
    // at load, referenced by every SkeletonUtils clone) must NOT be disposed.
    battleGroup.traverse(o => {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.geometry && !o.geometry.isShared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) if (m && m.dispose) m.dispose();
    });
    scene.remove(battleGroup);
  }
  battleGroup = new THREE.Group();
  scene.add(battleGroup);
  ponies = [];
  duck = null;
  player = null;
  shockwaves = [];
  for (const s of shockwavePool) { s.active = false; s.mesh.visible = false; } // release pooled shockwaves
  killTimes = [];
  killstreakAnnounced = new Set();
  biteCount = 0;
  lastBiteAt = -9;
  lastDmgAt = -9;
  stampedeT = 0; stampedeCd = 14; lastStandDone = false;
  stats = { kills: 0, dmgDealt: 0, swings: 0, combo: 0, maxCombo: 0 };
  lastWordPopupAt = -9;
  _hudPfill = -1; _hudBfill = -1; _hudStats = ''; // force the HUD to redraw on the new battle's first frame
  resetCombo();
  hideCombo();
  battleTime = 0;
  timeScale = 1; slowmoT = 0; hitstopT = 0;
  // flush anything that could carry into the next battle
  idleQuipT = 6;
  commentaryTimer = 0; if (ui.commentary) ui.commentary.style.opacity = 0;
  vignetteT = 0; if (ui.vignette) ui.vignette.style.opacity = 0;
  gallopT = 0;
  for (const m of announceMsgs) m.el.remove();
  announceMsgs.length = 0;
  for (const pt of particles) { pt.alive = false; if (pt.mesh) pt.mesh.visible = false; } // stray confetti/dust
}

function startBattle(m) {
  mode = m;
  clearBattle();
  ui.menu.classList.add('hidden');
  ui.end.classList.remove('show');
  ui.hud.classList.remove('hidden');
  const rh = document.getElementById('rotateHint'); if (rh) rh.style.display = 'none';
  // a lingering pause (button or 'P') would otherwise freeze the fresh battle → "Dave just stands there"
  paused = false;
  const pb = document.getElementById('pauseBtn'); if (pb) pb.textContent = '⏸';

  player = new Player();
  player.root.position.set(0, 0, 8);
  player.yaw = Math.PI;

  if (mode === 'horses') player.retreatT = 1.6; // opening move: break out of the spawn encirclement
  SFX.stopGallop();
  if (mode === 'duck') {
    duck = new Duck();
    ui.bossname.textContent = '🦆 SIR QUACKSALOT THE ENORMOUS';
    cam.dist = 13;
  } else {
    for (let i = 0; i < CFG.pony.count; i++) ponies.push(new Pony(i));
    ui.bossname.textContent = '🐴 THE THUNDERING HUNDRED';
    cam.dist = 16;
  }

  phase = 'countdown';
  SFX.roundOne();
  let n = 3;
  const tick = () => {
    if (n > 0) {
      ui.countdown.textContent = n;
      ui.countdown.classList.remove('pop'); void ui.countdown.offsetWidth; ui.countdown.classList.add('pop');
      SFX.countBeep(false);
      n--;
      setTimeout(tick, 850);
    } else {
      ui.countdown.textContent = 'FIGHT!';
      ui.countdown.classList.remove('pop'); void ui.countdown.offsetWidth; ui.countdown.classList.add('pop');
      SFX.countBeep(true);
      if (mode === 'duck') SFX.bigQuackRoar(); else SFX.whinny(2.5, 0.4);
      phase = 'battle';
      paused = false; pauseBtn.textContent = '⏸'; // a pause pressed during the countdown must not freeze the fight
      SFX.startDrums();
      if (mode === 'horses') SFX.startGallop();
      say(mode === 'duck' ? 'One man. One absolutely enormous duck. No refunds.' : '100 tiny horses vs one guy named Dave. Place your bets.', 3.5);
      const temperLine = {
        brave: 'Dave cracks his knuckles. Today, he is BRAVE.',
        cautious: 'Dave has chosen careful, responsible violence.',
        showboat: 'Dave believes the crowd loves him. There is no crowd.',
      }[player.temper];
      setTimeout(() => { if (phase === 'battle') say(temperLine, 3); }, 4500);
    }
  };
  tick();
}

function computeGrade(victory) {
  const GC = { S: '#ffd54a', A: '#7CFC7C', B: '#8fd0ff', C: '#ffa94d', D: '#ff6b6b' };
  let letter;
  if (!victory) {
    const closeCall = mode === 'duck' ? (duck && duck.hp < duck.maxHp * 0.35) : (ponies.filter(p => !p.dead).length <= 20);
    letter = closeCall ? 'C' : 'D';
  } else {
    const hpPct = player ? player.hp / player.maxHp : 0;
    let score = hpPct * 55 + Math.min(stats.maxCombo, 40) * 1.1;
    if (battleTime < 40) score += 16; else if (battleTime < 65) score += 8;
    letter = score > 92 ? 'S' : score > 72 ? 'A' : score > 52 ? 'B' : 'C';
  }
  return { letter, color: GC[letter] };
}

function endBattle(victory) {
  if (phase === 'end') return;
  phase = 'end';
  SFX.stopDrums();
  SFX.stopGallop();
  const t = Math.floor(battleTime);
  const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  if (victory && player && !player.dead) player.startCheer();
  const statCards = [];
  statCards.push(`<div class="stat"><b>${mm}:${ss}</b><span>BATTLE TIME</span></div>`);
  if (mode === 'horses') {
    statCards.push(`<div class="stat"><b>${stats.kills}/100</b><span>PONIES FELLED</span></div>`);
  } else {
    statCards.push(`<div class="stat"><b>${Math.round(stats.dmgDealt)}</b><span>DAMAGE DEALT</span></div>`);
  }
  statCards.push(`<div class="stat"><b>${stats.maxCombo}</b><span>BEST COMBO</span></div>`);
  statCards.push(`<div class="stat"><b>${stats.swings}</b><span>PUNCHES & KICKS</span></div>`);
  ui.endstats.innerHTML = statCards.join('');

  // performance grade
  const grade = computeGrade(victory);
  if (ui.endgrade) {
    ui.endgrade.innerHTML = `<span class="glabel">RANK</span>${grade.letter}`;
    ui.endgrade.style.color = grade.color;
  }

  setTimeout(() => {
    if (victory) {
      ui.endtitle.textContent = '🏆 VICTORY';
      SFX.victoryVoice(grade.letter === 'S' || (player && player.hp >= 85));
      ui.endsub.textContent = mode === 'duck'
        ? 'Sir Quacksalot has been dethroned. The pond is silent. Dave will never eat orange sauce again.'
        : 'All 100 tiny horses have been vanquished. Dave requests a very small parade.';
      SFX.fanfare();
      confettiRain(player.root.position);
    } else {
      ui.endtitle.textContent = '💀 DEFEATED';
      ui.endsub.textContent = mode === 'duck'
        ? 'The horse-sized duck reigns supreme. Witnesses report it did a little victory waddle.'
        : `Overwhelmed by ${ponies.filter(p => !p.dead).length} remaining tiny horses. They showed no mercy. They never do.`;
      SFX.sadTrombone();
    }
    ui.end.classList.add('show');
  }, victory ? 1800 : 1400);
}

// ---------------------------------------------------------------- HUD update
// HUD write-cache: the DOM (style widths + innerHTML) only changes ~once a second, but updateHUD
// runs every frame. Writing innerHTML every frame forces a parse + style/layout recalc for nothing;
// guard each write so we only touch the DOM when the value actually changed.
let _hudPfill = -1, _hudBfill = -1, _hudStats = '';
function updateHUD() {
  if (!player) return;
  const pf = (player.hp / player.maxHp) * 100;
  if (pf !== _hudPfill) { ui.playerfill.style.width = `${pf}%`; _hudPfill = pf; }
  let alive = 0;
  if (mode === 'duck' && duck) {
    const bf = (duck.hp / duck.maxHp) * 100;
    if (bf !== _hudBfill) { ui.bossfill.style.width = `${bf}%`; _hudBfill = bf; }
  } else if (mode === 'horses') {
    for (const p of ponies) if (!p.dead) alive++; // single scan; reused by line2 below
    if (alive !== _hudBfill) { ui.bossfill.style.width = `${alive}%`; _hudBfill = alive; }
  }
  const t = Math.floor(battleTime);
  const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  const line2 = mode === 'horses' ? `🐴 ${alive} left` : `💥 ${Math.round(stats.dmgDealt)} dmg`;
  const s = `⏱ ${mm}:${ss}<br>${line2}<br>👊 ${stats.swings} thrown`;
  if (s !== _hudStats) { ui.stats.innerHTML = s; _hudStats = s; }
}

// ---------------------------------------------------------------- input / buttons
// phase guards prevent ghost-clicking a card multiple times after a mode is picked
$('pickDuck').addEventListener('click', () => { if (phase !== 'menu') return; SFX.initAudio(); SFX.uiClick(); SFX.quack(0.35, 0.6); startBattle('duck'); });
$('pickHorses').addEventListener('click', () => { if (phase !== 'menu') return; SFX.initAudio(); SFX.uiClick(); SFX.whinny(2.4, 0.4); startBattle('horses'); });
$('rematch').addEventListener('click', () => { if (phase !== 'end') return; SFX.initAudio(); SFX.uiClick(); startBattle(mode); });
$('swap').addEventListener('click', () => { if (phase !== 'end') return; SFX.initAudio(); SFX.uiClick(); startBattle(mode === 'duck' ? 'horses' : 'duck'); });
for (const id of ['pickDuck', 'pickHorses', 'rematch', 'swap']) {
  $(id).addEventListener('mouseenter', () => SFX.uiHover());
}

let paused = false;
const muteBtn = $('muteBtn'), pauseBtn = $('pauseBtn'), musicBtn = $('musicBtn'), markersBtn = $('markersBtn');
muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊'; // sync icon to initial mute state (?mute=1)
function toggleMarkers() {
  showMarkers = !showMarkers;
  markersBtn.style.opacity = showMarkers ? '1' : '0.45';
  if (!showMarkers) for (const p of popups) { p.alive = false; p.sprite.visible = false; } // clear the ones on screen
}
function toggleMute() {
  SFX.setMuted(!SFX.isMuted());
  muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊';
}
function toggleMusic() {
  SFX.initAudio();
  SFX.setMusicEnabled(!SFX.isMusicOn());
  musicBtn.textContent = SFX.isMusicOn() ? '🥁' : '🎵';
  musicBtn.style.opacity = SFX.isMusicOn() ? '1' : '0.45';
}
function togglePause() {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶' : '⏸';
}
musicBtn.addEventListener('click', toggleMusic);
markersBtn.addEventListener('click', toggleMarkers);
muteBtn.addEventListener('click', toggleMute);
pauseBtn.addEventListener('click', togglePause);
addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if (e.key === 'b' || e.key === 'B') toggleMusic();
  if (e.key === 'k' || e.key === 'K') toggleMarkers();
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('cleanhud'); // streamer clean-capture mode
});

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let frameNo = 0;

// ---- lightweight profiler (enabled with ?prof). Near-zero cost when off: each _prof call is a
// single boolean test. Accumulates per-phase ms + draw-call/triangle counts and flushes ~2x/sec.
const _profAcc = {}, _profMax = {};
let _profN = 0, _profFrameStart = 0, _profLastFlush = 0, _profEl = null;
function _prof(label, t0) {
  if (!PROF) return;
  const d = performance.now() - t0;
  _profAcc[label] = (_profAcc[label] || 0) + d;
  if (d > (_profMax[label] || 0)) _profMax[label] = d; // worst single frame in the window
}
function _profFrame() {
  if (!PROF) return;
  _profAcc.calls = (_profAcc.calls || 0) + renderer.info.render.calls;
  _profAcc.tris = (_profAcc.tris || 0) + renderer.info.render.triangles;
  const ft = performance.now() - _profFrameStart;
  _profAcc.frame = (_profAcc.frame || 0) + ft;
  if (ft > (_profMax.frame || 0)) _profMax.frame = ft;
  _profN++;
  const nowMs = performance.now();
  if (nowMs - _profLastFlush < 500) return;
  if (!_profEl) {
    _profEl = document.createElement('pre');
    _profEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;margin:0;padding:8px 10px;' +
      'background:rgba(0,0,0,.72);color:#8fd;font:11px/1.45 ui-monospace,monospace;white-space:pre;' +
      'border-radius:6px;pointer-events:none;text-shadow:0 1px 2px #000';
    document.body.appendChild(_profEl);
  }
  const n = _profN;
  const avg = k => ((_profAcc[k] || 0) / n).toFixed(2).padStart(6);
  const mx = k => (_profMax[k] || 0).toFixed(2).padStart(6);
  const fps = (1000 / ((_profAcc.frame || 1) / n)).toFixed(0);
  const alive = ponies.filter(p => !p.dead).length;
  _profEl.textContent =
    `           avg     MAX  (ms)   horses ${alive}\n` +
    `frame  ${avg('frame')}  ${mx('frame')}   fps ${fps}\n` +
    `player ${avg('player')}  ${mx('player')}\n` +
    `duck   ${avg('duck')}  ${mx('duck')}\n` +
    `ponies ${avg('ponies')}  ${mx('ponies')}\n` +
    `fx     ${avg('fx')}  ${mx('fx')}\n` +
    `render ${avg('render')}  ${mx('render')}\n` +
    `draws ${Math.round((_profAcc.calls || 0) / n)}   tris ${Math.round((_profAcc.tris || 0) / n / 1000)}k`;
  for (const k in _profAcc) _profAcc[k] = 0;
  for (const k in _profMax) _profMax[k] = 0;
  _profN = 0;
  _profLastFlush = nowMs;
}

function animate() {
  requestAnimationFrame(animate);
  frameNo++;
  if (PROF) _profFrameStart = performance.now();
  let dt = Math.min(clock.getDelta(), 0.05);

  // time effects
  if (hitstopT > 0) { hitstopT -= dt; timeScale = 0.08; }
  else if (slowmoT > 0) { slowmoT -= dt; timeScale = 0.25; }
  else timeScale += (1 - timeScale) * Math.min(6 * dt, 1);
  const sdt = paused ? 0 : dt * timeScale;

  // clouds always drift
  for (const c of clouds) {
    c.position.x += c.userData.drift * dt;
    if (c.position.x > 110) c.position.x = -110;
  }

  // idle animations during the countdown so nobody T-poses
  if (phase === 'countdown' && player && sdt > 0) {
    player.mixer.update(sdt);
    if (duck) duck.update(sdt * 0.001); // just enough to settle pose
    for (const p of ponies) p.mixer.update(sdt);
  }

  if ((phase === 'battle' || phase === 'end') && sdt > 0) {
    if (phase === 'battle') battleTime += sdt;

    let _t = PROF ? performance.now() : 0;
    player.update(sdt);
    _prof('player', _t);            // Dave: animation mixer + state machine + AI think()
    _t = PROF ? performance.now() : 0;
    if (duck) duck.update(sdt);
    _prof('duck', _t);
    if (ponies.length) {
      _t = PROF ? performance.now() : 0;
      // spatial grid for separation
      const grid = new Map();
      for (const p of ponies) {
        if (p.dead) continue;
        const key = Math.floor(p.root.position.x / 1.2) * 1000 + Math.floor(p.root.position.z / 1.2);
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(p);
      }
      _prof('grid', _t);
      _t = PROF ? performance.now() : 0;
      for (const p of ponies) if (!p.gone) p.update(sdt, grid);
      _prof('ponies', _t);          // the 100-horse loop: physics, steering, separation, mixers
    }
    updateShockwaves(sdt);
    updateHorseSounds(sdt);

    // herd tactics: periodic coordinated stampede
    if (mode === 'horses' && phase === 'battle') {
      if (stampedeT > 0) stampedeT -= sdt;
      else {
        stampedeCd -= sdt;
        if (stampedeCd <= 0) {
          const alive = ponies.filter(q => !q.dead).length;
          if (alive > 8) {
            stampedeT = 2.4;
            stampedeCd = rand(11, 18);
            announce('🐴 STAMPEDE!');
            SFX.whinny(1.6, 0.5);
            shake(0.08);
          } else stampedeCd = 6;
        }
      }
    }

    // drums intensity
    if (mode === 'duck' && duck) SFX.setDrumIntensity(duck.enraged ? 1 : 0.45 + (1 - duck.hp / duck.maxHp) * 0.4);
    else SFX.setDrumIntensity(0.3 + (stats.kills / 100) * 0.7);

    // idle quips
    if (phase === 'battle') {
      idleQuipT -= sdt;
      if (idleQuipT <= 0) {
        idleQuipT = rand(9, 15);
        if (player.hp < 30) say(pick(QUIPS.playerLow), 2.6);
        else say(pick(mode === 'duck' ? QUIPS.duckIdle : QUIPS.horsesIdle), 2.8);
      }
    }
    updateHUD();
  }

  // commentary fade
  if (commentaryTimer > 0) {
    commentaryTimer -= dt;
    if (commentaryTimer <= 0) ui.commentary.style.opacity = 0;
  }
  updateAnnounce(dt);
  updateComboUI(dt);
  // vignette fade
  if (vignetteT > 0) {
    vignetteT = Math.max(0, vignetteT - dt * 2.5);
    ui.vignette.style.opacity = vignetteT * 0.72;
  }

  // when paused sdt is 0; the `|| dt` fallback must not sneak the scene back into motion
  let _t = PROF ? performance.now() : 0;
  updateParticles(paused ? 0 : (sdt || dt * 0.2));
  updatePopups(paused ? 0 : (sdt || dt));
  _prof('fx', _t);                  // particles + damage popups (canvas/texture work)
  updateCamera(dt);
  _t = PROF ? performance.now() : 0;
  renderer.render(scene, camera);   // scene.updateMatrixWorld (all bones) + shadow pass + draw submission
  _prof('render', _t);
  _profFrame();
}

// ---------------------------------------------------------------- boot
(async function init() {
  try {
    const [dave, horse, duckG] = await Promise.all([
      loadGLB('models/Dave.glb'),
      loadGLB('models/Horse.glb'),
      loadGLB('models/Duck.glb'),
    ]);
    assets.dave = dave;
    assets.anims = dave; // clips ship inside the same GLB, native to this rig
    assets.horse = horse;
    assets.duck = duckG;
    // collapse the horse's 8 primitives into one skinned mesh BEFORE clones are ever made
    mergeSkinnedMeshes(horse.scene);
    // SkeletonUtils.clone shares these BufferGeometries with every spawned entity; tag them so
    // clearBattle()'s dispose pass never frees a geometry the next battle's clones still use.
    for (const g of [dave.scene, horse.scene, duckG.scene]) g.traverse(o => { if (o.geometry) o.geometry.isShared = true; });
    assets.daveDim = measureAsset(dave.scene);
    assets.horseDim = measureAsset(horse.scene);
    // cache horse clips by short name (strip the "AnimalArmature|" prefix)
    assets.horseClips = {};
    for (const c of horse.animations) assets.horseClips[c.name.split('|').pop()] = c;
  } catch (e) {
    ui.loading.textContent = 'FAILED TO LOAD MODELS — run from a local server (python3 -m http.server)';
    console.error(e);
    return;
  }
  buildArena();
  ui.loading.style.opacity = 0;
  setTimeout(() => ui.loading.remove(), 500);
  animate();
  window.GAME_READY = true;
  if (DEBUG) window.DBG = { get player() { return player; }, get duck() { return duck; }, get ponies() { return ponies; }, get phase() { return phase; }, get battleTime() { return battleTime; }, get stats() { return stats; }, announce, damagePopup, registerHits, comboBreak, V3, scene, camera, THREE };
  // autoplay policy: if we skipped the menu, unlock audio on first interaction
  addEventListener('pointerdown', () => SFX.initAudio(), { once: true });
  if (AUTO_PICK === 'duck' || AUTO_PICK === 'horses') {
    SFX.initAudio();
    startBattle(AUTO_PICK);
  } else {
    phase = 'menu';
    ui.menu.classList.remove('hidden');
  }
})();
