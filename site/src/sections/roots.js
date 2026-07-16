/* ============================================================
   SOUNDPRINT — sections/roots.js  (Phase B2)
   Roots & Rarity: artist origins (flags + city cluster) · artist vintage ·
   release-decade / song-age nostalgia suite · new-release adoption ·
   mainstream meter (fans, obscurity, hipster index)
   NOTE: origin "map" is a DOM leaderboard + city breakout by design —
   a world choropleth of a 90%-US library reads as one green blob and
   costs ~200 KB of GeoJSON; the ranked view tells the story better.
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let root = null, s = null;

  /* MusicBrainz "area" is sometimes a state/city/historic entity — canonicalize */
  const ALIAS = {
    'England': 'United Kingdom', 'Scotland': 'United Kingdom', 'Wales': 'United Kingdom',
    'Northern Ireland': 'United Kingdom', 'United Kingdom of Great Britain and Ireland': 'United Kingdom',
    'Kingdom of Great Britain': 'United Kingdom', 'Kingdom of England': 'United Kingdom',
    'Philadelphia': 'United States', 'New Jersey': 'United States', 'Montgomery': 'United States',
    'Hawaii': 'United States', 'Columbus': 'United States', 'Pittsburgh': 'United States',
    'Puerto Rico': 'United States', 'Alberta': 'Canada',
    'Cisleithania': 'Austria', 'Austria–Hungary': 'Austria', 'Prince-Archbishopric of Salzburg': 'Austria',
    'Kingdom of the Netherlands': 'Netherlands', 'Habsburg Netherlands': 'Netherlands', 'Southern Netherlands': 'Netherlands',
    'Republic of Venice': 'Italy', 'Ancient Rome': 'Italy',
    'Later Zhao': 'China', 'Song dynasty': 'China', "People's Republic of China": 'China',
    'Kingdom of Denmark': 'Denmark',
  };
  const ISO = {
    'United States': 'US', 'United Kingdom': 'GB', 'Canada': 'CA', 'Ireland': 'IE', 'Australia': 'AU',
    'Sweden': 'SE', 'Germany': 'DE', 'Japan': 'JP', 'Trinidad and Tobago': 'TT', 'France': 'FR',
    'Iceland': 'IS', 'Russia': 'RU', 'Croatia': 'HR', 'South Korea': 'KR', 'Taiwan': 'TW',
    'Colombia': 'CO', 'China': 'CN', 'Denmark': 'DK', 'Argentina': 'AR', 'Spain': 'ES',
    'Philippines': 'PH', 'South Africa': 'ZA', 'Belgium': 'BE', 'Romania': 'RO', 'Norway': 'NO',
    'Netherlands': 'NL', 'Dominican Republic': 'DO', 'Italy': 'IT', 'Poland': 'PL', 'Jamaica': 'JM',
    'Syria': 'SY', 'New Zealand': 'NZ', 'Indonesia': 'ID', 'Uganda': 'UG', 'Mexico': 'MX',
    'India': 'IN', 'Brazil': 'BR', 'Panama': 'PA', 'Finland': 'FI', 'Estonia': 'EE', 'Armenia': 'AM',
    'Grenada': 'GD', 'Austria': 'AT', 'Nigeria': 'NG', 'Egypt': 'EG', 'Ukraine': 'UA', 'Ecuador': 'EC',
    'Guatemala': 'GT', 'Switzerland': 'CH', 'The Bahamas': 'BS', 'Moldova': 'MD', 'Saudi Arabia': 'SA',
  };
  const FLAG = iso => iso ? String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '🌐';

  function firstFlags() {
    if (SP._firstFlags) return SP._firstFlags;
    const d = SP.d, n = SP.n;
    const firstTrack = new Uint8Array(n), firstArtist = new Uint8Array(n);
    const seenT = new Uint8Array(d.trackName.length), seenA = new Uint8Array(d.artists.length);
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

  /* ---------------- compute ---------------- */
  function compute() {
    const d = SP.d, en = SP.en, sub = SP.subset;
    const st = { n: sub.length };
    if (!sub.length || !en) return st;
    const { firstTrack } = firstFlags();

    const artMs = new Map();               // artist -> ms (music, in scope)
    const decadeMs = new Map();            // release decade -> ms
    const ageDist = new Float64Array(61);  // age (yrs, cap 60) -> ms
    const monthAges = new Map();           // mk -> Map<age, ms>  (weighted median)
    const monthFans = new Map();           // mk -> {ms, logSum}
    const fanBuckets = new Float64Array(5);// <10k, 10-100k, 100k-1M, 1-5M, 5M+
    let yrMs = 0, totMs = 0, fansMs = 0, fansLogSum = 0;
    const fanSamples = [];                 // [logFans, ms] for weighted median
    const adopt = new Map();               // deltaYears -> count (first plays)
    const fastest = [];                    // same-year first plays
    let firstN = 0, sameYear = 0;

    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i], ms = d.ms[i], a = d.trackArtist[tr];
      totMs += ms;
      if (a > 0) artMs.set(a, (artMs.get(a) || 0) + ms);

      // release year facets
      const ry = en.trackYear[tr];
      if (ry > 0) {
        yrMs += ms;
        const dec = Math.floor(ry / 10) * 10;
        decadeMs.set(dec, (decadeMs.get(dec) || 0) + ms);
        const py = SP.year[i] + SP.month[i] / 12;
        let age = py - ry;
        if (age < 0) age = 0;
        const ageB = Math.min(60, Math.round(age));
        ageDist[ageB] += ms;
        const mk = SP.monthKey[i];
        let ma = monthAges.get(mk);
        if (!ma) { ma = new Map(); monthAges.set(mk, ma); }
        ma.set(ageB, (ma.get(ageB) || 0) + ms);
        // adoption (true first-ever plays only)
        if (firstTrack[i]) {
          firstN++;
          const dy = Math.max(0, SP.year[i] - ry);
          adopt.set(dy, (adopt.get(dy) || 0) + 1);
          // fastest list: iTunes-sourced years only (exact release years; deezer/isrc
          // are era-proxies and produce spurious "same-year" hits)
          if (dy === 0) { sameYear++; if (en.trackYearSrc[tr] === 0) fastest.push({ tr, dk: SP.dayKey[i], ry, src: 0 }); }
        }
      }
      // popularity facets
      const fans = a > 0 ? en.artistFans[a] : -1;
      if (fans > 0) {
        const lg = Math.log10(fans);
        fansMs += ms; fansLogSum += lg * ms;
        fanSamples.push([lg, ms]);
        const b = fans < 1e4 ? 0 : fans < 1e5 ? 1 : fans < 1e6 ? 2 : fans < 5e6 ? 3 : 4;
        fanBuckets[b] += ms;
        const mk = SP.monthKey[i];
        let mf = monthFans.get(mk);
        if (!mf) { mf = { ms: 0, logSum: 0 }; monthFans.set(mk, mf); }
        mf.ms += ms; mf.logSum += lg * ms;
      }
    }
    if (!totMs) return { n: sub.length, noMusic: true };
    st.totMs = totMs;

    // ---- origins ----
    const ctyMs = new Map(); let ctyCov = 0;
    const cityMs = new Map(); // cityIdx -> {ms, topA, topMs}
    artMs.forEach((ms, a) => {
      const c = en.artistCountry[a];
      if (c >= 0) {
        const name = ALIAS[en.countries[c]] || en.countries[c];
        ctyMs.set(name, (ctyMs.get(name) || 0) + ms);
        ctyCov += ms;
      }
      const ci = en.artistCity[a];
      if (ci >= 0) {
        let e = cityMs.get(ci);
        if (!e) { e = { ms: 0, topA: a, topMs: 0 }; cityMs.set(ci, e); }
        e.ms += ms;
        if (ms > e.topMs) { e.topMs = ms; e.topA = a; }
      }
    });
    st.origins = Array.from(ctyMs.entries()).map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);
    st.originCov = (ctyCov / totMs) * 100;
    st.cities = Array.from(cityMs.entries()).map(([ci, e]) => ({ city: en.cities[ci], ms: e.ms, topA: e.topA })).sort((a, b) => b.ms - a.ms).slice(0, 16);

    // ---- vintage ----
    const vinMs = new Map(); let vinTot = 0;
    const vinSamples = [];
    artMs.forEach((ms, a) => {
      const y = en.artistYear[a];
      if (y > 1900) {
        const dec = Math.floor(y / 10) * 10;
        vinMs.set(dec, (vinMs.get(dec) || 0) + ms);
        vinTot += ms;
        vinSamples.push([y, ms]);
      }
    });
    st.vintage = Array.from(vinMs.entries()).sort((a, b) => a[0] - b[0]);
    vinSamples.sort((a, b) => a[0] - b[0]);
    let acc = 0; st.vinMedian = null;
    for (const [y, ms] of vinSamples) { acc += ms; if (acc >= vinTot / 2) { st.vinMedian = y; break; } }
    st.vinTopDec = st.vintage.length ? st.vintage.slice().sort((a, b) => b[1] - a[1])[0][0] : null;
    st.vinShare = st.vinTopDec != null ? (vinMs.get(st.vinTopDec) / vinTot) * 100 : 0;

    // ---- decades ----
    st.decades = Array.from(decadeMs.entries()).sort((a, b) => a[0] - b[0]);
    st.yrCov = (yrMs / totMs) * 100;

    // ---- age over time (weighted median per month) ----
    st.mkMin = SP.monthKey[sub[0]]; st.mkMax = SP.monthKey[sub[sub.length - 1]];
    const mks = []; for (let mk = st.mkMin; mk <= st.mkMax; mk++) mks.push(mk);
    st.mks = mks;
    st.medAge = mks.map(mk => {
      const ma = monthAges.get(mk);
      if (!ma) return null;
      let tot = 0; ma.forEach(v => tot += v);
      if (tot < 3 * MSH) return null;
      const ages = Array.from(ma.entries()).sort((a, b) => a[0] - b[0]);
      let ac = 0;
      for (const [age, ms] of ages) { ac += ms; if (ac >= tot / 2) return age; }
      return null;
    });
    // headline: per-year weighted mean age
    const yearAge = new Map();
    monthAges.forEach((ma, mk) => {
      const y = SP.BASE_YEAR + Math.floor(mk / 12);
      let e = yearAge.get(y); if (!e) { e = { ms: 0, sum: 0 }; yearAge.set(y, e); }
      ma.forEach((ms, age) => { e.ms += ms; e.sum += age * ms; });
    });
    st.yearAge = yearAge;

    // ---- age distribution ----
    st.ageDist = ageDist;

    // ---- adoption ----
    st.adopt = adopt; st.firstN = firstN;
    st.sameYearPct = firstN ? (sameYear / firstN) * 100 : 0;
    fastest.sort((a, b) => a.dk - b.dk);
    // dedupe: earliest per track already guaranteed (first plays); keep top 8 by earliest in-year day
    st.fastest = fastest.sort((a, b) => (a.dk - Math.floor(Date.UTC(a.ry, 0, 1) / 86400000)) - (b.dk - Math.floor(Date.UTC(b.ry, 0, 1) / 86400000))).slice(0, 8);

    // ---- oldest favorites ----
    const trkAgg = new Map();
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i];
      let e = trkAgg.get(tr); if (!e) { e = { ms: 0, plays: 0 }; trkAgg.set(tr, e); }
      e.ms += d.ms[i]; e.plays++;
    }
    const olds = [];
    trkAgg.forEach((e, tr) => { const ry = en.trackYear[tr]; if (ry > 0 && e.plays >= 10) olds.push({ tr, ry, plays: e.plays, ms: e.ms, src: en.trackYearSrc[tr] }); });
    st.oldest = olds.sort((a, b) => a.ry - b.ry || b.plays - a.plays).slice(0, 8);

    // ---- mainstream meter ----
    st.fanBuckets = fanBuckets; st.fansMs = fansMs;
    st.avgLog = fansMs ? fansLogSum / fansMs : 0;
    fanSamples.sort((a, b) => a[0] - b[0]);
    let fa = 0; st.medFans = null;
    for (const [lg, ms] of fanSamples) { fa += ms; if (fa >= fansMs / 2) { st.medFans = Math.pow(10, lg); break; } }
    const MAXLOG = 7.4; // ~25M fans, biggest act on Deezer's scale in this library
    st.obscurity = Math.max(0, Math.min(100, (1 - st.avgLog / MAXLOG) * 100));
    st.hipster = mks.map(mk => {
      const mf = monthFans.get(mk);
      return mf && mf.ms > 5 * MSH ? +(((1 - (mf.logSum / mf.ms) / MAXLOG)) * 100).toFixed(1) : null;
    });

    const favArts = [];
    artMs.forEach((ms, a) => { const f = en.artistFans[a]; if (ms >= 3 * MSH && f > 0) favArts.push({ a, ms, fans: f }); });
    st.obscureFavs = favArts.slice().sort((a, b) => a.fans - b.fans).slice(0, 8);
    st.mainstreamFavs = favArts.slice().sort((a, b) => b.fans - a.fans).slice(0, 8);

    return st;
  }

  /* ---------------- skeleton ---------------- */
  function skeleton() {
    return `
    <div class="sec-head reveal">
      <div>
        <div class="sec-eyebrow">Roots &amp; Rarity</div>
        <h1 class="sec-title">Where your music comes from</h1>
        <p class="sec-sub" id="rt-sub"></p>
      </div>
    </div>
    <div class="cov-hint reveal"><span class="gdot"></span> origins & vintages from MusicBrainz/Wikidata · release years ≈ era-proxies when marked · popularity = Deezer fans</div>
    <div id="rt-empty" hidden><div class="card"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
      <div class="empty-t">No roots to trace</div><div>No music plays match the current filters.</div>
    </div></div></div>
    <div id="rt-body">
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Artist origins</div><div class="card-hint" id="rt-org-hint"></div></div>
          <div id="rt-origins"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">The city cluster</div><div class="card-hint">hometowns of your top-100 artists</div></div>
          <p class="sec-sub" style="margin:0 0 var(--sp-4);font-size:0.875rem" id="rt-city-copy"></p>
          <div class="citychips" id="rt-cities"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Artist vintage</div><div class="card-hint" id="rt-vin-hint"></div></div>
          <div class="chart" id="rt-vintage"></div>
        </div></div>
        <div class="c6 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Listening by release decade</div><div class="card-hint" id="rt-dec-hint"></div></div>
          <div class="chart" id="rt-decades"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c8 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">How old is the music you play?</div><div class="card-hint" id="rt-age-hint"></div></div>
          <div class="chart" id="rt-medage"></div>
        </div></div>
        <div class="c4 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Song-age distribution</div><div class="card-hint">listening time by age at play</div></div>
          <div class="chart" id="rt-agedist"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">New-release adoption</div><div class="card-hint" id="rt-adopt-hint"></div></div>
          <div class="statline" id="rt-adopt-stats"></div>
          <div class="chart short" id="rt-adopt" style="height:190px"></div>
          <div class="card-hint" style="margin:10px 0 4px">fastest same-year finds</div>
          <div class="mini" id="rt-fastest"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Oldest favorites</div><div class="card-hint">≥ 10 plays · ≈ marks era-proxy years</div></div>
          <div class="mini" id="rt-oldest"></div>
        </div></div>
      </div>
      <div class="grid" style="margin-bottom:var(--sp-6)">
        <div class="c7 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Mainstream meter</div><div class="card-hint">listening time by artist fanbase size (Deezer fans)</div></div>
          <div class="statline" id="rt-obs-stats"></div>
          <div class="chart short" id="rt-fans" style="height:210px"></div>
        </div></div>
        <div class="c5 reveal"><div class="card hoverable" style="height:100%">
          <div class="card-head"><div class="card-title">Deep cuts vs headliners</div><div class="card-hint">favorites (≥ 3 h) at the extremes</div></div>
          <div class="duo" id="rt-favs"></div>
        </div></div>
      </div>
      <div class="grid">
        <div class="c12 reveal"><div class="card hoverable">
          <div class="card-head"><div class="card-title">Hipster index</div><div class="card-hint">100 = unknown basement acts · 0 = stadium headliners · time-weighted monthly</div></div>
          <div class="chart" id="rt-hipster"></div>
        </div></div>
      </div>
    </div>`;
  }

  /* ---------------- fill ---------------- */
  function fill() {
    s = compute();
    const empty = !s.n || s.noMusic || !SP.en;
    el('rt-empty').hidden = !empty;
    el('rt-body').hidden = empty;
    const yearTxt = SP.filter.year === 'all' ? 'all time' : SP.filter.year;
    if (empty) { el('rt-sub').textContent = 'No music plays match the current filters.'; return; }
    const d = SP.d, en = SP.en;

    el('rt-sub').textContent = `Hometowns, vintages, decades and how deep into the catalog you really go — ${yearTxt}.`;

    /* origins */
    el('rt-org-hint').textContent = `covers ${SP.fmtPct(s.originCov)} of listening · ${s.origins.length} countries`;
    const org = el('rt-origins'); org.innerHTML = '';
    const top = s.origins[0] ? s.origins[0].ms : 1;
    s.origins.slice(0, 12).forEach(o => {
      const pct = (o.ms / s.totMs) * 100;
      org.appendChild(h(`<div class="org-row">
        <div class="org-flag">${FLAG(ISO[o.name])}</div>
        <div style="min-width:0"><div class="org-name">${esc(o.name)}</div>
          <div class="org-bar-track"><div class="org-bar" style="width:${(o.ms / top) * 100}%"></div></div></div>
        <div class="org-val">${SP.fmtInt(o.ms / MSH)} h<small>${SP.fmtPct(pct, pct < 10 ? 1 : 0)} of time</small></div>
      </div>`));
    });

    /* cities */
    const nash = s.cities.find(c => /nashville/i.test(c.city));
    el('rt-city-copy').innerHTML = s.cities.length
      ? `The pins cluster hard around the American South — Tennessee, the Carolinas, Georgia, Texas${nash ? ', with <b style="color:var(--accent)">Nashville</b> pulling like a magnet' : ''}. Your library has a home address.`
      : 'Not enough hometown data in this scope.';
    const cbox = el('rt-cities'); cbox.innerHTML = '';
    s.cities.forEach((c, i) => {
      cbox.appendChild(h(`<div class="citychip ${i < 3 || /nashville/i.test(c.city) ? 'hot' : ''}" title="${esc(c.city)} — biggest: ${esc(d.artists[c.topA])}">
        <span class="cc-city">${esc(c.city)}</span>
        <span class="cc-sub">${esc(d.artists[c.topA])} · ${SP.fmtInt(c.ms / MSH)} h</span>
      </div>`));
    });

    /* vintage */
    el('rt-vin-hint').innerHTML = s.vinTopDec != null
      ? `your artists are mostly born in the <b style="color:var(--accent)">${s.vinTopDec}s</b> (${SP.fmtPct(s.vinShare)} of time) · median ${s.vinMedian}`
      : 'formation / birth year, weighted by hours';
    const vinLabels = s.vintage.map(([dec]) => dec + 's');
    SP.makeChart(el('rt-vintage'), {
      grid: { left: 8, right: 12, top: 18, bottom: 6, containLabel: true },
      tooltip: { formatter: p => `<b>${vinLabels[p.dataIndex]}</b> artists · ${SP.fmtInt(p.value)} h of your listening` },
      xAxis: { type: 'category', data: vinLabels, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 34,
        data: s.vintage.map(([dec, ms]) => ({ value: Math.round(ms / MSH), itemStyle: { color: dec === s.vinTopDec ? '#1ED760' : 'rgba(30,215,96,0.3)', borderRadius: [4, 4, 0, 0] } })),
      }],
    });

    /* decades donut */
    el('rt-dec-hint').textContent = `release year known for ${SP.fmtPct(s.yrCov)} of listening`;
    const DECC = ['#8FA396', '#7B8A99', '#C792EA', '#7CC4FF', '#FF6B9D', '#FFB347', '#34D3EB', '#1ED760', '#A7F432'];
    const decTotal = s.decades.reduce((a, [, ms]) => a + ms, 0) || 1;
    SP.makeChart(el('rt-decades'), {
      tooltip: { formatter: p => `<b>${p.name}</b> releases<br>${SP.fmtInt(p.value)} h · ${p.percent}% of dated listening` },
      series: [{
        type: 'pie', radius: ['46%', '72%'], center: ['50%', '52%'],
        label: { formatter: '{b}\n{d}%', color: '#AEB4A9', fontFamily: 'Manrope', fontSize: 10.5, fontWeight: 600, lineHeight: 15 },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        itemStyle: { borderColor: '#121513', borderWidth: 3, borderRadius: 6 },
        data: s.decades.filter(([, ms]) => ms / decTotal > 0.004).map(([dec, ms], k) => ({ name: dec + 's', value: Math.round(ms / MSH), itemStyle: { color: DECC[Math.min(DECC.length - 1, Math.max(0, (dec - 1940) / 10))] || DECC[k % DECC.length] } })),
      }],
    });

    /* median age over time */
    let headline = '';
    const midY = Array.from(s.yearAge.keys()).sort()[Math.floor(s.yearAge.size / 2)];
    if (midY != null) {
      const e = s.yearAge.get(midY);
      headline = `in ${midY} the music you played was on average ${SP.fmt1(e.sum / e.ms)} years old`;
    }
    el('rt-age-hint').textContent = `weighted median age of what you played · ${headline}`;
    SP.makeChart(el('rt-medage'), {
      grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div>median song age <b style="color:#1ED760">${ps[0].value} yr${ps[0].value === 1 ? '' : 's'}</b>` },
      xAxis: { type: 'category', data: s.mks.map(mk => SP.monthKeyLabel(mk, true)), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(s.mks.length / 12) - 1) }, SP.axisLabel) },
      yAxis: { type: 'value', axisLabel: Object.assign({ formatter: v => v + ' yr' }, SP.axisLabel), splitLine: SP.splitLine },
      series: [{
        type: 'line', data: s.medAge, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#FFB347' }, itemStyle: { color: '#FFB347' },
        areaStyle: { color: SP.areaGradient('#FFB347', 0.18, 0.01) },
      }],
    });

    /* age distribution */
    const ageLabels = [], ageVals = [];
    for (let a = 0; a <= 20; a++) { ageLabels.push(String(a)); ageVals.push(s.ageDist[a] / MSH); }
    let tail = 0; for (let a = 21; a <= 60; a++) tail += s.ageDist[a];
    ageLabels.push('21+'); ageVals.push(tail / MSH);
    const maxAgeIdx = ageVals.indexOf(Math.max(...ageVals));
    SP.makeChart(el('rt-agedist'), {
      grid: { left: 8, right: 10, top: 16, bottom: 22, containLabel: true },
      tooltip: { formatter: p => `<b>${ageLabels[p.dataIndex]} yr${ageLabels[p.dataIndex] === '1' ? '' : 's'} old</b> at play time<br>${SP.fmtInt(p.value)} h` },
      xAxis: { type: 'category', data: ageLabels, name: 'age (yrs)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: '#6B716A', fontFamily: 'JetBrains Mono', fontSize: 9 }, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({}, SP.axisLabel, { interval: 3 }) },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{ type: 'bar', barMaxWidth: 16, data: ageVals.map((v, k) => ({ value: Math.round(v), itemStyle: { color: k === maxAgeIdx ? '#1ED760' : 'rgba(30,215,96,0.3)', borderRadius: [3, 3, 0, 0] } })) }],
    });

    /* adoption */
    el('rt-adopt-hint').textContent = 'release dates are year-granular, so adoption is measured in release-year terms';
    el('rt-adopt-stats').innerHTML = `
      <div class="sl"><div class="k">First plays w/ dated release</div><div class="v">${SP.fmtInt(s.firstN)}</div></div>
      <div class="sl"><div class="k">Heard in its release year</div><div class="v" style="color:var(--accent)">${SP.fmtPct(s.sameYearPct)}</div></div>`;
    const adLabels = ['same yr', '1', '2', '3–5', '6–10', '11–20', '20+'];
    const adVals = [0, 0, 0, 0, 0, 0, 0];
    s.adopt.forEach((n, dy) => {
      const b = dy === 0 ? 0 : dy === 1 ? 1 : dy === 2 ? 2 : dy <= 5 ? 3 : dy <= 10 ? 4 : dy <= 20 ? 5 : 6;
      adVals[b] += n;
    });
    SP.makeChart(el('rt-adopt'), {
      grid: { left: 8, right: 10, top: 12, bottom: 4, containLabel: true },
      tooltip: { formatter: p => `first heard <b>${adLabels[p.dataIndex]}</b>${p.dataIndex ? ' yrs after release' : ' — the year it came out'}<br>${SP.fmtInt(p.value)} songs` },
      xAxis: { type: 'category', data: adLabels, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{ type: 'bar', barMaxWidth: 26, data: adVals.map((v, k) => ({ value: v, itemStyle: { color: k === 0 ? '#1ED760' : 'rgba(30,215,96,0.3)', borderRadius: [3, 3, 0, 0] } })) }],
    });
    const fbox = el('rt-fastest'); fbox.innerHTML = '';
    if (!s.fastest.length) fbox.innerHTML = '<div class="mini-sub" style="padding:8px 4px">No exact-dated same-year finds in this scope.</div>';
    s.fastest.forEach((f, i) => {
      fbox.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[f.tr])} — ${esc(d.artists[d.trackArtist[f.tr]])}">${esc(d.trackName[f.tr])}</div>
        <div class="mini-sub">${esc(d.artists[d.trackArtist[f.tr]])} · released ${f.ry}</div></div>
        <div class="mini-val good">${SP.fmtDate(f.dk)}</div></div>`));
    });

    /* oldest favorites */
    const obox = el('rt-oldest'); obox.innerHTML = '';
    s.oldest.forEach((o, i) => {
      const ap = o.src !== 0 ? ' <span class="approx">≈</span>' : '';
      obox.appendChild(h(`<div class="mini-row"><div class="mini-rank">${i + 1}</div>
        <div style="min-width:0"><div class="mini-name" title="${esc(d.trackName[o.tr])} — ${esc(d.artists[d.trackArtist[o.tr]])}">${esc(d.trackName[o.tr])}</div>
        <div class="mini-sub">${esc(d.artists[d.trackArtist[o.tr]])} · ${SP.fmtInt(o.plays)} plays</div></div>
        <div class="mini-val">${o.ry}${ap}</div></div>`));
    });

    /* mainstream meter */
    el('rt-obs-stats').innerHTML = `
      <div class="sl"><div class="k">Obscurity score</div><div class="v" style="color:var(--accent)">${Math.round(s.obscurity)}<small> / 100</small></div></div>
      <div class="sl"><div class="k">Median artist fanbase</div><div class="v">${s.medFans != null ? SP.fmtInt(s.medFans) : '—'}<small> fans</small></div></div>`;
    const fbLabels = ['< 10k fans', '10k–100k', '100k–1M', '1M–5M', '5M+'];
    SP.makeChart(el('rt-fans'), {
      grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      tooltip: { formatter: p => `artists with <b>${fbLabels[p.dataIndex]}</b><br>${SP.fmtInt(p.value)} h · ${SP.fmtPct(p.value / (s.fansMs / MSH) * 100, 1)} of dated listening` },
      xAxis: { type: 'category', data: fbLabels, axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: SP.axisLabel },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine },
      series: [{
        type: 'bar', barMaxWidth: 40,
        data: Array.from(s.fanBuckets).map((ms, k) => ({ value: Math.round(ms / MSH), itemStyle: { color: ['#A7F432', '#1ED760', '#34D3EB', '#7CC4FF', '#C792EA'][k], borderRadius: [4, 4, 0, 0], opacity: 0.9 } })),
      }],
    });

    /* obscure vs mainstream favorites */
    const favBox = el('rt-favs'); favBox.innerHTML = '';
    const favRow = (fv, i, cls) => `<div class="mini-row"><div class="mini-rank">${i + 1}</div>
      <div style="min-width:0"><div class="mini-name" title="${esc(d.artists[fv.a])}">${esc(d.artists[fv.a])}</div>
      <div class="mini-sub">${SP.fmt1(fv.ms / MSH)} h with them</div></div>
      <div class="mini-val ${cls}">${fv.fans >= 1e6 ? SP.fmt1(fv.fans / 1e6) + 'M' : fv.fans >= 1e3 ? SP.fmtInt(fv.fans / 1e3) + 'k' : fv.fans}<small> fans</small></div></div>`;
    favBox.appendChild(h(`<div><h4 class="good">Deep cuts</h4><div class="mini">${s.obscureFavs.map((f, i) => favRow(f, i, 'good')).join('')}</div></div>`));
    favBox.appendChild(h(`<div><h4 style="color:#7CC4FF">Headliners</h4><div class="mini">${s.mainstreamFavs.map((f, i) => favRow(f, i, '')).join('')}</div></div>`));

    /* hipster trend */
    SP.makeChart(el('rt-hipster'), {
      grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
      tooltip: { trigger: 'axis', formatter: ps => `<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#6B716A">${ps[0].axisValueLabel}</div>hipster index <b style="color:#C792EA">${ps[0].value}</b>` },
      xAxis: { type: 'category', data: s.mks.map(mk => SP.monthKeyLabel(mk, true)), axisLine: SP.axisLine, axisTick: { show: false }, axisLabel: Object.assign({ interval: Math.max(0, Math.ceil(s.mks.length / 14) - 1) }, SP.axisLabel) },
      yAxis: { type: 'value', axisLabel: SP.axisLabel, splitLine: SP.splitLine, min: v => Math.max(0, Math.floor(v.min - 2)), max: v => Math.min(100, Math.ceil(v.max + 2)) },
      series: [{
        type: 'line', data: s.hipster, showSymbol: false, smooth: 0.3, connectNulls: true,
        lineStyle: { width: 2, color: '#C792EA' }, itemStyle: { color: '#C792EA' },
        areaStyle: { color: SP.areaGradient('#C792EA', 0.14, 0.01) },
      }],
    });

    requestAnimationFrame(() => SP.resizeAll());
  }

  SP.sections = SP.sections || {};
  SP.sections.roots = {
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
