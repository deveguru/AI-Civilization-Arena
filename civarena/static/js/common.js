/* Shared helpers: icons, flags, fetch, formatting */
const ICONS = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  step: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>',
  scroll: '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  crown: '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  flask: '<path d="M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20L14 9V3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  castle: '<path d="M3 21V8h3V5h3v3h2V5h2v3h2V5h3v3h3v13z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
};
function ic(name, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const fa = n => (n == null ? '' : Number(n).toLocaleString('fa-IR'));

async function api(url, opts = {}) {
  const o = Object.assign({ headers: {} }, opts);
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  if ((o.method || 'GET') !== 'GET') o.headers['X-Requested-With'] = 'civarena';
  const r = await fetch(url, o);
  let j = null;
  try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j;
}

/* ---------- flags: deterministic SVG from {pattern, colors:[a,b,c], emblem} */
function lum(hex) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; }
function emblemSVG(e, cx, cy, r, col) {
  const p = [];
  if (e === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; p.push((cx + Math.cos(a) * rr).toFixed(2) + ',' + (cy + Math.sin(a) * rr).toFixed(2)); } return `<polygon points="${p.join(' ')}" fill="${col}"/>`; }
  if (e === 'sun') { let s = `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${col}"/>`; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; s += `<line x1="${cx + Math.cos(a) * r * 0.65}" y1="${cy + Math.sin(a) * r * 0.65}" x2="${cx + Math.cos(a) * r}" y2="${cy + Math.sin(a) * r}" stroke="${col}" stroke-width="${r * 0.16}" stroke-linecap="round"/>`; } return s; }
  if (e === 'crescent') return `<path d="M${cx + r * 0.2},${cy - r} a${r},${r} 0 1,0 0,${2 * r} a${r * 0.78},${r * 0.78} 0 1,1 0,${-2 * r}z" fill="${col}"/>`;
  if (e === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="${col}"/>`;
  if (e === 'diamond') return `<polygon points="${cx},${cy - r} ${cx + r * 0.7},${cy} ${cx},${cy + r} ${cx - r * 0.7},${cy}" fill="${col}"/>`;
  if (e === 'lion') { let s = ''; for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7; s += `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)} ${(cx + Math.cos(a + 0.22) * r * 0.62).toFixed(2)},${(cy + Math.sin(a + 0.22) * r * 0.62).toFixed(2)} `; } return `<polygon points="${s}" fill="${col}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${col}"/>`; }
  if (e === 'tree') return `<polygon points="${cx},${cy - r} ${cx + r * 0.75},${cy + r * 0.5} ${cx - r * 0.75},${cy + r * 0.5}" fill="${col}"/><rect x="${cx - r * 0.13}" y="${cy + r * 0.45}" width="${r * 0.26}" height="${r * 0.5}" fill="${col}"/>`;
  if (e === 'crown') return `<polygon points="${cx - r},${cy + r * 0.6} ${cx - r},${cy - r * 0.5} ${cx - r * 0.5},${cy} ${cx},${cy - r * 0.8} ${cx + r * 0.5},${cy} ${cx + r},${cy - r * 0.5} ${cx + r},${cy + r * 0.6}" fill="${col}"/>`;
  return '';
}
function flagSVG(f, w = 30, h = 20) {
  f = f || { pattern: 'plain', colors: ['#888', '#fff', '#000'], emblem: 'none' };
  const [a, b, c] = f.colors;
  let s = '';
  let ex = 15, ey = 10, er = 4.6;
  switch (f.pattern) {
    case 'tricolor_v': s = `<rect width="10" height="20" fill="${a}"/><rect x="10" width="10" height="20" fill="${b}"/><rect x="20" width="10" height="20" fill="${a === c ? b : c}"/>`; break;
    case 'tricolor_h': s = `<rect width="30" height="7" fill="${a}"/><rect y="7" width="30" height="6" fill="${b}"/><rect y="13" width="30" height="7" fill="${a}"/>`; break;
    case 'bicolor_h': s = `<rect width="30" height="10" fill="${a}"/><rect y="10" width="30" height="10" fill="${b}"/>`; break;
    case 'cross': s = `<rect width="30" height="20" fill="${a}"/><rect x="8" width="4" height="20" fill="${b}"/><rect y="8" width="30" height="4" fill="${b}"/>`; ex = 22; ey = 15; er = 3; break;
    case 'saltire': s = `<rect width="30" height="20" fill="${a}"/><path d="M0,0L30,20M30,0L0,20" stroke="${b}" stroke-width="3.5"/>`; break;
    case 'canton': s = `<rect width="30" height="20" fill="${a}"/><rect width="13" height="10" fill="${b}"/>`; ex = 6.5; ey = 5; er = 3.4; break;
    case 'diagonal': s = `<rect width="30" height="20" fill="${a}"/><polygon points="30,0 30,20 0,20" fill="${b}"/>`; break;
    case 'chevron': s = `<rect width="30" height="20" fill="${a}"/><polygon points="0,0 13,10 0,20" fill="${b}"/>`; ex = 5; er = 3.2; break;
    default: s = `<rect width="30" height="20" fill="${a}"/>`;
  }
  let ec = c;
  const bgc = (f.pattern === 'canton' || f.pattern === 'chevron') ? b : (f.pattern === 'tricolor_v' || f.pattern === 'tricolor_h' ? b : a);
  if (Math.abs(lum(ec) - lum(bgc)) < 0.25) ec = lum(bgc) > 0.5 ? '#1a1a1a' : '#ffffff';
  if (f.emblem && f.emblem !== 'none') s += emblemSVG(f.emblem, ex, ey, er, ec);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 30 20" preserveAspectRatio="none">${s}<rect width="30" height="20" fill="url(#gl)" opacity=".0"/></svg>`;
}
function flagHTML(f, w = 30, h = 20) { return `<span class="flag" style="width:${w}px;height:${h}px">${flagSVG(f, w, h)}</span>`; }
const flagImgCache = {};
function flagImage(f, key) {
  if (flagImgCache[key]) return flagImgCache[key];
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(flagSVG(f, 60, 40));
  flagImgCache[key] = img;
  return img;
}
const PERS_ICON = { aggressive: 'swords', scientific: 'flask', expansionist: 'globe', economic: 'zap', defensive: 'shield', diplomatic: 'handshake', cultural: 'crown', free: 'brain' };
const EV_ICON = { war: 'swords', capture: 'castle', peace: 'handshake', alliance: 'handshake', tech: 'flask', era: 'layers', city: 'home', victory: 'crown', eliminated: 'x', message: 'msg', diplomacy: 'msg', battle: 'swords', siege: 'castle' };
