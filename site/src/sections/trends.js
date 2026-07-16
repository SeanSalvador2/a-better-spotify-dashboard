/* ============================================================
   SOUNDPRINT — sections/trends.js  (BUILD_SPEC §2)
   Calendar heatmaps · monthly combo + YoY ghost · YoY comparison ·
   rolling momentum + eras · streaks & records · seasonal profile
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function p95(arr) { if (!arr.length) return 1; const a = Array.from(arr).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] || 1; }

  let root = null, s = null, ghostOn = false;

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!sub.length) return st;

    // per-day aggregates + per-day top track
    const dayAgg = new Map();               // dayKey -> {ms, plays}
    const dayTracks = new Map();            // dayKey -> Map<tr, plays> (music only)
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], dk = SP.dayKey[i];
      let a = dayAgg.get(dk);
      if (!a) { a = { ms: 0, plays: 0 }; dayAgg.set(dk, a); }
      a.ms += d.ms[i]; a.plays++;
      if (d.ty[i] === 0) {
        let m = dayTracks.get(dk);
        if (!m) { m = new Map(); dayTracks.set(dk, m); }
        const tr = d.tr[i];
        m.set(tr, (m.get(tr) || 0) + 1);
      }
    }
    st.dayAgg = dayAgg;
    st.dayTop = function (dk) {
      const m = dayTracks.get(dk);
      if (!m) return null;
      let best = null, bv = -1;
      m.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      return best == null ? null : { name: d.trackName[best], artist: d.artists[d.trackArtist[best]], plays: bv };
    };

    const dayKeys = Array.from(dayAgg.keys()).sort((a, b) => a - b);
    st.dayMin = dayKeys[0]; st.dayMax = dayKeys[dayKeys.length - 1];
    st.years = [];
    {
      const y0 = SP.dayKeyToDate(st.dayMin).getUTCFullYear();
      const y1 = SP.dayKeyToDate(st.dayMax).getUTCFullYear();
      for (let y = y0; y <= y1; y++) st.years.push(y);
    }

    // monthly aggregates for current subset + yearless (for ghost overlay)
    st.monthly = SP.byMonthKey(sub);
    st.mkMin = SP.monthKey[sub[0]];
    st.mkMax = SP.monthKey[sub[sub.length - 1]];
    st.subYearless = SP.buildSubsetCustom({ year: 'all' });
    st.monthlyAll = SP.byMonthKey(st.subYearless);
    st.yearly = SP.groupSum(st.subYearless, i => SP.year[i]);

    // rolling 30-day average of the metric
    const span = st.dayMax - st.dayMin + 1;
    const daily = new Float64Array(span);
    dayAgg.forEach((a, dk) => { daily[dk - st.dayMin] = metric === 'hours' ? a.ms / MSH : a.plays; });
    const W = 30, roll = [];
    let acc = 0;
    for (let k = 0; k < span; k++) {
      acc += daily[k];
      if (k >= W) acc -= daily[k - W];
      const denom = Math.min(k + 1, W);
      roll.push([(st.dayMin + k) * 86400000, +(acc / denom).toFixed(3)]);
    }
    st.roll = roll;

    // era annotations: top artist (or top track under artist focus) per half-year
    const eraKeyOf = SP.filter.artist != null ? SP.trackIdOf : SP.artistIdOf;
    const eraName = SP.filter.artist != null ? (k => d.trackName[k]) : (k => d.artists[k]);
    const hyMap = new Map(); // hy -> Map<key, val>
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], hy = Math.floor(SP.monthKey[i] / 6);
      const key = eraKeyOf(i);
      if (key < 0) continue;
      let m = hyMap.get(hy);
      if (!m) { m = new Map(); hyMap.set(hy, m); }
      m.set(key, (m.get(key) || 0) + (metric === 'hours' ? d.ms[i] / MSH : 1));
    }
    st.eras = [];
    Array.from(hyMap.keys()).sort((a, b) => a - b).forEach(hy => {
      const m = hyMap.get(hy);
      let best = null, bv = -1;
      m.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      if (best == null) return;
      const year = SP.BASE_YEAR + Math.floor(hy / 2), half = hy % 2;
      const start = Date.UTC(year, half ? 6 : 0, 1);
      const end = Date.UTC(year, half ? 12 : 6, 1) - 86400000;
      st.eras.push({ start, end, name: eraName(best), val: bv });
    });

    // seasonal: metric by month-of-year, averaged across occurrences in range
    const moTotal = new Float64Array(12), moOcc = new Float64Array(12);
    st.monthly.forEach((e, mk) => {
      const mo = mk % 12;
      moTotal[mo] += SP.metricVal(e, metric);
    });
    // occurrences: how many (year,month) cells fall inside the day span
    {
      const d0 = SP.dayKeyToDate(st.dayMin), d1 = SP.dayKeyToDate(st.dayMax);
      let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
      const yEnd = d1.getUTCFullYear(), mEnd = d1.getUTCMonth();
      while (y < yEnd || (y === yEnd && m <= mEnd)) {
        moOcc[m]++;
        m++; if (m === 12) { m = 0; y++; }
      }
    }
    st.seasonal = [];
    for (let mo = 0; mo < 12; mo++) st.seasonal.push(moOcc[mo] ? moTotal[mo] / moOcc[mo] : 0);

    // streaks / drought / biggest days
    let bestS = 0, run = 0, prev = null, bestSEnd = null;
    let bestD = 0, bestDFrom = null, bestDTo = null;
    for (const dk of dayKeys) {
      if (prev != null && dk === prev + 1) run++; else run = 1;
      if (run > bestS) { bestS = run; bestSEnd = dk; }
      if (prev != null && dk - prev - 1 > bestD) { bestD = dk - prev - 1; bestDFrom = prev; bestDTo = dk; }
      prev = dk;
    }
    st.streak = { len: bestS, start: bestSEnd != null ? bestSEnd - bestS + 1 : null, end: bestSEnd };
    st.drought = { len: bestD, from: bestDFrom, to: bestDTo };

    const days = [];
    dayAgg.forEach((a, dk) => days.push({ dk, ms: a.ms, plays: a.plays, val: metric === 'hours' ? a.ms / MSH : a.plays }));
    days.sort((a, b) => b.val - a.val);
    st.bigDays = days.slice(0, 10);

    return st;
  }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Trends</div>
        <h1 class="sec-title">The shape of your listening</h1>
        <p class="sec-sub" id="tr-sub"></p>
      </div>
    </div>
    <div id="tr-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-4 4"/></svg>
      <div class="empty-t">Nothing here yet</div><div>No plays match the current filters — try another year or clear a filter.</div>
    </div></div></div>
    <div id="tr-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title" id="tr-cal-title">Every day, colored by listening</div><div class="card-hint">hover a cell for that day's top track</div></div>
          <div id="tr-cal" style="width:100%"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c8 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Month by month</div>
            <button class="btn-ghost" id="tr-ghost">YoY ghost</button></div>
          <div class="chart" id="tr-monthly"></div>
        </div></div>
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Year over year</div><div class="card-hint" id="tr-yoy-hint"></div></div>
          <div class="chart" id="tr-yoy"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Listening momentum</div><div class="card-hint" id="tr-mom-hint">rolling 30-day average · era labels show who owned each half-year</div></div>
          <div class="chart" id="tr-momentum"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Streaks & records</div><div class="card-hint" id="tr-rec-hint"></div></div>
          <div id="tr-recs"></div>
          <table class="tbl" style="margin-top:var(--sp-3)">
            <thead><tr><th>#</th><th>Date</th><th class="num">Hours</th><th class="num">Plays</th><th>Top track</th></tr></thead>
            <tbody id="tr-bigdays"></tbody>
          </table>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Seasonal profile</div><div class="card-hint" id="tr-sea-hint"></div></div>
          <div class="chart tall" id="tr-seasonal"></div>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- charts ---------------- */
  function renderCalendar() {
    const node = el('tr-cal');
    const metric = s.metric;
    const years = SP.filter.year === 'all' ? s.years : [SP.filter.year];
    const PER = 152, TOP = 14;
    node.style.height = (years.length * PER + 34) + 'px';

    const vals = [];
    s.dayAgg.forEach((a, dk) => vals.push(metric === 'hours' ? a.ms / MSH : a.plays));
    const vmax = Math.max(1, p95(vals));

    const calendars = [], series = [];
    years.forEach((y, i) => {
      calendars.push({
        top: TOP + i * PER + 22, left: 44, right: 10, range: String(y),
        cellSize: ['auto', 13.5],
        splitLine: { show: false },
        itemStyle: { color: 'rgba(255,255,255,0.025)', borderColor: '#0A0C0B', borderWidth: 2.5 },
        dayLabel: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], firstDay: 0 },
        monthLabel: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 },
        yearLabel: { show: true, position: 'left', margin: 26, color: '#AEB4A9', fontFamily: 'Bricolage Grotesque', fontSize: 15, fontWeight: 700 },
      });
      const data = [];
      s.dayAgg.forEach((a, dk) => {
        const dt = SP.dayKeyToDate(dk);
        if (dt.getUTCFullYear() !== y) return;
        const v = metric === 'hours' ? a.ms / MSH : a.plays;
        data.push([dt.toISOString().slice(0, 10), +v.toFixed(2), dk]);
      });
      series.push({ type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i, data, itemStyle: { borderRadius: 2.5 }, emphasis: { itemStyle: { borderColor: 'rgba(30,215,96,0.9)', borderWidth: 1 } } });
    });

    SP.makeChart(node, {
      tooltip: {
        formatter: p => {
          if (!p.value) return '';
          const dk = p.value[2];
          const a = s.dayAgg.get(dk);
          const top = s.dayTop(dk);
          const head = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${SP.fmtDate(dk)}</div>`;
          const line = `<b style="font-size:13.5px">${SP.fmt1(a.ms / MSH)} h</b> <span style="color:#AEB4A9">· ${SP.fmtInt(a.plays)} plays</span>`;
          const tt = top ? `<div style="margin-top:5px;color:#AEB4A9;font-size:12px;max-width:240px;white-space:normal">Top track: <span style="color:#1ED760;font-weight:600">${esc(top.name)}</span> — ${esc(top.artist)} (${top.plays}×)</div>` : '';
          return head + line + tt;
        },
      },
      visualMap: {
        show: false, min: 0, max: vmax, type: 'continuous', dimension: 1,
        inRange: { color: SP.RAMP_GREEN },
      },
      calendar: calendars,
      series,
    });
    el('tr-cal-title').textContent = metric === 'hours' ? 'Every day, colored by hours' : 'Every day, colored by plays';
  }

  function monthList() {
    const out = [];
    for (let mk = s.mkMin; mk <= s.mkMax; mk++) out.push(mk);
    return out;
  }

  function renderMonthly() {
    const mks = monthList();
    const labels = mks.map(mk => SP.monthKeyLabel(mk, true));
    const hrs = mks.map(mk => { const e = s.monthly.get(mk); return e ? +(e.ms / MSH).toFixed(1) : 0; });
    const pls = mks.map(mk => { const e = s.monthly.get(mk); return e ? e.plays : 0; });
    const series = [
      {
        name: 'Hours', type: 'bar', data: hrs, yAxisIndex: 0, barMaxWidth: 18,
        itemStyle: { borderRadius: [3, 3, 0, 0], color: SP.areaGradient('#1ED760', 0.95, 0.45) },
      },
      {
        name: 'Plays', type: 'line', data: pls, yAxisIndex: 1, smooth: 0.3, showSymbol: false,
        lineStyle: { width: 1.8, color: '#34D3EB' }, itemStyle: { color: '#34D3EB' },
      },
    ];
    if (ghostOn) {
      const gh = mks.map(mk => { const e = s.monthlyAll.get(mk - 12); return e ? +(e.ms / MSH).toFixed(1) : null; });
      const gp = mks.map(mk => { const e = s.monthlyAll.get(mk - 12); return e ? e.plays : null; });
      series.push({ name: 'Hours (prev yr)', type: 'bar', data: gh, yAxisIndex: 0, barMaxWidth: 18, barGap: '-100%', z: 1, silent: true, itemStyle: { color: 'rgba(232,230,223,0.10)', borderRadius: [3, 3, 0, 0] } });
      series.push({ name: 'Plays (prev yr)', type: 'line', data: gp, yAxisIndex: 1, smooth: 0.3, showSymbol: false, silent: true, lineStyle: { width: 1.2, type: 'dashed', color: 'rgba(52,211,235,0.35)' } });
    }
    SP.makeChart(el('tr-monthly'), {
      grid: { left: 8, right: 8, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        formatter: ps => {
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${ps[0].axisValueLabel}</div>`;
          ps.forEach(p => {
            if (p.value == null) return;
            const v = p.seriesName.startsWith('Hours') ? SP.fmtInt(p.value) + ' h' : SP.fmtInt(p.value) + ' plays';
            out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${v}</b></div>`;
          });
          return out;
        },
      },
      xAxis: { type: 'category', data: labels, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(mks.length / 16) - 1) }, SP.axisLabel) },
      yAxis: [
        { type: 'value', axisLabel: Object.assign({ formatter: v => v + ' h' }, SP.axisLabel), splitLine: SP.splitLine },
        { type: 'value', axisLabel: SP.axisLabel, splitLine: { show: false } },
      ],
      series,
    });
  }

  function renderYoY() {
    const years = [];
    s.yearly.forEach((e, y) => years.push(y));
    years.sort((a, b) => a - b);
    const sel = SP.filter.year;
    const hrs = years.map(y => +((s.yearly.get(y).ms) / MSH).toFixed(0));
    const pls = years.map(y => s.yearly.get(y).plays);
    el('tr-yoy-hint').textContent = sel === 'all' ? 'all years' : `${sel} highlighted`;
    SP.makeChart(el('tr-yoy'), {
      grid: { left: 8, right: 8, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } } },
      xAxis: { type: 'category', data: years.map(String), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: [
        { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
        { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Hours', type: 'bar', data: hrs.map((v, i) => ({ value: v, itemStyle: { color: (sel === 'all' || years[i] === sel) ? '#1ED760' : 'rgba(30,215,96,0.25)', borderRadius: [3, 3, 0, 0] } })),
          barMaxWidth: 22, yAxisIndex: 0,
        },
        {
          name: 'Plays', type: 'bar', data: pls.map((v, i) => ({ value: v, itemStyle: { color: (sel === 'all' || years[i] === sel) ? '#34D3EB' : 'rgba(52,211,235,0.22)', borderRadius: [3, 3, 0, 0] } })),
          barMaxWidth: 22, yAxisIndex: 1,
        },
      ],
    });
  }

  function renderMomentum() {
    const metric = s.metric;
    const areas = s.eras.map((e, i) => ([
      {
        xAxis: e.start,
        itemStyle: { color: i % 2 ? 'rgba(255,255,255,0.022)' : 'rgba(30,215,96,0.028)' },
        label: {
          show: true, position: 'insideTop', distance: i % 2 ? 24 : 8, color: '#AEB4A9',
          fontFamily: 'JetBrains Mono', fontSize: 9.5, fontWeight: 500,
          formatter: e.name.length > 16 ? e.name.slice(0, 15) + '…' : e.name,
        },
      },
      { xAxis: Math.min(e.end, s.dayMax * 86400000) },
    ]));
    el('tr-mom-hint').textContent = SP.filter.artist != null
      ? 'rolling 30-day average · era labels show the top track of each half-year'
      : 'rolling 30-day average · era labels show who owned each half-year';
    SP.makeChart(el('tr-momentum'), {
      grid: { left: 8, right: 18, top: 30, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          const p = ps[0];
          const dt = new Date(p.value[0]);
          const v = metric === 'hours' ? SP.fmt1(p.value[1]) + ' h/day' : SP.fmt1(p.value[1]) + ' plays/day';
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:2px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}</div><b style="font-size:13.5px">${v}</b> <span style="color:#AEB4A9">30-day avg</span>`;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => metric === 'hours' ? v + ' h' : SP.fmtInt(v) }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'line', showSymbol: false, smooth: 0.2, sampling: 'lttb', data: s.roll,
        lineStyle: { width: 2, color: '#1ED760' },
        areaStyle: { color: SP.areaGradient('#1ED760', 0.22, 0.01) },
        markArea: { silent: true, data: areas },
        emphasis: { disabled: true },
      }],
    });
  }

  function renderSeasonal() {
    const metric = s.metric;
    const maxIdx = s.seasonal.indexOf(Math.max(...s.seasonal));
    el('tr-sea-hint').textContent = metric === 'hours' ? 'avg hours per month-of-year' : 'avg plays per month-of-year';
    SP.makeChart(el('tr-seasonal'), {
      grid: { left: 8, right: 52, top: 16, bottom: 6, containLabel: true },
      tooltip: {
        formatter: p => `<b>${SP.MONTHS[p.dataIndex]}</b> · avg ${metric === 'hours' ? SP.fmt1(p.value) + ' h' : SP.fmtInt(p.value) + ' plays'}/month`,
      },
      xAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine, axisLine: { show: false } },
      yAxis: { type: 'category', data: SP.MONTHS.slice(), inverse: true, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontSize: 11 }) },
      series: [{
        type: 'bar', data: s.seasonal.map((v, i) => ({
          value: +v.toFixed(1),
          itemStyle: { color: i === maxIdx ? '#1ED760' : 'rgba(30,215,96,0.30)', borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 14,
        label: { show: true, position: 'right', color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => p.dataIndex === maxIdx ? (metric === 'hours' ? SP.fmt1(p.value) + ' h' : SP.fmtInt(p.value)) : '' },
      }],
    });
  }

  function renderRecords() {
    const recs = el('tr-recs'); recs.innerHTML = '';
    const st = s.streak, dr = s.drought;
    const streakSub = st.len > 0 ? `${SP.fmtDate(st.start)} – ${SP.fmtDate(st.end)}` : '';
    const droughtSub = dr.len > 0 ? `${SP.fmtDate(dr.from)} → ${SP.fmtDate(dr.to)}` : 'no gaps in range';
    recs.appendChild(h(`<div class="rec"><div class="k">Longest daily streak</div><div class="v"><span class="accent">${SP.fmtInt(st.len)} days</span><small>${streakSub}</small></div></div>`));
    recs.appendChild(h(`<div class="rec"><div class="k">Longest drought</div><div class="v">${SP.fmtInt(dr.len)} days<small>${droughtSub}</small></div></div>`));
    el('tr-rec-hint').textContent = 'top 10 biggest days';

    const tb = el('tr-bigdays'); tb.innerHTML = '';
    s.bigDays.forEach((bd, i) => {
      const top = s.dayTop(bd.dk);
      tb.appendChild(h(`<tr>
        <td class="num dim">${i + 1}</td>
        <td style="white-space:nowrap;font-family:var(--f-mono);font-size:0.78rem;color:var(--tx-hi)">${SP.fmtDate(bd.dk)}</td>
        <td class="num">${SP.fmt1(bd.ms / MSH)}</td>
        <td class="num dim">${SP.fmtInt(bd.plays)}</td>
        <td><div class="t-name" title="${top ? esc(top.name + ' — ' + top.artist) : ''}">${top ? esc(top.name) : '—'}</div></td>
      </tr>`));
    });
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n;
    el('tr-empty').hidden = !empty;
    el('tr-body').hidden = empty;
    if (empty) { el('tr-sub').textContent = 'No plays match the current filters.'; return; }

    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('tr-sub').textContent = scopeArtist
      ? `${scopeArtist}'s rhythm across ${SP.fmtInt(s.dayMax - s.dayMin + 1)} days — ${yearTxt}.`
      : `Daily rhythm, momentum and records — ${yearTxt}.`;

    const gbtn = el('tr-ghost');
    gbtn.classList.toggle('on', ghostOn);
    gbtn.onclick = () => { ghostOn = !ghostOn; gbtn.classList.toggle('on', ghostOn); renderMonthly(); };

    renderCalendar();
    renderMonthly();
    renderYoY();
    renderMomentum();
    renderSeasonal();
    renderRecords();
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.trends = {
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
