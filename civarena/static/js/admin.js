/* Admin dashboard: games, new game wizard, results/analytics, AI web-service settings. */
(() => {
  const R = window.RULES, CFG = window.CFG;
  const page = document.getElementById('page');
  const A = { settings: null, models: [], civs: [], page: 'games', resGid: null, refresh: null };
  document.querySelectorAll('[data-ic]').forEach(e => e.innerHTML = ic(e.dataset.ic));
  document.querySelectorAll('.nav a[data-p]').forEach(a => a.onclick = () => go(a.dataset.p));
  const STATUS = { running: 'در حال اجرا', paused: 'متوقف', finished: 'پایان یافته' };
  const VICT = { domination: 'فتح جهان', science: 'علمی', score: 'امتیاز' };
  const LOCAL = 'local-bot';
  const LEMURA_CARD = `<div class="lemura"><div class="lg">L</div><div style="flex:1;line-height:1.9">
      <b>وب‌سرویس پیشنهادی: لمورا (Lemura)</b> — وب‌سرویس هوش مصنوعی <b>ایرانی، آسان و سازگار با OpenAI</b>.
      با یک کلید <code>lsk-…</code> به مدل‌های GPT، Claude، Gemini و دیگر مدل‌ها دسترسی دارید؛ قیمت‌گذاری تومانی.
      <div class="row" style="margin-top:6px;flex-wrap:wrap"><a class="btn gold" href="https://lemura.ir" target="_blank">ورود به lemura.ir و دریافت کلید</a><a class="btn" href="https://lemura.ir/docs" target="_blank">مستندات API</a></div></div></div>`;


  function go(p, arg) {
    A.page = p; clearInterval(A.refresh);
    document.querySelectorAll('.nav a[data-p]').forEach(a => a.classList.toggle('on', a.dataset.p === p));
    ({ games: pGames, new: pNew, results: pResults, analytics: pAnalytics, settings: pSettings })[p](arg);
  }
  function flash(el, msg, kind = 'ok') { el.innerHTML = `<div class="note ${kind}">${msg}</div>`; }

  async function loadSettings() { A.settings = await api('/api/admin/settings'); A.models = A.settings.models_cache || []; }
  function modelOptions(sel) {
    const groups = {};
    A.models.forEach(m => (groups[m.owned_by || 'سایر'] = groups[m.owned_by || 'سایر'] || []).push(m.id));
    let h = `<option value="${LOCAL}" ${sel === LOCAL ? 'selected' : ''}>local-bot — free built-in AI</option>`;
    for (const g of Object.keys(groups).sort()) h += `<optgroup label="${esc(g)}">${groups[g].sort().map(id => `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(id)}</option>`).join('')}</optgroup>`;
    if (sel && sel !== LOCAL && !A.models.find(m => m.id === sel)) h += `<option value="${esc(sel)}" selected>${esc(sel)}</option>`;
    return h;
  }

  /* ================================================================ games */
  async function pGames() {
    page.innerHTML = `<h1>بازی‌ها</h1><div class="sub">مدیریت بازی‌های ساخته‌شده؛ شروع، توقف، اجرای نوبت به نوبت و حذف.</div><div id="gl"></div>`;
    const draw = async () => {
      const games = await api('/api/games');
      const gl = document.getElementById('gl'); if (!gl) return;
      if (!games.length) { gl.innerHTML = `<div class="card" style="text-align:center;padding:40px"><div style="font-size:16px;margin-bottom:10px">هنوز بازی‌ای ساخته نشده است.</div><button class="btn gold" id="mk">${ic('plus')} ساخت بازی جدید</button></div>`; document.getElementById('mk').onclick = () => go('new'); return; }
      gl.innerHTML = games.map(g => `<div class="gcard">
        <div><div class="nm">#${fa(g.id)} ${esc(g.name)}</div>
          <div class="dim" style="margin-top:4px">نوبت ${fa(g.turn)} · سال ${g.year < 0 ? fa(-g.year) + ' پ.م' : fa(g.year) + ' م'} · ${new Date(g.created * 1000).toLocaleString('fa-IR')}</div>
          <div class="flags" style="margin-top:8px">${g.civs.map((c, i) => `<span title="${esc(c.name)} — ${esc(c.model)}" style="${g.winner === i ? 'outline:2px solid #f2c14e;border-radius:4px' : ''}">${flagHTML(c.flag, 30, 20)}</span>`).join('')}</div></div>
        <span class="pill ${g.status}">${STATUS[g.status] || g.status}</span>
        ${g.winner != null ? `<span class="pill finished">${ic('crown', 'sm')} ${esc(g.civs[g.winner].name)} (${VICT[g.victory] || ''})</span>` : ''}
        <div class="acts">
          <a class="btn" href="/?g=${g.id}" target="_blank">${ic('eye')} تماشا</a>
          ${g.status === 'running' ? `<button class="btn" data-a="pause" data-g="${g.id}">${ic('pause')} توقف</button>` : g.status !== 'finished' ? `<button class="btn gold" data-a="start" data-g="${g.id}">${ic('play')} اجرا</button>` : ''}
          ${g.status !== 'finished' ? `<button class="btn" data-a="step" data-g="${g.id}" title="اجرای یک نوبت">${ic('step')} یک نوبت</button>` : ''}
          <button class="btn" data-r="${g.id}">${ic('chart')} نتایج</button>
          <button class="btn red icon" data-a="delete" data-g="${g.id}" title="حذف">${ic('trash')}</button>
        </div></div>`).join('');
      gl.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        if (b.dataset.a === 'delete' && !confirm('این بازی و تمام داده‌هایش حذف شود؟')) return;
        try { await api(`/api/admin/game/${b.dataset.g}/${b.dataset.a}`, { method: 'POST', body: {} }); } catch (e) { alert(e.message); }
        draw();
      });
      gl.querySelectorAll('[data-r]').forEach(b => b.onclick = () => go('results', +b.dataset.r));
    };
    await draw();
    A.refresh = setInterval(draw, 4000);
  }

  /* ================================================================ new game */
  async function pNew() {
    await loadSettings();
    if (!A.civs.length) A.civs = (await api('/api/admin/random_setup', { method: 'POST', body: { count: 4, models: [LOCAL] } }));
    const st = A.settings;
    const noKey = !st.api_key_set;
    page.innerHTML = `<h1>ساخت بازی جدید</h1><div class="sub">تمدن‌ها، مدل هوش مصنوعی هر کدام، شخصیت، رنگ و پرچم را انتخاب کنید — یا همه چیز را تصادفی بسازید.</div>
      ${noKey ? `<div class="note err" style="margin-bottom:14px">کلید API هنوز تنظیم نشده؛ فقط «هوش محلی» کار می‌کند. <a data-go="settings">تنظیم وب‌سرویس</a></div>${LEMURA_CARD}` : ''}
      ${!A.models.length && !noKey ? `<div class="note" style="margin-bottom:14px">فهرست مدل‌ها هنوز دریافت نشده. <a data-go="settings">دریافت از وب‌سرویس</a></div>` : ''}
      <div class="card"><h2>${ic('users')} تمدن‌ها</h2>
        <div class="row" style="flex-wrap:wrap;margin-bottom:14px">
          <label class="f" style="margin:0">تعداد</label><input class="inp" id="cnt" type="number" min="2" max="10" value="${A.civs.length}" style="width:80px">
          <button class="btn" id="apCnt">اعمال تعداد</button>
          <button class="btn gold" id="rndAll">${ic('dice')} همه چیز تصادفی</button>
          <button class="btn" id="rndModels">${ic('dice')} فقط مدل‌ها تصادفی</button>
          <button class="btn" id="rndPers">${ic('dice')} شخصیت‌ها تصادفی</button>
          <button class="btn" id="addCiv">${ic('plus')} افزودن تمدن</button>
        </div>
        <details style="margin-bottom:12px"><summary class="muted" style="cursor:pointer">مدل‌های مجاز برای انتخاب تصادفی (${fa(A.models.length + 1)} مدل)</summary>
          <div style="max-height:220px;overflow:auto;margin-top:8px;columns:3 220px" id="pool">
            <label class="switch"><input type="checkbox" value="${LOCAL}" ${noKey ? 'checked' : ''}> هوش محلی</label><br>
            ${A.models.map(m => `<label class="switch"><input type="checkbox" value="${esc(m.id)}" checked> <span class="model">${esc(m.id)}</span></label><br>`).join('')}
          </div></details>
        <div class="civrow dim" style="background:none;border:none;padding:0 8px;font-size:11.5px"><span>رنگ</span><span>پرچم</span><span>نام تمدن</span><span>رهبر</span><span>مدل هوش مصنوعی</span><span>شخصیت</span><span></span></div>
        <div id="rows"></div>
      </div>
      <div class="card"><h2>${ic('globe')} جهان و زمان</h2>
        <div class="grid3">
          <div class="field"><label class="f">نام بازی</label><input class="inp" id="gname" placeholder="مثلاً: جنگ مدل‌ها — دور اول"></div>
          <div class="field"><label class="f">اندازه نقشه</label><select class="inp" id="msize">${Object.entries(CFG.sizes).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${{ small: 'کوچک', medium: 'متوسط', large: 'بزرگ', huge: 'خیلی بزرگ' }[k]} (${v[0]}×${v[1]})</option>`).join('')}</select></div>
          <div class="field"><label class="f">بذر نقشه (خالی = تصادفی)</label><input class="inp" id="seed" type="number" placeholder="تصادفی"></div>
          <div class="field"><label class="f">نسبت خشکی: <b id="lrv">۵۲٪</b></label><input id="land" type="range" min="35" max="72" value="52" style="width:100%"></div>
          <div class="field"><label class="f">حداکثر نوبت</label><input class="inp" id="maxt" type="number" value="250" min="20" max="1000"></div>
          <div class="field"><label class="f">هوش مصنوعی هر چند نوبت فکر کند</label><input class="inp" id="think" type="number" value="${esc(st.default_think_every)}" min="1" max="20"></div>
          <div class="field"><label class="f">فاصله زمانی هر نوبت (ثانیه)</label><input class="inp" id="delay" type="number" step="0.5" value="${esc(st.default_turn_delay)}" min="0" max="60"></div>
          <div class="field"><label class="f">شرایط پیروزی</label>
            <label class="switch"><input type="checkbox" class="vic" value="domination" checked> فتح جهان</label>
            <label class="switch"><input type="checkbox" class="vic" value="science" checked> علمی</label>
            <label class="switch"><input type="checkbox" class="vic" value="score" checked> امتیاز</label></div>
          <div class="field"><label class="f">&nbsp;</label><label class="switch"><input type="checkbox" id="auto" checked> شروع خودکار پس از ساخت</label></div>
        </div>
        <div class="note" id="cost" style="margin-bottom:12px"></div>
        <div class="row"><button class="btn gold" id="create" style="padding:10px 22px">${ic('play')} ساخت و شروع بازی</button><span id="cmsg"></span></div>
      </div>`;
    page.querySelectorAll('[data-go]').forEach(a => { a.style.cursor = 'pointer'; a.onclick = () => go(a.dataset.go); });
    const pool = () => [...document.querySelectorAll('#pool input:checked')].map(i => i.value);
    const rows = document.getElementById('rows');
    const drawRows = () => {
      rows.innerHTML = A.civs.map((c, i) => `<div class="civrow" data-i="${i}">
        <input type="color" value="${c.color}" data-k="color">
        <span title="کلیک = پرچم تصادفی" data-flag>${flagHTML(c.flag, 46, 30)}</span>
        <input class="inp" value="${esc(c.name)}" data-k="name">
        <input class="inp" value="${esc(c.leader)}" data-k="leader">
        <select class="inp" data-k="model" style="direction:ltr">${modelOptions(c.model)}</select>
        <select class="inp" data-k="personality">${Object.entries(R.personalities).map(([k, v]) => `<option value="${k}" ${k === c.personality ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn red icon" data-del title="حذف">${ic('x', 'sm')}</button></div>`).join('');
      rows.querySelectorAll('.civrow').forEach(r => {
        const i = +r.dataset.i;
        r.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => {
          A.civs[i][inp.dataset.k] = inp.value;
          if (inp.dataset.k === 'color') { A.civs[i].flag.colors[0] = inp.value; r.querySelector('[data-flag]').innerHTML = flagHTML(A.civs[i].flag, 46, 30); }
          costNote();
        });
        r.querySelector('[data-flag]').onclick = () => { A.civs[i].flag = rndFlag(A.civs[i].color); drawRows(); };
        r.querySelector('[data-del]').onclick = () => { if (A.civs.length > 2) { A.civs.splice(i, 1); drawRows(); } };
      });
      document.getElementById('cnt').value = A.civs.length;
      costNote();
    };
    const costNote = () => {
      const ai = A.civs.filter(c => c.model !== LOCAL).length;
      const think = +document.getElementById('think').value || 2, mt = +document.getElementById('maxt').value || 250;
      const calls = Math.ceil(mt / think) * ai;
      document.getElementById('cost').innerHTML = ai ? `برآورد: حدود <b>${fa(calls)}</b> درخواست هوش مصنوعی در کل بازی (${fa(ai)} تمدن هوشمند × ${fa(Math.ceil(mt / think))} تصمیم). محدودیت وب‌سرویس: ۳۰ درخواست در دقیقه و ۳۰۰۰ در روز؛ سرعت به‌طور خودکار تنظیم می‌شود.` : 'همه تمدن‌ها با هوش محلی بازی می‌کنند — رایگان و سریع.';
    };
    document.getElementById('think').oninput = costNote; document.getElementById('maxt').oninput = costNote;
    document.getElementById('land').oninput = e => document.getElementById('lrv').textContent = fa(e.target.value) + '٪';
    document.getElementById('apCnt').onclick = async () => {
      const n = Math.max(2, Math.min(10, +document.getElementById('cnt').value));
      if (n > A.civs.length) { const extra = await api('/api/admin/random_setup', { method: 'POST', body: { count: n, models: pool() } }); const used = new Set(A.civs.map(c => c.color)); for (const c of extra) { if (A.civs.length >= n) break; if (!A.civs.find(x => x.name === c.name)) { if (used.has(c.color)) { const free = CFG.colors.find(x => !used.has(x)); if (free) { c.color = free; c.flag.colors[0] = free; } } used.add(c.color); A.civs.push(c); } } }
      else A.civs = A.civs.slice(0, n);
      drawRows();
    };
    document.getElementById('rndAll').onclick = async () => { A.civs = await api('/api/admin/random_setup', { method: 'POST', body: { count: +document.getElementById('cnt').value || 4, models: pool() } }); document.getElementById('seed').value = ''; drawRows(); };
    document.getElementById('rndModels').onclick = () => { const p = pool(); if (!p.length) return alert('حداقل یک مدل را در فهرست مدل‌های مجاز انتخاب کنید'); A.civs.forEach(c => c.model = p[Math.random() * p.length | 0]); drawRows(); };
    document.getElementById('rndPers').onclick = () => { const ks = Object.keys(R.personalities); A.civs.forEach(c => c.personality = ks[Math.random() * ks.length | 0]); drawRows(); };
    document.getElementById('addCiv').onclick = () => { document.getElementById('cnt').value = A.civs.length + 1; document.getElementById('apCnt').click(); };
    document.getElementById('create').onclick = async () => {
      const b = document.getElementById('create'); b.disabled = true;
      try {
        const body = {
          name: document.getElementById('gname').value, map_size: document.getElementById('msize').value,
          seed: document.getElementById('seed').value || null, land_ratio: +document.getElementById('land').value / 100,
          max_turns: +document.getElementById('maxt').value, think_every: +document.getElementById('think').value,
          turn_delay: +document.getElementById('delay').value, victories: [...document.querySelectorAll('.vic:checked')].map(i => i.value),
          autostart: document.getElementById('auto').checked, civs: A.civs,
        };
        const r = await api('/api/admin/games', { method: 'POST', body });
        A.civs = [];
        flash(document.getElementById('cmsg'), `بازی #${fa(r.id)} ساخته شد. <a href="/?g=${r.id}" target="_blank">تماشای نقشه</a>`);
        setTimeout(() => go('games'), 1400);
      } catch (e) { flash(document.getElementById('cmsg'), esc(e.message), 'err'); b.disabled = false; }
    };
    drawRows();
  }
  function rndFlag(color) {
    const pal = ['#ffffff', '#111111', '#ffd54f', '#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00'].filter(c => c !== color.toLowerCase());
    const pick = a => a[Math.random() * a.length | 0];
    const c2 = pick(pal); const c3 = pick(pal.filter(c => c !== c2));
    return { pattern: pick(CFG.patterns), colors: [color, c2, c3], emblem: pick(CFG.emblems) };
  }

  /* ================================================================ results */
  async function pResults(gid) {
    const games = await api('/api/games');
    if (!games.length) { page.innerHTML = `<h1>نتایج</h1><div class="card">بازی‌ای وجود ندارد.</div>`; return; }
    gid = gid || A.resGid || games[0].id; A.resGid = gid;
    await loadSettings();
    page.innerHTML = `<div class="row" style="flex-wrap:wrap"><div><h1>نتایج و تحلیل</h1><div class="sub">رتبه‌بندی، نمودار پیشرفت، عملکرد هر مدل و گزارش کامل افکار هوش مصنوعی.</div></div>
      <div style="margin-inline-start:auto" class="row"><select class="inp" id="rg" style="width:260px">${games.map(g => `<option value="${g.id}" ${g.id === gid ? 'selected' : ''}>#${g.id} — ${esc(g.name)}</option>`).join('')}</select>
      <a class="btn gold" href="/report/${gid}" target="_blank">${ic('pie')} گزارش نبرد</a><a class="btn" href="/api/admin/game/${gid}/export">${ic('download')} خروجی JSON</a><a class="btn" href="/?g=${gid}" target="_blank">${ic('eye')} نقشه</a></div></div>
      <div id="rbody">در حال بارگذاری…</div>`;
    document.getElementById('rg').onchange = e => pResults(+e.target.value);
    const draw = async () => {
      const rep = await api(`/api/admin/game/${gid}/report`);
      const body = document.getElementById('rbody'); if (!body) return;
      const keepLog = document.getElementById('tlog');
      if (!keepLog) body.innerHTML = resultsSkeleton(rep, gid);
      fillResults(rep, gid);
    };
    await draw();
    A.refresh = setInterval(draw, 5000);
  }
  function resultsSkeleton(rep, gid) {
    const cfg = rep.game.config;
    return `<div class="kpi" id="kpi"></div>
      <div class="card"><h2>${ic('crown')} رتبه‌بندی تمدن‌ها و عملکرد مدل‌ها</h2><div style="overflow:auto"><table class="t" id="rank"></table></div></div>
      <div class="card"><h2>${ic('pie')} الگوی تصمیم‌گیری تمدن‌ها</h2><div id="decisions"></div>${catLegend()}</div>
      <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">${ic('chart')} نمودار پیشرفت</h2>
        <select class="inp" id="metric" style="width:160px;margin-inline-start:auto"><option value="score">امتیاز</option><option value="pop">جمعیت</option><option value="cities">شهرها</option><option value="military">قدرت نظامی</option><option value="techs">فناوری</option><option value="gold">طلا</option></select></div>
        <canvas class="chart" id="chart"></canvas><div id="legend" class="row" style="flex-wrap:wrap;margin-top:8px"></div></div>
      <div class="card"><h2>${ic('settings')} کنترل بازی</h2>
        <div class="row" style="flex-wrap:wrap">
          <label class="f" style="margin:0">فاصله نوبت (ثانیه)</label><input class="inp" id="sdelay" type="number" step="0.5" value="${cfg.turn_delay}" style="width:90px">
          <label class="f" style="margin:0">تفکر هر چند نوبت</label><input class="inp" id="sthink" type="number" value="${cfg.think_every}" style="width:80px">
          <button class="btn" id="sapply">اعمال</button>
          <button class="btn gold" data-ga="start">${ic('play')} اجرا</button><button class="btn" data-ga="pause">${ic('pause')} توقف</button><button class="btn" data-ga="step">${ic('step')} یک نوبت</button>
          <span id="smsg"></span></div>
        <div class="dim" style="margin-top:10px">نقشه: ${esc(cfg.map_size)} · بذر ${fa(cfg.seed)} · حداکثر ${fa(cfg.max_turns)} نوبت · پیروزی: ${(cfg.victories || []).map(v => VICT[v]).join('، ')}</div></div>
      <div class="card"><div class="row" style="flex-wrap:wrap;margin-bottom:12px"><h2 style="margin:0">${ic('brain')} گزارش کامل افکار و تصمیم‌ها</h2>
        <select class="inp" id="tciv" style="width:180px;margin-inline-start:auto"><option value="all">همه تمدن‌ها</option>${rep.static.civs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input class="inp" id="tq" placeholder="جستجو در افکار…" style="width:200px"><button class="btn" id="tgo">جستجو</button></div>
        <div class="thlog" id="tlog"></div><button class="btn" id="tmore" style="width:100%;justify-content:center">موارد بیشتر</button></div>
      <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">${ic('scroll')} رویدادهای مهم</h2>
        <select class="inp" id="ekind" style="width:170px;margin-inline-start:auto"><option value="">همه</option><option value="war">جنگ</option><option value="capture">فتح شهر</option><option value="peace">صلح</option><option value="alliance">اتحاد</option><option value="message">پیام‌ها</option><option value="tech">فناوری</option><option value="era">عصر</option><option value="city">شهر جدید</option><option value="eliminated">نابودی</option><option value="battle">نبرد</option></select></div>
        <div id="elog" style="max-height:420px;overflow:auto"></div></div>`;
  }
  let lastThoughtId = null;
  function fillResults(rep, gid) {
    const s = rep.snapshot, st = rep.static;
    const civ = id => st.civs[id];
    const aiBy = {}; rep.ai.forEach(a => { (aiBy[a.civ] = aiBy[a.civ] || []).push(a); });
    const totalCalls = rep.ai.reduce((a, b) => a + (b.model !== LOCAL ? b.n : 0), 0), totalTok = rep.ai.reduce((a, b) => a + (b.tokens || 0), 0);
    const fails = rep.ai.reduce((a, b) => a + (b.fb || 0), 0);
    document.getElementById('kpi').innerHTML = `<div><b>${fa(s.turn)}</b><span>نوبت (${esc(s.year_label)})</span></div>
      <div><b>${STATUS[s.status] || s.status}</b><span>وضعیت</span></div>
      <div><b>${s.winner != null ? esc(civ(s.winner).name) : '—'}</b><span>برنده ${s.victory ? '(' + VICT[s.victory] + ')' : ''}</span></div>
      <div><b>${fa(totalCalls)}</b><span>درخواست هوش مصنوعی</span></div><div><b>${fa(totalTok)}</b><span>توکن مصرفی</span></div>
      <div><b>${fa(fails)}</b><span>خطا / جایگزین محلی</span></div>`;
    const order = [...s.civs].sort((a, b) => (b.alive - a.alive) || b.score - a.score);
    if (!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.cm)) document.getElementById('rank').innerHTML = `<tr><th>#</th><th>تمدن</th><th>مدل</th><th>امتیاز</th><th>شهر</th><th>جمعیت</th><th>فناوری</th><th>ارتش</th><th>طلا</th><th>وضعیت</th><th>درخواست / موفق</th><th>تأخیر میانگین</th><th>توکن</th><th>تغییر مدل</th></tr>` +
      order.map((d, i) => {
        const c = civ(d.id), a = (aiBy[d.id] || []).reduce((x, y) => ({ n: x.n + y.n, ok: x.ok + y.ok, ms: y.ms || x.ms, tokens: x.tokens + (y.tokens || 0) }), { n: 0, ok: 0, ms: 0, tokens: 0 });
        return `<tr><td>${fa(i + 1)}</td><td>${flagHTML(c.flag, 26, 17)} <b style="color:${c.color}">${esc(c.name)}</b><div class="dim">${esc(c.leader)} · ${esc(c.pname)}</div></td>
          <td><span class="model">${esc(c.model)}</span></td><td><b style="color:#f2c14e">${fa(d.score)}</b></td><td>${fa(d.cities)}</td><td>${fa(d.pop)}</td><td>${fa(d.techs)}</td><td>${fa(Math.round(d.military))}</td><td>${fa(d.gold)}</td>
          <td>${d.alive ? (s.winner === d.id ? '<span class="pill finished">برنده</span>' : '<span class="pill running">زنده</span>') : `<span class="pill">نابود در نوبت ${fa(d.eliminated_turn)}</span>`}</td>
          <td>${fa(a.n)} / ${fa(a.ok)}</td><td>${a.ms ? fa((a.ms / 1000).toFixed(1)) + ' ث' : '—'}</td><td>${fa(a.tokens)}</td>
          <td>${d.alive && s.status !== 'finished' ? `<select class="inp" data-cm="${d.id}" style="width:170px;direction:ltr;font-size:11.5px">${modelOptions(c.model)}</select>` : ''}</td></tr>`;
      }).join('');
    document.querySelectorAll('[data-cm]').forEach(sel => sel.onchange = async () => { await api(`/api/admin/game/${gid}/model`, { method: 'POST', body: { civ: +sel.dataset.cm, model: sel.value } }); });
    drawChart(rep);
    document.getElementById('metric').onchange = () => drawChart(rep);
    const dec = document.getElementById('decisions');
    if (dec) dec.innerHTML = heatMatrix([...s.civs].sort((a, b) => b.score - a.score).map(d => ({ label: `${flagHTML(civ(d.id).flag, 22, 15)} ${esc(civ(d.id).name)} <span class="model">${esc(civ(d.id).model)}</span>`, cats: d.cats })));
    document.querySelectorAll('[data-ga]').forEach(b => b.onclick = async () => { try { await api(`/api/admin/game/${gid}/${b.dataset.ga}`, { method: 'POST', body: {} }); flash(document.getElementById('smsg'), 'انجام شد'); } catch (e) { flash(document.getElementById('smsg'), esc(e.message), 'err'); } });
    document.getElementById('sapply').onclick = async () => { await api(`/api/admin/game/${gid}/speed`, { method: 'POST', body: { turn_delay: +document.getElementById('sdelay').value, think_every: +document.getElementById('sthink').value } }); flash(document.getElementById('smsg'), 'ذخیره شد'); };
    if (!document.getElementById('tlog').dataset.init) {
      document.getElementById('tlog').dataset.init = 1;
      const loadT = async (reset) => {
        const log = document.getElementById('tlog');
        if (reset) { log.innerHTML = ''; lastThoughtId = null; }
        const qs = new URLSearchParams({ civ: document.getElementById('tciv').value, q: document.getElementById('tq').value });
        if (lastThoughtId) qs.set('before', lastThoughtId);
        const rows = await api(`/api/admin/game/${gid}/thoughts?${qs}`);
        if (rows.length) lastThoughtId = rows[rows.length - 1].id;
        log.insertAdjacentHTML('beforeend', rows.map(t => thoughtFull(t, st)).join('') || (reset ? '<div class="dim">موردی یافت نشد</div>' : ''));
        document.getElementById('tmore').style.display = rows.length < 30 ? 'none' : '';
      };
      document.getElementById('tgo').onclick = () => loadT(true); document.getElementById('tciv').onchange = () => loadT(true);
      document.getElementById('tq').onkeydown = e => { if (e.key === 'Enter') loadT(true); };
      document.getElementById('tmore').onclick = () => loadT(false);
      loadT(true);
      const loadE = async () => {
        const ev = await api(`/api/admin/game/${gid}/events?kind=${document.getElementById('ekind').value}`);
        document.getElementById('elog').innerHTML = ev.map(e => `<div class="ev ${e.kind}"><span class="tn">${fa(e.turn)}</span>${ic(EV_ICON[e.kind] || 'scroll', 'sm')}<span class="tx">${esc(e.text)}</span></div>`).join('') || '<div class="dim">رویدادی نیست</div>';
      };
      document.getElementById('ekind').onchange = loadE; loadE();
    }
  }
  function thoughtFull(t, st) {
    const c = st.civs[t.civ];
    return `<div class="th ${t.fallback ? 'fb' : ''}" style="--c:${c.color}">
      <div class="hd">${flagHTML(c.flag, 24, 16)}<b>${esc(c.name)}</b><span class="model">${esc(t.model)}</span>${t.focus && R.categories[t.focus] ? `<span class="fchip" style="--fc:${R.categories[t.focus].color}">${R.categories[t.focus].name}</span>` : ''}${t.fallback ? '<span class="chip err">جایگزین محلی</span>' : ''}
        <span class="t">نوبت ${fa(t.turn)}${t.latency_ms ? ' · ' + fa((t.latency_ms / 1000).toFixed(1)) + 'ث' : ''}${t.tokens ? ' · ' + fa(t.tokens) + ' توکن' : ''}</span></div>
      <div class="txt">${esc(t.thought)}</div>${t.plan ? `<div class="pl">${ic('crown', 'sm')} ${esc(t.plan)}</div>` : ''}
      <div class="acts">${(t.actions || []).map(a => `<span class="chip">${esc(a)}</span>`).join('')}</div>
      ${(t.errors || []).length ? `<div class="acts">${t.errors.map(e => `<span class="chip err">${esc(e)}</span>`).join('')}</div>` : ''}
      ${t.reasoning ? `<details><summary>استدلال درونی مدل</summary><pre>${esc(t.reasoning)}</pre></details>` : ''}
      ${t.raw ? `<details><summary>پاسخ خام مدل</summary><pre style="direction:ltr;text-align:left">${esc(t.raw)}</pre></details>` : ''}
      ${t.prompt ? `<details><summary>پرامپت ارسالی</summary><pre>${esc(t.prompt)}</pre></details>` : ''}
    </div>`;
  }
  function drawChart(rep) {
    const cv = document.getElementById('chart'); if (!cv) return;
    const metric = document.getElementById('metric').value, st = rep.static;
    const dpr = devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const W = r.width, H = r.height, pad = { l: 46, r: 14, t: 12, b: 26 };
    const series = {}; let maxT = 1, maxV = 1;
    rep.stats.forEach(s => { (series[s.civ] = series[s.civ] || []).push([s.turn, s[metric]]); maxT = Math.max(maxT, s.turn); maxV = Math.max(maxV, s[metric]); });
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#6f7a96'; g.font = '11px Vazirmatn, Tahoma'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad.t + (H - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(Math.round(maxV * (1 - i / 4)).toLocaleString('fa-IR'), pad.l - 6, y + 4); }
    g.textAlign = 'center'; for (let i = 0; i <= 5; i++) { const x = pad.l + (W - pad.l - pad.r) * i / 5; g.fillText(Math.round(maxT * i / 5).toLocaleString('fa-IR'), x, H - 8); }
    for (const cid in series) {
      const c = st.civs[cid]; g.strokeStyle = c.color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.beginPath();
      series[cid].forEach(([t, v], i) => { const x = pad.l + (W - pad.l - pad.r) * t / maxT, y = pad.t + (H - pad.t - pad.b) * (1 - v / maxV); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    document.getElementById('legend').innerHTML = st.civs.map(c => `<span class="chip"><i class="dot" style="background:${c.color}"></i> ${esc(c.name)} <span class="model">${esc(c.model)}</span></span>`).join('');
  }


  /* ================================================================ cross-game model analytics */
  async function pAnalytics() {
    page.innerHTML = `<h1>تحلیل مدل‌ها در همه نبردها</h1><div class="sub">هر مدل هوش مصنوعی در نبردهای مختلف بیشتر چه راهبردی انتخاب می‌کند — رشد، توسعه، علم، اقتصاد، دفاع، حمله، اتحاد یا بی‌طرفی — و چقدر موفق است.</div><div id="ab">در حال محاسبه…</div>`;
    const r = await api('/api/admin/analytics/models');
    const ab = document.getElementById('ab'); if (!ab) return;
    if (!r.models.length) { ab.innerHTML = '<div class="card">هنوز داده‌ای نیست؛ یک بازی بسازید.</div>'; return; }
    const tot = r.models.reduce((a, m) => a + m.decisions, 0);
    ab.innerHTML = `<div class="kpi"><div><b>${fa(r.games.length)}</b><span>نبرد</span></div><div><b>${fa(r.models.length)}</b><span>مدل</span></div><div><b>${fa(tot)}</b><span>تصمیم تحلیل‌شده</span></div><div><b>${fa(r.games.filter(g => g.winner).length)}</b><span>نبرد تمام‌شده</span></div></div>
      <div class="card"><h2>${ic('crown')} جدول مدل‌ها</h2><div style="overflow:auto"><table class="t"><tr><th>مدل</th><th>نبرد</th><th>پیروزی</th><th>نرخ پیروزی</th><th>میانگین رتبه</th><th>میانگین امتیاز</th><th>نابودی</th><th>تصمیم</th><th>خطا</th><th>راهبرد غالب</th><th style="min-width:220px">الگوی تصمیم</th></tr>
      ${r.models.map(m => { const top = catShares(m.cats).sort((a, b) => b.v - a.v)[0];
        return `<tr><td><span class="model">${esc(m.model)}</span></td><td>${fa(m.games)}</td><td><b style="color:#f2c14e">${fa(m.wins)}</b></td><td>${m.games ? pct(m.wins / m.games) : '—'}</td><td>${m.avg_rank != null ? fa(m.avg_rank) : '—'}</td><td>${fa(m.avg_score)}</td><td>${fa(m.eliminated)}</td><td>${fa(m.decisions)}</td><td>${fa(m.fallbacks)}</td>
        <td>${top ? `<span class="fchip" style="--fc:${top.color}">${top.name} ${pct(top.v)}</span>` : '—'}</td><td>${stackBar(m.cats, 12)}</td></tr>`; }).join('')}</table></div>${catLegend()}</div>
      <div class="card"><h2>${ic('pie')} ماتریس راهبرد مدل‌ها</h2><div style="overflow:auto">${heatMatrix(r.models.map(m => ({ label: `<span class="model">${esc(m.model)}</span>`, cats: m.cats })))}</div></div>
      <div class="grid2">${r.models.map(m => `<div class="card"><h2><span class="model">${esc(m.model)}</span> <span class="dim" style="font-weight:400;font-size:12px">${fa(m.decisions)} تصمیم · ${fa(m.wins)} پیروزی از ${fa(m.games)} نبرد</span></h2>
        <div class="row" style="align-items:center">${donut(m.cats, 150)}<div style="flex:1">${barList(m.cats)}</div></div>
        <div class="dim" style="margin-top:8px;font-size:12px">تمرکز اعلام‌شده توسط خود مدل</div>${barList(m.focus, { count: true })}</div>`).join('')}</div>
      <div class="card"><h2>${ic('scroll')} نبردها</h2><table class="t"><tr><th>#</th><th>نام</th><th>وضعیت</th><th>نوبت</th><th>مدل برنده</th><th></th></tr>
        ${r.games.map(g => `<tr><td>${fa(g.id)}</td><td>${esc(g.name)}</td><td><span class="pill ${g.status}">${STATUS[g.status] || g.status}</span></td><td>${fa(g.turn)}</td><td>${g.winner ? `<span class="model">${esc(g.winner)}</span>` : '—'}</td><td><a class="btn" href="/report/${g.id}" target="_blank">گزارش</a></td></tr>`).join('')}</table></div>`;
  }

  /* ================================================================ settings */
  async function pSettings() {
    await loadSettings();
    const s = A.settings;
    page.innerHTML = `<h1>وب‌سرویس هوش مصنوعی</h1><div class="sub">همه تمدن‌ها از یک وب‌سرویس (سازگار با OpenAI) استفاده می‌کنند و فقط مدلشان متفاوت است. تنظیمات در پایگاه داده ذخیره می‌شود.</div>
      ${LEMURA_CARD}
      <div class="card"><h2>${ic('key')} اتصال</h2>
        <div class="grid2">
          <div class="field"><label class="f">آدرس پایه API</label><input class="inp" id="base" value="${esc(s.api_base)}" style="direction:ltr"></div>
          <div class="field"><label class="f">کلید API ${s.api_key_set ? `<span class="pill running">تنظیم شده: ${esc(s.api_key_hint)}</span>` : '<span class="pill">تنظیم نشده</span>'}</label>
            <input class="inp" id="key" type="password" placeholder="${s.api_key_set ? 'برای تغییر، کلید جدید را وارد کنید' : 'lsk-...'}" style="direction:ltr" autocomplete="off"></div>
        </div>
        <div class="dim" style="margin-bottom:12px;line-height:1.9">مستندات: <a href="https://lemura.ir/docs" target="_blank">lemura.ir/docs</a> — احراز هویت با <code>Authorization: Bearer lsk-...</code>، مسیرهای <code>/chat/completions</code>، <code>/models</code> و <code>/me</code>.</div>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn gold" id="save">ذخیره تنظیمات</button>
          <button class="btn" id="test">${ic('zap')} آزمایش اتصال و دریافت مدل‌ها</button>
          <select class="inp" id="tmodel" style="width:240px;direction:ltr">${modelOptions('')}</select><button class="btn" id="tchat">آزمایش گفتگو با مدل</button>
          ${s.api_key_set ? `<button class="btn red" id="clr">حذف کلید</button>` : ''}
        </div>
        <div id="tres" style="margin-top:12px"></div></div>
      <div class="card"><h2>${ic('brain')} رفتار مدل‌ها</h2>
        <div class="grid3">
          <div class="field"><label class="f">حداکثر درخواست در دقیقه (کل)</label><input class="inp" id="rpm" type="number" value="${esc(s.rpm)}" min="1" max="600"></div>
          <div class="field"><label class="f">دما (temperature)</label><input class="inp" id="temp" type="number" step="0.1" value="${esc(s.temperature)}" min="0" max="2"></div>
          <div class="field"><label class="f">حداکثر توکن پاسخ</label><input class="inp" id="mtok" type="number" value="${esc(s.max_tokens)}" min="300" max="32000"></div>
          <div class="field"><label class="f">مهلت پاسخ (ثانیه)</label><input class="inp" id="tout" type="number" value="${esc(s.timeout)}" min="10" max="600"></div>
          <div class="field"><label class="f">زبان افکار</label><select class="inp" id="lang"><option value="fa" ${s.language === 'fa' ? 'selected' : ''}>فارسی</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select></div>
          <div class="field"><label class="f">حالت JSON اجباری</label><label class="switch"><input type="checkbox" id="jm" ${s.json_mode === '1' ? 'checked' : ''}> ارسال response_format=json_object</label></div>
          <div class="field"><label class="f">پیش‌فرض: تفکر هر چند نوبت</label><input class="inp" id="dthink" type="number" value="${esc(s.default_think_every)}" min="1" max="20"></div>
          <div class="field"><label class="f">پیش‌فرض: فاصله نوبت (ثانیه)</label><input class="inp" id="ddelay" type="number" step="0.5" value="${esc(s.default_turn_delay)}"></div>
        </div>
        <div class="grid3" style="margin-bottom:6px">
          <div class="field"><label class="f">گفتگوی تماشاگران با رهبران</label><label class="switch"><input type="checkbox" id="chpub" ${s.chat_public === '1' ? 'checked' : ''}> برای همه بازدیدکنندگان فعال باشد (در غیر این صورت فقط مدیر)</label></div>
          <div class="field"><label class="f">حداکثر پیام گفتگو در دقیقه برای هر بازدیدکننده</label><input class="inp" id="chrpm" type="number" value="${esc(s.chat_rpm)}" min="1" max="60"></div>
          <div class="field"><label class="f">حداکثر توکن پاسخ گفتگو</label><input class="inp" id="chtok" type="number" value="${esc(s.chat_max_tokens)}" min="200" max="8000"></div>
        </div>
        <div class="field"><label class="f">دستور اضافه برای همه رهبران (اختیاری)</label><textarea class="inp" id="extra" rows="3" placeholder="مثلاً: پیام‌های دیپلماتیک را با لحن ادبی و حماسی بنویس.">${esc(s.extra_prompt)}</textarea></div>
        <button class="btn gold" id="save2">ذخیره</button> <span id="smsg2"></span></div>
      <div class="card"><h2>${ic('layers')} مدل‌های دریافت‌شده (${fa(A.models.length)})</h2>
        <div style="max-height:260px;overflow:auto">${A.models.map(m => `<span class="chip"><span class="model">${esc(m.id)}</span> <span class="dim">${esc(m.owned_by)}</span></span>`).join('') || '<span class="dim">هنوز فهرستی دریافت نشده — «آزمایش اتصال» را بزنید.</span>'}</div></div>
      <div class="card"><h2>${ic('lock')} امنیت</h2>
        <div class="grid2"><div class="field"><label class="f">رمز عبور جدید مدیریت</label><input class="inp" id="npw" type="password" autocomplete="new-password"></div></div>
        <button class="btn" id="spw">تغییر رمز</button> <span id="pmsg"></span></div>`;
    const val = id => document.getElementById(id).value;
    const save = async (msgEl) => {
      const body = { api_base: val('base'), rpm: val('rpm'), temperature: val('temp'), max_tokens: val('mtok'), timeout: val('tout'), language: val('lang'), json_mode: document.getElementById('jm').checked ? '1' : '0', extra_prompt: val('extra'), default_think_every: val('dthink'), default_turn_delay: val('ddelay'), chat_public: document.getElementById('chpub').checked ? '1' : '0', chat_rpm: val('chrpm'), chat_max_tokens: val('chtok') };
      if (val('key')) body.api_key = val('key');
      try { await api('/api/admin/settings', { method: 'POST', body }); flash(msgEl, 'تنظیمات در پایگاه داده ذخیره شد.'); if (body.api_key) setTimeout(pSettings, 800); } catch (e) { flash(msgEl, esc(e.message), 'err'); }
    };
    document.getElementById('save').onclick = () => save(document.getElementById('tres'));
    document.getElementById('save2').onclick = () => save(document.getElementById('smsg2'));
    const test = async (withChat) => {
      const out = document.getElementById('tres'); out.innerHTML = '<div class="note">در حال آزمایش…</div>';
      try {
        const r = await api('/api/admin/test', { method: 'POST', body: { api_base: val('base'), api_key: val('key'), model: withChat ? val('tmodel') : null } });
        let h = '';
        h += r.me ? `<div class="note ok" style="margin-bottom:6px">کلید معتبر است. ${esc(JSON.stringify(r.me).slice(0, 300))}</div>` : `<div class="note err" style="margin-bottom:6px">بررسی کلید (/me): ${esc(r.me_error)}</div>`;
        h += r.models != null ? `<div class="note ok" style="margin-bottom:6px">${fa(r.models)} مدل گفتگو دریافت و در پایگاه داده ذخیره شد.</div>` : `<div class="note err" style="margin-bottom:6px">دریافت مدل‌ها: ${esc(r.models_error)}</div>`;
        if (withChat) h += r.chat ? `<div class="note ok">پاسخ مدل (${fa((r.chat_ms / 1000).toFixed(1))} ثانیه): ${esc(r.chat)}</div>` : `<div class="note err">گفتگو: ${esc(r.chat_error)}</div>`;
        out.innerHTML = h;
        if (r.models != null && !withChat) { await loadSettings(); document.getElementById('tmodel').innerHTML = modelOptions(''); }
      } catch (e) { flash(out, esc(e.message), 'err'); }
    };
    document.getElementById('test').onclick = () => test(false);
    document.getElementById('tchat').onclick = () => { if (val('tmodel') === LOCAL) return alert('یک مدل از وب‌سرویس انتخاب کنید'); test(true); };
    const clr = document.getElementById('clr'); if (clr) clr.onclick = async () => { if (confirm('کلید API حذف شود؟')) { await api('/api/admin/settings', { method: 'POST', body: { clear_key: true } }); pSettings(); } };
    document.getElementById('spw').onclick = async () => { try { await api('/api/admin/settings', { method: 'POST', body: { new_password: val('npw') } }); flash(document.getElementById('pmsg'), 'رمز تغییر کرد'); } catch (e) { flash(document.getElementById('pmsg'), esc(e.message), 'err'); } };
  }

  go('games');
})();
