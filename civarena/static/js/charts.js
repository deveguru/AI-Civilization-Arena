/* Small SVG chart helpers shared by the viewer, admin and battle report. */
const CATS = (window.RULES && window.RULES.categories) || {};
const CAT_KEYS = Object.keys(CATS);
const pct = v => (v * 100).toFixed(v < .1 ? 1 : 0).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) + '٪';

function catShares(obj) {
  const tot = CAT_KEYS.reduce((a, k) => a + (obj && obj[k] || 0), 0) || 1;
  return CAT_KEYS.map(k => ({ k, v: (obj && obj[k] || 0) / tot, raw: obj && obj[k] || 0, ...CATS[k] })).filter(x => x.raw > 0);
}

/* thin stacked bar of category shares */
function stackBar(obj, h = 8) {
  const s = catShares(obj);
  if (!s.length) return `<div class="sbar" style="height:${h}px"></div>`;
  return `<div class="sbar" style="height:${h}px">${s.map(x => `<i style="width:${x.v * 100}%;background:${x.color}" title="${x.name}: ${pct(x.v)}"></i>`).join('')}</div>`;
}

/* donut with center label */
function donut(obj, size = 150, label = '') {
  const s = catShares(obj), r = size / 2 - 10, c = size / 2, sw = size * .17;
  if (!s.length) return `<svg width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${sw}"/></svg>`;
  let a0 = -Math.PI / 2, out = '';
  for (const x of s) {
    const a1 = a0 + x.v * Math.PI * 2 - (s.length > 1 ? .02 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    if (s.length === 1) out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${x.color}" stroke-width="${sw}"/>`;
    else out += `<path d="M${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}" fill="none" stroke="${x.color}" stroke-width="${sw}"><title>${x.name}: ${pct(x.v)}</title></path>`;
    a0 = a1 + (s.length > 1 ? .02 : 0);
  }
  const top = s.slice().sort((a, b) => b.v - a.v)[0];
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${out}
    <text x="${c}" y="${c - 4}" text-anchor="middle" fill="${top.color}" font-size="${size * .11}" font-weight="800" font-family="Vazirmatn,Tahoma">${top.name}</text>
    <text x="${c}" y="${c + size * .1}" text-anchor="middle" fill="#a9b3cc" font-size="${size * .085}" font-family="Vazirmatn,Tahoma">${label || pct(top.v)}</text></svg>`;
}

/* horizontal bars with labels */
function barList(obj, opts = {}) {
  const s = catShares(obj).sort((a, b) => b.v - a.v);
  if (!s.length) return '<div class="dim">هنوز داده‌ای نیست</div>';
  const max = s[0].v || 1;
  return `<div class="bars">${s.map(x => `<div class="br"><span class="bl"><i class="dot" style="background:${x.color}"></i>${x.name}</span>
    <span class="bt"><i style="width:${x.v / max * 100}%;background:${x.color}"></i></span><span class="bv">${opts.count ? fa(Math.round(x.raw)) : pct(x.v)}</span></div>`).join('')}</div>`;
}

/* timeline of focus per decision */
function focusStrip(timeline, maxTurn) {
  if (!timeline || !timeline.length) return '';
  maxTurn = maxTurn || timeline[timeline.length - 1][0] || 1;
  const w = 100 / Math.max(1, timeline.length);
  return `<div class="strip">${timeline.map(([t, f]) => `<i style="width:${w}%;background:${(CATS[f] || {}).color || '#555'}" title="نوبت ${fa(t)}: ${(CATS[f] || {}).name || f}"></i>`).join('')}</div>`;
}

/* civ x category heat matrix */
function heatMatrix(rows) {
  const head = `<tr><th></th>${CAT_KEYS.map(k => `<th><i class="dot" style="background:${CATS[k].color}"></i> ${CATS[k].name}</th>`).join('')}</tr>`;
  const body = rows.map(r => {
    const s = {}; catShares(r.cats).forEach(x => s[x.k] = x.v);
    return `<tr><td class="hn">${r.label}</td>${CAT_KEYS.map(k => { const v = s[k] || 0; return `<td><span class="hc" style="background:${rgbaHex(CATS[k].color, Math.min(.95, v * 1.6 + (v ? .08 : 0)))}">${v ? pct(v) : '—'}</span></td>`; }).join('')}</tr>`;
  }).join('');
  return `<table class="heat">${head}${body}</table>`;
}
function rgbaHex(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

/* multi-line chart on canvas */
function lineChart(cv, series, colors, opts = {}) {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const W = r.width, H = r.height, pad = { l: 46, r: 14, t: 12, b: 26 };
  let maxT = 1, maxV = 1;
  for (const k in series) for (const [t, v] of series[k]) { maxT = Math.max(maxT, t); maxV = Math.max(maxV, v); }
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#6f7a96'; g.font = '11px Vazirmatn, Tahoma'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = pad.t + (H - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(Math.round(maxV * (1 - i / 4)).toLocaleString('fa-IR'), pad.l - 6, y + 4); }
  g.textAlign = 'center'; for (let i = 0; i <= 5; i++) { const x = pad.l + (W - pad.l - pad.r) * i / 5; g.fillText(Math.round(maxT * i / 5).toLocaleString('fa-IR'), x, H - 8); }
  for (const k in series) {
    g.strokeStyle = colors[k]; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath();
    series[k].forEach(([t, v], i) => { const x = pad.l + (W - pad.l - pad.r) * t / maxT, y = pad.t + (H - pad.t - pad.b) * (1 - v / maxV); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    if (opts.fill) { g.lineTo(W - pad.r, H - pad.b); g.lineTo(pad.l, H - pad.b); g.fillStyle = rgbaHex(colors[k], .08); g.fill(); }
  }
}

/* stacked area of focus categories over time for one civ (canvas) */
function focusArea(cv, timeline, bucket = 10) {
  const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const W = r.width, H = r.height;
  g.clearRect(0, 0, W, H);
  if (!timeline || !timeline.length) return;
  const maxT = timeline[timeline.length - 1][0] + 1;
  const nb = Math.max(1, Math.ceil(maxT / bucket));
  const buckets = Array.from({ length: nb }, () => ({}));
  for (const [t, f] of timeline) { const b = buckets[Math.min(nb - 1, Math.floor(t / bucket))]; b[f] = (b[f] || 0) + 1; }
  const bw = W / nb;
  buckets.forEach((b, i) => {
    const tot = Object.values(b).reduce((a, v) => a + v, 0); if (!tot) return;
    let y = H;
    for (const k of CAT_KEYS) { if (!b[k]) continue; const h = b[k] / tot * H; g.fillStyle = CATS[k].color; g.fillRect(i * bw + .5, y - h, bw - 1, h); y -= h; }
  });
}

function catLegend() { return `<div class="legendrow">${CAT_KEYS.map(k => `<span><i class="dot" style="background:${CATS[k].color}"></i>${CATS[k].name}</span>`).join('')}</div>`; }
