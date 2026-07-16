/* ============================================================
   SOUNDPRINT — sections/behavior.js  (BUILD_SPEC §6 + §7)
   One nav item, two sub-tabs:
   BEHAVIOR — skip anatomy · start/end reasons · intentionality ·
              shuffle · platforms · countries · offline/incognito
   DISCOVERY — new artists · explore vs repeat · diversity index ·
               era bands · hall of fame · time machine
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const FLAG = iso => String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  const CTY_NAME = { US: 'United States', DE: 'Germany', PH: 'Philippines', SG: 'Singapore', NL: 'Netherlands', GR: 'Greece', TR: 'Turkey', CA: 'Canada' };

  let root = null, tab = 'behavior', tmMonth = null;
  // Eras 2.0 state (persists across filter changes)
  let eraTh = 25, eraDur = 60, eraLevel = 'artist', eraView = 'bands', eraSel = -1, eraDebounce = null;

  /* ---------- global first-play flags (cached, full history) ---------- */
  function firstFlags() {
    if (SP._firstFlags) return SP._firstFlags;
    const d = SP.d, n = SP.n;
    const firstTrack = new Uint8Array(n), firstArtist = new Uint8Array(n);
    const seenT = new Uint8Array(d.trackName.length);
    const seenA = new Uint8Array(d.artists.length);
    for (let i = 0; i < n; i++) {
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i];
      if (tr > 0 && !seenT[tr]) { seenT[tr] = 1; firstTrack[i] = 1; }
      const a = d.trackArtist[tr];
      if (a > 0 && !seenA[a]) { seenA[a] = 1; firstArtist[i] = 1; }
    }
    SP._firstFlags = { firstTrack, firstArtist };
    return SP._firstFlags;
  }

  function monthRange(sub) {
    return { mkMin: SP.monthKey[sub[0]], mkMax: SP.monthKey[sub[sub.length - 1]] };
  }
  function mkList(a, b) { const out = []; for (let mk = a; mk <= b; mk++) out.push(mk); return out; }
  function monthAxis(mks, target) {
    target = target || 14;
    return {
      type: 'category', data: mks.map(mk => SP.monthKeyLabel(mk, true)),
      axisLine: SP.axisLine, axisTick: { show: false },
      axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(mks.length / target) - 1) }, SP.axisLabel),
    };
  }
  function pctAxis(max) {
    return { type: 'value', max, axisLabel: Object.assign({ formatter: v => v + '%' }, SP.axisLabel), splitLine: SP.splitLine };
  }
  function rsId(name) { return SP.d.reasonStart.indexOf(name); }

  /* ============================================================
     BEHAVIOR TAB
     ============================================================ */
  function behaviorSkeleton() {
    return `
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Skip rate over time</div><div class="card-hint">all plays incl. &lt;30s blips</div></div>
          <div class="chart" id="bh-skipline"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Songs die at…</div><div class="card-hint">seconds survived before a skip</div></div>
          <div class="chart" id="bh-die"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Skips by hour of day</div><div class="card-hint" id="bh-skiphour-hint"></div></div>
          <div class="chart" id="bh-skiphour"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Skips by platform</div><div class="card-hint">itchier thumbs on some devices</div></div>
          <div class="chart" id="bh-skippf"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">How plays start</div><div class="card-hint">reason_start</div></div>
          <div class="chart tall" id="bh-rs"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">How plays end</div><div class="card-hint">reason_end</div></div>
          <div class="chart tall" id="bh-re"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Intentionality index</div><div class="card-hint" id="bh-int-hint">share of plays you started on purpose (clickrow + playbtn + backbtn)</div></div>
          <div class="chart" id="bh-intent"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Shuffle rate over time</div><div class="card-hint" id="bh-shuf-hint"></div></div>
          <div class="chart" id="bh-shuffle"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Shuffle vs sequential</div><div class="card-hint">who you album-listen vs shuffle · top 12 artists</div></div>
          <div class="chart tall" id="bh-shufart"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c8 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Platform evolution</div><div class="card-hint">the Windows era → the iPhone era</div></div>
          <div class="chart tall" id="bh-pfarea"></div>
        </div></div>
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Device mix</div><div class="card-hint" id="bh-pfmix-hint"></div></div>
          <div class="chart tall" id="bh-pfdonut"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Platform × hour</div><div class="card-hint">when each device gets used</div></div>
          <div id="bh-pfhour" style="width:100%;height:260px"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Where you listened from</div><div class="card-hint" id="bh-cty-hint"></div></div>
          <div class="cty" id="bh-cty"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Offline & incognito</div><div class="card-hint">downloaded listening + private sessions</div></div>
          <div class="statline" id="bh-off-stats"></div>
          <div class="card-hint" style="margin:8px 0 4px">offline share of plays, monthly</div>
          <div id="bh-offline" style="width:100%;height:210px"></div>
        </div></div>
      </div>`;
  }

  function fillBehavior() {
    const d = SP.d;
    // scope that ignores the ≥30s threshold — behavior needs the blips
    const all = SP.buildSubsetCustom({ minListen: false });
    const sub = SP.subset;
    if (!all.length) return false;
    const { mkMin, mkMax } = monthRange(all);
    const mks = mkList(mkMin, mkMax);

    /* ---- skip anatomy (on the no-threshold scope) ---- */
    const skipM = new Map(); // mk -> {n, sk}
    const skipH = new Float64Array(24), playH = new Float64Array(24);
    const skipPf = new Map(); // pf -> {n, sk}
    const dieBins = new Float64Array(13); // 0-10..110-120, 120+
    for (let j = 0; j < all.length; j++) {
      const i = all[j];
      const mk = SP.monthKey[i], sk = SP.isSkipped(i);
      let e = skipM.get(mk); if (!e) { e = { n: 0, sk: 0 }; skipM.set(mk, e); }
      e.n++; if (sk) e.sk++;
      playH[SP.hour[i]]++; if (sk) skipH[SP.hour[i]]++;
      const pf = d.pf[i];
      let p = skipPf.get(pf); if (!p) { p = { n: 0, sk: 0 }; skipPf.set(pf, p); }
      p.n++; if (sk) p.sk++;
      if (sk) {
        const sec = d.ms[i] / 1000;
        dieBins[Math.min(12, Math.floor(sec / 10))]++;
      }
    }
    let skipRate = mks.map(mk => { const e = skipM.get(mk); return e && e.n >= 20 ? +((e.sk / e.n) * 100).toFixed(1) : null; });
    // Spotify's `skipped` flag is missing from early export rows: if the range
    // opens with a long run of hard zeros followed by real rates, show a gap
    // instead of a misleading 0% plateau.
    {
      let firstPos = skipRate.findIndex(v => v != null && v > 0);
      const lead = skipRate.slice(0, firstPos < 0 ? 0 : firstPos).filter(v => v != null);
      if (firstPos >= 6 && lead.length >= 6 && lead.every(v => v === 0)) {
        skipRate = skipRate.map((v, k) => (k < firstPos ? null : v));
        const hint = el('bh-skipline').closest('.card').querySelector('.card-hint');
        if (hint) hint.textContent = `all plays incl. <30s blips · flag not recorded before ${SP.monthKeyLabel(mks[firstPos], true)}`;
      }
    }
    SP.makeChart(el('bh-skipline'), {
      grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#F45B5B">${ps[0].value}%</b> of plays skipped` },
      xAxis: monthAxis(mks, 9),
      yAxis: pctAxis(null),
      series: [{
        type: 'line', data: skipRate, showSymbol: false, smooth: 0.3, connectNulls: false,
        lineStyle: { width: 2, color: '#F45B5B' }, areaStyle: { color: SP.areaGradient('#F45B5B', 0.16, 0.01) },
      }],
    });

    const dieLabels = ['0–10', '10–20', '20–30', '30–40', '40–50', '50–60', '60–70', '70–80', '80–90', '90–100', '100–110', '110–120', '120+'];
    const dieMax = Array.from(dieBins).indexOf(Math.max(...dieBins));
    const dieTotal = dieBins.reduce((a, b) => a + b, 0) || 1;
    SP.makeChart(el('bh-die'), {
      grid: { left: 8, right: 8, top: 16, bottom: 22, containLabel: true },
      tooltip: { formatter: p => `skipped after <b>${dieLabels[p.dataIndex]} s</b><br>${SP.fmtInt(p.value)} plays (${SP.fmtPct(p.value / dieTotal * 100)})` },
      xAxis: {
        type: 'category', data: dieLabels, name: 'seconds', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5 },
        axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { interval: 1, fontSize: 9 }),
      },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v >= 1000 ? (v / 1000) + 'k' : v }, SP.axisLabel), splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: Array.from(dieBins).map((v, i) => ({ value: v, itemStyle: { color: i === dieMax ? '#F45B5B' : 'rgba(244,91,91,0.32)', borderRadius: [3, 3, 0, 0] } })),
      }],
    });

    // skip by hour
    const skipHourRate = Array.from({ length: 24 }, (_, hh) => playH[hh] >= 30 ? +((skipH[hh] / playH[hh]) * 100).toFixed(1) : 0);
    const shMax = skipHourRate.indexOf(Math.max(...skipHourRate));
    el('bh-skiphour-hint').textContent = `trigger-happiest at ${shMax === 0 ? '12 am' : shMax < 12 ? shMax + ' am' : shMax === 12 ? '12 pm' : (shMax - 12) + ' pm'}`;
    SP.makeChart(el('bh-skiphour'), {
      grid: { left: 8, right: 8, top: 16, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${p.name}</b> · ${p.value}% skipped` },
      xAxis: {
        type: 'category', data: Array.from({ length: 24 }, (_, hh) => hh === 0 ? '12a' : hh < 12 ? hh + 'a' : hh === 12 ? '12p' : (hh - 12) + 'p'),
        axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { interval: 1, fontSize: 9 }),
      },
      yAxis: pctAxis(null),
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: skipHourRate.map((v, i) => ({ value: v, itemStyle: { color: i === shMax ? '#F45B5B' : 'rgba(244,91,91,0.32)', borderRadius: [3, 3, 0, 0] } })),
      }],
    });

    // skip by platform
    const pfRows = Array.from(skipPf.entries()).filter(([, e]) => e.n >= 50)
      .map(([pf, e]) => ({ name: d.platforms[pf], rate: (e.sk / e.n) * 100, n: e.n }))
      .sort((a, b) => b.rate - a.rate);
    SP.makeChart(el('bh-skippf'), {
      grid: { left: 8, right: 48, top: 12, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${p.name}</b> · ${SP.fmt1(p.value)}% skipped <span style="color:#6B716A">(${SP.fmtInt(pfRows[p.dataIndex].n)} plays)</span>` },
      xAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v + '%' }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false } },
      yAxis: { type: 'category', data: pfRows.map(r => r.name), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11.5, color: '#AEB4A9' }) },
      series: [{
        type: 'bar', barMaxWidth: 15,
        data: pfRows.map((r, i) => ({ value: +r.rate.toFixed(1), itemStyle: { color: i === 0 ? '#F45B5B' : 'rgba(244,91,91,0.4)', borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => p.value + '%' },
      }],
    });

    /* ---- reasons (no-threshold scope; blips ARE the story) ---- */
    const mkReason = (elId, ids, dict, accent) => {
      const cnt = new Map();
      for (let j = 0; j < all.length; j++) {
        const i = all[j], r = ids[i];
        cnt.set(r, (cnt.get(r) || 0) + 1);
      }
      const rows = Array.from(cnt.entries()).map(([r, n]) => ({ name: dict[r], n })).sort((a, b) => b.n - a.n).slice(0, 8);
      const tot = all.length;
      SP.makeChart(el(elId), {
        grid: { left: 8, right: 56, top: 8, bottom: 6, containLabel: true },
        tooltip: { formatter: p => `<b>${p.name}</b> · ${SP.fmtInt(p.value)} plays (${SP.fmtPct(p.value / tot * 100, p.value / tot < 0.1 ? 1 : 0)})` },
        xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } },
        yAxis: { type: 'category', data: rows.map(r => r.name), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'JetBrains Mono', fontSize: 10.5, color: '#AEB4A9' }) },
        series: [{
          type: 'bar', barMaxWidth: 16,
          data: rows.map((r, i) => ({ value: r.n, itemStyle: { color: i === 0 ? accent : SP.rgba(accent, 0.35), borderRadius: [0, 3, 3, 0] } })),
          label: { show: true, position: 'right', color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => SP.fmtPct(p.value / tot * 100, p.value / tot < 0.1 ? 1 : 0) },
        }],
      });
    };
    mkReason('bh-rs', d.rs, d.reasonStart, '#1ED760');
    mkReason('bh-re', d.re, d.reasonEnd, '#34D3EB');

    /* ---- intentionality index ---- */
    const intentIds = new Set(['clickrow', 'playbtn', 'backbtn'].map(x => d.reasonStart.indexOf(x)).filter(x => x >= 0));
    const intM = new Map();
    for (let j = 0; j < all.length; j++) {
      const i = all[j], mk = SP.monthKey[i];
      let e = intM.get(mk); if (!e) { e = { n: 0, y: 0 }; intM.set(mk, e); }
      e.n++; if (intentIds.has(d.rs[i])) e.y++;
    }
    const intent = mks.map(mk => { const e = intM.get(mk); return e && e.n >= 20 ? +((e.y / e.n) * 100).toFixed(1) : null; });
    const intVals = intent.filter(v => v != null);
    const intAvg = intVals.length ? intVals.reduce((a, b) => a + b, 0) / intVals.length : 0;
    el('bh-int-hint').textContent = `share of plays you started on purpose · average ${SP.fmtPct(intAvg)} — the rest is autoplay momentum`;
    SP.makeChart(el('bh-intent'), {
      grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#1ED760">${ps[0].value}%</b> deliberate starts` },
      xAxis: monthAxis(mks),
      yAxis: pctAxis(null),
      series: [{
        type: 'line', data: intent, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#1ED760' }, areaStyle: { color: SP.areaGradient('#1ED760', 0.18, 0.01) },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: 'rgba(232,230,223,0.3)', type: 'dashed' },
          label: { position: 'insideEndTop', color: '#AEB4A9', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: 'avg ' + Math.round(intAvg) + '%' },
          data: [{ yAxis: +intAvg.toFixed(1) }],
        },
      }],
    });

    /* ---- shuffle (respects the ≥30s toggle: uses live subset) ---- */
    const shufM = new Map();
    const shufArt = new Map(); // artist -> {n, sh}
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], mk = SP.monthKey[i];
      let e = shufM.get(mk); if (!e) { e = { n: 0, sh: 0 }; shufM.set(mk, e); }
      e.n++; if (SP.isShuffle(i)) e.sh++;
      const a = SP.artistIdOf(i);
      if (a > 0) {
        let x = shufArt.get(a); if (!x) { x = { n: 0, sh: 0 }; shufArt.set(a, x); }
        x.n++; if (SP.isShuffle(i)) x.sh++;
      }
    }
    const smks = sub.length ? mkList(SP.monthKey[sub[0]], SP.monthKey[sub[sub.length - 1]]) : mks;
    const shuffle = smks.map(mk => { const e = shufM.get(mk); return e && e.n >= 20 ? +((e.sh / e.n) * 100).toFixed(1) : null; });
    let shTot = 0, shN = 0; shufM.forEach(e => { shTot += e.sh; shN += e.n; });
    el('bh-shuf-hint').textContent = `${SP.fmtPct(shN ? shTot / shN * 100 : 0)} of plays are on shuffle overall`;
    SP.makeChart(el('bh-shuffle'), {
      grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#C792EA">${ps[0].value}%</b> on shuffle` },
      xAxis: monthAxis(smks, 9),
      yAxis: pctAxis(100),
      series: [{
        type: 'line', data: shuffle, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#C792EA' }, areaStyle: { color: SP.areaGradient('#C792EA', 0.16, 0.01) },
      }],
    });

    const topArtIds = SP.topN(SP.byArtist(sub), 12, 'plays').map(a => a.key);
    const saRows = topArtIds.map(a => {
      const x = shufArt.get(a) || { n: 0, sh: 0 };
      return { name: d.artists[a], rate: x.n ? (x.sh / x.n) * 100 : 0, n: x.n };
    }).sort((a, b) => b.rate - a.rate);
    SP.makeChart(el('bh-shufart'), {
      grid: { left: 8, right: 52, top: 8, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${esc(p.name)}</b><br>${SP.fmt1(p.value)}% shuffled · ${SP.fmtInt(saRows[p.dataIndex].n)} plays<br><span style="color:#6B716A;font-size:11px">${p.value >= 60 ? 'shuffle-first artist' : p.value <= 35 ? 'you play their albums straight through' : 'a bit of both'}</span>` },
      xAxis: { type: 'value', max: 100, axisLabel: Object.assign({ formatter: v => v + '%' }, SP.axisLabel), splitLine: SP.splitLine, axisLine: { show: false } },
      yAxis: { type: 'category', data: saRows.map(r => r.name), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11, color: '#AEB4A9', width: 110, overflow: 'truncate' }) },
      series: [{
        type: 'bar', barMaxWidth: 13,
        data: saRows.map(r => ({ value: +r.rate.toFixed(1), itemStyle: { color: r.rate >= 50 ? '#C792EA' : 'rgba(30,215,96,0.75)', borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9.5, formatter: p => Math.round(p.value) + '%' },
      }],
    });

    /* ---- platforms (live subset) ---- */
    const pfM = new Map(); // mk -> Float64Array(nPf)
    const pfTot = new Float64Array(d.platforms.length);
    const pfHour = new Float64Array(d.platforms.length * 24);
    const useH = SP.filter.metric === 'hours';
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], pf = d.pf[i], mk = SP.monthKey[i];
      const v = useH ? d.ms[i] / MSH : 1;
      let arr = pfM.get(mk); if (!arr) { arr = new Float64Array(d.platforms.length); pfM.set(mk, arr); }
      arr[pf] += v; pfTot[pf] += v;
      pfHour[pf * 24 + SP.hour[i]] += v;
    }
    const pfOrder = Array.from(pfTot.keys()).sort((a, b) => pfTot[b] - pfTot[a]);
    const pfColors = ['#1ED760', '#34D3EB', '#FFB347', '#FF6B9D', '#C792EA', '#E8E6DF'];
    const pfSeries = pfOrder.filter(pf => pfTot[pf] > 0).map((pf, k) => ({
      name: d.platforms[pf], type: 'line', stack: 'pf', areaStyle: { opacity: 0.75 }, smooth: 0.25,
      showSymbol: false, lineStyle: { width: 0.5 },
      itemStyle: { color: pfColors[k % pfColors.length] },
      data: smks.map(mk => { const arr = pfM.get(mk); const tot = arr ? arr.reduce((a, b) => a + b, 0) : 0; return tot ? +((arr[pf] / tot) * 100).toFixed(1) : 0; }),
    }));
    SP.makeChart(el('bh-pfarea'), {
      grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${ps[0].axisValueLabel}</div>`;
          ps.filter(p => p.value > 0.5).forEach(p => { out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${Math.round(p.value)}%</b></div>`; });
          return out;
        },
      },
      xAxis: Object.assign(monthAxis(smks), { boundaryGap: false }),
      yAxis: pctAxis(100),
      series: pfSeries,
    });

    el('bh-pfmix-hint').textContent = useH ? 'by hours' : 'by plays';
    SP.makeChart(el('bh-pfdonut'), {
      tooltip: { formatter: p => `<b>${p.name}</b> · ${SP.fmtInt(p.value)} ${useH ? 'h' : 'plays'} (${p.percent}%)` },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['50%', '46%'],
        label: { show: true, formatter: '{b}\n{d}%', color: '#AEB4A9', fontFamily: 'Manrope', fontSize: 10.5, fontWeight: 600, lineHeight: 15 },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        itemStyle: { borderColor: '#121513', borderWidth: 3, borderRadius: 6 },
        data: pfOrder.filter(pf => pfTot[pf] > 0).map((pf, k) => ({ name: d.platforms[pf], value: Math.round(pfTot[pf]), itemStyle: { color: pfColors[k % pfColors.length] } })),
      }],
    });

    // platform × hour heatmap (share-normalized per platform)
    const pfShown = pfOrder.filter(pf => pfTot[pf] > 0).slice(0, 4);
    const pfhData = [];
    pfShown.forEach((pf, row) => {
      const rowTot = pfTot[pf] || 1;
      for (let hh = 0; hh < 24; hh++) pfhData.push([hh, row, +((pfHour[pf * 24 + hh] / rowTot) * 100).toFixed(2)]);
    });
    SP.makeChart(el('bh-pfhour'), {
      grid: { left: 8, right: 14, top: 8, bottom: 8, containLabel: true },
      tooltip: { formatter: p => `<b>${d.platforms[pfShown[p.value[1]]]}</b> · ${p.value[0] === 0 ? '12 am' : p.value[0] < 12 ? p.value[0] + ' am' : p.value[0] === 12 ? '12 pm' : (p.value[0] - 12) + ' pm'}<br>${SP.fmt1(p.value[2])}% of that device's listening` },
      visualMap: { show: false, min: 0, max: 12, dimension: 2, inRange: { color: SP.RAMP_GREEN } },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, hh) => hh === 0 ? '12a' : hh < 12 ? hh + 'a' : hh === 12 ? '12p' : (hh - 12) + 'p'), axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { interval: 1, fontSize: 9 }) },
      yAxis: { type: 'category', data: pfShown.map(pf => d.platforms[pf]), axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { fontFamily: 'Manrope', fontSize: 11, color: '#AEB4A9' }) },
      series: [{ type: 'heatmap', data: pfhData, itemStyle: { borderRadius: 3, borderColor: '#0A0C0B', borderWidth: 2.5 } }],
    });

    /* ---- countries ---- */
    const cty = new Map(); // co -> {ms, plays, dkMin, dkMax}
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], co = d.co[i];
      let e = cty.get(co);
      if (!e) { e = { ms: 0, plays: 0, dkMin: SP.dayKey[i], dkMax: SP.dayKey[i] }; cty.set(co, e); }
      e.ms += d.ms[i]; e.plays++; e.dkMax = SP.dayKey[i];
    }
    const ctyRows = Array.from(cty.entries()).map(([co, e]) => ({ iso: d.countries[co], e })).sort((a, b) => b.e.ms - a.e.ms);
    el('bh-cty-hint').textContent = `${ctyRows.length} countries`;
    const ctyBox = el('bh-cty'); ctyBox.innerHTML = '';
    ctyRows.forEach(({ iso, e }) => {
      const range = e.dkMin === e.dkMax ? SP.fmtDate(e.dkMin) : `${SP.fmtDate(e.dkMin)} → ${SP.fmtDate(e.dkMax)}`;
      ctyBox.appendChild(h(`<div class="cty-row">
        <div class="cty-flag">${FLAG(iso)}</div>
        <div style="min-width:0"><div class="cty-name">${esc(CTY_NAME[iso] || iso)}</div><div class="cty-sub">${range}</div></div>
        <div class="cty-val">${SP.fmt1(e.ms / MSH)}<small> h</small><br><small>${SP.fmtInt(e.plays)} plays</small></div>
      </div>`));
    });

    /* ---- offline & incognito ---- */
    let off = 0, inc = 0;
    const offM = new Map();
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], mk = SP.monthKey[i];
      let e = offM.get(mk); if (!e) { e = { n: 0, off: 0 }; offM.set(mk, e); }
      e.n++;
      if (SP.isOffline(i)) { off++; e.off++; }
      if (SP.isIncognito(i)) inc++;
    }
    const offStats = el('bh-off-stats'); offStats.innerHTML = '';
    offStats.appendChild(h(`<div class="sl"><div class="k">Offline plays</div><div class="v">${SP.fmtInt(off)}<small> · ${SP.fmtPct(sub.length ? off / sub.length * 100 : 0, 1)}</small></div></div>`));
    offStats.appendChild(h(`<div class="sl"><div class="k">Incognito plays</div><div class="v">${SP.fmtInt(inc)}<small> · ${SP.fmtPct(sub.length ? inc / sub.length * 100 : 0, 2)}</small></div></div>`));
    const offline = smks.map(mk => { const e = offM.get(mk); return e && e.n >= 20 ? +((e.off / e.n) * 100).toFixed(1) : 0; });
    SP.makeChart(el('bh-offline'), {
      grid: { left: 8, right: 10, top: 10, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#FFB347">${ps[0].value}%</b> offline` },
      xAxis: monthAxis(smks, 7),
      yAxis: pctAxis(null),
      series: [{
        type: 'line', data: offline, showSymbol: false, smooth: 0.3,
        lineStyle: { width: 1.8, color: '#FFB347' }, areaStyle: { color: SP.areaGradient('#FFB347', 0.16, 0.01) },
      }],
    });
    return true;
  }

  /* ============================================================
     DISCOVERY TAB
     ============================================================ */
  function discoverySkeleton() {
    return `
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">New artists discovered</div><div class="card-hint" id="ds-new-hint"></div></div>
          <div class="chart tall" id="ds-new"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Explore vs repeat</div><div class="card-hint">share of plays that are a song's first-ever spin</div></div>
          <div class="chart" id="ds-explore"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Taste diversity</div><div class="card-hint" id="ds-div-hint"></div></div>
          <div class="chart" id="ds-diversity"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Your musical eras</div><div class="card-hint" id="ds-era-hint"></div></div>
          <div class="ctlrow">
            <div class="ctl"><label for="era-th">Threshold</label>
              <input type="range" class="rs" id="era-th" min="10" max="50" step="1" aria-label="Era share threshold">
              <span class="ctl-val" id="era-th-val"></span></div>
            <div class="ctl"><label for="era-dur">Min length</label>
              <input type="range" class="rs" id="era-dur" min="14" max="120" step="1" aria-label="Era minimum duration in days">
              <span class="ctl-val" id="era-dur-val"></span></div>
            <div class="seg seg-soft" role="tablist" aria-label="Era level">
              <button data-lv="artist">Artist</button><button data-lv="genre">Genre</button><button data-lv="mood">Mood</button>
            </div>
            <div class="seg seg-soft" role="tablist" aria-label="Era view">
              <button data-vw="bands">Bands</button><button data-vw="chapters">Chapters</button>
            </div>
          </div>
          <div class="eras" id="ds-eras"></div>
          <div id="ds-era-detail"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Discovery hall of fame</div><div class="card-hint">found that year → became lifetime top-100</div></div>
          <div id="ds-hof"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Time machine</div><div class="card-hint">any month, reconstructed</div></div>
          <select class="tm-select" id="ds-tm-select" aria-label="Pick a month"></select>
          <div class="tm-stats" id="ds-tm-stats"></div>
          <div class="card-hint" style="margin-bottom:4px">top artists that month</div>
          <div class="mini" id="ds-tm-artists"></div>
          <div class="card-hint" style="margin:12px 0 4px">top tracks</div>
          <div class="mini" id="ds-tm-tracks"></div>
        </div></div>
      </div>`;
  }

  function fillDiscovery() {
    const d = SP.d, sub = SP.subset, metric = SP.filter.metric;
    if (!sub.length) return false;
    const { firstTrack, firstArtist } = firstFlags();
    const { mkMin, mkMax } = monthRange(sub);
    const mks = mkList(mkMin, mkMax);

    /* ---- new artists per month + cumulative ---- */
    const newA = new Map(), firstT = new Map(), playsM = new Map();
    const artMonthly = new Map(); // mk -> Map<artist, plays> (for diversity + eras)
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], mk = SP.monthKey[i];
      playsM.set(mk, (playsM.get(mk) || 0) + 1);
      if (firstArtist[i]) newA.set(mk, (newA.get(mk) || 0) + 1);
      if (firstTrack[i]) firstT.set(mk, (firstT.get(mk) || 0) + 1);
      const a = SP.artistIdOf(i);
      if (a > 0) {
        let m = artMonthly.get(mk);
        if (!m) { m = new Map(); artMonthly.set(mk, m); }
        m.set(a, (m.get(a) || 0) + 1);
      }
    }
    const newSeries = mks.map(mk => newA.get(mk) || 0);
    let cum = 0;
    const cumSeries = mks.map(mk => (cum += newA.get(mk) || 0));
    el('ds-new-hint').textContent = `${SP.fmtInt(cum)} artists first heard in this scope`;
    SP.makeChart(el('ds-new'), {
      grid: { left: 8, right: 8, top: 34, bottom: 6, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: '#AEB4A9', fontSize: 11, fontFamily: 'Manrope' }, itemWidth: 14, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
        formatter: ps => {
          let out = `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A;margin-bottom:3px">${ps[0].axisValueLabel}</div>`;
          ps.forEach(p => { out += `<div>${p.marker} <span style="color:#AEB4A9">${p.seriesName}</span> <b style="float:right;margin-left:14px">${SP.fmtInt(p.value)}</b></div>`; });
          return out;
        },
      },
      xAxis: monthAxis(mks),
      yAxis: [
        { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
        { type: 'value', axisLabel: SP.axisLabel, splitLine: { show: false } },
      ],
      series: [
        { name: 'New artists', type: 'bar', data: newSeries, barMaxWidth: 16, itemStyle: { color: SP.areaGradient('#1ED760', 0.95, 0.45), borderRadius: [3, 3, 0, 0] } },
        { name: 'Cumulative', type: 'line', yAxisIndex: 1, data: cumSeries, showSymbol: false, smooth: 0.2, lineStyle: { width: 1.8, color: '#34D3EB' }, itemStyle: { color: '#34D3EB' } },
      ],
    });

    /* ---- explore vs repeat ---- */
    const explore = mks.map(mk => { const n = playsM.get(mk) || 0; return n >= 20 ? +(((firstT.get(mk) || 0) / n) * 100).toFixed(1) : null; });
    SP.makeChart(el('ds-explore'), {
      grid: { left: 8, right: 10, top: 16, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#A7F432">${ps[0].value}%</b> exploring · <b>${(100 - ps[0].value).toFixed(1)}%</b> on repeat` },
      xAxis: monthAxis(mks, 8),
      yAxis: pctAxis(null),
      series: [{
        type: 'line', data: explore, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#A7F432' }, areaStyle: { color: SP.areaGradient('#A7F432', 0.16, 0.01) },
      }],
    });

    /* ---- diversity (Shannon entropy, bits) ---- */
    const H = mks.map(mk => {
      const m = artMonthly.get(mk);
      if (!m) return null;
      let n = 0; m.forEach(v => n += v);
      if (n < 20) return null;
      let ent = 0;
      m.forEach(v => { const p = v / n; ent -= p * Math.log2(p); });
      return +ent.toFixed(2);
    });
    const hVals = H.filter(v => v != null);
    const k6 = Math.min(6, Math.floor(hVals.length / 2));
    const early = hVals.slice(0, k6), late = hVals.slice(-k6);
    const eAvg = early.reduce((a, b) => a + b, 0) / (early.length || 1);
    const lAvg = late.reduce((a, b) => a + b, 0) / (late.length || 1);
    const deltaPct = eAvg ? ((lAvg - eAvg) / eAvg) * 100 : 0;
    el('ds-div-hint').textContent = hVals.length >= 4
      ? (Math.abs(deltaPct) < 5
        ? 'monthly Shannon entropy — your variety has held steady'
        : `monthly Shannon entropy — ${Math.abs(Math.round(deltaPct))}% ${deltaPct > 0 ? 'higher' : 'lower'} than when this range began: tastes are ${deltaPct > 0 ? 'widening' : 'narrowing'}`)
      : 'monthly Shannon entropy of artist mix';
    SP.makeChart(el('ds-diversity'), {
      grid: { left: 8, right: 10, top: 16, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div><b style="color:#34D3EB">${ps[0].value} bits</b> <span style="color:#AEB4A9">≈ ${SP.fmtInt(Math.pow(2, ps[0].value))} artists in balanced rotation</span>` },
      xAxis: monthAxis(mks, 8),
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v + ' bit' }, SP.axisLabel), splitLine: SP.splitLine, min: v => Math.floor(v.min) },
      series: [{
        type: 'line', data: H, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#34D3EB' }, areaStyle: { color: SP.areaGradient('#34D3EB', 0.14, 0.01) },
      }],
    });

    /* ---- era bands 2.0 (threshold + duration sliders · artist/genre/mood levels ·
            clickable detail cards · chapters view) ---- */
    mountEraControls();
    renderEras();

    /* ---- hall of fame ---- */
    const life = SP.buildSubsetCustom({ year: 'all' });
    const lifeArt = SP.topN(SP.byArtist(life), 100, 'plays');
    const lifeTrk = SP.topN(SP.byTrack(life), 100, 'plays');
    const artRank = new Map(); lifeArt.forEach((a, i) => artRank.set(a.key, i + 1));
    const trkRank = new Map(); lifeTrk.forEach((t, i) => trkRank.set(t.key, i + 1));
    // discovery year per artist/track (global firsts)
    const hofByYear = new Map();
    for (let i = 0; i < SP.n; i++) {
      if (!firstArtist[i] && !firstTrack[i]) continue;
      const y = SP.year[i];
      let e = hofByYear.get(y);
      if (!e) { e = { artists: [], tracks: [] }; hofByYear.set(y, e); }
      if (firstArtist[i]) {
        const a = SP.artistIdOf(i);
        if (artRank.has(a)) e.artists.push({ id: a, rank: artRank.get(a) });
      }
      if (firstTrack[i]) {
        const tr = SP.trackIdOf(i);
        if (trkRank.has(tr)) e.tracks.push({ id: tr, rank: trkRank.get(tr) });
      }
    }
    const hofBox = el('ds-hof'); hofBox.innerHTML = '';
    Array.from(hofByYear.keys()).sort((a, b) => a - b).forEach(y => {
      const e = hofByYear.get(y);
      e.artists.sort((a, b) => a.rank - b.rank);
      e.tracks.sort((a, b) => a.rank - b.rank);
      const aB = e.artists.slice(0, 4).map(x => `<span class="hof-b" title="lifetime artist #${x.rank}">${esc(d.artists[x.id])} <small>#${x.rank}</small></span>`).join('');
      const tB = e.tracks.slice(0, 3).map(x => `<span class="hof-b trk" title="${esc(d.trackName[x.id])} — lifetime track #${x.rank}">${esc(d.trackName[x.id])} <small>#${x.rank}</small></span>`).join('');
      if (!aB && !tB) return;
      hofBox.appendChild(h(`<div class="hof-year"><div class="hof-y">${y}</div><div class="hof-badges">${aB}${tB}</div></div>`));
    });

    /* ---- time machine ---- */
    const yl = SP.buildSubsetCustom({ year: 'all' });
    const ylMin = SP.monthKey[yl[0]], ylMax = SP.monthKey[yl[yl.length - 1]];
    const sel = el('ds-tm-select');
    sel.innerHTML = '';
    for (let mk = ylMax; mk >= ylMin; mk--) {
      const o = document.createElement('option');
      o.value = mk;
      o.textContent = `${SP.MONTHS[mk % 12]} ${SP.BASE_YEAR + Math.floor(mk / 12)}`;
      sel.appendChild(o);
    }
    if (tmMonth == null || tmMonth < ylMin || tmMonth > ylMax) {
      // default to the biggest month in scope
      let best = ylMin, bv = -1;
      playsM.forEach((v, mk) => { if (v > bv) { bv = v; best = mk; } });
      tmMonth = best;
    }
    sel.value = String(tmMonth);
    sel.onchange = () => { tmMonth = +sel.value; renderTimeMachine(); };
    renderTimeMachine();
    return true;
  }

  function renderTimeMachine() {
    const d = SP.d, metric = SP.filter.metric;
    const yl = SP.buildSubsetCustom({ year: 'all' });
    const idx = [];
    for (let j = 0; j < yl.length; j++) { if (SP.monthKey[yl[j]] === tmMonth) idx.push(yl[j]); }
    const mSub = Uint32Array.from(idx);
    const stats = el('ds-tm-stats'); stats.innerHTML = '';
    const aBox = el('ds-tm-artists'); aBox.innerHTML = '';
    const tBox = el('ds-tm-tracks'); tBox.innerHTML = '';
    if (!mSub.length) {
      stats.innerHTML = '<div class="sl"><div class="k">This month</div><div class="v">silence</div></div>';
      return;
    }
    let ms = 0; for (let j = 0; j < mSub.length; j++) ms += d.ms[mSub[j]];
    stats.appendChild(h(`<div class="sl"><div class="k">Hours</div><div class="v">${SP.fmtInt(ms / MSH)}</div></div>`));
    stats.appendChild(h(`<div class="sl"><div class="k">Plays</div><div class="v">${SP.fmtInt(mSub.length)}</div></div>`));
    SP.topN(SP.byArtist(mSub), 5, metric).forEach((a, i) => {
      aBox.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(d.artists[a.key])}">${esc(d.artists[a.key])}</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(a.ms / MSH) + '<small> h</small>' : SP.fmtInt(a.plays) + '<small> pl</small>'}</div></div>`));
    });
    SP.topN(SP.byTrack(mSub), 5, metric).forEach((t, i) => {
      tBox.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[t.key])}">${esc(d.trackName[t.key])}</div>
        <div class="mini-sub">${esc(d.artists[d.trackArtist[t.key]])}</div></div>
        <div class="mini-val">${metric === 'hours' ? SP.fmt1(t.ms / MSH) + '<small> h</small>' : SP.fmtInt(t.plays) + '<small> pl</small>'}</div></div>`));
    });
  }

  /* ============================================================
     ERAS 2.0 — generalized detection: artist / genre / mood-quadrant,
     live threshold + min-duration controls, detail cards, chapters
     ============================================================ */
  const MOODQ = [
    { name: 'Happy bangers', color: '#1ED760' },   // v≥50 e≥50
    { name: 'Soft & sunny', color: '#FFB347' },    // v≥50 e<50
    { name: 'Turbulent', color: '#F45B5B' },       // v<50 e≥50
    { name: 'Sad & slow', color: '#7CC4FF' },      // v<50 e<50
  ];
  function quadOf(i) {
    const d = SP.d, en = SP.en;
    if (!en || d.ty[i] !== 0) return -1;
    const tr = d.tr[i], v = en.trackValence[tr], e = en.trackEnergy[tr];
    if (v < 0 || e < 0) return -1;
    return (v >= 50 ? 0 : 2) + (e >= 50 ? 0 : 1);
  }
  function eraKeyOf(level) {
    if (level === 'genre') return SP.umbrellaOf;
    if (level === 'mood') return quadOf;
    return SP.artistIdOf;
  }
  function eraNameOf(level, key) {
    if (level === 'genre') return SP.genreName(key);
    if (level === 'mood') return MOODQ[key].name;
    return SP.d.artists[key];
  }
  function eraColorOf(level, key, idx) {
    if (level === 'genre') return SP.genreColor(key);
    if (level === 'mood') return MOODQ[key].color;
    const COLORS = ['#1ED760', '#34D3EB', '#FF6B9D', '#FFB347', '#C792EA', '#7CC4FF'];
    return COLORS[idx % COLORS.length];
  }

  function mountEraControls() {
    const th = el('era-th'), du = el('era-dur');
    th.value = eraTh; du.value = eraDur;
    const sync = () => {
      el('era-th-val').textContent = eraTh + '%';
      el('era-dur-val').textContent = eraDur + 'd';
      el('ds-era-hint').textContent = `an era = one ${eraLevel === 'mood' ? 'mood' : eraLevel} at ≥ ${eraTh}% of your listening for ≥ ${eraDur} days`;
      root.querySelectorAll('.ctlrow .seg [data-lv]').forEach(b => b.classList.toggle('on', b.dataset.lv === eraLevel));
      root.querySelectorAll('.ctlrow .seg [data-vw]').forEach(b => b.classList.toggle('on', b.dataset.vw === eraView));
    };
    const kick = () => { clearTimeout(eraDebounce); eraDebounce = setTimeout(() => { eraSel = -1; renderEras(); }, 160); };
    th.oninput = () => { eraTh = +th.value; sync(); kick(); };
    du.oninput = () => { eraDur = +du.value; sync(); kick(); };
    root.querySelectorAll('.ctlrow .seg [data-lv]').forEach(b => {
      b.onclick = () => { if (eraLevel !== b.dataset.lv) { eraLevel = b.dataset.lv; eraSel = -1; sync(); renderEras(); } };
    });
    root.querySelectorAll('.ctlrow .seg [data-vw]').forEach(b => {
      b.onclick = () => { if (eraView !== b.dataset.vw) { eraView = b.dataset.vw; sync(); renderEras(); } };
    });
    sync();
  }

  function detectEras() {
    const sub = SP.subset;
    const keyOf = eraKeyOf(eraLevel);
    const { mkMin, mkMax } = monthRange(sub);
    const mks = mkList(mkMin, mkMax);
    const monthly = new Map(); // mk -> Map<key, plays>
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], key = keyOf(i);
      if (key < 0) continue;
      const mk = SP.monthKey[i];
      let m = monthly.get(mk);
      if (!m) { m = new Map(); monthly.set(mk, m); }
      m.set(key, (m.get(key) || 0) + 1);
    }
    const T = eraTh / 100, SUSTAIN = T * 0.8, DIP = T * 0.48;
    const minMonths = Math.max(1, Math.round(eraDur / 30.44));
    const shareOf = (mk, key) => {
      const m = monthly.get(mk);
      if (!m) return { share: 0, n: 0 };
      let n = 0; m.forEach(v => n += v);
      return { share: n ? (m.get(key) || 0) / n : 0, n };
    };
    const monthTop = mks.map(mk => {
      const m = monthly.get(mk);
      if (!m) return null;
      let n = 0, best = null, bv = -1;
      m.forEach(v => n += v);
      m.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      return n >= 20 ? { key: best, share: bv / n } : null;
    });
    const runs = [];
    let run = null;
    for (let k = 0; k < mks.length; k++) {
      const mt = monthTop[k];
      if (run) {
        const { share, n } = shareOf(mks[k], run.key);
        if (n >= 20 && share >= SUSTAIN) { run.end = k; run.shares.push(share); run.dipped = false; continue; }
        if (n >= 20 && share >= DIP && !run.dipped) { run.dipped = true; continue; }
        run = null;
      }
      if (mt && mt.share >= T) { run = { key: mt.key, start: k, end: k, shares: [mt.share], dipped: false }; runs.push(run); }
    }
    const bands = runs.filter(e => e.end - e.start + 1 >= minMonths).map(e => ({
      key: e.key, mkStart: mks[e.start], mkEnd: mks[e.end],
      share: e.shares.reduce((a, b) => a + b, 0) / e.shares.length,
    }));
    // era stats in one pass: ms/plays per era + track tallies + successor month keys
    const d = SP.d, en = SP.en;
    bands.forEach(b => { b.ms = 0; b.plays = 0; b.windowMs = 0; b.tracks = new Map(); b.firstMonthTracks = new Map(); b.valMs = 0; b.val = 0; b.eng = 0; b.sentMs = 0; b.sent = 0; });
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j], mk = SP.monthKey[i], key = keyOf(i);
      for (const b of bands) {
        if (mk < b.mkStart || mk > b.mkEnd) continue;
        b.windowMs += d.ms[i];
        if (key !== b.key) continue;
        b.ms += d.ms[i]; b.plays++;
        const tr = SP.trackIdOf(i);
        if (tr > 0) {
          b.tracks.set(tr, (b.tracks.get(tr) || 0) + d.ms[i]);
          if (mk === b.mkStart) b.firstMonthTracks.set(tr, (b.firstMonthTracks.get(tr) || 0) + 1);
          if (en) {
            const v = en.trackValence[tr], e2 = en.trackEnergy[tr];
            if (v >= 0) { b.valMs += d.ms[i]; b.val += v * d.ms[i]; b.eng += e2 * d.ms[i]; }
            if (en.lyrWords[tr] >= 0) { b.sentMs += d.ms[i]; b.sent += en.lyrSent[tr] * d.ms[i]; }
          }
        }
      }
    }
    // what ended each era: top key of the month after the era, at the same level
    bands.forEach(b => {
      const m = monthly.get(b.mkEnd + 1);
      b.next = null;
      if (m) {
        let best = null, bv = -1;
        m.forEach((v, k) => { if (k !== b.key && v > bv) { bv = v; best = k; } });
        if (best != null) b.next = best;
      }
    });
    return { bands, mkMin, mkMax, span: mks.length };
  }

  function renderEras() {
    const erasBox = el('ds-eras');
    if (!erasBox) return;
    const detail = el('ds-era-detail'); detail.innerHTML = '';
    erasBox.innerHTML = '';
    const { bands, mkMin, mkMax, span } = detectEras();
    if (!bands.length) {
      erasBox.innerHTML = `<div class="empty" style="min-height:110px"><div>No ${eraLevel} held ≥ ${eraTh}% for ${eraDur}+ days in this scope — try a lower threshold.</div></div>`;
      return;
    }
    if (eraView === 'chapters') {
      const wrap = h('<div class="chapters"></div>');
      bands.forEach((b, i) => {
        const name = eraNameOf(eraLevel, b.key);
        const c = eraColorOf(eraLevel, b.key, i);
        const months = b.mkEnd - b.mkStart + 1;
        let trig = null, tv = -1;
        b.firstMonthTracks.forEach((v, tr) => { if (v > tv) { tv = v; trig = tr; } });
        const nextTxt = b.next != null ? `gave way to ${eraNameOf(eraLevel, b.next)}` : 'still going as the record ends';
        const chap = h(`<div class="chap" data-era="${i}" role="button" tabindex="0">
          <div class="chap-dot" style="border-color:${c}"></div>
          <div class="chap-k">Chapter ${i + 1} · ${SP.monthKeyLabel(b.mkStart, true)} → ${SP.monthKeyLabel(b.mkEnd, true)}</div>
          <div class="chap-t">The ${esc(name)} Era</div>
          <div class="chap-s">${months} month${months > 1 ? 's' : ''} at ${Math.round(b.share * 100)}% of everything you played${trig != null ? ` — it opened with <b>${esc(SP.d.trackName[trig])}</b>` : ''}, and ${nextTxt}.</div>
          <div class="chap-m">${SP.fmtInt(b.ms / MSH)} hours · ${SP.fmtInt(b.plays)} plays · click for the full story</div>
        </div>`);
        chap.addEventListener('click', () => { eraSel = eraSel === i ? -1 : i; renderEraDetail(bands, i); });
        wrap.appendChild(chap);
      });
      erasBox.appendChild(wrap);
    } else {
      const lane = h('<div class="era-lane"></div>');
      bands.forEach((b, i) => {
        const c = eraColorOf(eraLevel, b.key, i);
        const name = eraNameOf(eraLevel, b.key);
        const l = Math.min(((b.mkStart - mkMin) / span) * 100, 95.5);
        const w = Math.max(((b.mkEnd - b.mkStart + 1) / span) * 100, 4.5);
        const band = h(`<div class="era-band ${eraSel === i ? 'sel' : ''}" data-era="${i}" role="button" tabindex="0"
          style="left:${l}%;width:${w}%;background:${SP.rgba(c, 0.16)};border:1px solid ${SP.rgba(c, 0.55)}"
          title="The ${esc(name)} Era · ${SP.monthKeyLabel(b.mkStart, true)} – ${SP.monthKeyLabel(b.mkEnd, true)} · click for detail">
          <div class="en">${esc(name)}</div><div class="ed">${Math.round(b.share * 100)}%</div></div>`);
        band.addEventListener('click', () => { eraSel = eraSel === i ? -1 : i; lane.querySelectorAll('.era-band').forEach((n, k) => n.classList.toggle('sel', k === eraSel)); renderEraDetail(bands, eraSel); });
        band.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); band.click(); } });
        lane.appendChild(band);
      });
      erasBox.appendChild(lane);
      const ticks = h('<div class="era-ticks"></div>');
      for (let mk = Math.ceil(mkMin / 12) * 12; mk <= mkMax; mk += 12) {
        ticks.appendChild(h(`<div class="era-tick" style="left:${((mk - mkMin) / span) * 100}%">${SP.BASE_YEAR + mk / 12}</div>`));
      }
      erasBox.appendChild(ticks);
      const list = h('<div class="era-list"></div>');
      bands.forEach((b, i) => {
        const c = eraColorOf(eraLevel, b.key, i);
        const line = h(`<div class="era-line" data-era="${i}" style="cursor:pointer"><span class="dot" style="background:${c}"></span>
          <span><b>The ${esc(eraNameOf(eraLevel, b.key))} Era</b> — ${SP.monthKeyLabel(b.mkStart, true)} to ${SP.monthKeyLabel(b.mkEnd, true)}</span>
          <span class="mono">avg ${Math.round(b.share * 100)}% · ${SP.fmtInt(b.ms / MSH)} h</span></div>`);
        line.addEventListener('click', () => { eraSel = i; renderEraDetail(bands, i); });
        list.appendChild(line);
      });
      erasBox.appendChild(list);
    }
    if (eraSel >= 0 && eraSel < bands.length) renderEraDetail(bands, eraSel);
  }

  function renderEraDetail(bands, i) {
    const box = el('ds-era-detail');
    box.innerHTML = '';
    if (i < 0 || i >= bands.length) return;
    const d = SP.d, b = bands[i];
    const c = eraColorOf(eraLevel, b.key, i);
    const name = eraNameOf(eraLevel, b.key);
    const months = b.mkEnd - b.mkStart + 1;
    const shareOfWindow = b.windowMs ? (b.ms / b.windowMs) * 100 : 0;
    let trig = null, tv = -1;
    b.firstMonthTracks.forEach((v, tr) => { if (v > tv) { tv = v; trig = tr; } });
    const top5 = Array.from(b.tracks.entries()).sort((a, z) => z[1] - a[1]).slice(0, 5);
    const moodTxt = b.valMs > 0
      ? `${Math.round(b.val / b.valMs)} valence · ${Math.round(b.eng / b.valMs)} energy`
      : null;
    const sentTxt = b.sentMs > b.ms * 0.3 ? `${b.sent / b.sentMs > 0 ? '+' : ''}${Math.round(b.sent / b.sentMs)} lyric sentiment` : null;
    box.appendChild(h(`<div class="era-detail" style="border-color:${SP.rgba(c, 0.45)}">
      <div class="ed-head">
        <div class="ed-title" style="color:${c}">The ${esc(name)} Era</div>
        <div class="ed-dates">${SP.monthKeyLabel(b.mkStart, true)} → ${SP.monthKeyLabel(b.mkEnd, true)} · ${months} month${months > 1 ? 's' : ''}</div>
      </div>
      <div>
        <div class="ed-facts" style="margin-bottom:var(--sp-3)">
          <div class="ed-fact"><div class="k">Hours</div><div class="v">${SP.fmtInt(b.ms / MSH)}</div></div>
          <div class="ed-fact"><div class="k">Share of window</div><div class="v">${SP.fmtPct(shareOfWindow)}</div></div>
          <div class="ed-fact"><div class="k">Trigger song</div><div class="v" style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trig != null ? esc(d.trackName[trig]) : '—'}</div></div>
          <div class="ed-fact"><div class="k">What ended it</div><div class="v">${b.next != null ? esc(eraNameOf(eraLevel, b.next)) + '<small> took over</small>' : 'nothing yet'}</div></div>
          ${moodTxt ? `<div class="ed-fact"><div class="k">Era mood</div><div class="v">${moodTxt}</div></div>` : ''}
          ${sentTxt ? `<div class="ed-fact"><div class="k">Era words</div><div class="v">${sentTxt}</div></div>` : ''}
        </div>
      </div>
      <div>
        <h5>The era's soundtrack</h5>
        <div class="mini">${top5.map(([tr, ms], k) => `<div class="mini-row"><div class="mini-rank">${k + 1}</div>
          <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[tr])} — ${esc(d.artists[d.trackArtist[tr]])}">${esc(d.trackName[tr])}</div>
          <div class="mini-sub">${esc(d.artists[d.trackArtist[tr]])}</div></div>
          <div class="mini-val">${SP.fmt1(ms / MSH)}<small> h</small></div></div>`).join('')}</div>
      </div>
    </div>`));
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ============================================================
     lifecycle
     ============================================================ */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Discovery &amp; Behavior</div>
        <h1 class="sec-title" id="bh-title"></h1>
        <p class="sec-sub" id="bh-sub"></p>
      </div>
    </div>
    <div class="subtabs reveal" role="tablist" aria-label="Discovery and behavior views">
      <button class="subtab" id="bh-tab-behavior" role="tab">Behavior</button>
      <button class="subtab" id="bh-tab-discovery" role="tab">Discovery</button>
    </div>
    <div id="bh-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      <div class="empty-t">Nothing here yet</div><div>No plays match the current filters.</div>
    </div></div></div>
    <div id="bh-pane"></div>`;
  }

  function fill() {
    const isB = tab === 'behavior';
    el('bh-title').textContent = isB ? 'How you press play' : 'How your taste moves';
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    const scopeArtist = SP.filter.artist != null ? SP.d.artists[SP.filter.artist] : null;
    el('bh-sub').textContent = isB
      ? `Skips, reasons, shuffle, devices and places — ${scopeArtist ? scopeArtist + ', ' : ''}${yearTxt}.`
      : `Discoveries, diversity and eras — ${scopeArtist ? scopeArtist + ', ' : ''}${yearTxt}.`;
    el('bh-tab-behavior').classList.toggle('on', isB);
    el('bh-tab-discovery').classList.toggle('on', !isB);
    el('bh-tab-behavior').setAttribute('aria-selected', String(isB));
    el('bh-tab-discovery').setAttribute('aria-selected', String(!isB));

    const pane = el('bh-pane');
    SP.disposeChartsIn(pane);
    const hasData = SP.subset.length > 0;
    el('bh-empty').hidden = hasData;
    if (!hasData) { pane.innerHTML = ''; return; }
    pane.innerHTML = isB ? behaviorSkeleton() : discoverySkeleton();
    const ok = isB ? fillBehavior() : fillDiscovery();
    if (!ok) { pane.innerHTML = ''; el('bh-empty').hidden = false; }
    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.behavior = {
    render(container) {
      root = container;
      root.innerHTML = skeleton();
      el('bh-tab-behavior').addEventListener('click', () => { if (tab !== 'behavior') { tab = 'behavior'; fill(); } });
      el('bh-tab-discovery').addEventListener('click', () => { if (tab !== 'discovery') { tab = 'discovery'; fill(); } });
      fill();
      return root.querySelectorAll('.reveal');
    },
    update() { if (root) fill(); },
    dispose() { if (root) SP.disposeChartsIn(root); root = null; },
  };
})();
