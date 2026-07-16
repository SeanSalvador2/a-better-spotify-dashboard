/* ============================================================
   SOUNDPRINT — sections/genres.js  (v2 enrichment · PHASE B1)
   Umbrella donut + headline · genre streamgraph · bump · season/daypart
   heatmaps · discovery curve · diversity trend · drill-down + subgenre treemap
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  let root = null, s = null;

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, en = SP.en, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!en || !sub.length) return st;

    const U = en.umbrellas.length;
    const byU = new Float64Array(U).fill(0);          // metric val per umbrella
    const byUms = new Float64Array(U).fill(0);
    const byUplays = new Float64Array(U).fill(0);
    let unknownVal = 0, totalVal = 0;

    st.mkMin = SP.monthKey[sub[0]];
    st.mkMax = SP.monthKey[sub[sub.length - 1]];
    const nMk = st.mkMax - st.mkMin + 1;

    const monthlyU = new Map();   // u -> Float64Array per month (metric)
    const monthlyTot = new Float64Array(nMk);
    const seasonU = new Map();    // u -> Float64Array(12)
    const daypartU = new Map();   // u -> Float64Array(4)
    const hyU = new Map();        // hy -> Map<u, val>
    const firstU = new Map();     // u -> first play index
    const monthlyEntropyIn = new Map(); // mk -> Map<u, val>

    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const u = en.artistUmbrella[d.trackArtist[d.tr[i]]];
      const val = metric === 'hours' ? d.ms[i] / MSH : 1;
      totalVal += val;
      if (u < 0) { unknownVal += val; continue; }
      byU[u] += val; byUms[u] += d.ms[i]; byUplays[u]++;
      const mk = SP.monthKey[i] - st.mkMin;
      monthlyTot[mk] += val;
      let mu = monthlyU.get(u); if (!mu) { mu = new Float64Array(nMk); monthlyU.set(u, mu); } mu[mk] += val;
      let se = seasonU.get(u); if (!se) { se = new Float64Array(12); seasonU.set(u, se); } se[SP.month[i]] += val;
      let dp = daypartU.get(u); if (!dp) { dp = new Float64Array(4); daypartU.set(u, dp); } dp[SP.daypartOf(SP.hour[i])] += val;
      const hy = Math.floor(SP.monthKey[i] / 6);
      let hm = hyU.get(hy); if (!hm) { hm = new Map(); hyU.set(hy, hm); } hm.set(u, (hm.get(u) || 0) + val);
      if (!firstU.has(u)) firstU.set(u, i);
      const emk = SP.monthKey[i];
      let em = monthlyEntropyIn.get(emk); if (!em) { em = new Map(); monthlyEntropyIn.set(emk, em); } em.set(u, (em.get(u) || 0) + val);
    }

    st.totalVal = totalVal; st.unknownVal = unknownVal;
    st.byU = byU; st.byUms = byUms; st.byUplays = byUplays;
    st.order = Array.from(byU.keys()).filter(u => byU[u] > 0).sort((a, b) => byU[b] - byU[a]);
    if (!st.order.length) { st.n = 0; return st; }
    st.top = st.order.slice(0, 8);
    st.monthlyU = monthlyU; st.monthlyTot = monthlyTot;
    st.seasonU = seasonU; st.daypartU = daypartU;
    st.hyKeys = Array.from(hyU.keys()).sort((a, b) => a - b);
    st.hyRanks = new Map();
    st.hyKeys.forEach(hy => {
      const entries = Array.from(hyU.get(hy).entries()).sort((a, b) => b[1] - a[1]);
      const rm = new Map(); entries.forEach(([u], i) => rm.set(u, i + 1));
      st.hyRanks.set(hy, rm);
    });
    st.firstU = firstU;

    // monthly entropy over umbrellas
    st.entropy = [];
    Array.from(monthlyEntropyIn.keys()).sort((a, b) => a - b).forEach(mk => {
      const m = monthlyEntropyIn.get(mk);
      let tot = 0; m.forEach(v => tot += v);
      if (tot <= 0) return;
      let H = 0;
      m.forEach(v => { const p = v / tot; if (p > 0) H -= p * Math.log2(p); });
      st.entropy.push([mk, +H.toFixed(3)]);
    });

    // drill-down selection: single global genre filter wins, else top genre
    const g = SP.filter.genres;
    st.drillU = (g && g.length === 1) ? g[0] : st.order[0];
    st.drillLocked = g && g.length === 1;

    // drill aggregates
    const dr = { artists: new Map(), tracks: new Map(), monthly: new Float64Array(nMk), ms: 0, plays: 0 };
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const aid = d.trackArtist[d.tr[i]];
      if (en.artistUmbrella[aid] !== st.drillU) continue;
      const val = metric === 'hours' ? d.ms[i] / MSH : 1;
      dr.ms += d.ms[i]; dr.plays++;
      dr.monthly[SP.monthKey[i] - st.mkMin] += val;
      let a = dr.artists.get(aid); if (!a) { a = { ms: 0, plays: 0 }; dr.artists.set(aid, a); } a.ms += d.ms[i]; a.plays++;
      const tr = d.tr[i];
      let t = dr.tracks.get(tr); if (!t) { t = { ms: 0, plays: 0 }; dr.tracks.set(tr, t); } t.ms += d.ms[i]; t.plays++;
    }
    st.drill = dr;

    // subgenre attribution for the drill umbrella (artist ms split across its
    // subgenres). Wikidata labels vary in casing ("country" / "Country") and
    // form ("country music") — merge case-insensitively, and fold "<x> music"
    // into "<x>" when both exist.
    const subMsRaw = new Map(); // lc label -> {ms, label}
    dr.artists.forEach((a, aid) => {
      const subs = en.artistSubgenres[aid] || [];
      if (!subs.length) return;
      const per = a.ms / subs.length;
      subs.forEach(sg => {
        const label = en.subgenres[sg];
        const lc = label.toLowerCase();
        let e = subMsRaw.get(lc);
        if (!e) { e = { ms: 0, label: lc }; subMsRaw.set(lc, e); }
        e.ms += per;
      });
    });
    subMsRaw.forEach((e, lc) => {
      if (lc.endsWith(' music')) {
        const base = lc.slice(0, -6);
        const b = subMsRaw.get(base);
        if (b) { b.ms += e.ms; e.ms = 0; }
      }
    });
    st.subgenres = Array.from(subMsRaw.values()).filter(e => e.ms > 0)
      .map(e => ({ label: e.label, ms: e.ms })).sort((a, b) => b.ms - a.ms).slice(0, 24);

    return st;
  }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Genres</div>
        <h1 class="sec-title">The shape of your taste</h1>
        <p class="sec-sub" id="gn-sub"></p>
      </div>
    </div>
    <div id="gn-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/></svg>
      <div class="empty-t">Nothing here yet</div><div id="gn-empty-msg">No plays match the current filters.</div>
    </div></div></div>
    <div id="gn-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal">
          <div class="genre-hero">
            <div class="gh-call" id="gn-call"></div>
            <div class="card hoverable">
              <div class="card-head"><div class="card-title" id="gn-donut-title">Where your hours go</div><div class="card-hint">click a slice to filter the whole app</div></div>
              <div class="chart" id="gn-donut" style="height:300px"></div>
              <div class="glegend" id="gn-legend" style="margin-top:var(--sp-3)"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">The flow of taste, genre edition</div><div class="card-hint" id="gn-flow-hint"></div></div>
          <div class="chart tall" id="gn-flow"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%;display:flex;flex-direction:column">
          <div class="card-head"><div class="card-title">Genre rank evolution</div><div class="card-hint">per half-year · lower is better</div></div>
          <div class="chart tall" id="gn-bump" style="flex:1 1 auto;min-height:340px;height:auto"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Genre discovery</div><div class="card-hint">when each umbrella first appeared</div></div>
          <div class="chart" id="gn-disc" style="height:230px"></div>
          <div class="mini" id="gn-disc-list" style="margin-top:var(--sp-2)"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Genre by season</div><div class="card-hint" id="gn-season-hint">share of each genre's listening per month-of-year</div></div>
          <div id="gn-season" style="width:100%;height:330px"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Genre by time of day</div><div class="card-hint">share of each genre's listening per daypart</div></div>
          <div id="gn-daypart" style="width:100%;height:330px"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Genre diversity</div><div class="card-hint" id="gn-div-hint">monthly Shannon entropy across umbrella genres</div></div>
          <div class="chart" id="gn-div"></div>
          <div class="approx-hint" id="gn-div-note"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title" id="gn-drill-title">Inside a genre</div><div class="card-hint" id="gn-drill-hint"></div></div>
          <div class="grid" style="gap:var(--sp-5)">
            <div class="c4"><h4 class="duo-h" style="font-family:var(--f-mono);font-size:0.64rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--tx-low);margin-bottom:var(--sp-2)">Top artists</h4><div class="mini" id="gn-drill-artists"></div></div>
            <div class="c4"><h4 style="font-family:var(--f-mono);font-size:0.64rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--tx-low);margin-bottom:var(--sp-2)">Top tracks</h4><div class="mini" id="gn-drill-tracks"></div></div>
            <div class="c4"><h4 style="font-family:var(--f-mono);font-size:0.64rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--tx-low);margin-bottom:var(--sp-2)">Share of your listening</h4><div id="gn-drill-share" style="width:100%;height:190px"></div></div>
            <div class="c12"><h4 style="font-family:var(--f-mono);font-size:0.64rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--tx-low);margin:var(--sp-2) 0">Subgenre map</h4><div id="gn-tree" style="width:100%;height:320px"></div></div>
          </div>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- renderers ---------------- */
  function toggleGenre(u) {
    const cur = SP.filter.genres;
    if (cur.length === 1 && cur[0] === u) SP.setFilter({ genres: [] });
    else SP.setFilter({ genres: [u] });
  }

  function renderHero() {
    const en = SP.en, metric = s.metric;
    const topU = s.order[0];
    const single = SP.filter.genres.length === 1;
    const call = el('gn-call');
    const share = s.totalVal ? (s.byU[topU] / s.totalVal) * 100 : 0;

    // subgenres of the headline umbrella (time-weighted, from drill attribution if same)
    let subs = [];
    if (s.drillU === topU) subs = s.subgenres.slice(0, 6);

    if (single) {
      call.innerHTML = `
        <div class="gh-eyebrow">Genre focus</div>
        <div class="gh-line">Inside your <span class="pct gname">${esc(SP.genreName(topU))}</span> world</div>
        <div style="color:var(--tx-mid);font-size:0.92rem">${SP.fmtInt(s.byUms[topU] / MSH)} hours · ${SP.fmtInt(s.byUplays[topU])} plays in scope. The donut shows its subgenre make-up.</div>
        <div class="gh-subs">${subs.map(x => `<span class="gh-sub"><b>${esc(x.label)}</b> · ${SP.fmt1(x.ms / MSH)} h</span>`).join('')}</div>`;
    } else {
      call.innerHTML = `
        <div class="gh-eyebrow">Umbrella genres · ${metric === 'hours' ? 'by hours' : 'by plays'}</div>
        <div class="gh-line">You are <span class="pct">${SP.fmtPct(share, share < 10 ? 1 : 0)}</span> <span class="gname">${esc(SP.genreName(topU))}</span></div>
        <div style="color:var(--tx-mid);font-size:0.92rem">${SP.fmtInt(s.order.length)} umbrella genres in scope — the top three cover ${SP.fmtPct(s.order.slice(0, 3).reduce((a, u) => a + (s.byU[u] / s.totalVal) * 100, 0))} of everything you play.</div>
        <div class="gh-subs">${subs.map(x => `<span class="gh-sub"><b>${esc(x.label)}</b> · ${SP.fmt1(x.ms / MSH)} h</span>`).join('')}</div>`;
    }

    // donut: umbrellas, or subgenres when a single genre is focused
    const donutEl = el('gn-donut');
    let data, title;
    if (single) {
      title = `${cap(SP.genreName(s.drillU))} subgenres`;
      data = s.subgenres.slice(0, 10).map((x, i) => ({
        name: x.label, value: +(x.ms / MSH).toFixed(1),
        itemStyle: { color: i === 0 ? SP.genreColor(s.drillU) : SP.rgba(SP.genreColor(s.drillU), Math.max(0.25, 0.85 - i * 0.08)) },
      }));
    } else {
      title = 'Where your hours go';
      data = s.order.slice(0, 9).map(u => ({
        name: cap(SP.genreName(u)), value: +s.byU[u].toFixed(1), u,
        itemStyle: { color: SP.genreColor(u) },
      }));
      const rest = s.order.slice(9).reduce((a, u) => a + s.byU[u], 0) + s.unknownVal;
      if (rest > 0.01) data.push({ name: 'Everything else', value: +rest.toFixed(1), u: -1, itemStyle: { color: '#3A423C' } });
    }
    el('gn-donut-title').textContent = title;
    const unit = s.metric === 'hours' ? ' h' : ' plays';
    const chart = SP.makeChart(donutEl, {
      tooltip: { formatter: p => `<b>${esc(p.name)}</b><br>${SP.fmtInt(p.value)}${unit} · <span style="color:#1ED760">${p.percent}%</span>` },
      series: [{
        type: 'pie', radius: ['58%', '82%'], center: ['50%', '50%'],
        avoidLabelOverlap: true, padAngle: 1.2,
        itemStyle: { borderRadius: 6, borderColor: '#121513', borderWidth: 2 },
        label: { color: '#AEB4A9', fontFamily: 'Manrope', fontSize: 11, formatter: p => p.percent >= 4 ? p.name : '' },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
        emphasis: { scaleSize: 4, label: { show: true } },
        data,
      }],
    });
    chart.off('click');
    if (!single) chart.on('click', p => { if (p.data && p.data.u >= 0) toggleGenre(p.data.u); });
    else chart.on('click', () => {});

    // legend chips
    const leg = el('gn-legend'); leg.innerHTML = '';
    s.order.slice(0, 10).forEach(u => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="gdot" style="background:${SP.genreColor(u)}"></span>${esc(SP.genreName(u))}`;
      b.classList.toggle('on', SP.filter.genres.includes(u));
      b.addEventListener('click', () => toggleGenre(u));
      leg.appendChild(b);
    });
  }

  function monthDate(mk) {
    const y = SP.BASE_YEAR + Math.floor(mk / 12);
    return `${y}-${String(mk % 12 + 1).padStart(2, '0')}-01`;
  }

  function renderFlow() {
    const metric = s.metric;
    el('gn-flow-hint').textContent = `top ${Math.min(8, s.top.length)} genres, monthly ${metric}`;
    const data = [];
    s.top.forEach(u => {
      const arr = s.monthlyU.get(u);
      for (let k = 0; k < arr.length; k++) data.push([monthDate(s.mkMin + k), +arr[k].toFixed(2), cap(SP.genreName(u))]);
    });
    SP.makeChart(el('gn-flow'), {
      color: s.top.map(u => SP.genreColor(u)),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
          ps.filter(p => p.value[1] > 0).sort((a, b) => b.value[1] - a.value[1]).forEach(p => {
            out += `<div>${p.marker} <span style="color:#AEB4A9;text-transform:capitalize">${esc(p.value[2])}</span> <b style="float:right;margin-left:14px">${metric === 'hours' ? SP.fmt1(p.value[1]) + ' h' : SP.fmtInt(p.value[1])}</b></div>`;
          });
          return out;
        },
      },
      singleAxis: { type: 'time', top: 24, bottom: 36, left: 10, right: 10, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      series: [{ type: 'themeRiver', data, label: { show: false }, itemStyle: { opacity: 0.92 }, emphasis: { itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,0.6)' } } }],
    });
  }

  function hyLabel(hy) { return `’${String(SP.BASE_YEAR + Math.floor(hy / 2)).slice(2)} H${(hy % 2) + 1}`; }

  function renderBump() {
    const labels = s.hyKeys.map(hyLabel);
    const series = s.top.map(u => ({
      name: cap(SP.genreName(u)), type: 'line', smooth: true, symbol: 'circle', symbolSize: 7,
      lineStyle: { width: 2.4, color: SP.genreColor(u) }, itemStyle: { color: SP.genreColor(u) },
      data: s.hyKeys.map(hy => { const r = s.hyRanks.get(hy).get(u); return r != null && r <= 10 ? r : null; }),
      emphasis: { focus: 'series', lineStyle: { width: 3.4 } },
      endLabel: { show: true, formatter: p => p.value != null ? cap(SP.genreName(u)) : '', color: 'inherit', fontSize: 10.5, fontFamily: 'Manrope', fontWeight: 600, distance: 8, width: 90, overflow: 'truncate' },
      labelLayout: { moveOverlap: 'shiftY' },
    }));
    SP.makeChart(el('gn-bump'), {
      grid: { left: 8, right: 104, top: 18, bottom: 6, containLabel: true },
      tooltip: { trigger: 'item', formatter: p => `<b style="text-transform:capitalize">${esc(p.seriesName)}</b><br><span style="color:#AEB4A9">${labels[p.dataIndex]}</span> · rank <b style="color:#1ED760">#${p.value}</b>` },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', inverse: true, min: 1, max: 10, interval: 1, axisLabel: Object.assign({ formatter: v => '#' + v }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false } },
      series,
    });
  }

  function renderDiscovery() {
    const en = SP.en;
    // cumulative step curve of distinct umbrellas + markers at each first-heard
    const firsts = Array.from(s.firstU.entries()).map(([u, idx]) => ({ u, idx, sec: SP.t[idx] })).sort((a, b) => a.sec - b.sec);
    let c = 0;
    const line = firsts.map(f => { c++; return { value: [f.sec * 1000, c], u: f.u, idx: f.idx }; });
    // extend the curve flat to the end of the current range
    const endSec = SP.t[SP.subset[SP.subset.length - 1]];
    if (firsts.length && endSec * 1000 > line[line.length - 1].value[0]) {
      line.push({ value: [endSec * 1000, c], u: firsts[firsts.length - 1].u, idx: firsts[firsts.length - 1].idx, flat: true });
    }
    SP.makeChart(el('gn-disc'), {
      grid: { left: 8, right: 16, top: 14, bottom: 6, containLabel: true },
      tooltip: {
        formatter: p => {
          const dp = p.data;
          const nm = SP.nameOf(dp.idx);
          return `<b style="text-transform:capitalize">${esc(SP.genreName(dp.u))}</b> arrived<br><span style="color:#AEB4A9">${SP.fmtSecDate(SP.t[dp.idx])}</span> · via <span style="color:#1ED760">${esc(nm.artist || nm.title)}</span>`;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: SP.axisLabel, splitLine: SP.splitLine, axisLine: { show: false } },
      series: [{
        type: 'line', step: 'end', data: line.map(p => p.flat ? Object.assign({}, p, { symbol: 'none' }) : p), symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 2, color: '#1ED760' },
        itemStyle: { color: p => SP.genreColor(p.data.u) },
        areaStyle: { color: SP.areaGradient('#1ED760', 0.15, 0) },
      }],
    });
    const list = el('gn-disc-list'); list.innerHTML = '';
    firsts.slice(0, 6).forEach((f, i) => {
      const nm = SP.nameOf(f.idx);
      list.appendChild(h(`<div class="mini-row"><div class="mini-rank"><span class="gdot" style="background:${SP.genreColor(f.u)}"></span></div>
        <div style="min-width:0"><div class="mini-name" style="text-transform:capitalize">${esc(SP.genreName(f.u))}</div>
        <div class="mini-sub">via ${esc(nm.artist || nm.title)}</div></div>
        <div class="mini-val" style="font-weight:500;color:var(--tx-mid)">${SP.fmtSecDate(f.sec)}</div></div>`));
    });
  }

  function renderSeasonHeat() {
    // rows = top genres, cols = month-of-year, value = row-normalized share %
    const rows = s.top;
    const data = [], names = rows.map(u => cap(SP.genreName(u)));
    rows.forEach((u, y) => {
      const arr = s.seasonU.get(u);
      let tot = 0; for (let m = 0; m < 12; m++) tot += arr[m];
      for (let m = 0; m < 12; m++) data.push([m, y, tot > 0 ? +((arr[m] / tot) * 100).toFixed(1) : 0]);
    });
    SP.makeChart(el('gn-season'), {
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      tooltip: { formatter: p => `<b style="text-transform:capitalize">${esc(names[p.value[1]])}</b> in <b>${SP.MONTHS[p.value[0]]}</b><br><span style="color:#1ED760">${p.value[2]}%</span> of its listening` },
      visualMap: { show: false, min: 0, max: 16, dimension: 2, inRange: { color: SP.RAMP_GREEN } },
      xAxis: { type: 'category', data: SP.MONTHS.slice(), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'category', data: names, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11, color: '#AEB4A9' }) },
      series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 3, borderColor: '#0A0C0B', borderWidth: 2 }, emphasis: { itemStyle: { borderColor: 'rgba(30,215,96,0.9)', borderWidth: 1 } } }],
    });
  }

  function renderDaypartHeat() {
    const rows = s.top;
    const data = [], names = rows.map(u => cap(SP.genreName(u)));
    rows.forEach((u, y) => {
      const arr = s.daypartU.get(u);
      let tot = 0; for (let p = 0; p < 4; p++) tot += arr[p];
      for (let p = 0; p < 4; p++) data.push([p, y, tot > 0 ? +((arr[p] / tot) * 100).toFixed(1) : 0]);
    });
    SP.makeChart(el('gn-daypart'), {
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      tooltip: { formatter: p => `<b style="text-transform:capitalize">${esc(names[p.value[1]])}</b> · ${SP.DAYPARTS[p.value[0]]}<br><span style="color:#FF9F1C">${p.value[2]}%</span> of its listening` },
      visualMap: { show: false, min: 0, max: 60, dimension: 2, inRange: { color: SP.RAMP_WARM } },
      xAxis: { type: 'category', data: SP.DAYPARTS.slice(), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'category', data: names, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11, color: '#AEB4A9' }) },
      series: [{ type: 'heatmap', data, label: { show: true, color: '#F4F5F1', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => p.value[2] >= 8 ? Math.round(p.value[2]) + '%' : '' }, itemStyle: { borderRadius: 3, borderColor: '#0A0C0B', borderWidth: 2 } }],
    });
  }

  function renderDiversity() {
    if (s.entropy.length < 2) { el('gn-div').innerHTML = ''; el('gn-div-note').textContent = 'Not enough months in scope for a diversity trend.'; return; }
    const pts = s.entropy.map(([mk, H]) => [monthDate(mk), H]);
    let maxI = 0, minI = 0;
    s.entropy.forEach(([, H], i) => { if (H > s.entropy[maxI][1]) maxI = i; if (H < s.entropy[minI][1]) minI = i; });
    const lbl = mk => `${SP.MONTHS[mk % 12]} ${SP.BASE_YEAR + Math.floor(mk / 12)}`;
    const recent = s.entropy.slice(-6).reduce((a, e) => a + e[1], 0) / Math.min(6, s.entropy.length);
    const early = s.entropy.slice(0, 6).reduce((a, e) => a + e[1], 0) / Math.min(6, s.entropy.length);
    el('gn-div-note').textContent = recent > early + 0.15
      ? `Your palette is widening — recent months average ${recent.toFixed(2)} bits of genre entropy vs ${early.toFixed(2)} early on. Broadest: ${lbl(s.entropy[maxI][0])}. Most single-minded: ${lbl(s.entropy[minI][0])}.`
      : recent < early - 0.15
        ? `Your tastes are narrowing — recent months average ${recent.toFixed(2)} bits vs ${early.toFixed(2)} early on. Broadest: ${lbl(s.entropy[maxI][0])}. Most single-minded: ${lbl(s.entropy[minI][0])}.`
        : `Steady as she goes — genre diversity has hovered around ${recent.toFixed(2)} bits. Broadest month: ${lbl(s.entropy[maxI][0])}; most single-minded: ${lbl(s.entropy[minI][0])}.`;
    SP.makeChart(el('gn-div'), {
      grid: { left: 8, right: 18, top: 24, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:2px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div><b>${ps[0].value[1].toFixed(2)} bits</b> <span style="color:#AEB4A9">of genre entropy</span>`;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v.toFixed(1) }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false }, scale: true },
      series: [{
        type: 'line', data: pts, showSymbol: false, smooth: 0.3,
        lineStyle: { width: 2, color: '#34D3EB' },
        areaStyle: { color: SP.areaGradient('#34D3EB', 0.18, 0) },
        markPoint: {
          symbol: 'circle', symbolSize: 8,
          label: { color: '#AEB4A9', fontFamily: 'JetBrains Mono', fontSize: 9.5, position: 'top', distance: 8 },
          data: [
            { coord: pts[maxI], value: 'broadest', itemStyle: { color: '#A7F432' } },
            { coord: pts[minI], value: 'narrowest', itemStyle: { color: '#F45B5B' } },
          ],
        },
      }],
    });
  }

  function renderDrill() {
    const d = SP.d, en = SP.en, metric = s.metric, dr = s.drill;
    el('gn-drill-title').textContent = `Inside ${cap(SP.genreName(s.drillU))}`;
    el('gn-drill-hint').textContent = s.drillLocked
      ? 'scoped by your genre filter — clear the chip to zoom out'
      : `${SP.fmtInt(dr.ms / MSH)} h · ${SP.fmtInt(dr.plays)} plays · click any genre above to switch`;

    const arts = Array.from(dr.artists.entries()).map(([aid, a]) => ({ aid, val: metric === 'hours' ? a.ms / MSH : a.plays, ms: a.ms, plays: a.plays }))
      .sort((a, b) => b.val - a.val).slice(0, 7);
    const trks = Array.from(dr.tracks.entries()).map(([tr, a]) => ({ tr, val: metric === 'hours' ? a.ms / MSH : a.plays, ms: a.ms, plays: a.plays }))
      .sort((a, b) => b.val - a.val).slice(0, 7);

    const ab = el('gn-drill-artists'); ab.innerHTML = '';
    arts.forEach((a, i) => {
      const row = h(`<div class="mini-row" role="button" tabindex="0" style="cursor:pointer"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name">${esc(d.artists[a.aid])}</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(a.ms / MSH) + '<small> h</small>' : SP.fmtInt(a.plays) + '<small> pl</small>'}</div></div>`);
      row.addEventListener('click', () => SP.setFilter({ artist: a.aid }));
      ab.appendChild(row);
    });
    const tb = el('gn-drill-tracks'); tb.innerHTML = '';
    trks.forEach((t, i) => {
      tb.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[t.tr])}">${esc(d.trackName[t.tr])}</div>
        <div class="mini-sub">${esc(d.artists[d.trackArtist[t.tr]])}</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(t.ms / MSH) + '<small> h</small>' : SP.fmtInt(t.plays) + '<small> pl</small>'}</div></div>`));
    });

    // share-of-listening trend for the drill genre
    const shares = [];
    for (let k = 0; k < dr.monthly.length; k++) {
      const tot = s.monthlyTot[k];
      shares.push([monthDate(s.mkMin + k), tot > 0 ? +((dr.monthly[k] / tot) * 100).toFixed(1) : 0]);
    }
    SP.makeChart(el('gn-drill-share'), {
      grid: { left: 6, right: 10, top: 10, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div><b>${ps[0].value[1]}%</b> <span style="color:#AEB4A9">of that month</span>`;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontSize: 9 }), splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v + '%' }, SP.axisLabel, { fontSize: 9 }), splitLine: SP.splitLine, axisLine: { show: false } },
      series: [{ type: 'line', data: shares, showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: SP.genreColor(s.drillU) }, areaStyle: { color: SP.areaGradient(SP.genreColor(s.drillU), 0.25, 0) } }],
    });

    // subgenre treemap
    const base = SP.genreColor(s.drillU);
    SP.makeChart(el('gn-tree'), {
      tooltip: { formatter: p => `<b>${esc(p.name)}</b><br>${SP.fmt1(p.value)} h <span style="color:#AEB4A9">(artist time split across its subgenres)</span>` },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
        left: 0, right: 0, top: 0, bottom: 0,
        itemStyle: { borderColor: '#0A0C0B', borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        label: { color: '#0B1810', fontFamily: 'Manrope', fontWeight: 700, fontSize: 12, formatter: p => `${p.name}\n${SP.fmt1(p.value)} h` },
        data: s.subgenres.map((x, i) => ({
          name: x.label, value: +(x.ms / MSH).toFixed(1),
          itemStyle: { color: SP.rgba(base, Math.max(0.28, 0.95 - i * 0.05)) },
          label: { color: i < 6 ? '#0B1810' : '#F4F5F1' },
        })),
      }],
    });
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n || !SP.en || !s.order;
    el('gn-empty').hidden = !empty;
    el('gn-body').hidden = empty;
    if (empty) {
      el('gn-sub').textContent = 'No plays match the current filters.';
      el('gn-empty-msg').textContent = SP.en ? 'No plays match the current filters.' : 'Genre enrichment is unavailable in this build.';
      return;
    }
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('gn-sub').textContent = scopeArtist
      ? `${scopeArtist}, mapped by genre — ${yearTxt}.`
      : `Umbrella genres, subgenres and how your palette moves — ${yearTxt}.`;
    renderHero();
    renderFlow();
    renderBump();
    renderDiscovery();
    renderSeasonHeat();
    renderDaypartHeat();
    renderDiversity();
    renderDrill();
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.genres = {
    render(container) {
      root = container;
      root.innerHTML = skeleton();
      fill();
      return root.querySelectorAll('.reveal');
    },
    update() { if (root) fill(); },
    dispose() { if (root) SP.disposeChartsIn(root); root = null; },
  };
})();
