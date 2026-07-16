/* ============================================================
   SOUNDPRINT — sections/tracks.js  (BUILD_SPEC §4)
   Top-25 tracks · binges · lifespans · never-skip vs most-skipped ·
   completion histogram · top albums + loyalty · podcast corner
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function p95(arr) { if (!arr.length) return 1; const a = Array.from(arr).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] || 1; }

  let root = null, s = null;
  let bumpN = 10, flowN = 12, bumpDeb = null, flowDeb = null; // song bump/flow controls
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    const st = { n: sub.length, metric };
    if (!sub.length) return st;
    const dur = SP.trackDurations();

    const trkMap = SP.byTrack(sub);
    st.top25 = SP.topN(trkMap, 25, metric).filter(t => t.key > 0);
    st.totalVal = 0; trkMap.forEach((e, k) => { if (k > 0) st.totalVal += SP.metricVal(e, metric); });
    st.trkMap = trkMap;

    st.mkMin = SP.monthKey[sub[0]];
    st.mkMax = SP.monthKey[sub[sub.length - 1]];

    // completion % helper (avg played ms / estimated duration)
    st.completionOf = t => {
      const dd = dur[t.key];
      return dd > 0 ? Math.min(100, (t.ms / t.plays / dd) * 100) : null;
    };

    // sparklines for top 25
    const nB = SP.monthKeyMax + 1;
    const topSet = new Set(st.top25.map(t => t.key));
    st.spark = SP.seriesFor(sub, SP.trackIdOf, i => SP.monthKey[i], nB, topSet, metric);

    // ---- binges: most plays of one track in a single day ----
    // composite numeric key: tr * 40000 + dayOffset (dayOffset < 40000, tr < 9000)
    const binge = new Map();
    const D0 = SP.firstDayKey;
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0 || d.tr[i] === 0) continue;
      const key = d.tr[i] * 40000 + (SP.dayKey[i] - D0);
      binge.set(key, (binge.get(key) || 0) + 1);
    }
    const bingeArr = [];
    binge.forEach((v, key) => { if (v >= 3) bingeArr.push({ tr: Math.floor(key / 40000), dk: key % 40000 + D0, plays: v }); });
    bingeArr.sort((a, b) => b.plays - a.plays);
    st.binges = bingeArr.slice(0, 10);

    // ---- lifespans: top 15 monthly matrix ----
    const top15 = st.top25.slice(0, 15).map(t => t.key);
    const t15set = new Set(top15);
    const life = new Map(); // tr -> {arr, first, last}
    top15.forEach(tr => life.set(tr, { arr: new Float64Array(st.mkMax - st.mkMin + 1), first: Infinity, last: -Infinity }));
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], tr = SP.trackIdOf(i);
      if (!t15set.has(tr)) continue;
      const L = life.get(tr), k = SP.monthKey[i] - st.mkMin;
      L.arr[k] += metric === 'hours' ? d.ms[i] / MSH : 1;
      if (k < L.first) L.first = k;
      if (k > L.last) L.last = k;
    }
    st.life = life; st.top15 = top15;

    // ---- never-skip vs most-skipped (adaptive thresholds) ----
    const allTracks = [];
    trkMap.forEach((e, k) => { if (k > 0) allTracks.push({ key: k, plays: e.plays, ms: e.ms, skips: e.skips, rate: e.plays ? e.skips / e.plays : 0 }); });
    let minNever = 50, minSkip = 20;
    let never = allTracks.filter(t => t.plays >= minNever);
    while (never.length < 5 && minNever > 5) { minNever = Math.floor(minNever / 2); never = allTracks.filter(t => t.plays >= minNever); }
    st.neverSkip = never.sort((a, b) => a.rate - b.rate || b.plays - a.plays).slice(0, 8);
    st.neverMin = minNever;
    let skippy = allTracks.filter(t => t.plays >= minSkip);
    while (skippy.length < 5 && minSkip > 5) { minSkip = Math.floor(minSkip / 2); skippy = allTracks.filter(t => t.plays >= minSkip); }
    st.mostSkipped = skippy.sort((a, b) => b.rate - a.rate || b.plays - a.plays).slice(0, 8);
    st.skipMin = minSkip;

    // ---- completion histogram (per play) ----
    const bins = new Float64Array(10);
    let counted = 0;
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const dd = dur[d.tr[i]];
      if (!dd) continue;
      let pct = d.ms[i] / dd;
      if (pct > 1) pct = 1;
      bins[Math.min(9, Math.floor(pct * 10))]++;
      counted++;
    }
    st.histo = Array.from(bins);
    st.histoN = counted;

    // ---- albums + loyalty ----
    const albMap = SP.byAlbum(sub);
    st.topAlbums = SP.topN(albMap, 15, metric).filter(a => a.key > 0);
    const albSet = new Set(st.topAlbums.map(a => a.key));
    const albTracks = new Map(); albSet.forEach(a => albTracks.set(a, new Set()));
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const alb = d.trackAlbum[d.tr[i]];
      if (albSet.has(alb)) albTracks.get(alb).add(d.tr[i]);
    }
    st.albTracks = albTracks;

    // ---- podcast corner ----
    st.showPodcasts = SP.filter.content !== 'music' && SP.filter.artist == null;
    if (st.showPodcasts) {
      const shows = new Map(); // showId -> {ms, plays, eps:Set}
      for (let j = 0; j < sub.length; j++) {
        const i = sub[j];
        if (d.ty[i] !== 1) continue;
        const ep = d.tr[i], sh = d.epShow[ep];
        let e = shows.get(sh);
        if (!e) { e = { ms: 0, plays: 0, eps: new Set() }; shows.set(sh, e); }
        e.ms += d.ms[i]; e.plays++; e.eps.add(ep);
      }
      st.shows = Array.from(shows.entries()).map(([sh, e]) => ({ sh, ms: e.ms, plays: e.plays, eps: e.eps.size }))
        .sort((a, b) => b.ms - a.ms).slice(0, 10);
      if (!st.shows.length) st.showPodcasts = false;
    }

    return st;
  }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Tracks & Albums</div>
        <h1 class="sec-title">The songs that stuck</h1>
        <p class="sec-sub" id="tk-sub"></p>
      </div>
    </div>
    <div id="tk-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <div class="empty-t">Nothing here yet</div><div>No plays match the current filters.</div>
    </div></div></div>
    <div id="tk-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Top 25 tracks</div><div class="card-hint" id="tk-lb-hint"></div></div>
          <div class="lbx lbx-t" id="tk-lb"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Song rank evolution</div>
            <div class="ctl"><label for="tk-bumpn">Top</label>
              <input type="range" class="rs" id="tk-bumpn" min="5" max="25" step="1" aria-label="Number of songs in the rank chart">
              <span class="ctl-val" id="tk-bumpn-val"></span></div></div>
          <div class="card-hint" id="tk-bump-hint" style="margin:-8px 0 6px"></div>
          <div class="chart tall" id="tk-bump"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Flow of favorites</div>
            <div class="ctl"><label for="tk-flown">Top</label>
              <input type="range" class="rs" id="tk-flown" min="5" max="25" step="1" aria-label="Number of songs in the flow chart">
              <span class="ctl-val" id="tk-flown-val"></span></div></div>
          <div class="card-hint" style="margin:-8px 0 6px">each song's monthly listening, stacked like a river</div>
          <div class="chart tall" id="tk-flow"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">On-repeat binges</div><div class="card-hint">most plays of one track in a single day</div></div>
          <div class="mini" id="tk-binges"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Never-skip vs most-skipped</div><div class="card-hint" id="tk-skip-hint"></div></div>
          <div class="duo" id="tk-skips"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Track lifespans</div><div class="card-hint" id="tk-life-hint">top 15 · first play → last play, shaded by intensity</div></div>
          <div id="tk-life" style="width:100%;height:460px"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%;display:flex;flex-direction:column">
          <div class="card-head"><div class="card-title">How much of a song do you actually play?</div><div class="card-hint" id="tk-histo-hint"></div></div>
          <div class="chart tall" id="tk-histo" style="flex:1 1 auto;min-height:340px;height:auto"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Top albums</div><div class="card-hint" id="tk-alb-hint"></div></div>
          <div class="mini" id="tk-albums"></div>
        </div></div>
      </div>
      <div class="grid" id="tk-pod-wrap" hidden>
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Podcast corner</div><div class="card-hint">top shows by hours</div></div>
          <table class="tbl">
            <thead><tr><th>#</th><th>Show</th><th class="num">Hours</th><th class="num">Episodes</th><th class="num">Plays</th></tr></thead>
            <tbody id="tk-pods"></tbody>
          </table>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- renderers ---------------- */
  function renderLeaderboard() {
    const d = SP.d, metric = s.metric;
    el('tk-lb-hint').textContent = (metric === 'hours' ? 'ranked by hours' : 'ranked by plays') + ' · completion = avg listen ÷ track length';
    const box = el('tk-lb'); box.innerHTML = '';
    box.appendChild(h(`<div class="lbx-head"><span>#</span><span>Track</span><span>Trend</span><span class="r">Hours</span><span class="r">Plays</span><span class="r">Compl.</span><span class="r">Skip</span></div>`));
    const topVal = s.top25[0] ? s.top25[0].val : 1;
    s.top25.forEach((t, idx) => {
      const name = d.trackName[t.key];
      const artist = d.artists[d.trackArtist[t.key]];
      const compl = s.completionOf(t);
      const skip = t.plays ? (t.skips / t.plays) * 100 : 0;
      const sparkArr = s.spark.get(t.key) ? Array.from(s.spark.get(t.key)).slice(s.mkMin, s.mkMax + 1) : [];
      const spk = sparkArr.length > 1 ? SP.sparkline(sparkArr, { w: 64, h: 22, color: '#1ED760', fill: true }) : '';
      const row = h(`<div class="lbx-row" style="cursor:default">
        <div class="lbx-rank">${idx + 1}</div>
        <div style="min-width:0">
          <div class="lbx-name" title="${esc(name)} — ${esc(artist)}">${esc(name)}</div>
          <div class="lbx-sub">${esc(artist)}</div>
          <div class="lbx-bar-track"><div class="lbx-bar" style="width:0%"></div></div>
        </div>
        <div class="lbx-spark-cell">${spk}</div>
        <div class="lbx-val">${SP.fmt1(t.ms / MSH)}</div>
        <div class="lbx-val dim lbx-plays-cell">${SP.fmtInt(t.plays)}</div>
        <div class="lbx-val dim">${compl != null ? SP.fmtPct(compl) : '—'}</div>
        <div class="lbx-val" style="color:${skip >= 40 ? '#F45B5B' : skip <= 10 ? 'var(--accent)' : 'var(--tx-mid)'}">${SP.fmtPct(skip)}</div>
      </div>`);
      const bar = row.querySelector('.lbx-bar');
      const w = (t.val / topVal) * 100;
      if (reduce) bar.style.width = w + '%';
      else requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = w + '%'; }));
      box.appendChild(row);
    });
  }

  function renderBinges() {
    const d = SP.d, box = el('tk-binges'); box.innerHTML = '';
    if (!s.binges.length) { box.innerHTML = '<div class="mini-sub" style="padding:8px 4px">No repeat binges in this scope.</div>'; return; }
    s.binges.forEach((b, i) => {
      const name = d.trackName[b.tr], artist = d.artists[d.trackArtist[b.tr]];
      box.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(name)} — ${esc(artist)}">${esc(name)}</div>
        <div class="mini-sub">${esc(artist)} · ${SP.fmtDate(b.dk)}</div></div>
        <div class="mini-val good">${SP.fmtInt(b.plays)}<small>× in a day</small></div></div>`));
    });
  }

  function renderSkips() {
    const d = SP.d, box = el('tk-skips'); box.innerHTML = '';
    el('tk-skip-hint').textContent = `never-skip needs ≥ ${s.neverMin} plays · most-skipped ≥ ${s.skipMin}`;
    const mk = (list, cls) => {
      let out = '';
      list.forEach(t => {
        const name = d.trackName[t.key], artist = d.artists[d.trackArtist[t.key]];
        out += `<div class="mini-row"><div class="mini-rank"></div>
          <div style="min-width:0"><div class="mini-name" title="${esc(name)} — ${esc(artist)}">${esc(name)}</div>
          <div class="mini-sub">${esc(artist)} · ${SP.fmtInt(t.plays)} plays</div></div>
          <div class="mini-val ${cls}">${SP.fmtPct(t.rate * 100, t.rate < 0.1 ? 1 : 0)}</div></div>`;
      });
      return out || '<div class="mini-sub" style="padding:8px 4px">Not enough data.</div>';
    };
    box.appendChild(h(`<div><h4 class="good">Never skipped</h4><div class="mini">${mk(s.neverSkip, 'good')}</div></div>`));
    box.appendChild(h(`<div><h4 class="bad">Most skipped</h4><div class="mini">${mk(s.mostSkipped, 'bad')}</div></div>`));
  }

  function renderLifespans() {
    const d = SP.d, metric = s.metric;
    const node = el('tk-life');
    const names = s.top15.map(tr => d.trackName[tr]);
    node.style.height = Math.max(300, s.top15.length * 28 + 90) + 'px';
    const data = [];
    const vals = [];
    s.top15.forEach((tr, y) => {
      const L = s.life.get(tr);
      for (let k = L.first; k <= L.last; k++) {
        data.push([k, y, +L.arr[k].toFixed(2)]);
        if (L.arr[k] > 0) vals.push(L.arr[k]);
      }
    });
    const vmax = Math.max(1, p95(vals));
    const mks = []; for (let mk = s.mkMin; mk <= s.mkMax; mk++) mks.push(mk);
    SP.makeChart(node, {
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        formatter: p => {
          const tr = s.top15[p.value[1]];
          return `<b>${esc(d.trackName[tr])}</b> <span style="color:#AEB4A9">— ${esc(d.artists[d.trackArtist[tr]])}</span><br>` +
            `<span style="color:#AEB4A9">${SP.monthKeyLabel(s.mkMin + p.value[0], true)}</span> · <b style="color:#1ED760">${metric === 'hours' ? SP.fmt1(p.value[2]) + ' h' : SP.fmtInt(p.value[2]) + ' plays'}</b>`;
        },
      },
      visualMap: { show: false, min: 0, max: vmax, dimension: 2, inRange: { color: SP.RAMP_GREEN } },
      xAxis: {
        type: 'category', data: mks.map(mk => SP.monthKeyLabel(mk, true)),
        axisLine: SP.axisLine, axisTick: { show: false },
        axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(mks.length / 18) - 1) }, SP.axisLabel),
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category', data: names, inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11, color: '#AEB4A9', width: 170, overflow: 'truncate' }),
      },
      series: [{
        type: 'heatmap', data,
        itemStyle: { borderRadius: 3, borderColor: '#0A0C0B', borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: 'rgba(30,215,96,0.9)', borderWidth: 1 } },
        progressive: 2000,
      }],
    });
  }

  function renderHisto() {
    const labels = ['0–10', '10–20', '20–30', '30–40', '40–50', '50–60', '60–70', '70–80', '80–90', '90–100'];
    el('tk-histo-hint').textContent = `${SP.fmtInt(s.histoN)} plays · % of track length listened`;
    const maxIdx = s.histo.indexOf(Math.max(...s.histo));
    SP.makeChart(el('tk-histo'), {
      grid: { left: 8, right: 14, top: 20, bottom: 24, containLabel: true },
      tooltip: {
        formatter: p => `<b>${labels[p.dataIndex]}%</b> of the song<br>${SP.fmtInt(p.value)} plays <span style="color:#AEB4A9">(${SP.fmtPct(p.value / s.histoN * 100, 1)})</span>`,
      },
      xAxis: {
        type: 'category', data: labels, name: '% listened', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 },
        axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel,
      },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v >= 1000 ? (v / 1000) + 'k' : v }, SP.axisLabel), splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 34,
        data: s.histo.map((v, i) => ({
          value: v,
          itemStyle: { color: i === maxIdx ? '#1ED760' : 'rgba(30,215,96,0.30)', borderRadius: [4, 4, 0, 0] },
        })),
      }],
    });
  }

  function renderAlbums() {
    const d = SP.d, metric = s.metric, box = el('tk-albums'); box.innerHTML = '';
    el('tk-alb-hint').textContent = (metric === 'hours' ? 'by hours' : 'by plays') + ' · depth = distinct tracks in rotation';
    if (!s.topAlbums.length) { box.innerHTML = '<div class="mini-sub" style="padding:8px 4px">No albums in this scope.</div>'; return; }
    s.topAlbums.forEach((a, i) => {
      const name = d.albumName[a.key], artist = d.artists[d.albumArtist[a.key]];
      const depth = s.albTracks.get(a.key) ? s.albTracks.get(a.key).size : 0;
      box.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(name)} — ${esc(artist)}">${esc(name)}</div>
        <div class="mini-sub">${esc(artist)} · ${SP.fmtInt(depth)} tracks in rotation</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(a.ms / MSH) + '<small> h</small>' : SP.fmtInt(a.plays) + '<small> pl</small>'}</div></div>`));
    });
  }

  function renderPodcasts() {
    const d = SP.d;
    el('tk-pod-wrap').hidden = !s.showPodcasts;
    if (!s.showPodcasts) return;
    const tb = el('tk-pods'); tb.innerHTML = '';
    s.shows.forEach((sh, i) => {
      tb.appendChild(h(`<tr>
        <td class="num dim">${i + 1}</td>
        <td><div class="t-name" title="${esc(d.shows[sh.sh])}">${esc(d.shows[sh.sh])}</div></td>
        <td class="num">${SP.fmt1(sh.ms / MSH)}</td>
        <td class="num dim">${SP.fmtInt(sh.eps)}</td>
        <td class="num dim">${SP.fmtInt(sh.plays)}</td>
      </tr>`));
    });
  }

  /* ---------------- song rank evolution + flow of favorites (Phase B2) ---------------- */
  function songLabel(tr, max) {
    const d = SP.d;
    const t = `${d.trackName[tr]} — ${d.artists[d.trackArtist[tr]]}`;
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function wireSongCharts() {
    const bn = el('tk-bumpn'), fn = el('tk-flown');
    if (!bn || !fn) return;
    bn.value = bumpN; fn.value = flowN;
    el('tk-bumpn-val').textContent = String(bumpN);
    el('tk-flown-val').textContent = String(flowN);
    bn.oninput = () => {
      bumpN = +bn.value; el('tk-bumpn-val').textContent = String(bumpN);
      clearTimeout(bumpDeb); bumpDeb = setTimeout(renderSongBump, 160);
    };
    fn.oninput = () => {
      flowN = +fn.value; el('tk-flown-val').textContent = String(flowN);
      clearTimeout(flowDeb); flowDeb = setTimeout(renderSongFlow, 160);
    };
  }

  function renderSongBump() {
    const node = el('tk-bump');
    if (!node || !s || !s.top25) return;
    const d = SP.d, sub = SP.subset, metric = s.metric;
    // quarters when a single year is filtered, half-years otherwise
    const quarterly = SP.filter.year !== 'all';
    const bucketOf = quarterly ? (i => Math.floor(SP.monthKey[i] / 3)) : (i => Math.floor(SP.monthKey[i] / 6));
    const bLabel = quarterly
      ? b => `’${String(SP.BASE_YEAR + Math.floor(b / 4)).slice(2)} Q${(b % 4) + 1}`
      : b => `’${String(SP.BASE_YEAR + Math.floor(b / 2)).slice(2)} H${(b % 2) + 1}`;
    el('tk-bump-hint').textContent = `your all-time top ${bumpN}, re-ranked against each other every ${quarterly ? 'quarter' : 'half-year'} · lower is better · hover a line to isolate it`;

    // cohort ranking: the selected top-N songs re-ranked among themselves per
    // bucket (a global per-bucket rank leaves mostly-empty lines — a lifetime
    // top-10 song can sit at #80 in an off half-year)
    const topSongs = SP.topN(SP.byTrack(sub), bumpN, metric).filter(t => t.key > 0);
    const cohort = new Set(topSongs.map(t => t.key));
    const bAgg = new Map(); // b -> Map<tr, val> (cohort only)
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], tr = SP.trackIdOf(i);
      if (!cohort.has(tr)) continue;
      const b = bucketOf(i);
      let m = bAgg.get(b);
      if (!m) { m = new Map(); bAgg.set(b, m); }
      m.set(tr, (m.get(tr) || 0) + (metric === 'hours' ? d.ms[i] / MSH : 1));
    }
    const buckets = Array.from(bAgg.keys()).sort((a, b) => a - b);
    const ranks = new Map();
    buckets.forEach(b => {
      const entries = Array.from(bAgg.get(b).entries()).sort((a, z) => z[1] - a[1]);
      const rm = new Map();
      entries.forEach(([tr], k) => rm.set(tr, k + 1));
      ranks.set(b, rm);
    });
    const series = topSongs.map(t => ({
      name: songLabel(t.key, 40), type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2.2 },
      data: buckets.map(b => { const r = ranks.get(b).get(t.key); return r != null ? r : null; }),
      connectNulls: false,
      emphasis: { focus: 'series', lineStyle: { width: 3.2 } },
      endLabel: { show: true, formatter: p => p.value != null ? songLabel(t.key, 26) : '', color: 'inherit', fontSize: 10, fontFamily: 'Manrope', fontWeight: 600, distance: 8, width: 150, overflow: 'truncate' },
      labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
    }));
    SP.makeChart(node, {
      grid: { left: 8, right: 168, top: 18, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: p => `<b>${esc(p.seriesName)}</b><br><span style="color:#AEB4A9">${bLabel(buckets[p.dataIndex])}</span> · cohort rank <b style="color:#1ED760">#${p.value}</b>`,
      },
      xAxis: { type: 'category', data: buckets.map(bLabel), boundaryGap: false, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', inverse: true, min: 1, max: bumpN, interval: Math.max(1, Math.round(bumpN / 12)), axisLabel: Object.assign({ formatter: v => '#' + v }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false } },
      series,
    });
  }

  function renderSongFlow() {
    const node = el('tk-flow');
    if (!node || !s || !s.top25) return;
    const d = SP.d, sub = SP.subset, metric = s.metric;
    const topSongs = SP.topN(SP.byTrack(sub), flowN, metric).filter(t => t.key > 0);
    const set = new Set(topSongs.map(t => t.key));
    const flow = new Map();
    topSongs.forEach(t => flow.set(t.key, new Float64Array(s.mkMax - s.mkMin + 1)));
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], tr = SP.trackIdOf(i);
      if (!set.has(tr)) continue;
      flow.get(tr)[SP.monthKey[i] - s.mkMin] += metric === 'hours' ? d.ms[i] / MSH : 1;
    }
    const data = [];
    topSongs.forEach(t => {
      const arr = flow.get(t.key), name = songLabel(t.key, 44);
      for (let k = 0; k < arr.length; k++) {
        const mk = s.mkMin + k;
        data.push([`${SP.BASE_YEAR + Math.floor(mk / 12)}-${String(mk % 12 + 1).padStart(2, '0')}-01`, +arr[k].toFixed(2), name]);
      }
    });
    SP.makeChart(node, {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
          ps.filter(p => p.value[1] > 0).sort((a, b) => b.value[1] - a.value[1]).slice(0, 10).forEach(p => {
            out += `<div>${p.marker} <span style="color:#AEB4A9">${esc(p.value[2])}</span> <b style="float:right;margin-left:14px">${metric === 'hours' ? SP.fmt1(p.value[1]) + ' h' : SP.fmtInt(p.value[1])}</b></div>`;
          });
          return out;
        },
      },
      singleAxis: { type: 'time', top: 24, bottom: 36, left: 10, right: 10, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      series: [{ type: 'themeRiver', data, label: { show: false }, itemStyle: { opacity: 0.92 }, emphasis: { itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.6)' } } }],
    });
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n || !s.top25 || !s.top25.length;
    el('tk-empty').hidden = !empty;
    el('tk-body').hidden = empty;
    if (empty) { el('tk-sub').textContent = 'No plays match the current filters.'; return; }

    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('tk-sub').textContent = scopeArtist
      ? `${scopeArtist}'s songs on heavy rotation — ${yearTxt}.`
      : `Repeats, binges and the songs you never skip — ${yearTxt}.`;

    renderLeaderboard();
    wireSongCharts();
    renderSongBump();
    renderSongFlow();
    renderBinges();
    renderSkips();
    renderLifespans();
    renderHisto();
    renderAlbums();
    renderPodcasts();
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.tracks = {
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
