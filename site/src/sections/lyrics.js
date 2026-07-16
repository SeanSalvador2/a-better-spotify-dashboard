/* ============================================================
   SOUNDPRINT — sections/lyrics.js  (Phase B2)
   Lyrics Lab: sentiment gauge + vocabulary hero · sentiment vs sound ·
   theme tracker · word cloud · vocabulary rankings · sad-song affinity
   Lyric arrays cover the top ~2,000 tracks (92.7% of listening time);
   everything here is time-weighted over plays whose track has coverage.
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let root = null, s = null;

  const THEME_LABEL = {
    love: 'Love', heartbreak: 'Heartbreak', drinking_partying: 'Drinking & partying',
    trucks_roads_driving: 'Trucks & roads', small_town_home: 'Small town & home',
    faith: 'Faith', money: 'Money', night: 'Night', summer: 'Summer',
  };
  const THEME_COLORS = ['#FF6B9D', '#C792EA', '#FFB347', '#7CC4FF', '#1ED760', '#E8E6DF', '#F4D35E', '#34D3EB', '#A7F432'];

  function hasLyr(tr) { return SP.en && tr > 0 && SP.en.lyrWords[tr] >= 0; }

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, en = SP.en, sub = SP.subset;
    const st = { n: sub.length };
    if (!sub.length || !en) return st;

    let covMs = 0, totMs = 0;
    let sentW = 0, uniqW = 0, repW = 0, explW = 0, wordsW = 0;
    const monthly = new Map();      // mk -> {ms, sent, val}  (lyr-covered, music)
    const themeMs = new Float64Array(en.themes.length);
    const themeMonthly = new Map(); // mk -> Float64Array(themes)
    const themeTopTrack = en.themes.map(() => new Map()); // theme -> Map<tr, ms>
    const wordMs = new Map();       // word -> {ms, genreMs:Map}
    const trkAgg = new Map();       // tr -> {ms, plays}

    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i], ms = d.ms[i];
      totMs += ms;
      const mk = SP.monthKey[i];
      let me = monthly.get(mk);
      if (!me) { me = { ms: 0, sent: 0, valMs: 0, val: 0 }; monthly.set(mk, me); }
      const v = en.trackValence[tr];
      if (v >= 0) { me.valMs += ms; me.val += v * ms; }
      if (!hasLyr(tr)) continue;
      covMs += ms;
      sentW += en.lyrSent[tr] * ms;
      uniqW += en.lyrUnique[tr] * ms;
      repW += en.lyrRep[tr] * ms;
      wordsW += en.lyrWords[tr] * ms;
      if (en.lyrExplicit[tr] === 1) explW += ms;
      me.ms += ms; me.sent += en.lyrSent[tr] * ms;
      // themes
      const ths = en.lyrThemes[tr];
      if (ths && ths.length) {
        let ta = themeMonthly.get(mk);
        if (!ta) { ta = new Float64Array(en.themes.length); themeMonthly.set(mk, ta); }
        for (const th of ths) {
          themeMs[th] += ms; ta[th] += ms;
          themeTopTrack[th].set(tr, (themeTopTrack[th].get(tr) || 0) + ms);
        }
      }
      // words
      const tops = en.lyrTop[tr];
      if (tops && tops.length) {
        const u = en.artistUmbrella[d.trackArtist[tr]];
        for (const w of tops) {
          let we = wordMs.get(w);
          if (!we) { we = { ms: 0, g: new Map() }; wordMs.set(w, we); }
          we.ms += ms;
          if (u >= 0) we.g.set(u, (we.g.get(u) || 0) + ms);
        }
      }
      let te = trkAgg.get(tr);
      if (!te) { te = { ms: 0, plays: 0 }; trkAgg.set(tr, te); }
      te.ms += ms; te.plays++;
    }

    if (!covMs) return { n: sub.length, noCov: true };

    st.covPct = (covMs / totMs) * 100;
    st.sent = sentW / covMs;                    // -100..100
    st.unique = uniqW / covMs;
    st.rep = repW / covMs;
    st.words = wordsW / covMs;
    st.explicit = (explW / covMs) * 100;

    // monthly series
    st.mkMin = SP.monthKey[sub[0]]; st.mkMax = SP.monthKey[sub[sub.length - 1]];
    const mks = []; for (let mk = st.mkMin; mk <= st.mkMax; mk++) mks.push(mk);
    st.mks = mks;
    st.sentM = mks.map(mk => { const e = monthly.get(mk); return e && e.ms > 5 * MSH ? +(e.sent / e.ms).toFixed(1) : null; });
    st.valM = mks.map(mk => { const e = monthly.get(mk); return e && e.valMs > 5 * MSH ? +(((e.val / e.valMs) - 50) * 2).toFixed(1) : null; });
    // most/least positive months
    let hiMk = null, hiV = -Infinity, loMk = null, loV = Infinity;
    st.sentM.forEach((v, k) => { if (v == null) return; if (v > hiV) { hiV = v; hiMk = mks[k]; } if (v < loV) { loV = v; loMk = mks[k]; } });
    st.hi = { mk: hiMk, v: hiV }; st.lo = { mk: loMk, v: loV };
    // divergence: biggest gap sound-happy words-sad
    let dvMk = null, dvGap = -Infinity;
    mks.forEach((mk, k) => {
      const sv = st.sentM[k], vv = st.valM[k];
      if (sv == null || vv == null) return;
      const gap = vv - sv;
      if (gap > dvGap) { dvGap = gap; dvMk = mk; }
    });
    st.diverge = { mk: dvMk, gap: dvGap };

    // themes
    st.themeMs = themeMs;
    st.themeM = themeMonthly;
    st.themeOrder = Array.from(themeMs.keys()).sort((a, b) => themeMs[b] - themeMs[a]).filter(th => themeMs[th] > 0);
    st.themeTop = en.themes.map((_, th) => {
      let best = null, bv = -1;
      themeTopTrack[th].forEach((v, tr) => { if (v > bv) { bv = v; best = tr; } });
      return best;
    });

    // word cloud: top 70 words by ms; drop very short words
    st.cloud = Array.from(wordMs.entries())
      .filter(([w]) => w.length >= 3)
      .sort((a, b) => b[1].ms - a[1].ms).slice(0, 70)
      .map(([w, e]) => {
        let gBest = -1, gv = -1;
        e.g.forEach((v, u) => { if (v > gv) { gv = v; gBest = u; } });
        return { w, ms: e.ms, u: gBest };
      });

    // vocabulary rankings (favorite tracks = >=8 plays with coverage)
    const favs = [];
    trkAgg.forEach((e, tr) => { if (e.plays >= 8) favs.push({ tr, ms: e.ms, plays: e.plays, rep: en.lyrRep[tr], uniq: en.lyrUnique[tr], sent: en.lyrSent[tr] }); });
    st.mostRep = favs.slice().sort((a, b) => b.rep - a.rep || b.ms - a.ms).slice(0, 8);
    st.leastRep = favs.slice().sort((a, b) => a.rep - b.rep || b.ms - a.ms).slice(0, 8);

    // artists: weighted lyric stats, >=3h covered listening
    const artAgg = new Map();
    trkAgg.forEach((e, tr) => {
      const a = d.trackArtist[tr];
      if (a <= 0) return;
      let ae = artAgg.get(a);
      if (!ae) { ae = { ms: 0, uniq: 0, rep: 0 }; artAgg.set(a, ae); }
      ae.ms += e.ms; ae.uniq += en.lyrUnique[tr] * e.ms; ae.rep += en.lyrRep[tr] * e.ms;
    });
    const arts = [];
    artAgg.forEach((e, a) => { if (e.ms >= 3 * MSH) arts.push({ a, ms: e.ms, uniq: e.uniq / e.ms, rep: e.rep / e.ms }); });
    st.wordyArt = arts.slice().sort((a, b) => b.uniq - a.uniq).slice(0, 8);
    st.repArt = arts.slice().sort((a, b) => b.rep - a.rep).slice(0, 8);

    // sad-song affinity: VADER saturates at ±100 on full lyrics, so rank the
    // strongly-sad / strongly-happy favorites by how much you play them
    let sad = favs.filter(t => t.sent <= -60);
    if (sad.length < 5) sad = favs.slice().sort((a, b) => a.sent - b.sent).slice(0, 8);
    st.sadFavs = sad.sort((a, b) => b.plays - a.plays).slice(0, 8);
    let happy = favs.filter(t => t.sent >= 60);
    if (happy.length < 5) happy = favs.slice().sort((a, b) => b.sent - a.sent).slice(0, 8);
    st.happyFavs = happy.sort((a, b) => b.plays - a.plays).slice(0, 8);

    return st;
  }

  /* ---------------- renderers ---------------- */
  function sentWord(v) {
    if (v >= 35) return 'sunny';
    if (v >= 12) return 'warm';
    if (v >= -12) return 'bittersweet';
    if (v >= -35) return 'melancholy';
    return 'heavy';
  }
  function sentColor(v) { return v >= 12 ? '#1ED760' : v >= -12 ? '#FFB347' : '#FF6B9D'; }

  function gaugeSVG(v) {
    // arc from -100 (left) to +100 (right); needle at v
    const cx = 70, cy = 66, r = 54;
    const a0 = Math.PI, a1 = 0;
    const arc = (from, to, color, w) => {
      const x0 = cx + r * Math.cos(from), y0 = cy - r * Math.sin(from);
      const x1 = cx + r * Math.cos(to), y1 = cy - r * Math.sin(to);
      return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
    };
    const frac = (v + 100) / 200;                    // 0..1
    const ang = Math.PI * (1 - frac);
    const nx = cx + (r - 13) * Math.cos(ang), ny = cy - (r - 13) * Math.sin(ang);
    return `<svg width="140" height="76" viewBox="0 0 140 76" aria-hidden="true">
      ${arc(Math.PI, Math.PI * 0.62, '#FF6B9D', 7)}
      ${arc(Math.PI * 0.62, Math.PI * 0.38, '#FFB347', 7)}
      ${arc(Math.PI * 0.38, 0.02, '#1ED760', 7)}
      <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="6" fill="${sentColor(v)}" stroke="#0A0C0B" stroke-width="2.5"/>
      <text x="16" y="74" fill="#6B716A" font-size="8" font-family="JetBrains Mono">sad</text>
      <text x="106" y="74" fill="#6B716A" font-size="8" font-family="JetBrains Mono">happy</text>
    </svg>`;
  }

  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Lyrics Lab</div>
        <h1 class="sec-title">What your music is actually saying</h1>
        <p class="sec-sub" id="ly-sub"></p>
      </div>
    </div>
    <div class="cov-hint reveal"><span class="gdot"></span> lyrics analyzed for your top 2,000 tracks · derived stats only — no lyric text is stored</div>
    <div id="ly-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6H7a4 4 0 0 0 0 8h1v4l4-4h5a4 4 0 0 0 0-8Z"/></svg>
      <div class="empty-t">Nothing to read here</div><div>No lyric-covered plays match the current filters.</div>
    </div></div></div>
    <div id="ly-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Lyrical mood</div><div class="card-hint">time-weighted sentiment</div></div>
          <div class="lgauge" id="ly-gauge"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Your music's vocabulary</div><div class="card-hint">per song, weighted by listening</div></div>
          <div class="statline" id="ly-vocab" style="margin-bottom:0"></div>
        </div></div>
        <div class="c3 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Explicit share</div><div class="card-hint">of covered time</div></div>
          <div class="statline" id="ly-expl" style="margin-bottom:0"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Sound vs words</div><div class="card-hint" id="ly-sw-hint"></div></div>
          <div class="chart tall" id="ly-sent"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c8 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Theme tracker</div><div class="card-hint">what the songs were about, month by month</div></div>
          <div class="chart tall" id="ly-themes"></div>
        </div></div>
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">All-time themes</div><div class="card-hint" id="ly-tl-hint">hours inside each theme</div></div>
          <div class="mini" id="ly-themelb"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">The words you live in</div><div class="card-hint">distinctive words from your most-played songs · size = listening time · color = genre</div></div>
          <div class="cloud" id="ly-cloud"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Repetition olympics</div><div class="card-hint">among favorites (≥ 8 plays)</div></div>
          <div class="duo" id="ly-rep"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Wordiest vs loopiest artists</div><div class="card-hint">≥ 3 h of covered listening</div></div>
          <div class="duo" id="ly-art"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Sad songs you love</div><div class="card-hint">your favorites, ranked by lyrical sentiment — country music delivers</div></div>
          <div class="duo" id="ly-sad"></div>
        </div></div>
      </div>
    </div>`;
  }

  function miniTrackRow(i, tr, valHtml, cls) {
    const d = SP.d;
    const name = d.trackName[tr], artist = d.artists[d.trackArtist[tr]];
    return `<div class="mini-row"><div class="mini-rank">${i + 1}</div>
      <div style="min-width:0"><div class="mini-name" title="${esc(name)} — ${esc(artist)}">${esc(name)}</div>
      <div class="mini-sub">${esc(artist)}</div></div>
      <div class="mini-val ${cls || ''}">${valHtml}</div></div>`;
  }

  function fill() {
    s = compute();
    const empty = !s.n || s.noCov || !SP.en;
    el('ly-empty').hidden = !empty;
    el('ly-body').hidden = empty;
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    if (empty) { el('ly-sub').textContent = 'No lyric-covered plays match the current filters.'; return; }
    const en = SP.en, d = SP.d;

    el('ly-sub').textContent = `Sentiment, themes and vocabulary across ${SP.fmtPct(s.covPct)} of your listening — ${yearTxt}.`;

    // gauge + vocab + explicit
    el('ly-gauge').innerHTML = `${gaugeSVG(s.sent)}
      <div><div class="lg-val" style="color:${sentColor(s.sent)}">${s.sent > 0 ? '+' : ''}${s.sent.toFixed(0)}</div>
      <div class="lg-lab">reads ${sentWord(s.sent)}</div></div>`;
    el('ly-vocab').innerHTML = `
      <div class="sl"><div class="k">Unique words</div><div class="v">${SP.fmtInt(s.unique)}<small> avg / song</small></div></div>
      <div class="sl"><div class="k">Total words</div><div class="v">${SP.fmtInt(s.words)}<small> avg / song</small></div></div>
      <div class="sl"><div class="k">Repetitiveness</div><div class="v">${SP.fmtPct(s.rep)}<small> of lines repeat</small></div></div>`;
    el('ly-expl').innerHTML = `<div class="sl"><div class="k">Explicit</div><div class="v" style="color:${s.explicit > 30 ? '#FF6B9D' : 'var(--tx-hi)'}">${SP.fmtPct(s.explicit)}<small> of listening</small></div></div>`;

    // sound vs words
    const gapTxt = s.diverge.mk != null && s.diverge.gap > 15
      ? `biggest "sounds happy, reads sad" month: ${SP.monthKeyLabel(s.diverge.mk, true)}`
      : 'audio valence vs lyric sentiment, same −100…100 scale';
    el('ly-sw-hint').textContent = gapTxt;
    const marks = [];
    if (s.hi.mk != null) marks.push({ coord: [s.mks.indexOf(s.hi.mk), s.hi.v], value: 'peak', itemStyle: { color: '#1ED760' } });
    if (s.lo.mk != null) marks.push({ coord: [s.mks.indexOf(s.lo.mk), s.lo.v], value: 'dip', itemStyle: { color: '#FF6B9D' } });
    SP.makeChart(el('ly-sent'), {
      grid: { left: 8, right: 14, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${ps[0].axisValueLabel}</div>`;
          ps.forEach(p => { if (p.value == null) return; out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${p.value > 0 ? '+' : ''}${p.value}</b></div>`; });
          return out;
        },
      },
      xAxis: { type: 'category', data: s.mks.map(mk => SP.monthKeyLabel(mk, true)), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(s.mks.length / 14) - 1) }, SP.axisLabel) },
      yAxis: { type: 'value', min: -100, max: 100, axisLabel: Object.assign({ formatter: v => v > 0 ? '+' + v : v }, SP.axisLabel), splitLine: SP.splitLine },
      series: [
        {
          name: 'Words (lyric sentiment)', type: 'line', data: s.sentM, showSymbol: false, smooth: 0.3, connectNulls: true,
          lineStyle: { width: 2.2, color: '#FF6B9D' }, itemStyle: { color: '#FF6B9D' },
          areaStyle: { color: SP.areaGradient('#FF6B9D', 0.12, 0.01) },
          markPoint: { symbolSize: 44, label: { fontSize: 9, fontFamily: 'JetBrains Mono', color: '#0A0C0B', fontWeight: 700 }, data: marks },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed' }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
        {
          name: 'Sound (audio valence)', type: 'line', data: s.valM, showSymbol: false, smooth: 0.3, connectNulls: true,
          lineStyle: { width: 1.6, color: '#34D3EB', type: 'dashed' }, itemStyle: { color: '#34D3EB' },
        },
      ],
    });

    // theme tracker — themeRiver of theme hours
    const flow = [];
    s.themeOrder.forEach(th => {
      const name = THEME_LABEL[en.themes[th]] || en.themes[th];
      s.mks.forEach(mk => {
        const ta = s.themeM.get(mk);
        const v = ta ? ta[th] / MSH : 0;
        const dateStr = `${SP.BASE_YEAR + Math.floor(mk / 12)}-${String(mk % 12 + 1).padStart(2, '0')}-01`;
        flow.push([dateStr, +v.toFixed(2), name]);
      });
    });
    SP.makeChart(el('ly-themes'), {
      color: s.themeOrder.map(th => THEME_COLORS[th % THEME_COLORS.length]),
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        formatter: ps => {
          const dt = new Date(ps[0].value[0]);
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${SP.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
          ps.filter(p => p.value[1] > 0).sort((a, b) => b.value[1] - a.value[1]).forEach(p => {
            out += `<div>${p.marker} <span style="color:#AEB4A9">${esc(p.value[2])}</span> <b style="float:right;margin-left:14px">${SP.fmt1(p.value[1])} h</b></div>`;
          });
          return out;
        },
      },
      singleAxis: { type: 'time', top: 24, bottom: 36, left: 10, right: 10, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel, splitLine: { show: false } },
      series: [{ type: 'themeRiver', data: flow, label: { show: false }, itemStyle: { opacity: 0.9 }, emphasis: { itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.6)' } } }],
    });

    // theme leaderboard
    const tlb = el('ly-themelb'); tlb.innerHTML = '';
    s.themeOrder.forEach((th, i) => {
      const topTr = s.themeTop[th];
      const sub = topTr != null ? `${esc(d.trackName[topTr])} — ${esc(d.artists[d.trackArtist[topTr]])}` : '';
      tlb.appendChild(h(`<div class="mini-row"><div class="mini-rank" style="color:${THEME_COLORS[th % THEME_COLORS.length]}">●</div>
        <div style="min-width:0"><div class="mini-name">${esc(THEME_LABEL[en.themes[th]] || en.themes[th])}</div>
        <div class="mini-sub" title="${sub}">top: ${sub}</div></div>
        <div class="mini-val">${SP.fmtInt(s.themeMs[th] / MSH)}<small> h</small></div></div>`));
    });

    // word cloud
    const cloud = el('ly-cloud'); cloud.innerHTML = '';
    if (s.cloud.length) {
      const max = s.cloud[0].ms, min = s.cloud[s.cloud.length - 1].ms;
      // interleave big and small for a balanced flow layout
      const sorted = s.cloud.slice();
      const arranged = [];
      let lo = sorted.length - 1, hi = 0;
      while (hi <= lo) { arranged.push(sorted[hi++]); if (hi <= lo) arranged.push(sorted[lo--]); if (hi <= lo) arranged.push(sorted[lo--]); }
      arranged.forEach(({ w, ms, u }) => {
        const f = max > min ? (ms - min) / (max - min) : 1;
        const size = (0.8 + Math.pow(f, 0.7) * 2.4).toFixed(2);
        const color = u >= 0 ? SP.genreColor(u) : '#8FA396';
        const node = h(`<span style="font-size:${size}rem;color:${color}" title="${esc(w)} · ${SP.fmt1(ms / MSH)} h of songs that lean on it · ${esc(SP.genreName(u))}">${esc(w)}</span>`);
        cloud.appendChild(node);
      });
    }

    // repetition olympics
    const repBox = el('ly-rep'); repBox.innerHTML = '';
    const repRows = list => list.map((t, i) => miniTrackRow(i, t.tr, `${t.rep}<small>% loop</small>`, t.rep >= 60 ? 'bad' : '')).join('');
    repBox.appendChild(h(`<div><h4 class="bad">Most repetitive</h4><div class="mini">${repRows(s.mostRep)}</div></div>`));
    repBox.appendChild(h(`<div><h4 class="good">Most varied</h4><div class="mini">${s.leastRep.map((t, i) => miniTrackRow(i, t.tr, `${SP.fmtInt(SP.en.lyrUnique[t.tr])}<small> words</small>`, 'good')).join('')}</div></div>`));

    // artists
    const artBox = el('ly-art'); artBox.innerHTML = '';
    const artRow = (a, i, val, cls) => `<div class="mini-row"><div class="mini-rank">${i + 1}</div>
      <div style="min-width:0"><div class="mini-name" title="${esc(d.artists[a.a])}">${esc(d.artists[a.a])}</div>
      <div class="mini-sub">${SP.fmt1(a.ms / MSH)} h covered</div></div>
      <div class="mini-val ${cls}">${val}</div></div>`;
    artBox.appendChild(h(`<div><h4 class="good">Wordiest</h4><div class="mini">${s.wordyArt.map((a, i) => artRow(a, i, `${SP.fmtInt(a.uniq)}<small> uniq/song</small>`, 'good')).join('')}</div></div>`));
    artBox.appendChild(h(`<div><h4 class="bad">Most repetitive</h4><div class="mini">${s.repArt.map((a, i) => artRow(a, i, `${SP.fmtInt(a.rep)}<small>% loop</small>`, 'bad')).join('')}</div></div>`));

    // sad-song affinity
    const sadBox = el('ly-sad'); sadBox.innerHTML = '';
    sadBox.appendChild(h(`<div><h4 style="color:#FF6B9D">Saddest words, most plays</h4><div class="mini">${s.sadFavs.map((t, i) => miniTrackRow(i, t.tr, `${SP.fmtInt(t.plays)}<small> pl · ${t.sent > 0 ? '+' : ''}${t.sent} sent.</small>`, 'bad')).join('')}</div></div>`));
    sadBox.appendChild(h(`<div><h4 class="good">Happiest in rotation</h4><div class="mini">${s.happyFavs.map((t, i) => miniTrackRow(i, t.tr, `${SP.fmtInt(t.plays)}<small> pl · +${t.sent} sent.</small>`, 'good')).join('')}</div></div>`));

    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.lyrics = {
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
