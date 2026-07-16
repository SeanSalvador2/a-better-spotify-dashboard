/* ============================================================
   SOUNDPRINT — sections/mood.js  (v2 enrichment · PHASE B1)
   Audio DNA radar · mood quadrant · mood over time · by hour/weekday ·
   tempo · acousticness trend · dance by weekday · per-year fingerprints
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let root = null, s = null, energyOverlay = true;
  const AXES = ['Energy', 'Valence', 'Danceability', 'Acousticness', 'Speechiness'];

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, en = SP.en, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!en || !sub.length) return st;

    const E = en.trackEnergy, V = en.trackValence, DA = en.trackDance,
      AC = en.trackAcoustic, SPE = en.trackSpeech, TP = en.trackTempo, FS = en.trackFeatSrc;

    // weighted sums (weight = ms)
    let w = 0, we = 0, wv = 0, wd = 0, wa = 0, wsp = 0, wt = 0, wtw = 0, approxMs = 0, featMs = 0;
    st.mkMin = SP.monthKey[sub[0]];
    st.mkMax = SP.monthKey[sub[sub.length - 1]];
    const nMk = st.mkMax - st.mkMin + 1;
    const moV = new Float64Array(nMk), moE = new Float64Array(nMk), moW = new Float64Array(nMk);
    const hrV = new Float64Array(24), hrE = new Float64Array(24), hrW = new Float64Array(24);
    const wdV = new Float64Array(7), wdE = new Float64Array(7), wdW = new Float64Array(7);
    const wdD = new Float64Array(7), wdDW = new Float64Array(7);
    const yrA = new Map(), yrW = new Map();                 // acousticness per year
    const yrF = new Map();                                  // per-year feature sums [e,v,d,a,s,w]
    const perTrack = new Map();                             // tr -> ms in subset
    const tempoBins = new Float64Array(15);                 // 60..210 step 10 (clamped)

    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i];
      const ms = d.ms[i];
      const v = V[tr];
      if (v < 0) continue;                                   // no features at all
      featMs += ms;
      if (FS[tr] === 1) approxMs += ms;
      w += ms; we += E[tr] * ms; wv += v * ms; wd += DA[tr] * ms; wa += AC[tr] * ms; wsp += SPE[tr] * ms;
      if (TP[tr] > 0) { wt += TP[tr] * ms; wtw += ms; const b = Math.min(14, Math.max(0, Math.floor((TP[tr] - 60) / 10))); tempoBins[b] += ms / MSH; }
      const mk = SP.monthKey[i] - st.mkMin;
      moV[mk] += v * ms; moE[mk] += E[tr] * ms; moW[mk] += ms;
      const hr = SP.hour[i];
      hrV[hr] += v * ms; hrE[hr] += E[tr] * ms; hrW[hr] += ms;
      const wd_ = SP.weekday[i];
      wdV[wd_] += v * ms; wdE[wd_] += E[tr] * ms; wdW[wd_] += ms;
      wdD[wd_] += DA[tr] * ms; wdDW[wd_] += ms;
      const y = SP.year[i];
      yrA.set(y, (yrA.get(y) || 0) + AC[tr] * ms); yrW.set(y, (yrW.get(y) || 0) + ms);
      let f = yrF.get(y); if (!f) { f = [0, 0, 0, 0, 0, 0]; yrF.set(y, f); }
      f[0] += E[tr] * ms; f[1] += v * ms; f[2] += DA[tr] * ms; f[3] += AC[tr] * ms; f[4] += SPE[tr] * ms; f[5] += ms;
      perTrack.set(tr, (perTrack.get(tr) || 0) + ms);
    }

    if (w <= 0) { st.noFeatures = true; return st; }
    st.dna = [we / w, wv / w, wd / w, wa / w, wsp / w].map(x => +x.toFixed(1));
    st.tempo = wtw > 0 ? Math.round(wt / wtw) : null;
    st.approxPct = featMs > 0 ? (approxMs / featMs) * 100 : 0;

    st.monthly = [];
    for (let k = 0; k < nMk; k++) if (moW[k] > 0) st.monthly.push({ mk: st.mkMin + k, v: +(moV[k] / moW[k]).toFixed(1), e: +(moE[k] / moW[k]).toFixed(1) });
    st.byHour = Array.from({ length: 24 }, (_, hr) => hrW[hr] > 0 ? { v: +(hrV[hr] / hrW[hr]).toFixed(1), e: +(hrE[hr] / hrW[hr]).toFixed(1) } : null);
    st.byWeekday = Array.from({ length: 7 }, (_, k) => wdW[k] > 0 ? { v: +(wdV[k] / wdW[k]).toFixed(1), e: +(wdE[k] / wdW[k]).toFixed(1) } : null);
    st.danceWd = Array.from({ length: 7 }, (_, k) => wdDW[k] > 0 ? +(wdD[k] / wdDW[k]).toFixed(1) : 0);
    st.acousticYr = Array.from(yrA.keys()).sort((a, b) => a - b).map(y => ({ y, a: +(yrA.get(y) / yrW.get(y)).toFixed(1) }));
    st.yearDna = Array.from(yrF.keys()).sort((a, b) => a - b).map(y => {
      const f = yrF.get(y);
      return { y, vals: [f[0] / f[5], f[1] / f[5], f[2] / f[5], f[3] / f[5], f[4] / f[5]].map(x => +x.toFixed(1)) };
    });
    st.tempoBins = Array.from(tempoBins);

    // quadrant: top ~400 tracks by time
    const tracks = Array.from(perTrack.entries()).sort((a, b) => b[1] - a[1]).slice(0, 400);
    st.quad = tracks.map(([tr, ms]) => ({
      tr, ms, v: V[tr], e: E[tr], approx: FS[tr] === 1,
      aid: d.trackArtist[tr], u: en.artistUmbrella[d.trackArtist[tr]],
    })).filter(t => t.v >= 0 && t.e >= 0);

    // fastest / slowest favourites (>= 1 h listening, valid tempo)
    const favs = Array.from(perTrack.entries()).filter(([tr, ms]) => ms >= MSH && TP[tr] > 0 && FS[tr] === 0);
    favs.sort((a, b) => TP[b[0]] - TP[a[0]]);
    st.fastest = favs.slice(0, 5).map(([tr, ms]) => ({ tr, ms, bpm: TP[tr] }));
    st.slowest = favs.slice(-5).reverse().map(([tr, ms]) => ({ tr, ms, bpm: TP[tr] }));

    // saddest / happiest month annotations
    if (st.monthly.length) {
      st.sadIdx = 0; st.happyIdx = 0;
      st.monthly.forEach((m, i) => { if (m.v < st.monthly[st.sadIdx].v) st.sadIdx = i; if (m.v > st.monthly[st.happyIdx].v) st.happyIdx = i; });
    }
    return st;
  }

  function edgePos(idx) {
    const n = s.monthly.length;
    if (idx < n * 0.12) return 'right';
    if (idx > n * 0.88) return 'left';
    return 'top';
  }
  function mkLabel(mk) { return `${SP.MONTHS[mk % 12]} ${SP.BASE_YEAR + Math.floor(mk / 12)}`; }
  function monthDate(mk) { return `${SP.BASE_YEAR + Math.floor(mk / 12)}-${String(mk % 12 + 1).padStart(2, '0')}-01`; }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Mood</div>
        <h1 class="sec-title">What your ears feel like</h1>
        <p class="sec-sub" id="md-sub"></p>
      </div>
    </div>
    <div id="md-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2.5-6 4 12 3-8 1.8 2H22"/></svg>
      <div class="empty-t">Nothing here yet</div><div id="md-empty-msg">No plays match the current filters.</div>
    </div></div></div>
    <div id="md-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal">
          <div class="mood-hero">
            <div class="card hoverable">
              <div class="card-head"><div class="card-title">Your audio DNA</div><div class="card-hint">time-weighted · vs a 50-line reference</div></div>
              <div class="chart" id="md-radar" style="height:280px"></div>
              <div class="mh-tempo"><span class="k">Average tempo</span><span class="v" id="md-bpm">—</span></div>
            </div>
            <div class="card hoverable">
              <div class="card-head"><div class="card-title">Mood over time</div>
                <button class="btn-ghost on" id="md-eover">Energy overlay</button></div>
              <div class="chart tall" id="md-trend" style="height:352px"></div>
            </div>
          </div>
          <div class="approx-hint" id="md-approx"></div>
        </div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">The mood quadrant</div><div class="card-hint">valence × energy of your top tracks · bubble = hours · color = genre · click → artist focus</div></div>
          <div id="md-quad" style="width:100%;height:520px"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Mood by hour</div><div class="card-hint">morning energy, 2am feelings</div></div>
          <div class="chart" id="md-hour"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Mood by weekday</div><div class="card-hint">valence & energy, time-weighted</div></div>
          <div class="chart" id="md-weekday"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Tempo</div><div class="card-hint" id="md-tempo-hint">hours by BPM band</div></div>
          <div class="chart" id="md-tempo"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Speed extremes</div><div class="card-hint">favourites (≥ 1 h) with exact features</div></div>
          <div class="duo" id="md-extremes"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Are you going acoustic?</div><div class="card-hint">avg acousticness per year</div></div>
          <div class="chart" id="md-acoustic"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Weekend dance index</div><div class="card-hint">avg danceability per weekday</div></div>
          <div class="chart" id="md-dance"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Fingerprint per year</div><div class="card-hint">energy · valence · dance · acoustic · speech</div></div>
          <div id="md-years" style="width:100%;height:250px"></div>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- renderers ---------------- */
  function renderRadar() {
    SP.makeChart(el('md-radar'), {
      tooltip: { show: false },
      radar: {
        indicator: AXES.map(n => ({ name: n, max: 100 })),
        radius: '72%', center: ['50%', '52%'],
        axisName: { color: '#AEB4A9', fontFamily: 'JetBrains Mono', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.07)' } },
        splitArea: { areaStyle: { color: ['transparent', 'rgba(255,255,255,0.015)'] } },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.07)' } },
      },
      series: [{
        type: 'radar', symbol: 'none',
        data: [
          { value: [50, 50, 50, 50, 50], name: 'Reference', lineStyle: { color: 'rgba(232,230,223,0.35)', type: 'dashed', width: 1.2 }, areaStyle: { color: 'transparent' } },
          { value: s.dna, name: 'You', lineStyle: { color: '#1ED760', width: 2.4 }, areaStyle: { color: SP.rgba('#1ED760', 0.22) }, itemStyle: { color: '#1ED760' } },
        ],
      }],
    });
    el('md-bpm').innerHTML = s.tempo != null ? `${s.tempo}<small> BPM</small>` : '—';
  }

  function renderTrend() {
    const pts = s.monthly.map(m => [monthDate(m.mk), m.v]);
    const ePts = s.monthly.map(m => [monthDate(m.mk), m.e]);
    const series = [{
      name: 'Valence', type: 'line', data: pts, showSymbol: false, smooth: 0.3,
      lineStyle: { width: 2.2, color: '#1ED760' }, itemStyle: { color: '#1ED760' },
      areaStyle: { color: SP.areaGradient('#1ED760', 0.16, 0) },
      markPoint: s.monthly.length > 2 ? {
        symbol: 'circle', symbolSize: 9,
        label: { color: '#AEB4A9', fontFamily: 'JetBrains Mono', fontSize: 9.5, distance: 8, formatter: p => p.value },
        data: [
          { coord: pts[s.sadIdx], value: `saddest · ${mkLabel(s.monthly[s.sadIdx].mk)}`, itemStyle: { color: '#F45B5B' }, label: { position: edgePos(s.sadIdx) } },
          { coord: pts[s.happyIdx], value: `happiest · ${mkLabel(s.monthly[s.happyIdx].mk)}`, itemStyle: { color: '#A7F432' }, label: { position: edgePos(s.happyIdx) } },
        ],
      } : undefined,
    }];
    if (energyOverlay) series.push({
      name: 'Energy', type: 'line', data: ePts, showSymbol: false, smooth: 0.3,
      lineStyle: { width: 1.6, color: '#34D3EB', type: 'dashed' }, itemStyle: { color: '#34D3EB' },
    });
    SP.makeChart(el('md-trend'), {
      grid: { left: 8, right: 20, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:2px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
          ps.forEach(p => { out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${p.value[1]}</b></div>`; });
          return out;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: { type: 'value', min: v => Math.max(0, Math.floor(v.min - 6)), max: v => Math.min(100, Math.ceil(v.max + 6)), axisLabel: SP.axisLabel, splitLine: SP.splitLine, axisLine: { show: false } },
      series,
    });
  }

  function renderQuadrant() {
    const d = SP.d;
    const maxMs = s.quad.length ? s.quad[0].ms : 1;
    const pts = s.quad.map(t => ({
      value: [t.v, t.e],
      tr: t.tr, ms: t.ms, aid: t.aid, approx: t.approx,
      symbolSize: Math.max(6, Math.sqrt(t.ms / maxMs) * 34),
      itemStyle: {
        color: SP.rgba(SP.genreColor(t.u), 0.6),
        borderColor: SP.rgba(SP.genreColor(t.u), 0.95),
        borderWidth: 1,
      },
    }));
    const lbl = (x, y, text, align) => ({
      type: 'text', left: x, top: y,
      style: { text, fill: '#6B716A', font: '600 11px JetBrains Mono', textAlign: align || 'left' },
    });
    const chart = SP.makeChart(el('md-quad'), {
      grid: { left: 8, right: 64, top: 26, bottom: 10, containLabel: true },
      tooltip: {
        formatter: p => {
          const dp = p.data;
          return `<b>${esc(d.trackName[dp.tr])}</b>${dp.approx ? ' <span style="color:#6B716A">≈</span>' : ''}<br>` +
            `<span style="color:#AEB4A9">${esc(d.artists[dp.aid])}</span><br>` +
            `${SP.fmt1(dp.ms / MSH)} h · valence <b>${p.value[0]}</b> · energy <b>${p.value[1]}</b>` +
            (dp.approx ? `<br><span style="color:#6B716A;font-size:11px">≈ artist-typical mood (approximate)</span>` : '');
        },
      },
      graphic: [
        lbl('14%', '10%', 'SAD BANGERS'),
        lbl('78%', '10%', 'HAPPY ANTHEMS'),
        lbl('14%', '90%', 'IN YOUR FEELINGS'),
        lbl('76%', '90%', 'CHILL & CONTENT'),
      ],
      xAxis: {
        type: 'value', min: 0, max: 100, name: 'valence →', nameLocation: 'end', nameGap: 6,
        nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 },
        axisLabel: SP.axisLabel, splitLine: { show: false }, axisLine: SP.axisLine, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', min: 0, max: 100, name: 'energy ↑', nameGap: 12,
        nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 },
        axisLabel: SP.axisLabel, splitLine: { show: false }, axisLine: SP.axisLine, axisTick: { show: false },
      },
      series: [{
        type: 'scatter', data: pts, animationThreshold: 3000, progressive: 0,
        markLine: {
          silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: 'rgba(255,255,255,0.10)', type: 'dashed' },
          data: [{ xAxis: 50 }, { yAxis: 50 }],
        },
      }],
    });
    chart.off('click');
    chart.on('click', p => { if (p.data && p.data.aid) SP.setFilter({ artist: p.data.aid }); });
  }

  function hourLbl(hr) { return hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : (hr - 12) + 'p'; }

  function renderByHour() {
    const hrs = Array.from({ length: 24 }, (_, k) => k);
    SP.makeChart(el('md-hour'), {
      grid: { left: 8, right: 14, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: hrs.map(hourLbl), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: 2 }, SP.axisLabel) },
      yAxis: { type: 'value', scale: true, axisLabel: SP.axisLabel, splitLine: SP.splitLine, axisLine: { show: false } },
      series: [
        { name: 'Valence', type: 'line', smooth: 0.4, showSymbol: false, data: hrs.map(k => s.byHour[k] ? s.byHour[k].v : null), lineStyle: { width: 2.2, color: '#1ED760' }, itemStyle: { color: '#1ED760' }, connectNulls: true },
        { name: 'Energy', type: 'line', smooth: 0.4, showSymbol: false, data: hrs.map(k => s.byHour[k] ? s.byHour[k].e : null), lineStyle: { width: 1.8, color: '#34D3EB', type: 'dashed' }, itemStyle: { color: '#34D3EB' }, connectNulls: true },
      ],
    });
  }

  function renderByWeekday() {
    SP.makeChart(el('md-weekday'), {
      grid: { left: 8, right: 14, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } } },
      xAxis: { type: 'category', data: SP.WEEKDAYS.slice(), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', min: v => Math.max(0, Math.floor(v.min - 2)), max: v => Math.min(100, Math.ceil(v.max + 2)), axisLabel: SP.axisLabel, splitLine: SP.splitLine, axisLine: { show: false } },
      series: [
        { name: 'Valence', type: 'bar', barMaxWidth: 16, data: SP.WEEKDAYS.map((_, k) => s.byWeekday[k] ? s.byWeekday[k].v : 0), itemStyle: { color: '#1ED760', borderRadius: [3, 3, 0, 0] } },
        { name: 'Energy', type: 'bar', barMaxWidth: 16, data: SP.WEEKDAYS.map((_, k) => s.byWeekday[k] ? s.byWeekday[k].e : 0), itemStyle: { color: SP.rgba('#34D3EB', 0.65), borderRadius: [3, 3, 0, 0] } },
      ],
    });
  }

  function renderTempo() {
    const labels = Array.from({ length: 15 }, (_, k) => k === 14 ? '200+' : `${60 + k * 10}–${70 + k * 10}`);
    const maxIdx = s.tempoBins.indexOf(Math.max(...s.tempoBins));
    el('md-tempo-hint').textContent = `hours by BPM band · your centre of gravity is ${s.tempo != null ? s.tempo + ' BPM' : 'unknown'}`;
    SP.makeChart(el('md-tempo'), {
      grid: { left: 8, right: 14, top: 18, bottom: 24, containLabel: true },
      tooltip: { formatter: p => `<b>${labels[p.dataIndex]} BPM</b><br>${SP.fmtInt(p.value)} hours` },
      xAxis: { type: 'category', data: labels, name: 'BPM', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 }, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: 1, rotate: 30 }, SP.axisLabel) },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 30,
        data: s.tempoBins.map((v, i) => ({ value: +v.toFixed(1), itemStyle: { color: i === maxIdx ? '#1ED760' : 'rgba(30,215,96,0.30)', borderRadius: [4, 4, 0, 0] } })),
      }],
    });
  }

  function renderExtremes() {
    const d = SP.d, box = el('md-extremes'); box.innerHTML = '';
    const mk = list => list.map(x => `<div class="mini-row"><div class="mini-rank"></div>
      <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[x.tr])}">${esc(d.trackName[x.tr])}</div>
      <div class="mini-sub">${esc(d.artists[d.trackArtist[x.tr]])} · ${SP.fmt1(x.ms / MSH)} h</div></div>
      <div class="mini-val">${x.bpm}<small> BPM</small></div></div>`).join('') || '<div class="mini-sub" style="padding:8px 4px">Not enough data.</div>';
    box.appendChild(h(`<div><h4 class="good">Fastest favourites</h4><div class="mini">${mk(s.fastest)}</div></div>`));
    box.appendChild(h(`<div><h4 style="color:#7CC4FF">Slowest favourites</h4><div class="mini">${mk(s.slowest)}</div></div>`));
  }

  function renderAcoustic() {
    const dir = s.acousticYr.length >= 2 ? s.acousticYr[s.acousticYr.length - 1].a - s.acousticYr[0].a : 0;
    SP.makeChart(el('md-acoustic'), {
      grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${p.name}</b><br>avg acousticness <b style="color:#FFB347">${p.value}</b>` },
      xAxis: { type: 'category', data: s.acousticYr.map(x => String(x.y)), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', min: v => Math.max(0, Math.floor(v.min - 1)), max: v => Math.min(100, Math.ceil(v.max + 1)), axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 34,
        data: s.acousticYr.map((x, i) => ({ value: x.a, itemStyle: { color: i === s.acousticYr.length - 1 ? '#FFB347' : 'rgba(255,179,71,0.35)', borderRadius: [4, 4, 0, 0] } })),
        markLine: dir !== 0 ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: 'transparent' }, data: [] } : undefined,
      }],
    });
  }

  function renderDance() {
    const weekend = new Set([0, 6]);
    const maxIdx = s.danceWd.indexOf(Math.max(...s.danceWd));
    SP.makeChart(el('md-dance'), {
      grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${SP.WEEKDAYS[p.dataIndex]}</b><br>avg danceability <b style="color:#FF6B9D">${p.value}</b>` },
      xAxis: { type: 'category', data: SP.WEEKDAYS.slice(), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', min: v => Math.max(0, Math.floor(v.min - 1)), max: v => Math.min(100, Math.ceil(v.max + 1)), axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 30,
        data: s.danceWd.map((v, i) => ({
          value: v,
          itemStyle: { color: i === maxIdx ? '#FF6B9D' : weekend.has(i) ? 'rgba(255,107,157,0.55)' : 'rgba(255,107,157,0.25)', borderRadius: [4, 4, 0, 0] },
        })),
      }],
    });
  }

  function renderYearRadars() {
    const years = s.yearDna;
    if (!years.length) { el('md-years').innerHTML = ''; return; }
    const nY = years.length;
    const radars = [], series = [];
    years.forEach((yd, i) => {
      const cx = ((i + 0.5) / nY) * 100;
      radars.push({
        indicator: AXES.map(n => ({ name: n.slice(0, 1), max: 100 })),
        center: [cx + '%', '46%'], radius: Math.min(64, (100 / nY) * 3.2) + '%',
        axisName: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 8.5 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        splitNumber: 2,
      });
      series.push({
        type: 'radar', radarIndex: i, symbol: 'none',
        data: [{ value: yd.vals, name: String(yd.y) }],
        lineStyle: { color: '#1ED760', width: 1.8 },
        areaStyle: { color: SP.rgba('#1ED760', 0.18) },
        itemStyle: { color: '#1ED760' },
      });
    });
    SP.makeChart(el('md-years'), {
      tooltip: { show: false },
      graphic: years.map((yd, i) => ({
        type: 'text', left: (((i + 0.5) / nY) * 100 - 2.2) + '%', top: '86%',
        style: { text: String(yd.y), fill: '#AEB4A9', font: '700 12px JetBrains Mono' },
      })),
      radar: radars,
      series,
    });
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n || !SP.en || s.noFeatures;
    el('md-empty').hidden = !empty;
    el('md-body').hidden = empty;
    if (empty) {
      el('md-sub').textContent = 'No plays match the current filters.';
      el('md-empty-msg').textContent = !SP.en ? 'Mood enrichment is unavailable in this build.'
        : s.noFeatures ? 'No audio features for the current selection.' : 'No plays match the current filters.';
      return;
    }
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('md-sub').textContent = scopeArtist
      ? `${scopeArtist}'s emotional signature — ${yearTxt}.`
      : `Valence, energy and tempo across everything you play — ${yearTxt}.`;
    el('md-approx').innerHTML = `<span class="gdot"></span> ≈ marks approximate features (${SP.fmtPct(s.approxPct, 1)} of listening uses artist-typical values where the exact track wasn't matched).`;

    const eb = el('md-eover');
    eb.classList.toggle('on', energyOverlay);
    eb.onclick = () => { energyOverlay = !energyOverlay; eb.classList.toggle('on', energyOverlay); renderTrend(); };

    renderRadar();
    renderTrend();
    renderQuadrant();
    renderByHour();
    renderByWeekday();
    renderTempo();
    renderExtremes();
    renderAcoustic();
    renderDance();
    renderYearRadars();
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.mood = {
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
