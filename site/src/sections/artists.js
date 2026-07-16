/* ============================================================
   SOUNDPRINT — sections/artists.js  (BUILD_SPEC §3)
   Top-25 leaderboard · rank bump · streamgraph · discovery scatter ·
   loyalty & depth · rising vs fading · one-hit wonders · artist detail mode
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let root = null, s = null, mode = null; // 'list' | 'detail'
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rankMapOf(map, metric) {
    const arr = SP.topN(map, 0, metric);
    const rm = new Map();
    arr.forEach((e, i) => rm.set(e.key, i + 1));
    return rm;
  }

  /* ================= LIST MODE ================= */
  function computeList() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!sub.length) return st;

    const artMap = SP.byArtist(sub);
    st.top25 = SP.topN(artMap, 25, metric);
    st.totalVal = 0; artMap.forEach(e => st.totalVal += SP.metricVal(e, metric));

    st.mkMin = SP.monthKey[sub[0]];
    st.mkMax = SP.monthKey[sub[sub.length - 1]];
    const nB = SP.monthKeyMax + 1;
    const topSet = new Set(st.top25.map(a => a.key));
    st.spark = SP.seriesFor(sub, SP.artistIdOf, i => SP.monthKey[i], nB, topSet, metric);

    // ---- rank delta vs previous equivalent period ----
    if (SP.filter.year !== 'all') {
      const prevSub = SP.buildSubsetCustom({ year: SP.filter.year - 1 });
      st.prevRanks = prevSub.length ? rankMapOf(SP.byArtist(prevSub), metric) : null;
      st.curRanksForDelta = rankMapOf(artMap, metric);
      st.deltaHint = `Δ vs ${SP.filter.year - 1}`;
    } else {
      const dMax = SP.dayKey[sub[sub.length - 1]];
      const cur = SP.buildSubsetCustom({ year: 'all', dayMin: dMax - 364, dayMax: dMax });
      const prv = SP.buildSubsetCustom({ year: 'all', dayMin: dMax - 729, dayMax: dMax - 365 });
      st.curRanksForDelta = rankMapOf(SP.byArtist(cur), metric);
      st.prevRanks = prv.length ? rankMapOf(SP.byArtist(prv), metric) : null;
      st.deltaHint = 'Δ last 12 mo vs prior';
    }

    // ---- half-year buckets for bump chart ----
    const hyAgg = new Map(); // hy -> Map<artist, val>
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], aid = SP.artistIdOf(i);
      if (aid <= 0) continue;
      const hy = Math.floor(SP.monthKey[i] / 6);
      let m = hyAgg.get(hy);
      if (!m) { m = new Map(); hyAgg.set(hy, m); }
      m.set(aid, (m.get(aid) || 0) + (metric === 'hours' ? d.ms[i] / MSH : 1));
    }
    st.hyKeys = Array.from(hyAgg.keys()).sort((a, b) => a - b);
    st.hyRanks = new Map();
    st.hyKeys.forEach(hy => {
      const entries = Array.from(hyAgg.get(hy).entries()).sort((a, b) => b[1] - a[1]);
      const rm = new Map();
      entries.forEach(([aid], i) => rm.set(aid, i + 1));
      st.hyRanks.set(hy, rm);
    });

    // ---- streamgraph: top 12 monthly ----
    const top12 = st.top25.slice(0, 12).map(a => a.key);
    const t12set = new Set(top12);
    const flow = new Map(); // artist -> Float64Array months
    top12.forEach(a => flow.set(a, new Float64Array(st.mkMax - st.mkMin + 1)));
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], aid = SP.artistIdOf(i);
      if (!t12set.has(aid)) continue;
      flow.get(aid)[SP.monthKey[i] - st.mkMin] += metric === 'hours' ? d.ms[i] / MSH : 1;
    }
    st.flow = flow; st.top12 = top12;

    // ---- discovery scatter + loyalty inputs (one pass) ----
    const first = new Map();  // artist -> {idx, tr}
    const acc = new Map();    // artist -> {ms, plays, tracks:Set, tMin, tMax, monthly:Map}
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], aid = SP.artistIdOf(i);
      if (aid <= 0) continue;
      if (!first.has(aid)) first.set(aid, { idx: i, tr: d.tr[i] });
      let a = acc.get(aid);
      if (!a) { a = { ms: 0, plays: 0, tracks: new Set(), tMin: SP.t[i], tMax: SP.t[i], monthly: null }; acc.set(aid, a); }
      a.ms += d.ms[i]; a.plays++; a.tracks.add(d.tr[i]); a.tMax = SP.t[i];
    }
    st.first = first; st.acc = acc;

    // discovery points: artists with >= 3h total
    st.discovery = [];
    acc.forEach((a, aid) => {
      if (a.ms < 3 * MSH) return;
      const f = first.get(aid);
      st.discovery.push({
        aid, x: SP.t[f.idx] * 1000, y: +(a.ms / MSH).toFixed(1), plays: a.plays,
        firstTrack: d.trackName[f.tr], firstSec: SP.t[f.idx],
      });
    });
    st.discovery.sort((a, b) => b.y - a.y);

    // loyalty & depth for top 15 (needs per-artist monthly)
    const top15 = st.top25.slice(0, 15).map(a => a.key);
    const t15set = new Set(top15);
    const monthly15 = new Map(); top15.forEach(a => monthly15.set(a, new Map()));
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], aid = SP.artistIdOf(i);
      if (!t15set.has(aid)) continue;
      const m = monthly15.get(aid), mk = SP.monthKey[i];
      m.set(mk, (m.get(mk) || 0) + d.ms[i] / MSH);
    }
    st.loyalty = top15.map(aid => {
      const a = acc.get(aid), m = monthly15.get(aid);
      let peak = 0, sum = 0;
      m.forEach(v => { if (v > peak) peak = v; sum += v; });
      const avg = m.size ? sum / m.size : 0;
      return {
        aid, name: d.artists[aid],
        spanDays: Math.max(1, Math.round((a.tMax - a.tMin) / 86400)),
        depth: a.tracks.size,
        obsession: avg > 0 ? peak / avg : 0,
        peakMonth: (() => { let bk = null, bv = -1; m.forEach((v, k) => { if (v > bv) { bv = v; bk = k; } }); return bk; })(),
        hours: a.ms / MSH,
      };
    });

    // rising vs fading: last 12mo vs prior 12mo (yearless)
    {
      const yl = SP.buildSubsetCustom({ year: 'all' });
      const dMax = yl.length ? SP.dayKey[yl[yl.length - 1]] : 0;
      const cur = SP.buildSubsetCustom({ year: 'all', dayMin: dMax - 364, dayMax: dMax });
      const prv = SP.buildSubsetCustom({ year: 'all', dayMin: dMax - 729, dayMax: dMax - 365 });
      if (cur.length && prv.length) {
        const curMap = SP.byArtist(cur), prvMap = SP.byArtist(prv);
        const curRank = rankMapOf(curMap, metric), prvRank = rankMapOf(prvMap, metric);
        const moves = [];
        curRank.forEach((r, aid) => {
          if (r > 40) return;
          const pr = prvRank.get(aid);
          if (pr == null) { moves.push({ aid, r, pr: null, move: 999 }); return; }
          moves.push({ aid, r, pr, move: pr - r });
        });
        const known = moves.filter(m => m.pr != null);
        st.rising = known.filter(m => m.move > 0).sort((a, b) => b.move - a.move).slice(0, 5);
        const faders = [];
        prvRank.forEach((pr, aid) => {
          if (pr > 40) return;
          const r = curRank.get(aid);
          faders.push({ aid, r: r == null ? Infinity : r, pr, move: pr - (r == null ? 200 : r) });
        });
        st.fading = faders.filter(m => m.move < 0).sort((a, b) => a.move - b.move).slice(0, 5);
        st.newcomers = moves.filter(m => m.pr == null).sort((a, b) => a.r - b.r).slice(0, 3);
      }
    }

    // one-hit wonders
    st.wonders = [];
    acc.forEach((a, aid) => {
      if (a.tracks.size !== 1 || a.plays < 12) return;
      const trId = a.tracks.values().next().value;
      st.wonders.push({ aid, name: d.artists[aid], track: d.trackName[trId], plays: a.plays, ms: a.ms });
    });
    st.wonders.sort((a, b) => b.plays - a.plays);
    st.wonders = st.wonders.slice(0, 8);

    return st;
  }

  function listSkeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Artists</div>
        <h1 class="sec-title">Who owns your ears</h1>
        <p class="sec-sub" id="ar-sub"></p>
      </div>
    </div>
    <div id="ar-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
      <div class="empty-t">Nothing here yet</div><div>No plays match the current filters.</div>
    </div></div></div>
    <div id="ar-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Top 25 artists</div><div class="card-hint" id="ar-lb-hint"></div></div>
          <div class="lbx" id="ar-lb"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Rank evolution</div><div class="card-hint">top 10 artists per half-year · lower is better</div></div>
          <div class="chart tall" id="ar-bump"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">The flow of taste</div><div class="card-hint" id="ar-flow-hint">top 12 artists, monthly</div></div>
          <div class="chart tall" id="ar-flow"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Discovery timeline</div><div class="card-hint">when you first heard each artist vs how big they became · bubble = plays</div></div>
          <div class="chart tall" id="ar-disc"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Loyalty & depth</div><div class="card-hint">top 15 · obsession = peak month ÷ avg month</div></div>
          <table class="tbl">
            <thead><tr><th>Artist</th><th class="num">In rotation</th><th class="num">Tracks</th><th class="num">Obsession</th><th>Peak month</th></tr></thead>
            <tbody id="ar-loyal"></tbody>
          </table>
        </div></div>
        <div class="c5 reveal" style="display:flex;flex-direction:column;gap:var(--sp-6)">
          <div class="card hoverable">
            <div class="card-head"><div class="card-title">Rising vs fading</div><div class="card-hint">last 12 mo vs prior 12 mo</div></div>
            <div class="duo" id="ar-moves"></div>
          </div>
          <div class="card hoverable" style="flex:1">
            <div class="card-head"><div class="card-title">One-hit wonders</div><div class="card-hint">entire relationship = one song</div></div>
            <div class="mini" id="ar-wonders"></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderLeaderboard() {
    const d = SP.d, metric = s.metric;
    el('ar-lb-hint').textContent = (metric === 'hours' ? 'ranked by hours · ' : 'ranked by plays · ') + s.deltaHint + ' · click a row to focus';
    const box = el('ar-lb'); box.innerHTML = '';
    box.appendChild(h(`<div class="lbx-head"><span>#</span><span>Δ</span><span>Artist</span><span>Trend</span><span class="r">Hours</span><span class="r">Plays</span><span class="r">Share</span></div>`));
    const topVal = s.top25[0] ? s.top25[0].val : 1;
    s.top25.forEach((a, idx) => {
      const name = d.artists[a.key];
      const share = s.totalVal ? (a.val / s.totalVal) * 100 : 0;
      // delta
      let deltaHtml = '<span class="delta na">·</span>';
      if (s.prevRanks) {
        const cur = s.curRanksForDelta.get(a.key);
        const prev = s.prevRanks.get(a.key);
        if (cur == null) deltaHtml = '<span class="delta na">·</span>';
        else if (prev == null) deltaHtml = '<span class="delta new">NEW</span>';
        else if (prev === cur) deltaHtml = '<span class="delta same">=</span>';
        else if (prev > cur) deltaHtml = `<span class="delta up">▲${prev - cur}</span>`;
        else deltaHtml = `<span class="delta down">▼${cur - prev}</span>`;
      }
      const sparkArr = s.spark.get(a.key) ? Array.from(s.spark.get(a.key)).slice(s.mkMin, s.mkMax + 1) : [];
      const spk = sparkArr.length > 1 ? SP.sparkline(sparkArr, { w: 64, h: 22, color: '#1ED760', fill: true }) : '';
      const row = h(`<div class="lbx-row" role="button" tabindex="0" aria-label="Focus on ${esc(name)}">
        <div class="lbx-rank">${idx + 1}</div>
        ${deltaHtml}
        <div style="min-width:0">
          <div class="lbx-name" title="${esc(name)}">${esc(name)}</div>
          <div class="lbx-bar-track"><div class="lbx-bar" style="width:0%"></div></div>
        </div>
        <div class="lbx-spark-cell">${spk}</div>
        <div class="lbx-val">${SP.fmt1(a.ms / MSH)}</div>
        <div class="lbx-val dim lbx-plays-cell">${SP.fmtInt(a.plays)}</div>
        <div class="lbx-val dim">${SP.fmtPct(share, share < 10 ? 1 : 0)}</div>
      </div>`);
      const bar = row.querySelector('.lbx-bar');
      const w = (a.val / topVal) * 100;
      if (reduce) bar.style.width = w + '%';
      else requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = w + '%'; }));
      const focus = () => SP.setFilter({ artist: a.key });
      row.addEventListener('click', focus);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); } });
      box.appendChild(row);
    });
  }

  function hyLabel(hy) { return `’${String(SP.BASE_YEAR + Math.floor(hy / 2)).slice(2)} H${(hy % 2) + 1}`; }

  function renderBump() {
    const d = SP.d;
    const top10 = s.top25.slice(0, 10);
    const labels = s.hyKeys.map(hyLabel);
    const series = top10.map((a, i) => ({
      name: d.artists[a.key], type: 'line', smooth: true, symbol: 'circle', symbolSize: 7,
      lineStyle: { width: 2.4 },
      data: s.hyKeys.map(hy => { const r = s.hyRanks.get(hy).get(a.key); return r != null && r <= 14 ? r : null; }),
      connectNulls: false,
      emphasis: { focus: 'series', lineStyle: { width: 3.4 } },
      endLabel: { show: true, formatter: p => p.value != null ? d.artists[a.key] : '', color: 'inherit', fontSize: 10.5, fontFamily: 'Manrope', fontWeight: 600, distance: 8, width: 110, overflow: 'truncate' },
      labelLayout: { moveOverlap: 'shiftY' },
    }));
    SP.makeChart(el('ar-bump'), {
      grid: { left: 8, right: 130, top: 18, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: p => `<b>${esc(p.seriesName)}</b><br><span style="color:#AEB4A9">${labels[p.dataIndex]}</span> · rank <b style="color:#1ED760">#${p.value}</b>`,
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', inverse: true, min: 1, max: 14, interval: 1, axisLabel: Object.assign({ formatter: v => '#' + v }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false } },
      series,
    });
  }

  function renderFlow() {
    const d = SP.d, metric = s.metric;
    el('ar-flow-hint').textContent = `top 12 artists, monthly ${metric}`;
    const data = [];
    s.top12.forEach(aid => {
      const arr = s.flow.get(aid), name = d.artists[aid];
      for (let k = 0; k < arr.length; k++) {
        const mk = s.mkMin + k;
        const dateStr = `${SP.BASE_YEAR + Math.floor(mk / 12)}-${String(mk % 12 + 1).padStart(2, '0')}-01`;
        data.push([dateStr, +arr[k].toFixed(2), name]);
      }
    });
    SP.makeChart(el('ar-flow'), {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
          ps.filter(p => p.value[1] > 0).sort((a, b) => b.value[1] - a.value[1]).slice(0, 8).forEach(p => {
            out += `<div>${p.marker} <span style="color:#AEB4A9">${esc(p.value[2])}</span> <b style="float:right;margin-left:14px">${metric === 'hours' ? SP.fmt1(p.value[1]) + ' h' : SP.fmtInt(p.value[1])}</b></div>`;
          });
          return out;
        },
      },
      singleAxis: {
        type: 'time', top: 24, bottom: 36, left: 10, right: 10,
        axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false },
      },
      series: [{
        type: 'themeRiver', data,
        emphasis: { itemStyle: { shadowBlur: 18, shadowColor: 'rgba(0,0,0,0.6)' } },
        label: { show: false },
        itemStyle: { opacity: 0.92 },
      }],
    });
  }

  function renderDiscovery() {
    const d = SP.d;
    const labelSet = new Set(s.discovery.slice(0, 7).map(p => p.aid));
    const pts = s.discovery.map(p => ({
      value: [p.x, p.y],
      aid: p.aid, plays: p.plays, firstTrack: p.firstTrack, firstSec: p.firstSec,
      symbolSize: Math.max(5, Math.sqrt(p.plays) * 0.62),
      label: labelSet.has(p.aid) ? { show: true, position: 'right', formatter: () => d.artists[p.aid], color: '#AEB4A9', fontSize: 10.5, fontFamily: 'Manrope', fontWeight: 600 } : undefined,
      itemStyle: { color: SP.rgba('#1ED760', 0.55), borderColor: 'rgba(30,215,96,0.9)', borderWidth: 1 },
    }));
    SP.makeChart(el('ar-disc'), {
      grid: { left: 8, right: 40, top: 26, bottom: 8, containLabel: true },
      tooltip: {
        formatter: p => {
          const dp = p.data;
          return `<b>${esc(d.artists[dp.aid])}</b><br>` +
            `<span style="color:#AEB4A9">First heard</span> <b>${SP.fmtSecDate(dp.firstSec)}</b><br>` +
            `<span style="color:#AEB4A9">First track</span> <span style="color:#1ED760">${esc(dp.firstTrack)}</span><br>` +
            `<span style="color:#AEB4A9">Since then</span> <b>${SP.fmt1(p.value[1])} h</b> · ${SP.fmtInt(dp.plays)} plays`;
        },
      },
      xAxis: { type: 'time', axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      yAxis: {
        type: 'log', logBase: 10, min: 1, name: 'total hours', nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9 },
        axisLabel: Object.assign({ formatter: v => SP.fmtInt(v) }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false },
      },
      series: [{ type: 'scatter', data: pts, animationThreshold: 3000, progressive: 0, labelLayout: { hideOverlap: true } }],
    });
  }

  function renderLoyalty() {
    const tb = el('ar-loyal'); tb.innerHTML = '';
    s.loyalty.forEach(l => {
      tb.appendChild(h(`<tr>
        <td><div class="t-name" title="${esc(l.name)}">${esc(l.name)}</div></td>
        <td class="num dim">${SP.fmtInt(l.spanDays)} d</td>
        <td class="num dim">${SP.fmtInt(l.depth)}</td>
        <td class="num" style="color:${l.obsession >= 3 ? 'var(--accent)' : 'var(--tx-hi)'}">${l.obsession.toFixed(1)}×</td>
        <td style="font-family:var(--f-mono);font-size:0.76rem;white-space:nowrap">${l.peakMonth != null ? SP.monthKeyLabel(l.peakMonth, true) : '—'}</td>
      </tr>`));
    });
  }

  function renderMoves() {
    const d = SP.d, box = el('ar-moves'); box.innerHTML = '';
    if (!s.rising || !s.fading) {
      box.innerHTML = `<div class="empty" style="min-height:120px;grid-column:1/-1"><div>Needs ≥ 24 months of listening in scope to compare.</div></div>`;
      return;
    }
    const mk = (list, cls, arrow) => {
      let out = '';
      list.forEach(m => {
        const name = d.artists[m.aid];
        const to = m.r === Infinity ? 'out' : '#' + m.r;
        out += `<div class="mini-row"><div class="mini-rank">${arrow}</div>
          <div style="min-width:0"><div class="mini-name" title="${esc(name)}">${esc(name)}</div>
          <div class="mini-sub">#${m.pr} → ${to}</div></div>
          <div class="mini-val ${cls}">${m.move > 0 ? '+' + m.move : m.r === Infinity ? '−' + m.pr : m.move}</div></div>`;
      });
      return out || '<div class="mini-sub" style="padding:8px 4px">No movers.</div>';
    };
    box.appendChild(h(`<div><h4 class="good">Rising</h4><div class="mini">${mk(s.rising, 'good', '▲')}</div></div>`));
    box.appendChild(h(`<div><h4 class="bad">Fading</h4><div class="mini">${mk(s.fading, 'bad', '▼')}</div></div>`));
  }

  function renderWonders() {
    const box = el('ar-wonders'); box.innerHTML = '';
    if (!s.wonders.length) { box.innerHTML = '<div class="mini-sub" style="padding:8px 4px">No one-hit wonders in this scope.</div>'; return; }
    s.wonders.forEach((w, i) => {
      box.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(w.name)}">${esc(w.name)}</div>
        <div class="mini-sub" title="${esc(w.track)}">only track: ${esc(w.track)}</div></div>
        <div class="mini-val">${SP.fmtInt(w.plays)}<small> pl</small></div></div>`));
    });
  }

  /* ================= DETAIL MODE (artist focus) ================= */
  function computeDetail() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric, aid = SP.filter.artist;
    const st = { n: sub.length, metric, aid, name: d.artists[aid] };
    if (!sub.length) return st;

    let ms = 0, skips = 0;
    const tracks = new Map(), albums = new Set(), monthly = new Map();
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      ms += d.ms[i];
      if (SP.isSkipped(i)) skips++;
      const tr = d.tr[i];
      let te = tracks.get(tr);
      if (!te) { te = { plays: 0, ms: 0, skips: 0 }; tracks.set(tr, te); }
      te.plays++; te.ms += d.ms[i]; if (SP.isSkipped(i)) te.skips++;
      albums.add(d.trackAlbum[tr]);
      const mk = SP.monthKey[i];
      let me = monthly.get(mk);
      if (!me) { me = { ms: 0, plays: 0 }; monthly.set(mk, me); }
      me.ms += d.ms[i]; me.plays++;
    }
    st.hours = ms / MSH; st.plays = sub.length; st.skips = skips;
    st.uniqueTracks = tracks.size; st.uniqueAlbums = albums.size;
    st.firstIdx = sub[0]; st.lastIdx = sub[sub.length - 1];
    st.firstTrack = d.trackName[d.tr[sub[0]]];
    st.spanDays = Math.max(1, Math.round((SP.t[st.lastIdx] - SP.t[st.firstIdx]) / 86400));
    st.monthly = monthly;
    st.mkMin = SP.monthKey[sub[0]]; st.mkMax = SP.monthKey[sub[sub.length - 1]];
    st.topTracks = SP.topN(tracks, 10, metric);
    st.trackTotalVal = 0; tracks.forEach(e => st.trackTotalVal += SP.metricVal(e, metric));

    // share of ALL listening in same scope (without artist filter)
    const all = SP.buildSubsetCustom({ artist: null });
    let allMs = 0;
    for (let j = 0; j < all.length; j++) allMs += d.ms[all[j]];
    st.shareMs = allMs ? (ms / allMs) * 100 : 0;
    st.sharePlays = all.length ? (sub.length / all.length) * 100 : 0;

    let peakMk = null, peakV = -1;
    monthly.forEach((e, mk) => { const v = e.ms / MSH; if (v > peakV) { peakV = v; peakMk = mk; } });
    st.peakMk = peakMk; st.peakHours = peakV;
    return st;
  }

  function detailSkeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Artists · focus</div>
        <h1 class="sec-title">Artist under the microscope</h1>
        <p class="sec-sub" id="ar-sub"></p>
      </div>
    </div>
    <div id="ar-empty" hidden><div class="card"><div class="empty"><div class="empty-t">Nothing here yet</div><div>No plays for this artist under the current filters.</div></div></div></div>
    <div id="ar-body">
      <div class="artist-hero reveal" id="ar-hero"></div>
      <div class="grid">
        <div class="c8 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title" id="ar-trend-title">Monthly listening</div><div class="card-hint" id="ar-trend-hint"></div></div>
          <div class="chart tall" id="ar-trend"></div>
        </div></div>
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Their top tracks</div><div class="card-hint" id="ar-dtracks-hint"></div></div>
          <div class="mini" id="ar-dtracks"></div>
        </div></div>
      </div>
    </div>`;
  }

  function fillDetail() {
    s = computeDetail();
    const empty = !s.n;
    el('ar-empty').hidden = !empty;
    el('ar-body').hidden = empty;
    el('ar-sub').textContent = empty
      ? `No ${s.name} plays match the current filters.`
      : `Everything about your ${s.name} era${SP.filter.year !== 'all' ? ' in ' + SP.filter.year : ''}. Clear the artist chip to zoom back out.`;
    if (empty) return;

    const d = SP.d;
    el('ar-hero').innerHTML = `
      <div class="ah-eyebrow">Artist in focus</div>
      <div class="ah-name">${esc(s.name)}</div>
      <div class="ah-facts">
        <div class="ah-fact"><div class="k">Hours</div><div class="v">${SP.fmtInt(s.hours)}</div></div>
        <div class="ah-fact"><div class="k">Plays</div><div class="v">${SP.fmtInt(s.plays)}</div></div>
        <div class="ah-fact"><div class="k">Share of scope</div><div class="v">${SP.fmtPct(s.shareMs, s.shareMs < 10 ? 1 : 0)}<small> of your hours</small></div></div>
        <div class="ah-fact"><div class="k">First heard</div><div class="v" style="font-size:1.05rem">${SP.fmtSecDate(SP.t[s.firstIdx])}<small> · ${esc(s.firstTrack)}</small></div></div>
        <div class="ah-fact"><div class="k">In rotation</div><div class="v">${SP.fmtInt(s.spanDays)}<small> days</small></div></div>
        <div class="ah-fact"><div class="k">Catalog depth</div><div class="v">${SP.fmtInt(s.uniqueTracks)}<small> tracks · ${SP.fmtInt(s.uniqueAlbums)} albums</small></div></div>
        <div class="ah-fact"><div class="k">Peak month</div><div class="v">${s.peakMk != null ? SP.monthKeyLabel(s.peakMk, true) : '—'}<small> · ${SP.fmt1(s.peakHours)} h</small></div></div>
      </div>`;

    // monthly trend
    const metric = s.metric;
    const mks = []; for (let mk = s.mkMin; mk <= s.mkMax; mk++) mks.push(mk);
    const vals = mks.map(mk => { const e = s.monthly.get(mk); return e ? +(metric === 'hours' ? e.ms / MSH : e.plays).toFixed(1) : 0; });
    el('ar-trend-title').textContent = metric === 'hours' ? 'Monthly hours' : 'Monthly plays';
    el('ar-trend-hint').textContent = `${SP.monthKeyLabel(s.mkMin, true)} → ${SP.monthKeyLabel(s.mkMax, true)}`;
    SP.makeChart(el('ar-trend'), {
      grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:2px">${ps[0].axisValueLabel}</div><b style="font-size:13.5px">${metric === 'hours' ? SP.fmt1(ps[0].value) + ' h' : SP.fmtInt(ps[0].value) + ' plays'}</b>`,
      },
      xAxis: { type: 'category', data: mks.map(mk => SP.monthKeyLabel(mk, true)), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(mks.length / 16) - 1) }, SP.axisLabel) },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', data: vals, barMaxWidth: 20,
        itemStyle: { borderRadius: [3, 3, 0, 0], color: SP.areaGradient('#1ED760', 0.95, 0.4) },
      }],
    });

    // top tracks mini list
    el('ar-dtracks-hint').textContent = metric === 'hours' ? 'by hours' : 'by plays';
    const box = el('ar-dtracks'); box.innerHTML = '';
    s.topTracks.forEach((t, i) => {
      const name = d.trackName[t.key];
      const share = s.trackTotalVal ? (t.val / s.trackTotalVal) * 100 : 0;
      box.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(name)}">${esc(name)}</div>
        <div class="mini-sub">${SP.fmtPct(share, share < 10 ? 1 : 0)} of their listening</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(t.ms / MSH) + '<small> h</small>' : SP.fmtInt(t.plays) + '<small> pl</small>'}</div></div>`));
    });
  }

  /* ================= lifecycle ================= */
  function fillList() {
    s = computeList();
    const empty = !s.n;
    el('ar-empty').hidden = !empty;
    el('ar-body').hidden = empty;
    if (empty) { el('ar-sub').textContent = 'No plays match the current filters.'; return; }
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    el('ar-sub').textContent = `Rankings, eras and obsessions — ${yearTxt}.`;
    renderLeaderboard();
    renderBump();
    renderFlow();
    renderDiscovery();
    renderLoyalty();
    renderMoves();
    renderWonders();
    requestAnimationFrame(() => SP.resizeAll());
  }

  function fill() {
    const wantMode = SP.filter.artist != null ? 'detail' : 'list';
    if (wantMode !== mode) {
      mode = wantMode;
      SP.disposeChartsIn(root);
      root.innerHTML = mode === 'detail' ? detailSkeleton() : listSkeleton();
    }
    if (mode === 'detail') fillDetail(); else fillList();
  }

  SP.sections = SP.sections || {};
  SP.sections.artists = {
    render(container) {
      root = container;
      mode = null;
      fill();
      return root.querySelectorAll('.reveal');
    },
    update() { if (root) fill(); },
    dispose() { if (root) SP.disposeChartsIn(root); root = null; mode = null; },
  };
})();
