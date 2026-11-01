/* Spectator UI: polling, civ panel, AI thought stream, chat with leaders, events, diplomacy. */
(() => {
  const $ = id => document.getElementById(id);
  const V = {
    gid: null, st: null, s: null, ev: 0, th: 0, events: [], thoughts: [], sel: null, tab: 'thoughts',
    typed: new Set(), shown: new Set(), winnerShown: false, games: [], timer: null, chat: {}, chatBusy: false,
  };
  const rend = new MapRenderer($('map'), $('mini'), $('tip'));
  rend.onSelectCiv = cid => selectCiv(V.sel === cid ? null : cid, true);

  document.querySelectorAll('[data-ic]').forEach(e => e.innerHTML = ic(e.dataset.ic, 'sm'));
  $('adminIc').innerHTML = ic('shield', 'lg');
  $('icCivs').innerHTML = ic('users', 'sm');
  $('zin').innerHTML = ic('plus'); $('zout').innerHTML = ic('minus'); $('zfit').innerHTML = ic('fit'); $('zgrid').innerHTML = ic('grid');
  $('tup').innerHTML = ic('chevup'); $('tdown').innerHTML = ic('chevdown');
  $('zin').onclick = () => rend.zoom(1.25); $('zout').onclick = () => rend.zoom(1 / 1.25); $('zfit').onclick = () => rend.fit();
  $('zgrid').onclick = () => { rend.grid = !rend.grid; };
  $('tup').onclick = () => rend.tilt(6); $('tdown').onclick = () => rend.tilt(-6);
  const syncMode = m => {
    document.querySelectorAll('.vbtn').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('tup').style.display = $('tdown').style.display = m === '3d' ? '' : 'none';
  };
  rend.onMode = syncMode; syncMode(rend.mode);
  document.querySelectorAll('.vbtn').forEach(b => b.onclick = () => rend.setMode(b.dataset.mode));
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));

  const civ = id => V.st && V.st.civs[id];
  const civDyn = id => V.s && V.s.civs.find(c => c.id === id);
  const STATUS = { running: 'در حال اجرا', paused: 'متوقف', finished: 'پایان یافته' };
  const CATN = k => (window.RULES.categories[k] || {}).name || k;
  const CATC = k => (window.RULES.categories[k] || {}).color || '#888';

  function setTab(tab) {
    V.tab = tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $('chatbox').style.display = tab === 'chat' ? '' : 'none';
    if (tab === 'chat' && V.sel == null && V.s) { const first = V.s.civs.find(c => c.alive); if (first) selectCiv(first.id, false); }
    renderFeed(true);
    if (tab === 'chat') loadChat();
  }

  async function loadGames() {
    V.games = await api('/api/games');
    const sel = $('gsel');
    sel.innerHTML = V.games.map(g => `<option value="${g.id}">#${g.id} — ${esc(g.name)}</option>`).join('');
    if (!V.games.length) { $('empty').style.display = 'grid'; sel.style.display = 'none'; $('reportBtn').style.display = 'none'; return; }
    $('empty').style.display = 'none'; sel.style.display = ''; $('reportBtn').style.display = '';
    const q = new URLSearchParams(location.search).get('g');
    const pick = V.games.find(g => String(g.id) === q) || V.games.find(g => g.status === 'running') || V.games[0];
    sel.value = pick.id;
    sel.onchange = () => { history.replaceState(null, '', '?g=' + sel.value); openGame(+sel.value); };
    openGame(pick.id);
  }

  async function openGame(gid) {
    Object.assign(V, { gid, ev: 0, th: 0, events: [], thoughts: [], s: null, sel: null, winnerShown: false, typed: new Set(), shown: new Set(), chat: {} });
    rend.state = null; rend._fitted = false;
    V.st = await api(`/api/game/${gid}/static`);
    const g = V.games.find(x => x.id === gid);
    $('gname').textContent = g ? g.name : '';
    $('reportBtn').href = '/report/' + gid;
    rend.setStatic(V.st);
    clearTimeout(V.timer);
    await poll(true);
  }

  async function poll(first) {
    if (V.gid == null) return;
    const gid = V.gid;
    try {
      const t = V.s ? V.s.turn : -1;
      const s = await api(`/api/game/${gid}/state?ev=${V.ev}&th=${V.th}&t=${first ? -1 : t}`);
      if (gid !== V.gid) return;
      if (!s.owner && V.s) for (const k of ['owner', 'cities', 'units', 'fx', 'civs']) s[k] = V.s[k];
      const newTurn = !V.s || V.s.turn !== s.turn;
      V.s = s;
      if (s.events.length) { V.ev = s.events[s.events.length - 1].id; V.events.push(...s.events); V.events = V.events.slice(-400); if (!first) s.events.forEach(toast); }
      if (s.thoughts.length) { V.th = s.thoughts[s.thoughts.length - 1].id; V.thoughts.push(...s.thoughts); V.thoughts = V.thoughts.slice(-200); if (first) s.thoughts.forEach(t => V.typed.add(t.id)); }
      if (newTurn || first) rend.setState(s);
      renderTop(); renderCivs();
      if ((s.events.length || s.thoughts.length || first) && V.tab !== 'chat') renderFeed(first);
      if (s.winner != null && !V.winnerShown) { V.winnerShown = true; showWinner(); }
    } catch (e) { console.warn(e); }
    V.timer = setTimeout(() => poll(false), V.s && V.s.status === 'running' ? 900 : 2500);
  }

  function renderTop() {
    const s = V.s;
    $('year').textContent = s.year_label;
    $('turn').textContent = `نوبت ${fa(s.turn)} از ${fa(s.max_turns)}`;
    $('tprog').style.width = Math.min(100, s.turn / s.max_turns * 100) + '%';
    const leader = [...s.civs].filter(c => c.alive).sort((a, b) => b.score - a.score)[0];
    $('era').textContent = leader ? `پیشتاز: ${civ(leader.id).name} · عصر ${leader.era}` : '';
    const st = $('gstatus'); st.className = 'pill ' + s.status; st.textContent = STATUS[s.status] || s.status;
    st.title = s.error || '';
  }

  function renderCivs() {
    const s = V.s;
    const order = [...s.civs].sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
    $('civCount').textContent = `${fa(s.civs.filter(c => c.alive).length)} از ${fa(s.civs.length)} زنده`;
    const maxScore = Math.max(1, ...s.civs.map(c => c.score));
    $('civs').innerHTML = order.map((d, i) => {
      const c = civ(d.id);
      const rels = Object.entries(d.relations).filter(([k, v]) => v !== 'peace').map(([k, v]) => { const o = civ(+k); return o ? `<span class="rel ${v}">${ic(v === 'war' ? 'swords' : 'handshake', 'sm')}${esc(o.name)}</span>` : ''; }).join('');
      const thinking = s.thinking && s.thinking.includes(d.id);
      const rp = d.sci_cost ? Math.min(100, d.sci / d.sci_cost * 100) : 0;
      return `<div class="civ ${V.sel === d.id ? 'sel' : ''} ${d.alive ? '' : 'dead'}" style="--c:${c.color}" data-id="${d.id}">
        <span class="rank">${d.alive ? '#' + fa(i + 1) : 'نابود'}</span>
        <div class="hd">${flagHTML(c.flag, 36, 24)}
          <div><div class="nm" style="color:${c.color};filter:brightness(1.2)">${esc(c.name)}</div>
          <div class="ld">${esc(c.leader)} · ${ic(PERS_ICON[c.personality] || 'brain', 'sm')} ${esc(c.pname)}</div></div>
          <div class="sc"><b>${fa(d.score)}</b><span>امتیاز</span></div></div>
        <div style="margin-top:7px;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="model">${esc(c.model)}</span>
          ${d.last_focus ? `<span class="fchip" style="--fc:${CATC(d.last_focus)}">${CATN(d.last_focus)}</span>` : ''}
          ${thinking ? '<span class="thinking"><i></i><i></i><i></i> فکر می‌کند</span>' : ''}
          ${d.alive ? `<button class="btn ghost icon chatbtn" data-chat="${d.id}" title="گفتگو با رهبر">${ic('msg', 'sm')}</button>` : ''}</div>
        <div class="progress" style="width:100%;margin-top:7px;height:3px"><i style="width:${d.score / maxScore * 100}%;background:${c.color}"></i></div>
        <div class="stats">
          <div><b>${fa(d.cities)}</b>شهر</div><div><b>${fa(d.pop)}</b>جمعیت</div>
          <div><b>${fa(Math.round(d.military))}</b>ارتش</div><div><b>${fa(d.techs)}</b>فناوری</div>
        </div>
        <div class="res"><span><i class="rs" style="background:#ffd54f"></i>${fa(d.gold)}</span><span><i class="rs" style="background:#a1693a"></i>${fa(d.wood)}</span><span><i class="rs" style="background:#9aa5b1"></i>${fa(d.stone)}</span><span class="dim">عصر ${d.era}</span></div>
        ${d.alive && d.research_name ? `<div class="rbar">پژوهش: ${esc(d.research_name)} <span class="dim">${fa(d.sci)}/${fa(d.sci_cost)}</span><div class="progress"><i style="width:${rp}%"></i></div></div>` : ''}
        ${Object.keys(d.cats || {}).length ? `<div class="rbar">الگوی تصمیم‌گیری${stackBar(d.cats, 7)}</div>` : ''}
        ${rels ? `<div class="rels">${rels}</div>` : ''}
        ${d.plan ? `<div class="plan">${ic('crown', 'sm')} ${esc(d.plan)}</div>` : ''}
      </div>`;
    }).join('');
    document.querySelectorAll('#civs .civ').forEach(el => el.onclick = e => {
      const id = +el.dataset.id;
      if (e.target.closest('[data-chat]')) { selectCiv(id, true); setTab('chat'); return; }
      selectCiv(id === V.sel ? null : id, true);
    });
  }

  function selectCiv(cid, focus) {
    V.sel = cid; rend.sel = cid;
    renderCivs(); renderFeed(true);
    if (V.tab === 'chat') loadChat();
    if (focus && cid != null && V.s) {
      const d = civDyn(cid);
      const cap = V.s.cities.find(c => c.id === d.capital) || V.s.cities.find(c => c.civ === cid) || V.s.units.find(u => u.civ === cid);
      if (cap) rend.focus(cap.x, cap.y, Math.max(rend.cam.z, 1.1));
    }
  }

  function renderFilter() {
    const chat = V.tab === 'chat';
    const btn = (id, label, color) => `<span class="fbtn ${V.sel === id ? 'on' : ''}" data-id="${id ?? ''}">${color ? `<i class="dot" style="background:${color}"></i>` : ''}${label}</span>`;
    $('filter').innerHTML = (chat ? '' : btn(null, 'همه')) + V.st.civs.map(c => btn(c.id, esc(c.name), c.color)).join('');
    $('filter').querySelectorAll('.fbtn').forEach(b => b.onclick = () => selectCiv(b.dataset.id === '' ? null : +b.dataset.id, true));
  }

  function renderFeed() {
    if (!V.st) return;
    renderFilter();
    const feed = $('feed');
    if (V.tab === 'chat') return renderChat();
    const keepTop = feed.scrollTop < 30;
    if (V.tab === 'thoughts') {
      const list = V.thoughts.filter(t => V.sel == null || t.civ === V.sel).slice(-60).reverse();
      if (!list.length) { feed.innerHTML = `<div class="empty" style="position:static;padding:40px 20px">هنوز فکری ثبت نشده. مدل‌ها در ابتدای هر چرخه تصمیم‌گیری فکر می‌کنند.</div>`; return; }
      feed.innerHTML = list.map(thoughtHTML).join('');
      list.forEach(t => { if (!V.typed.has(t.id)) { V.typed.add(t.id); typewrite('tt' + t.id, t.thought); } });
    } else if (V.tab === 'events') {
      const list = V.events.filter(e => V.sel == null || e.civ === V.sel || (e.text && e.text.includes(civ(V.sel)?.name))).slice(-200).reverse();
      feed.innerHTML = list.map(e => `<div class="ev ${e.kind}"><span class="tn">${fa(e.turn)}</span>${ic(EV_ICON[e.kind] || 'scroll', 'sm')}<span class="tx">${esc(e.text)}</span></div>`).join('') || '<div class="empty" style="position:static;padding:40px">رویدادی نیست</div>';
    } else {
      const list = V.events.filter(e => ['message', 'diplomacy', 'war', 'peace', 'alliance'].includes(e.kind))
        .filter(e => V.sel == null || (e.data && (e.data.frm === V.sel || e.data.to === V.sel)) || (e.text || '').includes(civ(V.sel)?.name)).slice(-120).reverse();
      feed.innerHTML = list.map(e => {
        const f = e.data && e.data.frm != null ? civ(e.data.frm) : null, to = e.data && e.data.to != null ? civ(e.data.to) : null;
        if (f && e.data.msg) return `<div class="msg" style="border-inline-start:3px solid ${f.color}"><div class="hd">${flagHTML(f.flag, 22, 15)} <b style="color:${f.color}">${esc(f.name)}</b> ← ${to ? flagHTML(to.flag, 22, 15) + ' ' + esc(to.name) : ''}<span class="dim" style="margin-inline-start:auto">نوبت ${fa(e.turn)}</span></div>«${esc(e.data.msg)}»</div>`;
        return `<div class="ev ${e.kind}"><span class="tn">${fa(e.turn)}</span>${ic(EV_ICON[e.kind] || 'msg', 'sm')}<span class="tx">${esc(e.text)}</span></div>`;
      }).join('') || '<div class="empty" style="position:static;padding:40px">هنوز پیام دیپلماتیکی رد و بدل نشده</div>';
    }
    if (keepTop) feed.scrollTop = 0;
  }

  function thoughtHTML(t) {
    const c = civ(t.civ); if (!c) return '';
    const acts = (t.actions || []).slice(0, 8).map(a => `<span class="chip">${esc(a)}</span>`).join('') + ((t.actions || []).length > 8 ? `<span class="chip">+${fa(t.actions.length - 8)}</span>` : '');
    const errs = (t.errors || []).length ? `<details><summary>${fa(t.errors.length)} خطا / فرمان نامعتبر</summary>${t.errors.map(e => `<span class="chip err">${esc(e)}</span>`).join('')}</details>` : '';
    const reas = t.reasoning ? `<details><summary>استدلال درونی مدل (reasoning)</summary><pre>${esc(t.reasoning)}</pre></details>` : '';
    const isNew = !V.shown.has(t.id); V.shown.add(t.id);
    return `<div class="th ${t.fallback ? 'fb' : ''} ${isNew ? 'new' : ''}" style="--c:${c.color}">
      <div class="hd">${flagHTML(c.flag, 24, 16)}<b>${esc(c.name)}</b><span class="model">${esc(t.model)}</span>
        ${t.focus ? `<span class="fchip" style="--fc:${CATC(t.focus)}">${CATN(t.focus)}</span>` : ''}
        <span class="t">نوبت ${fa(t.turn)}${t.latency_ms ? ' · ' + fa((t.latency_ms / 1000).toFixed(1)) + 'ث' : ''}${t.tokens ? ' · ' + fa(t.tokens) + ' توکن' : ''}</span></div>
      <div class="txt" id="tt${t.id}">${V.typed.has(t.id) ? esc(t.thought) : ''}</div>
      ${t.plan ? `<div class="pl">${ic('crown', 'sm')} ${esc(t.plan)}</div>` : ''}
      ${acts ? `<div class="acts">${acts}</div>` : ''}${errs}${reas}
    </div>`;
  }

  function typewrite(id, text) {
    let i = 0; const step = Math.max(1, Math.round(text.length / 90));
    const tick = () => {
      const el = document.getElementById(id); if (!el) return;
      i = Math.min(text.length, i + step); el.textContent = text.slice(0, i);
      el.classList.toggle('caret', i < text.length);
      if (i < text.length) setTimeout(tick, 18);
    };
    tick();
  }

  /* ---------------- chat with a leader */
  async function loadChat() {
    if (V.sel == null || !V.gid) return renderChat();
    const cid = V.sel;
    try {
      const r = await api(`/api/game/${V.gid}/chat/${cid}`);
      V.chat[cid] = r;
    } catch (e) { V.chat[cid] = { allowed: false, messages: [], error: e.message }; }
    if (V.tab === 'chat' && V.sel === cid) renderChat();
  }
  function renderChat() {
    const feed = $('feed'), cid = V.sel;
    if (cid == null) { feed.innerHTML = '<div class="empty" style="position:static;padding:40px 20px">یک تمدن را انتخاب کنید تا با رهبرش گفتگو کنید.</div>'; return; }
    const c = civ(cid), d = civDyn(cid), ch = V.chat[cid] || { messages: [] };
    const head = `<div class="chathead" style="--c:${c.color}">${flagHTML(c.flag, 42, 28)}<div><b>${esc(c.leader)}</b> — رهبر ${esc(c.name)}<div class="dim"><span class="model">${esc(c.model)}</span> · ${esc(c.pname)}${d && !d.alive ? ' · نابود شده' : ''}</div></div></div>`;
    let body = '';
    if (ch.allowed === false) body += `<div class="note" style="margin:10px">گفتگو با رهبران فعلاً فقط برای مدیر فعال است. <a href="/admin">ورود به پیشخوان</a> — مدیر می‌تواند «گفتگوی عمومی» را در تنظیمات روشن کند.</div>`;
    if (!ch.messages.length) body += `<div class="dim" style="padding:14px;line-height:1.9">از ${esc(c.leader)} درباره دلیل تصمیم‌ها، نقشه‌هایش یا نظرش درباره تمدن‌های دیگر بپرسید. پاسخ را همان مدل هوش مصنوعیِ این تمدن می‌دهد و از وضعیت لحظه‌ای بازی و آخرین افکارش خبر دارد.</div>`;
    body += ch.messages.map(m => `<div class="bubble ${m.role === 'user' ? 'me' : 'them'}" style="--c:${c.color}">
      ${m.role !== 'user' ? `<div class="bh">${flagHTML(c.flag, 18, 12)} ${esc(c.leader)} <span class="dim">· نوبت ${fa(m.turn)}${m.ms ? ' · ' + fa((m.ms / 1000).toFixed(1)) + 'ث' : ''}</span></div>` : ''}
      <div class="bt" ${m.typing ? `id="ct${m.id}"` : ''}>${m.typing ? '' : esc(m.content)}</div>
      ${m.reasoning ? `<details><summary>استدلال درونی</summary><pre>${esc(m.reasoning)}</pre></details>` : ''}</div>`).join('');
    if (V.chatBusy === cid) body += `<div class="bubble them" style="--c:${c.color}"><span class="thinking"><i></i><i></i><i></i> ${esc(c.leader)} در حال پاسخ…</span></div>`;
    feed.innerHTML = head + `<div class="chatlog">${body}</div>`;
    ch.messages.filter(m => m.typing).forEach(m => { m.typing = false; typewrite('ct' + m.id, m.content); });
    feed.scrollTop = feed.scrollHeight;
    const others = V.st.civs.filter(o => o.id !== cid);
    const sug = [`چرا این راهبرد را انتخاب کردی؟`, `برنامه‌ات برای ده نوبت آینده چیست؟`, others[0] ? `نظرت درباره ${others[0].name} چیست؟` : null, `بزرگ‌ترین تهدید تو کیست؟`, `اگر جای تو بودم به چه کسی حمله می‌کردم؟`].filter(Boolean);
    $('chatSug').innerHTML = sug.map(s => `<span class="chip sug">${esc(s)}</span>`).join('');
    $('chatSug').querySelectorAll('.sug').forEach(el => el.onclick = () => { $('chatIn').value = el.textContent; sendChat(); });
    const dis = ch.allowed === false || (d && !d.alive);
    $('chatIn').disabled = $('chatSend').disabled = dis || !!V.chatBusy;
  }
  async function sendChat() {
    const cid = V.sel, msg = $('chatIn').value.trim();
    if (cid == null || !msg || V.chatBusy) return;
    const ch = V.chat[cid] = V.chat[cid] || { messages: [], allowed: true };
    ch.messages.push({ id: 'u' + Date.now(), role: 'user', content: msg, turn: V.s ? V.s.turn : 0 });
    $('chatIn').value = ''; V.chatBusy = cid; renderChat();
    try {
      const r = await api(`/api/game/${V.gid}/chat/${cid}`, { method: 'POST', body: { message: msg } });
      ch.messages.push({ id: 'l' + Date.now(), role: 'leader', content: r.reply, reasoning: r.reasoning, ms: r.ms, turn: r.turn, typing: true });
    } catch (e) {
      ch.messages.push({ id: 'e' + Date.now(), role: 'leader', content: '⚠ ' + e.message, turn: V.s ? V.s.turn : 0 });
    }
    V.chatBusy = false;
    if (V.tab === 'chat' && V.sel === cid) renderChat();
  }
  $('chatForm').onsubmit = e => { e.preventDefault(); sendChat(); };
  $('chatIn').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } };

  const TOAST_KINDS = ['war', 'capture', 'eliminated', 'victory', 'peace', 'alliance', 'era', 'contact'];
  function toast(e) {
    if (!TOAST_KINDS.includes(e.kind)) return;
    const box = $('toasts');
    const d = document.createElement('div'); d.className = 'toast ' + e.kind;
    d.innerHTML = `${ic(EV_ICON[e.kind] || 'scroll', 'sm')} ${esc(e.text)}`;
    box.prepend(d); while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  }

  function showWinner() {
    const s = V.s, w = civ(s.winner); if (!w) return;
    const vt = { domination: 'پیروزی نظامی — فتح جهان', science: 'پیروزی علمی — سفر به فضا', score: 'پیروزی امتیازی — پایان زمان' }[s.victory] || '';
    const rank = [...s.civs].sort((a, b) => (b.alive - a.alive) || b.score - a.score);
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box wide">${flagHTML(w.flag, 120, 80)}<h2>${esc(w.name)} پیروز شد!</h2>
      <div class="muted">${vt}</div><div style="margin:8px 0"><span class="model">${esc(w.model)}</span></div>
      <table class="t" style="margin-top:14px">${rank.map((d, i) => `<tr><td>${fa(i + 1)}</td><td>${flagHTML(civ(d.id).flag, 24, 16)} ${esc(civ(d.id).name)}</td><td><span class="model">${esc(civ(d.id).model)}</span></td><td style="min-width:140px">${stackBar(d.cats, 8)}</td><td><b>${fa(d.score)}</b></td></tr>`).join('')}</table>
      ${catLegend()}
      <div class="row" style="justify-content:center;margin-top:16px"><a class="btn gold" href="/report/${V.gid}" target="_blank">${ic('chart')} گزارش کامل نبرد و نمودار تصمیم‌ها</a><button class="btn">ادامه تماشا</button></div></div>`;
    m.querySelector('button').onclick = () => m.remove();
    document.body.appendChild(m);
  }

  loadGames().catch(e => { console.error(e); $('empty').style.display = 'grid'; });
  setInterval(async () => { try { const g = await api('/api/games'); if (g.length !== V.games.length) { V.games = g; if (V.gid == null) loadGames(); else { const sel = $('gsel'); const cur = sel.value; sel.innerHTML = g.map(x => `<option value="${x.id}">#${x.id} — ${esc(x.name)}</option>`).join(''); sel.value = cur; } } } catch (e) { } }, 10000);
})();
