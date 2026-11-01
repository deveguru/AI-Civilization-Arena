/* Battle report: winner, ranking, decision analytics per civilization, score history. */
(async () => {
  const el = document.getElementById('rep');
  let R;
  try { R = await api(`/api/game/${window.GID}/battle`); } catch (e) { el.innerHTML = `<div class="note err">${esc(e.message)}</div>`; return; }
  const st = R.static, s = R.snapshot, C = window.RULES.categories;
  const civ = id => st.civs[id];
  const ai = {}; R.ai.forEach(a => ai[a.civ] = a);
  const tl = {}; R.civs.forEach(c => tl[c.id] = c.timeline);
  const ranked = [...s.civs].sort((a, b) => (b.alive - a.alive) || b.score - a.score);
  const VICT = { domination: 'پیروزی نظامی — فتح جهان', science: 'پیروزی علمی — سفر به فضا', score: 'پیروزی امتیازی — پایان زمان' };
  const finished = s.winner != null;
  const w = finished ? civ(s.winner) : civ(ranked[0].id);
  const topCat = obj => { const x = catShares(obj).sort((a, b) => b.v - a.v)[0]; return x ? x : null; };
  const T = k => (s.civs.find(c => c.id === k) || {}).tally || {};

  const hero = `<div class="rhero">
    ${flagHTML(w.flag, 120, 80)}
    <div style="flex:1;min-width:240px">
      <div class="dim">گزارش نبرد #${fa(R.game.id)} — ${esc(R.game.name)}</div>
      <h1>${finished ? `${esc(w.name)} پیروز نبرد شد` : `نبرد ادامه دارد — پیشتاز: ${esc(w.name)}`}</h1>
      <div class="muted" style="margin-top:4px">${finished ? VICT[s.victory] || '' : 'گزارش لحظه‌ای؛ با پایان بازی نهایی می‌شود'} · مدل: <span class="model">${esc(w.model)}</span></div>
      <div class="muted" style="margin-top:6px">${fa(s.turn)} نوبت · تا سال ${esc(s.year_label)} · ${fa(st.civs.length)} تمدن · ${fa(R.ai.reduce((a, b) => a + b.n, 0))} تصمیم ثبت‌شده</div>
    </div>
    <div class="noprint row"><button class="btn" onclick="print()">${ic('print')} چاپ / PDF</button><a class="btn" href="/?g=${R.game.id}">${ic('globe')} نقشه</a></div>
  </div>`;

  const table = `<div class="card"><h2>${ic('crown')} رتبه‌بندی نهایی</h2><div style="overflow:auto"><table class="t">
    <tr><th>#</th><th>تمدن</th><th>مدل</th><th>نتیجه</th><th>امتیاز</th><th>اوج امتیاز</th><th>شهر</th><th>فناوری</th><th>فتح شهر</th><th>از دست‌رفته</th><th>جنگ‌ها</th><th>اتحاد/صلح</th><th>راهبرد غالب</th></tr>
    ${ranked.map((d, i) => { const c = civ(d.id), t = T(d.id), tc = topCat(d.cats);
      return `<tr><td>${fa(i + 1)}</td><td>${flagHTML(c.flag, 26, 17)} <b style="color:${c.color}">${esc(c.name)}</b><div class="dim">${esc(c.leader)} · ${esc(c.pname)}</div></td>
      <td><span class="model">${esc(c.model)}</span></td>
      <td>${s.winner === d.id ? '<span class="pill finished">برنده</span>' : d.alive ? '<span class="pill running">زنده</span>' : `<span class="pill">نابود (نوبت ${fa(d.eliminated_turn)})</span>`}</td>
      <td><b style="color:#f2c14e">${fa(d.score)}</b></td><td>${fa(t.peak_score || d.score)}</td><td>${fa(d.cities)}</td><td>${fa(d.techs)}</td>
      <td>${fa(t.captured || 0)}</td><td>${fa(t.cities_lost || 0)}</td><td>${fa((t.wars_declared || 0) + (t.wars_joined || 0))}</td><td>${fa((t.alliances || 0) + (t.peaces || 0))}</td>
      <td>${tc ? `<span class="fchip" style="--fc:${tc.color}">${tc.name} ${pct(tc.v)}</span>` : '—'}</td></tr>`; }).join('')}
  </table></div></div>`;

  const heat = `<div class="card"><h2>${ic('pie')} ماتریس تصمیم‌گیری — هر تمدن بیشتر چه کرد؟</h2>
    <div style="overflow:auto">${heatMatrix(ranked.map(d => ({ label: `${flagHTML(civ(d.id).flag, 22, 15)} ${esc(civ(d.id).name)} <span class="model">${esc(civ(d.id).model)}</span>`, cats: d.cats })))}</div>
    <div class="dim" style="margin-top:8px;font-size:12px">سهم هر راهبرد از مجموع تصمیم‌ها، محاسبه‌شده از کارهای واقعی هر مدل (ساخت، فرمان نظامی، دیپلماسی) در طول نبرد.</div></div>`;

  const cards = `<div class="rgrid">${ranked.map((d, i) => {
    const c = civ(d.id), t = T(d.id), a = ai[d.id] || {};
    const res = s.winner === d.id ? ['برنده', '#f2c14e'] : !d.alive ? ['شکست خورد', '#ef5350'] : [`رتبه ${fa(i + 1)}`, '#90a4ae'];
    const q = (R.quotes[d.id] || []).map(x => `<div class="quote" style="--fc:${(C[x.focus] || {}).color || '#888'}"><b style="color:${(C[x.focus] || {}).color}">${(C[x.focus] || {}).name || ''}</b> · نوبت ${fa(x.turn)}<br>«${esc(x.text)}»</div>`).join('');
    return `<div class="rciv" style="--c:${c.color}">
      <div class="top">${flagHTML(c.flag, 44, 29)}<div><b style="font-size:16px;color:${c.color}">${esc(c.name)}</b><div class="dim">${esc(c.leader)} · <span class="model">${esc(c.model)}</span></div></div>
        <span class="res-badge" style="background:${res[1]}22;color:${res[1]};border:1px solid ${res[1]}66">${res[0]}</span></div>
      <div class="viz">${donut(d.cats, 140)}<div style="flex:1">${barList(d.cats)}</div></div>
      <div style="margin-top:10px;font-size:12px" class="dim">تمرکز اعلام‌شده توسط خود مدل (تعداد دفعات)</div>${barList(d.focus, { count: true })}
      <div style="margin-top:10px;font-size:12px" class="dim">تغییر راهبرد در طول زمان</div>
      <canvas class="fa" data-civ="${d.id}"></canvas>
      <div class="kv"><div><b>${fa(t.peak_score || d.score)}</b>اوج امتیاز</div><div><b>${fa(t.cities_founded || 0)}</b>شهر بنا کرد</div><div><b>${fa(t.captured || 0)}</b>شهر فتح کرد</div><div><b>${fa(t.cities_lost || 0)}</b>شهر از دست داد</div>
        <div><b>${fa(t.kills || 0)}</b>نابودی دشمن</div><div><b>${fa(t.losses || 0)}</b>تلفات</div><div><b>${fa((t.wars_declared || 0))}</b>اعلان جنگ</div><div><b>${fa((t.alliances || 0) + (t.peaces || 0))}</b>اتحاد/صلح</div>
        <div><b>${fa(t.betrayals || 0)}</b>خیانت</div><div><b>${fa(t.messages || 0)}</b>پیام دیپلماتیک</div><div><b>${fa(a.n || 0)}</b>تصمیم</div><div><b>${a.ms ? fa((a.ms / 1000).toFixed(1)) + 'ث' : '—'}</b>تأخیر مدل</div></div>
      ${q ? `<div class="dim" style="font-size:12px;margin-top:6px">نقل‌قول‌های کلیدی از ذهن مدل</div>${q}` : ''}
    </div>`; }).join('')}</div>`;

  const chart = `<div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">${ic('chart')} روند پیشرفت</h2>
    <select class="inp noprint" id="metric" style="width:160px;margin-inline-start:auto"><option value="score">امتیاز</option><option value="pop">جمعیت</option><option value="cities">شهرها</option><option value="military">قدرت نظامی</option><option value="techs">فناوری</option></select></div>
    <canvas class="chart" id="chart"></canvas>${'<div class="legendrow">' + st.civs.map(c => `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name)}</span>`).join('') + '</div>'}</div>`;

  el.innerHTML = hero + table + heat + `<h2 style="margin:22px 0 12px">${ic('brain')} تحلیل تصمیم‌گیری هر تمدن و مدل</h2>${catLegend()}<div style="height:12px"></div>` + cards + `<div style="height:16px"></div>` + chart +
    `<div class="dim" style="text-align:center;margin-top:20px;font-size:12px">ساخته‌شده با AI Civilization Arena · وب‌سرویس پیشنهادی هوش مصنوعی: <a href="https://lemura.ir" target="_blank">لمورا — lemura.ir</a></div>`;

  document.querySelectorAll('canvas.fa').forEach(cv => focusArea(cv, tl[+cv.dataset.civ], Math.max(4, Math.ceil(s.turn / 30))));
  const drawChart = () => {
    const m = document.getElementById('metric').value, ser = {}, col = {};
    R.stats.forEach(x => { (ser[x.civ] = ser[x.civ] || []).push([x.turn, x[m]]); });
    st.civs.forEach(c => col[c.id] = c.color);
    lineChart(document.getElementById('chart'), ser, col);
  };
  document.getElementById('metric').onchange = drawChart; drawChart();
  window.addEventListener('resize', drawChart);
})();
