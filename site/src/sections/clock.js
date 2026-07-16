/* ============================================================
   SOUNDPRINT — sections/clock.js  (BUILD_SPEC §5)
   Hour×weekday warm heatmap · radial 24h · weekday/weekend ·
   night owl · daypart personality · sessions analysis
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const H12 = hh => hh === 0 ? '12 am' : hh < 12 ? hh + ' am' : hh === 12 ? '12 pm' : (hh - 12) + ' pm';
  const H12s = hh => hh === 0 ? '12a' : hh < 12 ? hh + 'a' : hh === 12 ? '12p' : (hh - 12) + 'p';

  let root = null, s = null;
  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun display order

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!sub.length) return st;
    const useH = metric === 'hours';

    // hour × weekday matrix + hourly + weekday
    const mat = new Float64Array(7 * 24);
    const hourly = new Float64Array(24);
    const wd = new Float64Array(7);
    let nightVal = 0, total = 0;
    const nightTracks = new Map(); // tr -> plays in 2-4:59am
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      const v = useH ? d.ms[i] / MSH : 1;
      const hh = SP.hour[i], w = SP.weekday[i];
      mat[w * 24 + hh] += v;
      hourly[hh] += v;
      wd[w] += v;
      total += v;
      if (hh < 5) nightVal += v;
      if (hh >= 2 && hh < 5 && d.ty[i] === 0 && d.tr[i] > 0) {
        nightTracks.set(d.tr[i], (nightTracks.get(d.tr[i]) || 0) + 1);
      }
    }
    st.mat = mat; st.hourly = Array.from(hourly); st.wd = Array.from(wd); st.total = total;
    st.nightShare = total ? (nightVal / total) * 100 : 0;
    st.nightVal = nightVal;

    // peak cell + peak hour
    let pk = 0; for (let k = 1; k < 168; k++) if (mat[k] > mat[pk]) pk = k;
    st.peakCell = { w: Math.floor(pk / 24), h: pk % 24, v: mat[pk] };
    st.peakHour = st.hourly.indexOf(Math.max(...st.hourly));

    // 3am songs
    const nt = Array.from(nightTracks.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    st.nightSongs = nt.map(([tr, plays]) => ({ name: d.trackName[tr], artist: d.artists[d.trackArtist[tr]], plays }));

    // weekend split
    st.weekendVal = wd[0] + wd[6];
    st.weekdayVal = total - st.weekendVal;

    // daypart composition per year: night 0-5, morning 6-11, afternoon 12-17, evening 18-23
    const dpYear = new Map(); // year -> [4]
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      const y = SP.year[i], hh = SP.hour[i];
      const dp = hh < 6 ? 0 : hh < 12 ? 1 : hh < 18 ? 2 : 3;
      let a = dpYear.get(y);
      if (!a) { a = [0, 0, 0, 0]; dpYear.set(y, a); }
      a[dp] += useH ? d.ms[i] / MSH : 1;
    }
    st.dpYears = Array.from(dpYear.keys()).sort((a, b) => a - b);
    st.dpYear = dpYear;

    // ---- sessions (gap > 30 min from end of previous play) ----
    const sess = [];
    let cur = null;
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      const start = SP.t[i], end = SP.t[i] + d.ms[i] / 1000;
      if (!cur || start - cur.end > 1800) {
        cur = { start, end, plays: 1, ms: d.ms[i], firstIdx: i };
        sess.push(cur);
      } else {
        cur.plays++; cur.ms += d.ms[i];
        if (end > cur.end) cur.end = end;
      }
    }
    sess.forEach(x => { x.dur = (x.end - x.start) / 60; }); // minutes
    st.sessions = sess;
    st.sessCount = sess.length;
    if (sess.length) {
      const durs = sess.map(x => x.dur).sort((a, b) => a - b);
      st.sessMedian = durs[Math.floor(durs.length / 2)];
      st.sessAvg = durs.reduce((a, b) => a + b, 0) / durs.length;
      st.longest = sess.reduce((a, b) => (b.dur > a.dur ? b : a), sess[0]);
      // histogram
      const bins = [0, 0, 0, 0, 0, 0];
      sess.forEach(x => {
        const m = x.dur;
        bins[m < 15 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : m < 240 ? 4 : 5]++;
      });
      st.sessBins = bins;
      // sessions per active day, monthly
      const perMonth = new Map(); // mk -> {sess, days:Set}
      sess.forEach(x => {
        const mk = SP.monthKey[x.firstIdx];
        let e = perMonth.get(mk);
        if (!e) { e = { sess: 0, days: new Set() }; perMonth.set(mk, e); }
        e.sess++; e.days.add(Math.floor(x.start / 86400));
      });
      st.sessTrend = Array.from(perMonth.entries()).sort((a, b) => a[0] - b[0])
        .map(([mk, e]) => ({ mk, v: e.sess / e.days.size }));
      // latest nights: sessions that ran past midnight (crossed a day boundary or
      // started 0–3 am) and ended before 9 am — ranked by how deep they went
      const late = [];
      sess.forEach(x => {
        const endDate = new Date(x.end * 1000);
        const hEnd = endDate.getUTCHours() + endDate.getUTCMinutes() / 60;
        const startH = new Date(x.start * 1000).getUTCHours();
        const crossed = Math.floor(x.start / 86400) !== Math.floor(x.end / 86400);
        if (hEnd < 9 && x.dur >= 20 && (crossed || startH < 3)) late.push({ x, hEnd });
      });
      late.sort((a, b) => b.hEnd - a.hEnd);
      st.lateNights = late.slice(0, 5).map(({ x, hEnd }) => {
        const endDate = new Date(x.end * 1000);
        const hh = endDate.getUTCHours(), mm = endDate.getUTCMinutes();
        return {
          date: SP.fmtSecDate(x.start),
          endTxt: `${hh === 0 ? 12 : hh}:${String(mm).padStart(2, '0')} am`,
          dur: x.dur, plays: x.plays,
        };
      });
    }
    return st;
  }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Listening Clock</div>
        <h1 class="sec-title">When the music happens</h1>
        <p class="sec-sub" id="ck-sub"></p>
      </div>
    </div>
    <div id="ck-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <div class="empty-t">Nothing here yet</div><div>No plays match the current filters.</div>
    </div></div></div>
    <div id="ck-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Your listening fingerprint</div><div class="card-hint" id="ck-hw-hint"></div></div>
          <div id="ck-hw" style="width:100%;height:360px"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Around the clock</div><div class="card-hint" id="ck-radial-hint">24-hour radial · night hours shaded</div></div>
          <div class="chart tall" id="ck-radial" style="height:420px"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Weekday vs weekend</div><div class="card-hint" id="ck-wk-hint"></div></div>
          <div id="ck-donut" style="width:100%;height:190px"></div>
          <div id="ck-wdbars" style="width:100%;height:220px"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%;display:flex;flex-direction:column">
          <div class="card-head"><div class="card-title">Sessions</div><div class="card-hint">a session ends after a 30-minute silence</div></div>
          <div class="statline" id="ck-sess-stats"></div>
          <div id="ck-sess-hist" style="width:100%;flex:1 1 auto;min-height:200px"></div>
          <div class="card-hint" style="margin:10px 0 2px">sessions per listening day, monthly</div>
          <div id="ck-sess-trend" style="width:100%;flex:1 1 auto;min-height:150px"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Night owl</div><div class="card-hint">midnight – 5 am</div></div>
          <div class="statline" id="ck-night-stat"></div>
          <div class="card-hint" style="margin-bottom:6px">your 3 am songs</div>
          <div class="mini" id="ck-night-songs"></div>
          <div class="card-hint" style="margin:14px 0 6px">latest nights (session end time)</div>
          <div class="mini" id="ck-late"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title" id="ck-dp-title"></div><div class="card-hint">share of listening by time of day, per year</div></div>
          <div id="ck-dayparts" style="width:100%;height:300px"></div>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- renderers ---------------- */
  function renderMatrix() {
    const metric = s.metric;
    const data = [];
    WD_ORDER.forEach((w, row) => {
      for (let hh = 0; hh < 24; hh++) {
        const v = s.mat[w * 24 + hh];
        data.push([hh, row, +v.toFixed(2)]);
      }
    });
    const vals = data.map(x => x[2]).filter(v => v > 0).sort((a, b) => a - b);
    const vmax = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.97))] : 1;
    const vmin = vals.length ? vals[Math.floor(vals.length * 0.05)] : 0;
    el('ck-hw-hint').textContent = `peak: ${SP.WEEKDAYS[s.peakCell.w]} · ${H12(s.peakCell.h)} — ${metric === 'hours' ? SP.fmt1(s.peakCell.v) + ' h' : SP.fmtInt(s.peakCell.v) + ' plays'}`;
    SP.makeChart(el('ck-hw'), {
      grid: { left: 8, right: 14, top: 10, bottom: 8, containLabel: true },
      tooltip: {
        formatter: p => {
          const w = WD_ORDER[p.value[1]];
          return `<b>${SP.WEEKDAYS[w]} · ${H12(p.value[0])}</b><br><span style="color:#FF9F1C;font-weight:700;font-size:13.5px">${metric === 'hours' ? SP.fmt1(p.value[2]) + ' h' : SP.fmtInt(p.value[2]) + ' plays'}</span> <span style="color:#AEB4A9">across the range</span>`;
        },
      },
      visualMap: { show: false, min: vmin, max: Math.max(vmin + 1, vmax), dimension: 2, inRange: { color: SP.RAMP_WARM } },
      xAxis: {
        type: 'category', data: Array.from({ length: 24 }, (_, hh) => H12s(hh)),
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { interval: 1 }), splitLine: { show: false },
      },
      yAxis: {
        type: 'category', data: WD_ORDER.map(w => SP.WEEKDAYS[w]), inverse: true,
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontSize: 11.5 }),
      },
      series: [{
        type: 'heatmap', data,
        itemStyle: { borderRadius: 4, borderColor: '#0A0C0B', borderWidth: 3 },
        emphasis: { itemStyle: { borderColor: 'rgba(255,159,28,0.9)', borderWidth: 1.5 } },
        progressive: 0,
      }],
    });
  }

  function renderRadial() {
    const metric = s.metric;
    const isNight = hh => hh < 6 || hh >= 22;
    const maxV = Math.max(...s.hourly, 1);
    SP.makeChart(el('ck-radial'), {
      polar: { radius: ['16%', '78%'] },
      angleAxis: {
        type: 'category', data: Array.from({ length: 24 }, (_, hh) => H12s(hh)),
        startAngle: 97.5, clockwise: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: Object.assign({}, SP.axisLabel, { fontSize: 9.5 }),
        splitLine: { show: false }, boundaryGap: true, z: 10,
      },
      radiusAxis: { max: maxV * 1.05, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      tooltip: {
        formatter: p => p.seriesIndex === 1 ? `<b>${H12(p.dataIndex)}</b><br><span style="color:#1ED760;font-weight:700;font-size:13.5px">${metric === 'hours' ? SP.fmt1(p.value) + ' h' : SP.fmtInt(p.value) + ' plays'}</span>${isNight(p.dataIndex) ? ' <span style="color:#34D3EB;font-family:JetBrains Mono,monospace;font-size:10px">· night</span>' : ''}` : '',
      },
      series: [
        { // night shading backdrop
          type: 'bar', coordinateSystem: 'polar', silent: true, barCategoryGap: '0%', z: 1,
          data: Array.from({ length: 24 }, (_, hh) => isNight(hh) ? maxV * 1.05 : 0),
          itemStyle: { color: 'rgba(52,211,235,0.055)' },
        },
        {
          type: 'bar', coordinateSystem: 'polar', z: 2, barCategoryGap: '18%',
          data: s.hourly.map((v, hh) => ({
            value: +v.toFixed(2),
            itemStyle: {
              borderRadius: 3,
              color: hh === s.peakHour ? '#A7F432' : isNight(hh) ? 'rgba(52,211,235,0.75)' : SP.rgba('#1ED760', 0.4 + 0.55 * (v / maxV)),
            },
          })),
        },
      ],
    });
    el('ck-radial-hint').textContent = `peak hour: ${H12(s.peakHour)} · night hours shaded cyan`;
  }

  function renderWeekSplit() {
    const metric = s.metric;
    const wkPct = s.total ? (s.weekendVal / s.total) * 100 : 0;
    el('ck-wk-hint').textContent = `${SP.fmtPct(wkPct)} of listening happens on weekends`;
    SP.makeChart(el('ck-donut'), {
      tooltip: { formatter: p => `<b>${p.name}</b> · ${metric === 'hours' ? SP.fmtInt(p.value) + ' h' : SP.fmtInt(p.value) + ' plays'} (${p.percent}%)` },
      series: [{
        type: 'pie', radius: ['58%', '82%'], center: ['50%', '52%'],
        label: { show: true, formatter: '{b}\n{d}%', color: '#AEB4A9', fontFamily: 'Manrope', fontSize: 11, fontWeight: 600, lineHeight: 16 },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        itemStyle: { borderColor: '#121513', borderWidth: 3, borderRadius: 6 },
        data: [
          { name: 'Weekdays', value: Math.round(s.weekdayVal), itemStyle: { color: '#1ED760' } },
          { name: 'Weekends', value: Math.round(s.weekendVal), itemStyle: { color: '#34D3EB' } },
        ],
      }],
    });
    const maxW = Math.max(...s.wd, 1);
    SP.makeChart(el('ck-wdbars'), {
      grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${p.name}</b> · ${metric === 'hours' ? SP.fmtInt(p.value) + ' h' : SP.fmtInt(p.value) + ' plays'}` },
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
      yAxis: { type: 'category', data: WD_ORDER.map(w => SP.WEEKDAYS[w]), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontSize: 11 }) },
      series: [{
        type: 'bar', barMaxWidth: 13,
        data: WD_ORDER.map(w => ({
          value: +s.wd[w].toFixed(1),
          itemStyle: { color: (w === 0 || w === 6) ? 'rgba(52,211,235,0.8)' : SP.rgba('#1ED760', 0.35 + 0.6 * (s.wd[w] / maxW)), borderRadius: [0, 3, 3, 0] },
        })),
        label: { show: true, position: 'right', color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => metric === 'hours' ? SP.fmtInt(p.value) : SP.fmtInt(p.value) },
      }],
    });
  }

  function renderSessions() {
    const stats = el('ck-sess-stats'); stats.innerHTML = '';
    const fmtDur = m => m >= 90 ? SP.fmt1(m / 60) + ' h' : Math.round(m) + ' min';
    const L = s.longest;
    [
      ['Sessions', SP.fmtInt(s.sessCount), ''],
      ['Median length', fmtDur(s.sessMedian), ''],
      ['Average', fmtDur(s.sessAvg), ''],
      ['Longest ever', fmtDur(L.dur), `${SP.fmtSecDate(L.start)} · ${SP.fmtInt(L.plays)} tracks`],
    ].forEach(([k, v, sub]) => {
      stats.appendChild(h(`<div class="sl"><div class="k">${k}</div><div class="v">${v}${sub ? `<br><small>${sub}</small>` : ''}</div></div>`));
    });

    const labels = ['<15m', '15–30m', '30–60m', '1–2h', '2–4h', '4h+'];
    const maxIdx = s.sessBins.indexOf(Math.max(...s.sessBins));
    SP.makeChart(el('ck-sess-hist'), {
      grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
      tooltip: { formatter: p => `<b>${labels[p.dataIndex]}</b> sessions · ${SP.fmtInt(p.value)} (${SP.fmtPct(p.value / s.sessCount * 100)})` },
      xAxis: { type: 'category', data: labels, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v >= 1000 ? (v / 1000) + 'k' : v }, SP.axisLabel), splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 40,
        data: s.sessBins.map((v, i) => ({ value: v, itemStyle: { color: i === maxIdx ? '#1ED760' : 'rgba(30,215,96,0.3)', borderRadius: [4, 4, 0, 0] } })),
      }],
    });

    SP.makeChart(el('ck-sess-trend'), {
      grid: { left: 8, right: 10, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${SP.monthKeyLabel(s.sessTrend[ps[0].dataIndex].mk, true)}</div><b>${SP.fmt1(ps[0].value)}</b> sessions / listening day`,
      },
      xAxis: {
        type: 'category', data: s.sessTrend.map(x => SP.monthKeyLabel(x.mk, true)),
        axisLine: SP.axisLine, axisTick: { show: false },
        axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(s.sessTrend.length / 10) - 1) }, SP.axisLabel),
      },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine, min: 0 },
      series: [{
        type: 'line', data: s.sessTrend.map(x => +x.v.toFixed(2)), showSymbol: false, smooth: 0.3,
        lineStyle: { width: 1.8, color: '#34D3EB' }, areaStyle: { color: SP.areaGradient('#34D3EB', 0.16, 0.01) },
      }],
    });
  }

  function renderNightOwl() {
    const stat = el('ck-night-stat'); stat.innerHTML = '';
    stat.appendChild(h(`<div class="sl"><div class="k">Share after midnight</div><div class="v warm">${SP.fmtPct(s.nightShare, s.nightShare < 10 ? 1 : 0)}</div></div>`));
    stat.appendChild(h(`<div class="sl"><div class="k">${s.metric === 'hours' ? 'Night hours' : 'Night plays'}</div><div class="v">${SP.fmtInt(s.nightVal)}</div></div>`));

    const songs = el('ck-night-songs'); songs.innerHTML = '';
    if (!s.nightSongs.length) songs.innerHTML = '<div class="mini-sub" style="padding:6px 4px">No 2–5 am plays in this scope. You sleep. Respect.</div>';
    s.nightSongs.forEach((t, i) => {
      songs.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(t.name)} — ${esc(t.artist)}">${esc(t.name)}</div>
        <div class="mini-sub">${esc(t.artist)}</div></div>
        <div class="mini-val">${SP.fmtInt(t.plays)}<small> pl</small></div></div>`));
    });

    const late = el('ck-late'); late.innerHTML = '';
    if (!s.lateNights || !s.lateNights.length) late.innerHTML = '<div class="mini-sub" style="padding:6px 4px">No sessions ran past midnight.</div>';
    (s.lateNights || []).forEach((ln, i) => {
      late.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name">${ln.date}</div>
        <div class="mini-sub">${SP.fmtInt(ln.plays)} tracks · ${ln.dur >= 90 ? SP.fmt1(ln.dur / 60) + ' h' : Math.round(ln.dur) + ' min'}</div></div>
        <div class="mini-val warm" style="color:#FF9F1C">${ln.endTxt}</div></div>`));
    });
  }

  function renderDayparts() {
    const NAMES = ['Night (12–6a)', 'Morning (6–12)', 'Afternoon (12–6p)', 'Evening (6–12a)'];
    const COLORS = ['#34D3EB', '#FFD97D', '#FF9F1C', '#1ED760'];
    el('ck-dp-title').textContent = `Your peak hour is ${H12(s.peakHour)}`;
    const years = s.dpYears.map(String);
    const series = NAMES.map((name, k) => ({
      name, type: 'bar', stack: 'dp', barMaxWidth: 44,
      data: s.dpYears.map(y => {
        const a = s.dpYear.get(y);
        const tot = a[0] + a[1] + a[2] + a[3];
        return tot ? +((a[k] / tot) * 100).toFixed(1) : 0;
      }),
      itemStyle: { color: SP.rgba(COLORS[k], k === 0 ? 0.9 : 0.8) },
    }));
    series[3].itemStyle = { color: '#1ED760' };
    series.forEach((sr, k) => { if (k === 3) sr.itemStyle.borderRadius = [3, 3, 0, 0]; });
    SP.makeChart(el('ck-dayparts'), {
      grid: { left: 8, right: 8, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        formatter: ps => {
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${ps[0].axisValueLabel}</div>`;
          ps.forEach(p => { out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${p.value}%</b></div>`; });
          return out;
        },
      },
      xAxis: { type: 'category', data: years, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', max: 100, axisLabel: Object.assign({ formatter: v => v + '%' }, SP.axisLabel), splitLine: SP.splitLine },
      series,
    });
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n;
    el('ck-empty').hidden = !empty;
    el('ck-body').hidden = empty;
    if (empty) { el('ck-sub').textContent = 'No plays match the current filters.'; return; }
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('ck-sub').textContent = scopeArtist
      ? `${scopeArtist} o'clock — hours, weekdays and late nights, ${yearTxt}.`
      : `Hour by hour, weekday by weekday — ${yearTxt}.`;
    renderMatrix();
    renderRadial();
    renderWeekSplit();
    renderSessions();
    renderNightOwl();
    renderDayparts();
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.clock = {
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
