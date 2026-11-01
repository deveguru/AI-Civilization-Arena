/* Map renderer (Canvas 2D, no WebGL needed).
   One pinhole camera with adjustable pitch: 90° = classic top-down view, lower = perspective 3D.
   The ground texture is drawn in horizontal strips (rows of constant world-Y map to screen rows),
   cities / units / mountains / trees are upright billboards sorted by depth. */
const TS = 32;
const T_COL = {
  0: [22, 52, 102], 1: [40, 99, 156], 2: [222, 205, 150], 3: [104, 165, 78], 4: [164, 176, 92],
  5: [56, 112, 58], 6: [140, 132, 86], 7: [128, 122, 118], 8: [222, 192, 120], 9: [196, 208, 210],
};
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hexRgb(h) { h = h.replace('#', ''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgba(c, a) { const [r, g, b] = typeof c === 'string' ? hexRgb(c) : c; return `rgba(${r},${g},${b},${a})`; }
function shadeC(c, f) { const [r, g, b] = typeof c === 'string' ? hexRgb(c) : c; const k = v => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${k(r)},${k(g)},${k(b)})`; }
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const DEG = Math.PI / 180;

class MapRenderer {
  constructor(canvas, mini, tip) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.mini = mini; this.mctx = mini.getContext('2d');
    this.tip = tip;
    this.cam = { x: 0, y: 0, z: 1 };
    let saved = 'top';
    try { saved = localStorage.getItem('civ-view') || 'top'; } catch (e) { }
    this.mode = saved === '3d' ? '3d' : 'top';
    this.pitch3d = 44; this.pitch = this.mode === '3d' ? this.pitch3d : 90; this.pitchTarget = this.pitch;
    this.st = null; this.state = null; this.fxList = [];
    this.stateAt = 0; this.sel = null; this.hover = null; this.grid = false;
    this.onSelectCiv = null; this.onMode = null;
    this._bind();
    requestAnimationFrame(t => this._loop(t));
  }

  /* ================= data */
  setStatic(st) {
    this.st = st; this.W = st.w; this.H = st.h;
    this.tiles = Array.from(st.tiles, ch => +ch);
    this.civColor = {}; st.civs.forEach(c => this.civColor[c.id] = c.color);
    this.terrain = this._buildTerrain(true); this.terrainFlat = null;
    this.terrC = null; this.ownerKey = null; this.world = null; this.miniBase = null;
    const r = rng(st.w * 7 + st.h);
    this.clouds = Array.from({ length: 9 }, () => ({ x: r() * st.w * TS, y: r() * st.h * TS, s: 90 + r() * 170, v: 6 + r() * 10, a: .05 + r() * .06 }));
    this.bills = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i]; if (t !== 7 && t !== 5 && t !== 6) continue;
      const x = i % this.W, y = (i / this.W) | 0, rr = rng(i * 7919);
      if (t === 7) this.bills.push({ k: 'm', x: (x + .5) * TS + (rr() - .5) * 6, y: (y + .72) * TS, s: .85 + rr() * .35, snow: y < this.H * .25 || y > this.H * .78 || rr() < .5 });
      else if (t === 5) { const n = 2 + (rr() * 2 | 0); for (let j = 0; j < n; j++) this.bills.push({ k: 't', x: x * TS + 6 + rr() * (TS - 12), y: y * TS + 9 + rr() * (TS - 12), s: .75 + rr() * .5, con: y > this.H * .82 || y < this.H * .14 || rr() < .3 }); }
      else if (rr() < .55) this.bills.push({ k: 'h', x: (x + .5) * TS, y: (y + .65) * TS, s: .8 + rr() * .4 });
    }
    this.fit();
  }

  setState(s) {
    const prevTurn = this.state ? this.state.turn : null;
    this.state = s;
    if (s.owner && s.owner !== this.ownerKey) { this.ownerKey = s.owner; this._buildTerritory(); this.world = null; }
    if (s.cities) { this.cityAt = {}; s.cities.forEach(c => this.cityAt[c.x + ',' + c.y] = c); }
    if (prevTurn !== null && s.turn !== prevTurn && s.fx) {
      this.stateAt = performance.now();
      const now = performance.now();
      s.fx.slice(0, 80).forEach((f, i) => this.fxList.push(Object.assign({ t0: now + 250 + i * 70 }, f)));
    } else if (prevTurn === null) this.stateAt = performance.now() - 5000;
    this._miniDirty = true;
  }

  setMode(m) {
    this.mode = m === '3d' ? '3d' : 'top';
    this.pitchTarget = this.mode === '3d' ? this.pitch3d : 90;
    try { localStorage.setItem('civ-view', this.mode); } catch (e) { }
    if (this.mode === '3d' && this.cam.z < .6) this.cam.tz = .9;
    if (this.onMode) this.onMode(this.mode);
  }
  toggleMode() { this.setMode(this.mode === '3d' ? 'top' : '3d'); }

  /* ================= terrain */
  _buildTerrain(details) {
    const W = this.W, H = this.H, T = this.tiles, sh = this.st.shade;
    const c = document.createElement('canvas'); c.width = W * TS; c.height = H * TS;
    const g = c.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, col = T_COL[T[i]], f = .86 + sh[i] / 255 * .26;
      g.fillStyle = shadeC(col, f); g.fillRect(x * TS, y * TS, TS, TS);
    }
    const sm = document.createElement('canvas'); sm.width = W; sm.height = H;
    const sg = sm.getContext('2d'); const id = sg.createImageData(W, H); const r0 = rng(99);
    for (let i = 0; i < W * H; i++) {
      const col = T_COL[T[i]], f = .86 + sh[i] / 255 * .26 + (r0() - .5) * .06;
      id.data[i * 4] = col[0] * f; id.data[i * 4 + 1] = col[1] * f; id.data[i * 4 + 2] = col[2] * f; id.data[i * 4 + 3] = 255;
    }
    sg.putImageData(id, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.globalAlpha = .55; g.drawImage(sm, 0, 0, W * TS, H * TS); g.globalAlpha = 1;
    const lm = document.createElement('canvas'); lm.width = W; lm.height = H;
    const lg = lm.getContext('2d'); const ld = lg.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, j = Math.min(H - 1, y + 1) * W + Math.min(W - 1, x + 1);
      const v = T[i] >= 2 ? Math.max(0, Math.min(255, 128 + (sh[i] - sh[j]) * 9)) : 128;
      ld.data[i * 4] = ld.data[i * 4 + 1] = ld.data[i * 4 + 2] = v; ld.data[i * 4 + 3] = 255;
    }
    lg.putImageData(ld, 0, 0);
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = .6; g.drawImage(lm, 0, 0, W * TS, H * TS);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const nz = document.createElement('canvas'); nz.width = nz.height = 128;
    const ng = nz.getContext('2d'); const nd = ng.createImageData(128, 128); const r1 = rng(5);
    for (let i = 0; i < 128 * 128; i++) { const v = r1() * 255; nd.data[i * 4] = nd.data[i * 4 + 1] = nd.data[i * 4 + 2] = v; nd.data[i * 4 + 3] = 22; }
    ng.putImageData(nd, 0, 0);
    g.fillStyle = g.createPattern(nz, 'repeat'); g.fillRect(0, 0, W * TS, H * TS);
    const isW = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? false : T[y * W + x] < 2;
    g.lineCap = 'round';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isW(x, y)) continue;
      const px = x * TS, py = y * TS;
      for (const [dx, dy, x1, y1, x2, y2] of [[0, -1, px, py, px + TS, py], [0, 1, px, py + TS, px + TS, py + TS], [-1, 0, px, py, px, py + TS], [1, 0, px + TS, py, px + TS, py + TS]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && !isW(nx, ny)) {
          g.strokeStyle = 'rgba(235,245,255,.35)'; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(x1 - dx * 2, y1 - dy * 2); g.lineTo(x2 - dx * 2, y2 - dy * 2); g.stroke();
          g.strokeStyle = 'rgba(140,210,230,.18)'; g.lineWidth = 7;
          g.beginPath(); g.moveTo(x1 - dx * 5, y1 - dy * 5); g.lineTo(x2 - dx * 5, y2 - dy * 5); g.stroke();
        }
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = T[i], r = rng(i * 2654435761), px = x * TS, py = y * TS;
      if (t === 5) details ? this._trees(g, px, py, r, y > H * .85 || y < H * .12) : this._forestFloor(g, px, py, r);
      else if (t === 7) details ? this._mountain(g, px, py, r) : this._rock(g, px, py, r);
      else if (t === 6) { if (details) this._hills(g, px, py, r); }
      else if (t === 3 || t === 4) this._grass(g, px, py, r, t);
      else if (t === 8) this._dunes(g, px, py, r);
      else if (t === 0 && r() < .35) this._wave(g, px, py, r);
      else if (t === 9) this._snow(g, px, py, r);
    }
    for (const k in this.st.res) { const i = +k; this._resIcon(g, this.st.res[k], (i % W) * TS + TS - 9, ((i / W) | 0) * TS + 9); }
    return c;
  }
  _trees(g, px, py, r, conifer) {
    const n = 3 + (r() * 3 | 0);
    for (let k = 0; k < n; k++) {
      const x = px + 5 + r() * (TS - 10), y = py + 7 + r() * (TS - 12), s = 4 + r() * 3;
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(x + 2, y + s * .9, s * .9, s * .4, 0, 0, 7); g.fill();
      if (conifer) {
        g.fillStyle = '#244d2e'; g.beginPath(); g.moveTo(x, y - s * 1.4); g.lineTo(x + s * .8, y + s * .6); g.lineTo(x - s * .8, y + s * .6); g.fill();
        g.fillStyle = '#356b3c'; g.beginPath(); g.moveTo(x, y - s * 1.4); g.lineTo(x - s * .8, y + s * .6); g.lineTo(x, y + s * .6); g.fill();
      } else {
        g.fillStyle = '#5b3d22'; g.fillRect(x - .8, y, 1.6, s * .8);
        g.fillStyle = '#2d6331'; g.beginPath(); g.arc(x, y - s * .2, s, 0, 7); g.fill();
        g.fillStyle = '#4b8c46'; g.beginPath(); g.arc(x - s * .3, y - s * .5, s * .55, 0, 7); g.fill();
      }
    }
  }
  _forestFloor(g, px, py, r) { for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? 'rgba(20,60,25,.35)' : 'rgba(90,140,70,.25)'; g.beginPath(); g.arc(px + r() * TS, py + r() * TS, 3 + r() * 4, 0, 7); g.fill(); } }
  _rock(g, px, py, r) { g.fillStyle = 'rgba(90,85,80,.45)'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(px + r() * TS, py + r() * TS, 3 + r() * 5, 2 + r() * 3, r() * 3, 0, 7); g.fill(); } }
  _mountain(g, px, py, r) {
    const peaks = 1 + (r() < .6 ? 1 : 0);
    for (let k = 0; k < peaks; k++) {
      const cx = px + TS * (peaks === 1 ? .5 : (k ? .68 : .34)) + (r() - .5) * 4, base = py + TS - 4, hgt = 15 + r() * 9, wd = 11 + r() * 5;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(cx + 3, base, wd, 3, 0, 0, 7); g.fill();
      g.fillStyle = '#6f6862'; g.beginPath(); g.moveTo(cx, base - hgt); g.lineTo(cx + wd, base); g.lineTo(cx, base); g.fill();
      g.fillStyle = '#a19a92'; g.beginPath(); g.moveTo(cx, base - hgt); g.lineTo(cx, base); g.lineTo(cx - wd, base); g.fill();
      g.fillStyle = '#f4f6f8'; g.beginPath(); g.moveTo(cx, base - hgt); g.lineTo(cx + wd * .33, base - hgt * .66); g.lineTo(cx + wd * .1, base - hgt * .7); g.lineTo(cx - wd * .08, base - hgt * .6); g.lineTo(cx - wd * .33, base - hgt * .66); g.fill();
    }
  }
  _hills(g, px, py, r) {
    for (let k = 0; k < 2; k++) {
      const cx = px + 8 + k * 14 + r() * 4, cy = py + 18 + r() * 8 - k * 4, rw = 8 + r() * 3;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(cx + 2, cy + 1, rw, rw * .55, 0, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(255,240,200,.22)'; g.beginPath(); g.ellipse(cx - 1, cy, rw * .8, rw * .5, 0, Math.PI, Math.PI * 1.6); g.lineTo(cx - 1, cy); g.fill();
      g.strokeStyle = 'rgba(60,50,30,.35)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(cx, cy, rw, rw * .55, 0, Math.PI, 0); g.stroke();
    }
  }
  _grass(g, px, py, r, t) { g.strokeStyle = t === 3 ? 'rgba(40,90,30,.45)' : 'rgba(110,110,40,.45)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { const x = px + r() * TS, y = py + r() * TS; g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x - 1, y - 3); g.moveTo(x, y); g.lineTo(x, y - 4); g.moveTo(x + 2, y); g.lineTo(x + 1, y - 3); g.stroke(); } }
  _dunes(g, px, py, r) { g.strokeStyle = 'rgba(160,120,50,.4)'; g.lineWidth = 1.3; for (let k = 0; k < 2; k++) { const x = px + 4 + r() * 14, y = py + 8 + k * 12 + r() * 4; g.beginPath(); g.arc(x + 6, y + 6, 7, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); } }
  _wave(g, px, py, r) { g.strokeStyle = 'rgba(180,215,255,.18)'; g.lineWidth = 1.2; const x = px + 6 + r() * 14, y = py + 8 + r() * 16; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 3, y - 3, x + 6, y); g.quadraticCurveTo(x + 9, y + 3, x + 12, y); g.stroke(); }
  _snow(g, px, py, r) { g.fillStyle = 'rgba(255,255,255,.5)'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(px + r() * TS, py + r() * TS, .8 + r(), 0, 7); g.fill(); } }
  _resIcon(g, k, x, y) {
    g.save();
    g.fillStyle = 'rgba(10,14,28,.62)'; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = .8; g.stroke();
    if (k === 'wheat') { g.strokeStyle = '#f3d36b'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y - 4); for (let j = -3; j <= 1; j += 2) { g.moveTo(x, y + j); g.lineTo(x - 2.5, y + j - 2); g.moveTo(x, y + j); g.lineTo(x + 2.5, y + j - 2); } g.stroke(); }
    else if (k === 'fish') { g.fillStyle = '#8fd3ff'; g.beginPath(); g.ellipse(x - .5, y, 3.6, 2, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(x + 2.5, y); g.lineTo(x + 5, y - 2.5); g.lineTo(x + 5, y + 2.5); g.fill(); }
    else if (k === 'gold') { g.fillStyle = '#ffd34d'; g.beginPath(); g.moveTo(x - 4, y + 2.5); g.lineTo(x - 2, y - 2.5); g.lineTo(x + 2, y - 2.5); g.lineTo(x + 4, y + 2.5); g.fill(); }
    else if (k === 'iron') { g.fillStyle = '#b7c3cf'; g.fillRect(x - 3.5, y - 1.5, 7, 3.5); g.fillStyle = '#7d8894'; g.fillRect(x - 3.5, y + 1, 7, 1); }
    else if (k === 'horses') { g.strokeStyle = '#d9a066'; g.lineWidth = 1.8; g.beginPath(); g.arc(x, y, 3, Math.PI * .1, Math.PI * .9, true); g.stroke(); }
    else if (k === 'gems') { g.fillStyle = '#6ef0e0'; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 3.5, y); g.lineTo(x, y + 4); g.lineTo(x - 3.5, y); g.fill(); }
    else if (k === 'timber') { g.fillStyle = '#a1693a'; g.fillRect(x - 4, y - 2, 8, 4); g.fillStyle = '#e0b07a'; g.beginPath(); g.arc(x + 4, y, 2, 0, 7); g.fill(); }
    g.restore();
  }

  _buildTerritory() {
    const W = this.W, H = this.H, o = this.ownerKey;
    if (!this.terrC) { this.terrC = document.createElement('canvas'); this.terrC.width = W * TS; this.terrC.height = H * TS; }
    const g = this.terrC.getContext('2d'); g.clearRect(0, 0, W * TS, H * TS);
    const own = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : (o[y * W + x] === '.' ? -1 : o.charCodeAt(y * W + x) - 97);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = own(x, y); if (k < 0) continue; g.fillStyle = rgba(this.civColor[k] || '#888', .17); g.fillRect(x * TS, y * TS, TS, TS); }
    for (const pass of [0, 1]) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = own(x, y); if (k < 0) continue;
      const col = this.civColor[k] || '#888';
      g.strokeStyle = pass ? rgba(col, .95) : rgba(col, .25); g.lineWidth = pass ? 2.2 : 7; g.lineCap = 'round';
      const px = x * TS, py = y * TS, ins = pass ? 1.3 : 3.5;
      g.beginPath();
      if (own(x, y - 1) !== k) { g.moveTo(px, py + ins); g.lineTo(px + TS, py + ins); }
      if (own(x, y + 1) !== k) { g.moveTo(px, py + TS - ins); g.lineTo(px + TS, py + TS - ins); }
      if (own(x - 1, y) !== k) { g.moveTo(px + ins, py); g.lineTo(px + ins, py + TS); }
      if (own(x + 1, y) !== k) { g.moveTo(px + TS - ins, py); g.lineTo(px + TS - ins, py + TS); }
      g.stroke();
    }
  }
  _ensureWorld() {
    const flat = this.pitch < 80;
    if (this.world && this.worldFlat === flat) return;
    if (flat && !this.terrainFlat) this.terrainFlat = this._buildTerrain(false);
    if (!this.world) { this.world = document.createElement('canvas'); this.world.width = this.W * TS; this.world.height = this.H * TS; }
    const g = this.world.getContext('2d');
    g.drawImage(flat ? this.terrainFlat : this.terrain, 0, 0);
    if (this.terrC) g.drawImage(this.terrC, 0, 0);
    this.worldFlat = flat;
  }

  /* ================= camera */
  _setupCam(Wc, Hc) {
    const phi = this.pitch * DEG;
    this.sinP = Math.sin(phi); this.cosP = Math.cos(phi);
    this.F = Hc * 1.25;
    this.D = this.F / this.cam.z;
    this.Cy = this.cam.y + this.D * this.cosP; this.Cz = this.D * this.sinP;
    this.Wc = Wc; this.Hc = Hc;
    this.horizon = this.cosP < 1e-3 ? -1e9 : Hc / 2 - this.F * this.sinP / this.cosP;
    this.maxDepth = this.D * 7;
  }
  proj(X, Y, Z = 0) {
    const ry = Y - this.Cy, rz = Z - this.Cz;
    const depth = -ry * this.cosP - rz * this.sinP;
    if (depth < 2) return null;
    const up = -ry * this.sinP + rz * this.cosP;
    const k = this.F / depth;
    return { x: this.Wc / 2 + (X - this.cam.x) * k, y: this.Hc / 2 - up * k, k, depth };
  }
  unproj(sx, sy) {
    const t = (sy - this.Hc / 2) / this.F, den = t * this.cosP + this.sinP;
    if (den < 0.02) return null;
    const a = -this.Cz * (this.cosP - t * this.sinP) / den;
    const depth = -a * this.cosP + this.Cz * this.sinP;
    if (depth > this.maxDepth) return null;
    return { x: this.cam.x + (sx - this.Wc / 2) * depth / this.F, y: this.Cy + a, depth };
  }
  _up(g, X, Y) {
    const p = this.proj(X, Y); if (!p) return null;
    const d = this.dpr;
    g.setTransform(d * p.k, 0, 0, d * p.k, d * (p.x - X * p.k), d * (p.y - Y * p.k));
    return p;
  }
  _ground(g, X, Y) {
    const p = this.proj(X, Y), q = this.proj(X, Y + 1); if (!p || !q) return null;
    const gy = q.y - p.y, d = this.dpr;
    g.setTransform(d * p.k, 0, 0, d * gy, d * (p.x - X * p.k), d * (p.y - Y * gy));
    return p;
  }
  fit() {
    const r = this.cv.getBoundingClientRect();
    if (!this.st || !r.width) return;
    this.cam.z = Math.min(r.width / (this.W * TS), r.height / (this.H * TS)) * .98;
    this.cam.x = this.W * TS / 2; this.cam.y = this.H * TS / 2;
    this.cam.tx = this.cam.ty = this.cam.tz = undefined;
    if (this.mode === '3d') { this.cam.z = Math.max(this.cam.z * 1.6, .55); this.cam.y += this.H * TS * .08; }
  }
  focus(x, y, z) { this.cam.tx = (x + .5) * TS; this.cam.ty = (y + .5) * TS; if (z) this.cam.tz = z; }
  zoom(f, sx, sy) {
    const r = this.cv.getBoundingClientRect();
    sx = sx ?? r.width / 2; sy = sy ?? r.height / 2;
    this._setupCam(r.width, r.height);
    const a = this.unproj(sx, sy);
    this.cam.z = Math.max(.2, Math.min(6, this.cam.z * f));
    this._setupCam(r.width, r.height);
    const b = this.unproj(sx, sy);
    if (a && b) { this.cam.x += a.x - b.x; this.cam.y += a.y - b.y; }
    this.cam.tx = this.cam.ty = this.cam.tz = undefined;
  }
  tilt(delta) {
    if (this.mode !== '3d') return;
    this.pitch3d = Math.max(22, Math.min(78, this.pitch3d + delta));
    this.pitchTarget = this.pitch3d;
  }
  _bind() {
    const cv = this.cv; let drag = null, moved = false;
    cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY }; moved = false; cv.classList.add('drag'); });
    window.addEventListener('mouseup', e => { cv.classList.remove('drag'); if (drag && !moved && e.target === cv) this._click(e); drag = null; });
    window.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      if (drag) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true;
        this._setupCam(r.width, r.height);
        const a = this.unproj(drag.lx - r.left, drag.ly - r.top), b = this.unproj(e.clientX - r.left, e.clientY - r.top);
        if (a && b) { this.cam.x += a.x - b.x; this.cam.y += a.y - b.y; }
        else { this.cam.x -= (e.clientX - drag.lx) / this.cam.z; this.cam.y -= (e.clientY - drag.ly) / this.cam.z; }
        this._clampCam();
        drag.lx = e.clientX; drag.ly = e.clientY; this.cam.tx = undefined;
      }
      if (e.target === cv) this._hover(e.clientX - r.left, e.clientY - r.top);
      else if (this.tip) { this.tip.style.display = 'none'; this.hover = null; }
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect();
      if (e.shiftKey) this.tilt(e.deltaY < 0 ? 3 : -3);
      else this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let touch = null;
    cv.addEventListener('touchstart', e => { const t = e.touches; if (t.length === 1) touch = { lx: t[0].clientX, ly: t[0].clientY }; else if (t.length === 2) touch = { d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), z: this.cam.z }; }, { passive: true });
    cv.addEventListener('touchmove', e => {
      if (!touch) return; e.preventDefault(); const t = e.touches;
      if (t.length === 1 && touch.lx !== undefined) { this.cam.x -= (t[0].clientX - touch.lx) / this.cam.z; this.cam.y -= (t[0].clientY - touch.ly) / this.cam.z; touch.lx = t[0].clientX; touch.ly = t[0].clientY; this._clampCam(); }
      else if (t.length === 2 && touch.d) { const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); this.cam.z = Math.max(.2, Math.min(6, touch.z * d / touch.d)); }
    }, { passive: false });
    this.mini.addEventListener('click', e => { const r = this.mini.getBoundingClientRect(); this.cam.tx = (e.clientX - r.left) / this.miniSc * TS; this.cam.ty = (e.clientY - r.top) / this.miniSc * TS; });
    window.addEventListener('keydown', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const s = 60 / this.cam.z;
      if (e.key === 'ArrowLeft' || e.key === 'a') this.cam.x -= s; if (e.key === 'ArrowRight' || e.key === 'd') this.cam.x += s;
      if (e.key === 'ArrowUp' || e.key === 'w') this.cam.y -= s; if (e.key === 'ArrowDown' || e.key === 's') this.cam.y += s;
      if (e.key === '+' || e.key === '=') this.zoom(1.2); if (e.key === '-') this.zoom(1 / 1.2);
      if (e.key === 'v' || e.key === 'V') this.toggleMode();
      if (e.key === 'q') this.tilt(-4); if (e.key === 'e') this.tilt(4);
      this._clampCam();
    });
  }
  _clampCam() { if (!this.st) return; this.cam.x = Math.max(-200, Math.min(this.W * TS + 200, this.cam.x)); this.cam.y = Math.max(-200, Math.min(this.H * TS + 400, this.cam.y)); }
  _tileAt(sx, sy) { const p = this.unproj(sx, sy); if (!p) return null; const x = Math.floor(p.x / TS), y = Math.floor(p.y / TS); return (x < 0 || y < 0 || x >= this.W || y >= this.H) ? null : [x, y]; }
  _click(e) {
    const r = this.cv.getBoundingClientRect(); const t = this._tileAt(e.clientX - r.left, e.clientY - r.top);
    if (!t || !this.state) return;
    const c = this.cityAt && this.cityAt[t[0] + ',' + t[1]];
    const u = (this.state.units || []).find(u => u.x === t[0] && u.y === t[1]);
    const o = this.ownerKey ? this.ownerKey[t[1] * this.W + t[0]] : '.';
    const civ = c ? c.civ : u ? u.civ : (o !== '.' ? o.charCodeAt(0) - 97 : null);
    if (civ !== null && this.onSelectCiv) this.onSelectCiv(civ);
  }
  _hover(sx, sy) {
    const t = this._tileAt(sx, sy); this.hover = t;
    if (!t || !this.st || !this.tip) { if (this.tip) this.tip.style.display = 'none'; return; }
    const [x, y] = t, i = y * this.W + x, R = window.RULES;
    const terr = R.terrain[this.tiles[i]], res = this.st.res[i];
    const own = this.ownerKey && this.ownerKey[i] !== '.' ? this.st.civs[this.ownerKey.charCodeAt(i) - 97] : null;
    let h = `<div><b>${terr.name}</b> <span class="dim">(${x},${y})</span>${res ? ' · ' + R.resources[res] : ''}</div>`;
    if (own) h += `<div style="color:${own.color}">قلمرو ${esc(own.name)}</div>`;
    const c = this.cityAt && this.cityAt[x + ',' + y];
    if (c) {
      const cv = this.st.civs[c.civ];
      h += `<hr style="border-color:rgba(255,255,255,.1)"><div><b>${esc(c.name)}</b>${c.capital ? ' ★' : ''} — <span style="color:${cv.color}">${esc(cv.name)}</span></div>
        <div>جمعیت ${fa(c.pop)} · جان ${fa(Math.round(c.hp))}/${fa(c.maxhp)}</div>
        ${c.buildings.length ? `<div class="dim">${c.buildings.map(b => R.buildings[b]).join('، ')}</div>` : ''}
        ${c.queue.length ? `<div>در حال ساخت: ${c.queue.map(q => (R.units[q] || {}).name || R.buildings[q]).join(' ← ')}</div>` : ''}
        ${c.blocked ? `<div style="color:#ff9d9a">${esc(c.blocked)}</div>` : ''}`;
    }
    const us = (this.state && this.state.units || []).filter(u => u.x === x && u.y === y);
    for (const u of us.slice(0, 5)) { const cv = this.st.civs[u.civ]; h += `<div><span style="color:${cv.color}">●</span> ${R.units[u.type].name} · جان ${fa(Math.round(u.hp))}${u.vet ? ' · کهنه‌کار' : ''}${u.fort ? ' · سنگربندی' : ''}</div>`; }
    this.tip.innerHTML = h; this.tip.style.display = 'block';
    const r = this.cv.getBoundingClientRect();
    this.tip.style.left = Math.min(sx + 16, r.width - 290) + 'px'; this.tip.style.top = Math.min(sy + 16, r.height - 140) + 'px';
  }

  /* ================= frame */
  _loop(t) {
    requestAnimationFrame(tt => this._loop(tt));
    const cv = this.cv, dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (!r.width) return;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); if (!this._fitted && this.st) { this.fit(); this._fitted = true; } }
    this.dpr = dpr; this.time = t / 1000;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0a1730'; g.fillRect(0, 0, cv.width, cv.height);
    if (!this.st) return;
    const cam = this.cam;
    if (cam.tx !== undefined) { cam.x = lerp(cam.x, cam.tx, .12); cam.y = lerp(cam.y, cam.ty, .12); if (cam.tz) cam.z = lerp(cam.z, cam.tz, .1); if (Math.abs(cam.x - cam.tx) < .5 && Math.abs(cam.y - cam.ty) < .5 && (!cam.tz || Math.abs(cam.z - cam.tz) < .005)) cam.tx = cam.ty = cam.tz = undefined; }
    else if (cam.tz) { cam.z = lerp(cam.z, cam.tz, .1); if (Math.abs(cam.z - cam.tz) < .005) cam.tz = undefined; }
    if (Math.abs(this.pitch - this.pitchTarget) > .05) this.pitch = lerp(this.pitch, this.pitchTarget, .12); else this.pitch = this.pitchTarget;
    this._setupCam(r.width, r.height);
    this._ensureWorld();
    const persp = this.pitch < 89.5;
    if (persp) this._drawGround3D(g, r.width, r.height); else this._drawGroundTop(g);
    if (this.hover) this._tileOutline(g, this.hover[0], this.hover[1], 'rgba(255,255,255,.8)');
    if (this.state) this._objects(g, ease(Math.min(1, (performance.now() - this.stateAt) / 750)), persp, r.width, r.height);
    this._fx(g);
    if (!persp) { this._drawGroundTopTransform(g); this._clouds(g); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (persp) this._atmosphere(g, r.width, r.height);
    const now = performance.now();
    if (this._miniDirty || !this._mt || now - this._mt > 150) { this._mt = now; this._drawMini(); this._miniDirty = false; }
  }
  _drawGroundTopTransform(g) {
    const d = this.dpr, z = this.cam.z;
    g.setTransform(d * z, 0, 0, d * z, d * (this.Wc / 2 - this.cam.x * z), d * (this.Hc / 2 - this.cam.y * z));
  }
  _drawGroundTop(g) {
    this._drawGroundTopTransform(g);
    const z = this.cam.z;
    g.imageSmoothingEnabled = z < 1.6;
    g.drawImage(this.world, 0, 0);
    this._waterShimmer(g);
    if (this.grid) { g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 1 / z; g.beginPath(); for (let x = 0; x <= this.W; x++) { g.moveTo(x * TS, 0); g.lineTo(x * TS, this.H * TS); } for (let y = 0; y <= this.H; y++) { g.moveTo(0, y * TS); g.lineTo(this.W * TS, y * TS); } g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 6; g.strokeRect(-3, -3, this.W * TS + 6, this.H * TS + 6);
  }
  _drawGround3D(g, Wc, Hc) {
    const d = this.dpr, wW = this.world.width, wH = this.world.height;
    g.setTransform(d, 0, 0, d, 0, 0);
    const hor = Math.max(0, this.horizon);
    if (this.horizon > 0) {
      const sk = g.createLinearGradient(0, 0, 0, this.horizon + 2);
      sk.addColorStop(0, '#0d1b3d'); sk.addColorStop(.6, '#2c4f86'); sk.addColorStop(1, '#8fb4d8');
      g.fillStyle = sk; g.fillRect(0, 0, Wc, this.horizon + 2);
      const sun = g.createRadialGradient(Wc * .78, this.horizon - 10, 0, Wc * .78, this.horizon - 10, Hc * .4);
      sun.addColorStop(0, 'rgba(255,228,170,.55)'); sun.addColorStop(1, 'rgba(255,228,170,0)');
      g.fillStyle = sun; g.fillRect(0, 0, Wc, this.horizon + 2);
    }
    const sea = g.createLinearGradient(0, hor, 0, Hc);
    sea.addColorStop(0, '#2f5f95'); sea.addColorStop(.25, '#163866'); sea.addColorStop(1, '#0f2a52');
    g.fillStyle = sea; g.fillRect(0, hor, Wc, Hc - hor);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    const step = 2;
    for (let v = Math.floor(hor); v < Hc; v += step) {
      const a = this.unproj(Wc / 2, v), b = this.unproj(Wc / 2, v + step);
      if (!a || !b) continue;
      const y1 = a.y, y2 = b.y;
      if (y2 < 0 || y1 > wH || y2 <= y1) continue;
      const s = this.F / a.depth;
      let sx0 = this.cam.x - (Wc / 2) / s, sx1 = sx0 + Wc / s, dx0 = 0, dx1 = Wc;
      if (sx0 < 0) { dx0 = -sx0 * s; sx0 = 0; }
      if (sx1 > wW) { dx1 = Wc - (sx1 - wW) * s; sx1 = wW; }
      if (sx1 <= sx0) continue;
      const sy0 = Math.max(0, y1), sy1 = Math.min(wH, y2);
      if (sy1 - sy0 < .01) continue;
      g.drawImage(this.world, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, v, dx1 - dx0, step + .7);
    }
  }
  _atmosphere(g, Wc, Hc) {
    const hor = Math.max(0, this.horizon);
    const fogH = Math.max(40, (Hc - hor) * .3);
    const fog = g.createLinearGradient(0, hor, 0, hor + fogH);
    fog.addColorStop(0, 'rgba(143,180,216,.85)'); fog.addColorStop(1, 'rgba(143,180,216,0)');
    g.fillStyle = fog; g.fillRect(0, hor - 1, Wc, fogH);
    const vg = g.createRadialGradient(Wc / 2, Hc * .6, Hc * .35, Wc / 2, Hc * .6, Hc * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,.35)');
    g.fillStyle = vg; g.fillRect(0, 0, Wc, Hc);
  }
  _tileOutline(g, x, y, col) {
    const c = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([a, b]) => this.proj(a * TS, b * TS));
    if (c.some(p => !p)) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); c.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.stroke();
  }
  _waterShimmer(g) {
    if (this.cam.z < .45) return;
    const t = this.time, a = this.unproj(0, 0), b = this.unproj(this.Wc, this.Hc); if (!a || !b) return;
    const W = this.W;
    g.strokeStyle = 'rgba(200,230,255,.12)'; g.lineWidth = 1; g.beginPath();
    for (let y = Math.max(0, (a.y / TS) | 0); y < Math.min(this.H, b.y / TS + 1); y++) for (let x = Math.max(0, (a.x / TS) | 0); x < Math.min(W, b.x / TS + 1); x++) {
      if (this.tiles[y * W + x] > 1) continue;
      const ph = Math.sin(t * 1.3 + x * .9 + y * 1.7); if (ph < .55) continue;
      const px = x * TS + ((x * 13 + y * 7) % 18) + 4, py = y * TS + ((x * 5 + y * 11) % 20) + 6, l = 5 * ph;
      g.moveTo(px, py); g.quadraticCurveTo(px + l / 2, py - 2, px + l, py);
    }
    g.stroke();
  }
  _clouds(g) {
    const t = this.time, W = this.W * TS;
    for (const c of this.clouds) {
      const x = ((c.x + t * c.v) % (W + 400)) - 200, y = c.y;
      const gr = g.createRadialGradient(x, y, 0, x, y, c.s);
      gr.addColorStop(0, `rgba(0,0,10,${c.a})`); gr.addColorStop(1, 'rgba(0,0,10,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, c.s, 0, 7); g.fill();
    }
  }

  /* ================= objects (depth sorted) */
  _objects(g, p, persp, Wc, Hc) {
    const list = [];
    const vis = (X, Y, m = 80) => { const q = this.proj(X, Y); return q && q.x > -m && q.x < Wc + m && q.y > -m && q.y < Hc + m * 1.6 && q.depth < this.maxDepth * .9 ? q : null; };
    if (persp && this.pitch < 80) for (const b of this.bills) { const q = vis(b.x, b.y, 60); if (q && q.k > .18) list.push({ y: b.y, k: 'b', o: b }); }
    for (const c of this.state.cities || []) { const X = (c.x + .5) * TS, Y = (c.y + .5) * TS; if (vis(X, Y)) list.push({ y: Y, k: 'c', o: c }); }
    const groups = {};
    for (const u of this.state.units || []) { const k = u.x + ',' + u.y; (groups[k] = groups[k] || []).push(u); }
    for (const k in groups) {
      const us = groups[k], lead = us.find(u => u.type !== 'settler') || us[0];
      let X = (lerp(lead.px, lead.x, p) + .5) * TS, Y = (lerp(lead.py, lead.y, p) + .5) * TS;
      const incity = !!(this.cityAt && this.cityAt[k]);
      if (incity) { X -= 11; Y += 9; }
      if (vis(X, Y)) list.push({ y: Y + .1, k: 'u', o: { us, lead, X, Y, moving: (lead.px !== lead.x || lead.py !== lead.y) && p < 1, p, incity } });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.k === 'b') this._billboard(g, it.o);
      else if (it.k === 'c') this._city(g, it.o, persp);
      else this._unitGroup(g, it.o, persp);
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const it of list) if (it.k === 'c') this._cityLabel(g, it.o);
  }
  _billboard(g, b) {
    if (!this._up(g, b.x, b.y)) return;
    const x = b.x, y = b.y;
    if (b.k === 'm') {
      const s = b.s, w = 19 * s, h = 30 * s;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x + 4, y, w * 1.1, w * .32, 0, 0, 7); g.fill();
      g.fillStyle = '#5f5852'; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y); g.lineTo(x, y); g.fill();
      g.fillStyle = '#9c948b'; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x, y); g.lineTo(x - w, y); g.fill();
      g.fillStyle = '#7d756d'; g.beginPath(); g.moveTo(x - w * .55, y - h * .3); g.lineTo(x - w * .2, y - h * .55); g.lineTo(x - w * .05, y - h * .3); g.fill();
      if (b.snow) { g.fillStyle = '#f4f6f8'; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w * .34, y - h * .64); g.lineTo(x + w * .12, y - h * .68); g.lineTo(x - w * .05, y - h * .58); g.lineTo(x - w * .34, y - h * .64); g.fill(); }
    } else if (b.k === 't') {
      const s = b.s * 1.15;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x + 2, y, 5 * s, 2 * s, 0, 0, 7); g.fill();
      g.fillStyle = '#5b3d22'; g.fillRect(x - .9 * s, y - 4 * s, 1.8 * s, 4 * s);
      if (b.con) {
        g.fillStyle = '#21472a'; g.beginPath(); g.moveTo(x, y - 15 * s); g.lineTo(x + 5 * s, y - 3 * s); g.lineTo(x - 5 * s, y - 3 * s); g.fill();
        g.fillStyle = '#336a3b'; g.beginPath(); g.moveTo(x, y - 15 * s); g.lineTo(x - 5 * s, y - 3 * s); g.lineTo(x, y - 3 * s); g.fill();
      } else {
        g.fillStyle = '#2a5e2f'; g.beginPath(); g.arc(x, y - 8 * s, 5.2 * s, 0, 7); g.fill();
        g.fillStyle = '#4a8a43'; g.beginPath(); g.arc(x - 1.6 * s, y - 9.6 * s, 3 * s, 0, 7); g.fill();
      }
    } else {
      const s = b.s;
      g.fillStyle = '#8c8557'; g.beginPath(); g.ellipse(x, y, 13 * s, 8 * s, 0, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(255,240,200,.25)'; g.beginPath(); g.ellipse(x - 3 * s, y, 8 * s, 6 * s, 0, Math.PI, Math.PI * 1.55); g.lineTo(x - 3 * s, y); g.fill();
    }
  }
  _city(g, c, persp) {
    const col = this.civColor[c.civ], cx = (c.x + .5) * TS, cy = (c.y + .5) * TS, t = this.time;
    const sel = this.sel === c.civ;
    if (!this._ground(g, cx, cy)) return;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(cx + 2, cy + 3, 18, 17, 0, 0, 7); g.fill();
    const gr = g.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 17);
    gr.addColorStop(0, shadeC(col, 1.15)); gr.addColorStop(1, shadeC(col, .45));
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill();
    g.lineWidth = sel ? 2.5 : 1.5; g.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.5)'; g.stroke();
    if (c.walls) { g.strokeStyle = '#cfc6b4'; g.lineWidth = 3.4; g.setLineDash([3, 1.6]); g.beginPath(); g.arc(cx, cy, 16.8, 0, 7); g.stroke(); g.setLineDash([]); }
    if (!this._up(g, cx, cy)) return;
    if (c.walls && persp) for (const a of [-2.4, -.7, .7, 2.4]) this._box(g, cx + Math.sin(a) * 16, cy + Math.cos(a) * 6, 3, 3, 8, '#cfc6b4');
    const n = Math.min(8, 1 + Math.floor(c.pop / 2));
    const pos = [[0, 2], [-7, 5], [7, 5], [-5, -2], [5, -2], [0, 9], [-10, 1], [10, 1]];
    const order = pos.slice(0, n).map((p, i) => [p, i]).sort((a, b) => a[0][1] - b[0][1]);
    for (const [[dx, dy], k] of order) this._house(g, cx + dx, cy + dy, k === 0 ? 1.3 : 1, k === 0 && c.capital ? 11 : 5.5, k === 0 ? '#b23b2e' : '#8d4b32', k === 0 && c.capital);
    const civ = this.st.civs[c.civ], img = flagImage(civ.flag, 'c' + c.civ);
    const fx = cx + 9, fy = cy - 30;
    g.strokeStyle = '#3b2b1b'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(fx, cy - 2); g.lineTo(fx, fy - 2); g.stroke();
    g.fillStyle = '#e8c34a'; g.beginPath(); g.arc(fx, fy - 2.5, 1.4, 0, 7); g.fill();
    if (img.complete && img.naturalWidth) {
      const fw = 15, fh = 10, sl = 10;
      for (let k = 0; k < sl; k++) { const off = Math.sin(t * 5 + k * .7 + c.id) * 1.4 * (k / sl); g.drawImage(img, k * img.naturalWidth / sl, 0, img.naturalWidth / sl, img.naturalHeight, fx + k * fw / sl, fy + off, fw / sl + .4, fh); }
    }
    if (c.capital) this._star(g, cx - 12, cy - 17, 4.5, '#ffd54f');
    if (c.hp < c.maxhp - .5) {
      const bw = 26, p = Math.max(0, c.hp / c.maxhp);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(cx - bw / 2, cy - 24, bw, 3.5);
      g.fillStyle = p > .5 ? '#66bb6a' : p > .25 ? '#ffca28' : '#ef5350'; g.fillRect(cx - bw / 2, cy - 24, bw * p, 3.5);
    }
  }
  _box(g, x, y, w, d, h, col) {
    g.fillStyle = shadeC(col, .7); g.fillRect(x + w / 2, y - h, d * .6, h);
    g.fillStyle = col; g.fillRect(x - w / 2, y - h, w, h);
    g.fillStyle = shadeC(col, 1.1); g.fillRect(x - w / 2, y - h - 1.2, w + d * .6, 1.4);
  }
  _house(g, x, y, s, h, roof, tower) {
    const w = 7 * s, d = 3 * s, hh = h * s;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - w / 2 + 1, y - 1, w + d, 2);
    g.fillStyle = '#c9b996'; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2 + d, y - d * .6); g.lineTo(x + w / 2 + d, y - hh - d * .6); g.lineTo(x + w / 2, y - hh); g.fill();
    g.fillStyle = '#efe4cc'; g.fillRect(x - w / 2, y - hh, w, hh);
    g.fillStyle = '#4b3321'; g.fillRect(x - .9 * s, y - 2.8 * s, 1.8 * s, 2.8 * s);
    if (hh > 7) { g.fillStyle = '#6d5a3c'; g.fillRect(x - w / 2 + 1.2, y - hh + 2, 1.4, 1.6); g.fillRect(x + w / 2 - 2.6, y - hh + 2, 1.4, 1.6); }
    g.fillStyle = roof; g.beginPath(); g.moveTo(x - w / 2 - 1, y - hh); g.lineTo(x, y - hh - 4.5 * s); g.lineTo(x + w / 2 + 1, y - hh); g.fill();
    g.fillStyle = shadeC(roof, .7); g.beginPath(); g.moveTo(x, y - hh - 4.5 * s); g.lineTo(x + d, y - hh - 4.5 * s - d * .6); g.lineTo(x + w / 2 + 1 + d, y - hh - d * .6); g.lineTo(x + w / 2 + 1, y - hh); g.fill();
    if (tower) { g.fillStyle = '#e8c34a'; g.beginPath(); g.arc(x, y - hh - 5.5 * s, 1.3, 0, 7); g.fill(); }
  }
  _cityLabel(g, c) {
    const X = (c.x + .5) * TS, Y = (c.y + .5) * TS, p = this.proj(X, Y);
    if (!p || p.k < .32) return;
    const col = this.civColor[c.civ], sc = Math.max(.85, Math.min(1.5, p.k));
    g.save(); g.translate(p.x, p.y + 23 * Math.min(p.k, 1.6)); g.scale(sc, sc);
    g.font = '700 9.5px Vazirmatn, Tahoma, sans-serif'; g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = c.name, w = g.measureText(label).width + 26;
    g.fillStyle = 'rgba(8,12,24,.8)'; this._rr(g, -w / 2, -7.5, w, 15, 7.5); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.3; g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(w / 2 - 8, 0, 6, 0, 7); g.fill();
    g.fillStyle = lum(col) > .6 ? '#111' : '#fff'; g.font = '700 8px Vazirmatn, Tahoma'; g.fillText(String(c.pop), w / 2 - 8, .5);
    g.fillStyle = '#fff'; g.font = '700 9.5px Vazirmatn, Tahoma, sans-serif'; g.fillText(label, -4, .5);
    g.restore();
  }
  _rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  _star(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = .8; g.stroke(); }

  _unitGroup(g, o, persp) {
    const { us, lead, X, Y, moving, p, incity } = o;
    const col = this.civColor[lead.civ], s = incity ? .8 : 1;
    const bob = moving ? Math.abs(Math.sin(p * Math.PI * 4)) * 2 : 0;
    const lift = persp ? 13 * s : 0;
    if (!this._ground(g, X, Y)) return;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(X + 1.5, Y + (persp ? 1 : 8 * s), 10 * s, persp ? 8 * s : 4 * s, 0, 0, 7); g.fill();
    if (persp) { g.strokeStyle = rgba(col, .9); g.lineWidth = 2; g.beginPath(); g.arc(X, Y, 9 * s, 0, 7); g.stroke(); }
    if (!this._up(g, X, Y)) return;
    const ty = Y - lift - bob;
    if (persp) { g.strokeStyle = 'rgba(30,25,20,.9)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(X, Y); g.lineTo(X, ty + 8); g.stroke(); }
    this._token(g, lead, X, ty, s);
    if (us.length > 1) {
      g.fillStyle = '#f2c14e'; g.beginPath(); g.arc(X + 9 * s, ty - 9 * s, 5.5, 0, 7); g.fill();
      g.fillStyle = '#111'; g.font = '800 7.5px Tahoma'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(us.length, X + 9 * s, ty - 8.5 * s);
    }
  }
  _token(g, u, cx, cy, s) {
    const col = this.civColor[u.civ], R = 10.5 * s;
    const gr = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, R);
    gr.addColorStop(0, '#3a4560'); gr.addColorStop(1, '#141a2b');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.lineWidth = 2.6 * s; g.strokeStyle = col; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R - 2.5, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
    if (u.fort) { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R + 2.2, 0, 7); g.stroke(); }
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 1.6 * s; g.lineCap = 'round'; g.lineJoin = 'round';
    this._glyph(g, u.type, cx, cy, s);
    if (u.hp < 9.9) {
      const bw = 18 * s, p = Math.max(0, u.hp / 10);
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(cx - bw / 2, cy + R + 1.5, bw, 3);
      g.fillStyle = p > .5 ? '#66bb6a' : p > .25 ? '#ffca28' : '#ef5350'; g.fillRect(cx - bw / 2, cy + R + 1.5, bw * p, 3);
    }
    if (u.vet) { g.fillStyle = '#f2c14e'; for (let k = 0; k < u.vet; k++) { g.beginPath(); g.moveTo(cx - R - 1, cy - 4 + k * 3.3); g.lineTo(cx - R + 2.5, cy - 2.4 + k * 3.3); g.lineTo(cx - R - 1, cy - .8 + k * 3.3); g.fill(); } }
  }
  _glyph(g, t, x, y, s) {
    const k = s;
    g.beginPath();
    switch (t) {
      case 'settler': g.moveTo(x - 5 * k, y + 4 * k); g.lineTo(x - 5 * k, y - 1 * k); g.lineTo(x, y - 5.5 * k); g.lineTo(x + 5 * k, y - 1 * k); g.lineTo(x + 5 * k, y + 4 * k); g.closePath(); g.stroke(); g.fillRect(x - 1.2 * k, y + .5 * k, 2.4 * k, 3.5 * k); return;
      case 'warrior': g.moveTo(x - 4 * k, y + 5 * k); g.lineTo(x + 3 * k, y - 3 * k); g.stroke(); g.beginPath(); g.arc(x + 3.5 * k, y - 3.5 * k, 2.6 * k, 0, 7); g.fill(); return;
      case 'archer': g.arc(x - 2 * k, y, 6 * k, -1.2, 1.2); g.moveTo(x + .3 * k, y - 5.6 * k); g.lineTo(x + .3 * k, y + 5.6 * k); g.moveTo(x - 4 * k, y); g.lineTo(x + 5 * k, y); g.stroke(); return;
      case 'crossbowman': g.moveTo(x - 6 * k, y - 2 * k); g.quadraticCurveTo(x, y - 6 * k, x + 6 * k, y - 2 * k); g.moveTo(x, y - 4 * k); g.lineTo(x, y + 6 * k); g.moveTo(x - 6 * k, y - 2 * k); g.lineTo(x + 6 * k, y - 2 * k); g.stroke(); return;
      case 'spearman': g.moveTo(x - 5 * k, y + 5 * k); g.lineTo(x + 4 * k, y - 4 * k); g.stroke(); g.beginPath(); g.moveTo(x + 6 * k, y - 6 * k); g.lineTo(x + 2 * k, y - 4.5 * k); g.lineTo(x + 4.5 * k, y - 2 * k); g.fill(); return;
      case 'swordsman': case 'knight':
        g.moveTo(x - 4 * k, y + 5 * k); g.lineTo(x + 4.5 * k, y - 4.5 * k); g.moveTo(x - 4.5 * k, y + .5 * k); g.lineTo(x - .5 * k, y + 4.5 * k); g.stroke();
        if (t === 'knight') { g.beginPath(); g.arc(x + 1, y + 1, 7 * k, Math.PI * .65, Math.PI * 1.1); g.stroke(); }
        return;
      case 'horseman': case 'cavalry':
        g.arc(x, y + 1 * k, 4.6 * k, Math.PI * .1, Math.PI * .9, true); g.stroke();
        g.beginPath(); g.arc(x - 4.4 * k, y + 2.4 * k, .9 * k, 0, 7); g.arc(x + 4.4 * k, y + 2.4 * k, .9 * k, 0, 7); g.fill();
        if (t === 'cavalry') { g.beginPath(); g.moveTo(x - 5 * k, y - 5 * k); g.lineTo(x + 5 * k, y - 5 * k); g.stroke(); }
        return;
      case 'musketman': case 'rifleman':
        g.moveTo(x - 6 * k, y + 4 * k); g.lineTo(x + 6 * k, y - 4 * k); g.stroke(); g.beginPath(); g.moveTo(x - 6 * k, y + 4 * k); g.lineTo(x - 3.5 * k, y + 5.5 * k); g.lineTo(x - 2 * k, y + 2 * k); g.fill();
        if (t === 'rifleman') { g.beginPath(); g.moveTo(x + 6 * k, y - 4 * k); g.lineTo(x + 7.5 * k, y - 5 * k); g.stroke(); }
        return;
      case 'catapult': case 'cannon': case 'artillery':
        g.arc(x - 2 * k, y + 3 * k, 3 * k, 0, 7); g.stroke(); g.beginPath();
        if (t === 'catapult') { g.moveTo(x - 2 * k, y + 3 * k); g.lineTo(x + 5 * k, y - 5 * k); g.stroke(); g.beginPath(); g.arc(x + 5 * k, y - 5 * k, 1.6 * k, 0, 7); g.fill(); }
        else { g.lineWidth = (t === 'artillery' ? 3.4 : 2.6) * k; g.moveTo(x - 2 * k, y + 2 * k); g.lineTo(x + 6 * k, y - 3.5 * k); g.stroke(); }
        return;
      case 'tank': this._rr(g, x - 6.5 * k, y, 13 * k, 5 * k, 2.5 * k); g.fill(); g.fillRect(x - 3 * k, y - 3.5 * k, 6 * k, 4 * k); g.beginPath(); g.moveTo(x + 2 * k, y - 2 * k); g.lineTo(x + 7.5 * k, y - 3.5 * k); g.stroke(); return;
      default: g.arc(x, y, 3 * k, 0, 7); g.fill();
    }
  }

  /* ================= effects (screen space) */
  _fx(g) {
    const now = performance.now(), d = this.dpr;
    this.fxList = this.fxList.filter(f => now - f.t0 < 1600);
    g.setTransform(d, 0, 0, d, 0, 0);
    for (const f of this.fxList) {
      const e = (now - f.t0) / 1000; if (e < 0) continue;
      const T = this.proj((f.x + .5) * TS, (f.y + .5) * TS); if (!T) continue;
      const S = f.fx_ !== undefined ? (this.proj((f.fx_ + .5) * TS, (f.fy + .5) * TS) || T) : T;
      const k = T.k, col = this.civColor[f.civ] || '#fff';
      const lift = this.pitch < 89 ? 12 * k : 0;
      const tx = T.x, ty = T.y - lift, sx = S.x, sy = S.y - lift;
      if (f.k === 'ranged' || f.k === 'siege') {
        const fl = .45;
        if (e < fl) {
          const q = e / fl, arc = 22 * k + Math.hypot(tx - sx, ty - sy) * .15;
          const px = lerp(sx, tx, q), py = lerp(sy, ty, q) - Math.sin(q * Math.PI) * arc;
          const q2 = Math.max(0, q - .12), px2 = lerp(sx, tx, q2), py2 = lerp(sy, ty, q2) - Math.sin(q2 * Math.PI) * arc;
          g.strokeStyle = 'rgba(255,240,200,.45)'; g.lineWidth = 1.2 * Math.max(1, k); g.beginPath(); g.moveTo(px2, py2); g.lineTo(px, py); g.stroke();
          g.fillStyle = f.k === 'siege' ? '#ffb74d' : '#fff8e1'; g.beginPath(); g.arc(px, py, (f.k === 'siege' ? 3 : 1.8) * Math.max(1, k), 0, 7); g.fill();
        } else this._boom(g, tx, ty, (e - fl) / .7, (f.k === 'siege' ? 15 : 8) * k, f.d);
      } else if (f.k === 'melee') {
        if (e < .35) { const q = e / .35; g.strokeStyle = rgba(col, .6); g.lineWidth = 3 * k; g.beginPath(); g.moveTo(sx, sy); g.lineTo(lerp(sx, tx, .5 + q * .3), lerp(sy, ty, .5 + q * .3)); g.stroke(); }
        else this._sparks(g, lerp(sx, tx, .7), lerp(sy, ty, .7), (e - .35) / .6, f.d, f.da, sx, sy, k);
      } else if (f.k === 'capture' || f.k === 'found') {
        const q = Math.min(1, e / 1.4), X = (f.x + .5) * TS, Y = (f.y + .5) * TS;
        if (this._ground(g, X, Y)) {
          g.strokeStyle = rgba(col, 1 - q); g.lineWidth = 3 * (1 - q) + 1; g.beginPath(); g.arc(X, Y, 10 + q * 46, 0, 7); g.stroke();
          g.strokeStyle = rgba('#ffffff', (1 - q) * .7); g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y, 6 + q * 30, 0, 7); g.stroke();
          g.setTransform(d, 0, 0, d, 0, 0);
        }
        if (f.k === 'capture') { g.font = `800 ${Math.round(13 * Math.max(1, k))}px Vazirmatn, Tahoma`; g.textAlign = 'center'; g.direction = 'rtl'; g.fillStyle = rgba('#ffd54f', 1 - q); g.strokeStyle = rgba('#000', (1 - q) * .8); g.lineWidth = 3; const yy = T.y - 34 * k - q * 20; g.strokeText('فتح شد!', tx, yy); g.fillText('فتح شد!', tx, yy); }
      } else if (f.k === 'kill') {
        const q = Math.min(1, e), r = 7 * k; g.strokeStyle = rgba('#ff5252', 1 - q); g.lineWidth = 3; g.beginPath(); g.moveTo(tx - r, ty - r); g.lineTo(tx + r, ty + r); g.moveTo(tx + r, ty - r); g.lineTo(tx - r, ty + r); g.stroke();
      }
    }
  }
  _boom(g, x, y, q, r, d) {
    if (q > 1) return;
    const R = r * (.5 + q);
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(255,240,180,${1 - q})`); gr.addColorStop(.4, `rgba(255,140,40,${(1 - q) * .8})`); gr.addColorStop(1, 'rgba(80,30,10,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
    g.fillStyle = `rgba(60,55,50,${(1 - q) * .35})`; g.beginPath(); g.arc(x - R * .2, y - R * (.4 + q), R * .55, 0, 7); g.fill();
    if (d) this._dmgText(g, x, y - 14 - q * 16, '-' + d, q);
  }
  _sparks(g, x, y, q, d, da, sx, sy, k) {
    if (q > 1) return;
    g.strokeStyle = `rgba(255,236,150,${1 - q})`; g.lineWidth = 1.6;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + .3, r1 = (3 + q * 6) * k, r2 = (6 + q * 14) * k; g.beginPath(); g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); g.stroke(); }
    if (d) this._dmgText(g, x + 6, y - 12 - q * 16, '-' + d, q);
    if (da) this._dmgText(g, sx - 6, sy - 12 - q * 16, '-' + da, q, '#ffcc80');
  }
  _dmgText(g, x, y, t, q, c = '#ff6e6e') { g.font = '800 12px Tahoma'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = `rgba(0,0,0,${1 - q})`; g.strokeText(t, x, y); g.fillStyle = rgba(c, 1 - q); g.fillText(t, x, y); }

  /* ================= minimap */
  _drawMini() {
    if (!this.st) return;
    const m = this.mini, g = this.mctx, W = this.W, H = this.H;
    const sc = Math.min(200 / W, 130 / H);
    if (m.width !== Math.round(W * sc)) { m.width = Math.round(W * sc); m.height = Math.round(H * sc); }
    this.miniSc = sc;
    if (!this.miniBase) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const cg = c.getContext('2d'); const d = cg.createImageData(W, H);
      for (let i = 0; i < W * H; i++) { const col = T_COL[this.tiles[i]]; d.data[i * 4] = col[0]; d.data[i * 4 + 1] = col[1]; d.data[i * 4 + 2] = col[2]; d.data[i * 4 + 3] = 255; }
      cg.putImageData(d, 0, 0); this.miniBase = c;
    }
    g.imageSmoothingEnabled = false; g.drawImage(this.miniBase, 0, 0, m.width, m.height);
    const o = this.ownerKey;
    if (o) for (let i = 0; i < W * H; i++) { if (o[i] === '.') continue; g.fillStyle = rgba(this.civColor[o.charCodeAt(i) - 97], .55); g.fillRect((i % W) * sc, ((i / W) | 0) * sc, sc + .3, sc + .3); }
    if (this.state && this.state.cities) for (const c of this.state.cities) { g.fillStyle = '#fff'; g.fillRect(c.x * sc - 1.5, c.y * sc - 1.5, 3, 3); }
    if (this.Wc) {
      const top = Math.max(0, this.horizon + 6);
      const pts = [[0, top], [this.Wc, top], [this.Wc, this.Hc], [0, this.Hc]].map(([x, y]) => this.unproj(x, y));
      if (pts.every(Boolean)) {
        const s = sc / TS; g.strokeStyle = '#f2c14e'; g.lineWidth = 1.5; g.beginPath();
        pts.forEach((p, i) => i ? g.lineTo(p.x * s, p.y * s) : g.moveTo(p.x * s, p.y * s)); g.closePath(); g.stroke();
      }
    }
  }
}
