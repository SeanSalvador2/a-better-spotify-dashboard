/* ============================================================
   SOUNDPRINT — sections/overview.js  (BUILD_SPEC §1)
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;

  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  /* ---------------- compute all overview stats from subset ---------------- */
  function compute() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    const stats = { n: sub.length };
    if (sub.length === 0) { stats.empty = true; return stats; }

    let totalMs = 0, skips = 0;
    const artists = new Set(), tracks = new Set(), albums = new Set(), countries = new Set();
    const dayMs = new Map(), dayPlays = new Map();

    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      totalMs += d.ms[i];
      if (SP.isSkipped(i)) skips++;
      countries.add(d.co[i]);
      if (d.ty[i] === 0) {
        const tr = d.tr[i];
        artists.add(d.trackArtist[tr]);
        tracks.add(tr);
        albums.add(d.trackAlbum[tr]);
      }
      const dk = SP.dayKey[i];
      dayMs.set(dk, (dayMs.get(dk) || 0) + d.ms[i]);
      dayPlays.set(dk, (dayPlays.get(dk) || 0) + 1);
    }

    stats.totalMs = totalMs;
    stats.totalHours = totalMs / MSH;
    stats.totalPlays = sub.length;
    stats.uniqueArtists = artists.size;
    stats.uniqueTracks = tracks.size;
    stats.uniqueAlbums = albums.size;
    stats.skips = skips;
    stats.countries = countries.size;

    // day span
    const dayKeys = Array.from(dayMs.keys()).sort((a, b) => a - b);
    const firstDay = dayKeys[0], lastDay = dayKeys[dayKeys.length - 1];
    const spanDays = lastDay - firstDay + 1;
    stats.firstDay = firstDay; stats.lastDay = lastDay; stats.spanDays = spanDays;
    stats.daysListened = dayKeys.length;
    stats.daysPct = spanDays > 0 ? (dayKeys.length / spanDays) * 100 : 0;
    stats.avgHoursPerDay = stats.totalHours / spanDays;
    stats.avgPlaysPerDay = stats.totalPlays / spanDays;

    // longest streak of consecutive listening days
    let best = 0, run = 0, prev = null, bestEnd = null, curEnd = null;
    for (const dk of dayKeys) {
      if (prev != null && dk === prev + 1) { run++; } else { run = 1; }
      if (run > best) { best = run; bestEnd = dk; }
      prev = dk;
    }
    stats.streak = best;
    stats.streakEnd = bestEnd;
    stats.streakStart = bestEnd != null ? bestEnd - best + 1 : null;

    // biggest single day (by current metric)
    let bigDay = null, bigVal = -1;
    const src = metric === 'hours' ? dayMs : dayPlays;
    src.forEach((v, dk) => { if (v > bigVal) { bigVal = v; bigDay = dk; } });
    stats.bigDay = bigDay;
    stats.bigDayHours = (dayMs.get(bigDay) || 0) / MSH;
    stats.bigDayPlays = dayPlays.get(bigDay) || 0;
    stats.bigDayTopTrack = topTrackOfDay(bigDay);

    // cumulative series
    const cum = [];
    let acc = 0;
    for (const dk of dayKeys) {
      acc += metric === 'hours' ? dayMs.get(dk) / MSH : dayPlays.get(dk);
      cum.push([dk * SP.CONST.SEC_PER_DAY * 1000, +acc.toFixed(2)]);
    }
    stats.cum = cum;
    stats.cumTotal = acc;

    // milestones: nth plays
    const nths = [1, 50000, 100000, 150000, 200000];
    stats.milestones = [];
    // first play
    stats.milestones.push(mileFor('First play', sub[0], true));
    for (const nth of nths) {
      if (nth === 1) continue;
      if (sub.length >= nth) stats.milestones.push(mileFor(fmtNth(nth) + ' play', sub[nth - 1], false));
    }
    // each year's first & last song (within subset)
    const yearFirst = new Map(), yearLast = new Map();
    for (let j = 0; j < sub.length; j++) {
      const y = SP.year[sub[j]];
      if (!yearFirst.has(y)) yearFirst.set(y, sub[j]);
      yearLast.set(y, sub[j]);
    }
    const yrs = Array.from(yearFirst.keys()).sort((a, b) => a - b);
    stats.yearBook = yrs.map(y => ({ year: y, first: SP.nameOf(yearFirst.get(y)), firstSec: SP.t[yearFirst.get(y)], last: SP.nameOf(yearLast.get(y)), lastSec: SP.t[yearLast.get(y)] }));

    // top 5 artists / tracks with monthly sparkline series
    const artMap = SP.byArtist(sub), trkMap = SP.byTrack(sub);
    stats.topArtists = SP.topN(artMap, 5, metric);
    stats.topTracks = SP.topN(trkMap, 5, metric);
    stats.artistTotalVal = 0; artMap.forEach(e => stats.artistTotalVal += SP.metricVal(e, metric));
    stats.trackTotalVal = 0; trkMap.forEach(e => stats.trackTotalVal += SP.metricVal(e, metric));

    const nB = SP.monthKeyMax + 1;
    const bucketOf = i => SP.monthKey[i];
    const artKeys = new Set(stats.topArtists.map(a => a.key));
    const trkKeys = new Set(stats.topTracks.map(t => t.key));
    stats.artSeries = SP.seriesFor(sub, SP.artistIdOf, bucketOf, nB, artKeys, metric);
    stats.trkSeries = SP.seriesFor(sub, SP.trackIdOf, bucketOf, nB, trkKeys, metric);
    stats.mkMin = SP.monthKey[sub[0]];
    stats.mkMax = SP.monthKey[sub[sub.length - 1]];

    // % of waking life (16 waking hrs/day over span)
    stats.wakingPct = spanDays > 0 ? (stats.totalHours / (spanDays * 16)) * 100 : 0;

    return stats;
  }

  function topTrackOfDay(dk) {
    const d = SP.d, sub = SP.subset, m = new Map();
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (SP.dayKey[i] !== dk) continue;
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i];
      m.set(tr, (m.get(tr) || 0) + 1);
    }
    let best = null, bv = -1;
    m.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
    return best == null ? null : { name: d.trackName[best], artist: d.artists[d.trackArtist[best]], plays: bv };
  }

  function mileFor(tag, idx, major) {
    const nm = SP.nameOf(idx);
    return { tag, major, sec: SP.t[idx], title: nm.title, artist: nm.artist || nm.show || '' };
  }
  function fmtNth(n) { return SP.fmtInt(n) + 'th'; }

  /* ---------------- number animation ---------------- */
  function animateNum(node, value, fmt) {
    if (SP.reduceMotion || !window.countUp) { node.textContent = fmt(value); return; }
    const start = 0;
    const cu = new countUp.CountUp(node, value, {
      startVal: start, duration: 1.5, useEasing: true, useGrouping: true,
      formattingFn: fmt,
    });
    if (!cu.error) cu.start(); else node.textContent = fmt(value);
  }

  /* ---------------- render ---------------- */
  let root, s;

  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Overview</div>
        <h1 class="sec-title">Your listening, in one look</h1>
        <p class="sec-sub" id="ov-sub"></p>
      </div>
    </div>

    <div class="grid" style="margin-bottom:var(--sp-6)">
      <div class="c12 reveal">
        <div class="kpi-hero">
          <div class="kpi-feature" id="ov-feature">
            <div class="kpi-label">Total time listening</div>
            <div>
              <span class="kpi-value" id="ov-hours">0</span><span class="kpi-unit">h</span>
            </div>
            <div class="kpi-foot" id="ov-feature-foot"></div>
          </div>
          <div class="kpi-grid" id="ov-kpis"></div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-bottom:var(--sp-6)">
      <div class="c8 reveal">
        <div class="card hoverable">
          <div class="card-head">
            <div class="card-title" id="ov-cum-title">Cumulative listening</div>
            <div class="card-hint">drag the brush to zoom</div>
          </div>
          <div class="chart tall" id="ov-cum"></div>
        </div>
      </div>
      <div class="c4 reveal">
        <div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Lifetime in numbers</div></div>
          <div class="strip" id="ov-strip"></div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-bottom:var(--sp-6)">
      <div class="c12 reveal">
        <div class="card hoverable">
          <div class="card-head"><div class="card-title">Milestones</div><div class="card-hint">scroll →</div></div>
          <div class="miles" id="ov-miles"></div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-bottom:var(--sp-6)">
      <div class="c6 reveal">
        <div class="card hoverable">
          <div class="card-head"><div class="card-title">Top artists</div><div class="card-hint" id="ov-art-hint"></div></div>
          <div class="lb" id="ov-artists"></div>
        </div>
      </div>
      <div class="c6 reveal">
        <div class="card hoverable">
          <div class="card-head"><div class="card-title">Top tracks</div><div class="card-hint" id="ov-trk-hint"></div></div>
          <div class="lb" id="ov-tracks"></div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="c12 reveal">
        <div class="feature-band" id="ov-waking"></div>
      </div>
    </div>`;
  }

  function emptyState(msg) {
    return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>
      <div class="empty-t">Nothing here yet</div><div>${msg}</div></div>`;
  }

  function fillContent() {
    s = compute();

    if (s.empty) {
      root.querySelector('.grid').insertAdjacentElement('beforebegin', root.querySelector('.sec-head'));
      // simple: replace whole content with empty state cards
      el('ov-sub').textContent = 'No plays match the current filters.';
      el('ov-kpis').innerHTML = '';
      el('ov-feature-foot').textContent = '';
      el('ov-hours').textContent = '0';
      ['ov-strip', 'ov-miles', 'ov-artists', 'ov-tracks'].forEach(id => el(id).innerHTML = emptyState('Try clearing a filter or picking another year.'));
      el('ov-waking').innerHTML = `<div class="fb-body" style="grid-column:1/-1"><div class="fb-eyebrow">Empty range</div><div class="fb-lead">No listening to summarize for this selection.</div></div>`;
      const chartEl = el('ov-cum'); SP.disposeChartsIn(chartEl.parentElement); chartEl.innerHTML = '';
      chartEl.insertAdjacentHTML('afterbegin', emptyState('No data in range.'));
      return;
    }

    // subtitle
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    el('ov-sub').textContent = scopeArtist
      ? `Everything you played by ${scopeArtist} — ${yearTxt}.`
      : `${SP.fmtInt(s.totalPlays)} plays across ${SP.fmtInt(s.spanDays)} days — ${yearTxt}.`;

    // feature (total hours)
    animateNum(el('ov-hours'), s.totalHours, SP.fmtInt);
    el('ov-feature-foot').innerHTML = `That's <b>${SP.fmt1(s.totalHours / 24)} days</b> of sound — an average of <b>${SP.fmt1(s.avgHoursPerDay)} h</b> every listening day.`;

    // KPI grid
    const kpis = [
      { label: 'Plays', val: s.totalPlays, fmt: SP.fmtInt, foot: `${SP.fmt1(s.avgPlaysPerDay)}/day`, icon: iconPlay },
      { label: 'Artists', val: s.uniqueArtists, fmt: SP.fmtInt, foot: 'distinct', icon: iconMic },
      { label: 'Tracks', val: s.uniqueTracks, fmt: SP.fmtInt, foot: 'distinct', icon: iconNote },
      { label: 'Albums', val: s.uniqueAlbums, fmt: SP.fmtInt, foot: 'distinct', icon: iconDisc },
      { label: 'Days active', val: s.daysPct, fmt: v => SP.fmtPct(v), foot: `${SP.fmtInt(s.daysListened)}/${SP.fmtInt(s.spanDays)} days`, icon: iconCal },
      { label: 'Skips', val: s.skips, fmt: SP.fmtInt, foot: `${SP.fmtPct((s.skips / s.totalPlays) * 100)} of plays`, icon: iconSkip },
    ];
    const kg = el('ov-kpis'); kg.innerHTML = '';
    kpis.forEach(k => {
      const node = h(`<div class="kpi hoverable"><div class="kpi-icon">${k.icon}</div><div class="kpi-label">${k.label}</div><div class="kpi-value">0</div><div class="kpi-foot">${k.foot}</div></div>`);
      kg.appendChild(node);
      animateNum(node.querySelector('.kpi-value'), k.val, k.fmt);
    });

    // lifetime strip
    const strip = el('ov-strip');
    const streakTxt = s.streak > 0 ? `${SP.fmtDate(s.streakStart)} – ${SP.fmtDate(s.streakEnd)}` : '';
    const bigTrk = s.bigDayTopTrack ? `${s.bigDayTopTrack.name}` : '—';
    strip.innerHTML = '';
    [
      ['Avg per day', `${SP.fmt1(s.avgHoursPerDay)} h`, `${SP.fmt1(s.avgPlaysPerDay)} plays`],
      ['Longest streak', `<span class="accent">${SP.fmtInt(s.streak)} days</span>`, streakTxt],
      ['Biggest day', `${SP.fmt1(s.bigDayHours)} h`, s.bigDay != null ? SP.fmtDate(s.bigDay) : ''],
      ['— top track that day', bigTrk, s.bigDayTopTrack ? `${SP.fmtInt(s.bigDayTopTrack.plays)} plays` : ''],
      ['Total skips', SP.fmtInt(s.skips), `${SP.fmtPct((s.skips / s.totalPlays) * 100)} skip rate`],
      ['Countries', SP.fmtInt(s.countries), 'places you listened from'],
    ].forEach(([k, v, sub]) => {
      strip.appendChild(h(`<div class="strip-row"><div class="strip-k">${k}</div><div class="strip-v">${v}${sub ? `<small>${sub}</small>` : ''}</div></div>`));
    });

    // milestones
    const miles = el('ov-miles'); miles.innerHTML = '';
    s.milestones.forEach(m => {
      miles.appendChild(h(`<div class="mile ${m.major ? '' : 'minor'}">
        <div class="mile-dot"></div>
        <div class="mile-tag">${m.tag}</div>
        <div class="mile-date">${SP.fmtSecDate(m.sec)}</div>
        <div class="mile-title" title="${esc(m.title)}">${esc(m.title)}</div>
        <div class="mile-sub" title="${esc(m.artist)}">${esc(m.artist)}</div>
      </div>`));
    });
    s.yearBook.forEach(y => {
      miles.appendChild(h(`<div class="mile minor">
        <div class="mile-dot"></div>
        <div class="mile-tag">${y.year} · first → last</div>
        <div class="mile-date">${SP.fmtSecDate(y.firstSec)} → ${SP.fmtSecDate(y.lastSec)}</div>
        <div class="mile-title" title="${esc(y.first.title)}">${esc(y.first.title)}</div>
        <div class="mile-sub" title="…ended on ${esc(y.last.title)}">…ended on ${esc(y.last.title)}</div>
      </div>`));
    });

    // leaderboards
    const metric = SP.filter.metric;
    el('ov-art-hint').textContent = metric === 'hours' ? 'by hours' : 'by plays';
    el('ov-trk-hint').textContent = metric === 'hours' ? 'by hours' : 'by plays';
    renderLB(el('ov-artists'), s.topArtists, s.artistTotalVal, s.artSeries, k => SP.d.artists[k], null);
    renderLB(el('ov-tracks'), s.topTracks, s.trackTotalVal, s.trkSeries, k => SP.d.trackName[k], k => SP.d.artists[SP.d.trackArtist[k]]);

    // waking life band
    el('ov-waking').innerHTML = `
      <div class="fb-num">${SP.fmtPct(s.wakingPct, s.wakingPct < 10 ? 1 : 0)}</div>
      <div class="fb-body">
        <div class="fb-eyebrow">% of waking life · ${yearTxt}</div>
        <div class="fb-lead">Roughly ${SP.fmtPct(s.wakingPct, s.wakingPct < 10 ? 1 : 0)} of your waking hours had a soundtrack.</div>
        <div class="fb-sub">Assuming 16 waking hours a day across <b>${SP.fmtInt(s.spanDays)} days</b>, you pressed play for <b>${SP.fmtInt(s.totalHours)} hours</b>.</div>
      </div>`;

    renderCumChart();
  }

  function renderLB(container, rows, total, series, nameOf, subOf) {
    container.innerHTML = '';
    if (!rows.length) { container.innerHTML = emptyState('No entries.'); return; }
    const metric = SP.filter.metric;
    const top = rows[0].val || 1;
    rows.forEach((r, idx) => {
      const name = nameOf(r.key) || 'Unknown';
      const sub = subOf ? subOf(r.key) : '';
      const share = total > 0 ? (r.val / total) * 100 : 0;
      const valTxt = metric === 'hours' ? `${SP.fmt1(r.ms / MSH)}<small> h</small>` : `${SP.fmtInt(r.plays)}<small> pl</small>`;
      const spk = series && series.get(r.key) ? SP.sparkline(Array.from(series.get(r.key)).slice(s.mkMin, s.mkMax + 1), { w: 62, h: 22, color: '#1ED760', fill: true }) : '';
      const barW = (r.val / top) * 100;
      const row = h(`<div class="lb-row" ${subOf ? '' : 'data-artist="' + r.key + '"'} ${subOf ? '' : 'role="button" tabindex="0"'}>
        <div class="lb-rank">${idx + 1}</div>
        <div class="lb-main">
          <div class="lb-name" title="${esc(name)}">${esc(name)}</div>
          <div class="lb-sub">${sub ? esc(sub) + ' · ' : ''}${SP.fmtPct(share, share < 10 ? 1 : 0)} of listening</div>
          <div class="lb-bar-track"><div class="lb-bar" style="width:${barW}%"></div></div>
        </div>
        <div class="lb-right">${spk}<div class="lb-val">${valTxt}</div></div>
      </div>`);
      // artist rows clickable -> focus
      if (!subOf) {
        const setA = () => SP.setFilter({ artist: r.key });
        row.addEventListener('click', setA);
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setA(); } });
        row.style.cursor = 'pointer';
      }
      container.appendChild(row);
    });
  }

  function renderCumChart() {
    const node = el('ov-cum');
    const metric = SP.filter.metric;
    el('ov-cum-title').textContent = metric === 'hours' ? 'Cumulative hours listened' : 'Cumulative plays';
    const unit = metric === 'hours' ? ' h' : '';
    const chart = SP.makeChart(node, {
      grid: { left: 8, right: 20, top: 20, bottom: 64, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const d = new Date(p[0].value[0]);
          const dt = `${SP.MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
          const v = metric === 'hours' ? SP.fmtInt(p[0].value[1]) + ' h' : SP.fmtInt(p[0].value[1]) + ' plays';
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:2px">${dt}</div><b style="font-size:14px">${v}</b> total`;
        },
      },
      xAxis: {
        type: 'time',
        axisLine: SP.axisLine, axisTick: { show: false },
        axisLabel: Object.assign({}, SP.axisLabel),
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: Object.assign({ formatter: v => SP.fmtInt(v) + unit }, SP.axisLabel),
        splitLine: SP.splitLine, axisLine: { show: false }, axisTick: { show: false },
      },
      dataZoom: [
        { type: 'inside', throttle: 60 },
        {
          type: 'slider', height: 26, bottom: 14, borderColor: 'transparent',
          backgroundColor: 'rgba(255,255,255,0.03)', fillerColor: 'rgba(30,215,96,0.12)',
          dataBackground: { lineStyle: { color: '#2c3a2f' }, areaStyle: { color: 'rgba(30,215,96,0.08)' } },
          selectedDataBackground: { lineStyle: { color: '#1ED760' }, areaStyle: { color: 'rgba(30,215,96,0.18)' } },
          handleStyle: { color: '#1ED760', borderColor: '#1ED760' },
          moveHandleStyle: { color: '#1DB954' },
          textStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 10 },
        },
      ],
      series: [{
        type: 'line', showSymbol: false, smooth: 0.15, sampling: 'lttb',
        data: s.cum,
        lineStyle: { width: 2, color: '#1ED760' },
        areaStyle: { color: SP.areaGradient('#1ED760', 0.30, 0.01) },
        emphasis: { disabled: true },
      }],
    });
    return chart;
  }

  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- icons ---------------- */
  const iconPlay = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
  const iconMic = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
  const iconNote = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const iconDisc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg>';
  const iconCal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>';
  const iconSkip = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';

  /* ---------------- section interface ---------------- */
  SP.sections = SP.sections || {};
  SP.sections.overview = {
    render(container) {
      root = container;
      root.innerHTML = skeleton();
      fillContent();
      return root.querySelectorAll('.reveal');
    },
    update() { if (root) fillContent(); },
    dispose() { if (root) SP.disposeChartsIn(root); root = null; },
  };
})();
