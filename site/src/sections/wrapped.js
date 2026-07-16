/* ============================================================
   SOUNDPRINT — sections/wrapped.js  (BUILD_SPEC §8, DESIGN_BRIEF §6)
   Year chips → contained scroll-snap story: minutes → top artist →
   top track → top 5 → biggest day → personality → poster → confetti.
   NOTE: Wrapped uses its OWN year selector. Global filters are hidden
   and ignored here by design (music only, ≥30s plays).
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const MSH = SP.CONST.MS_PER_HOUR;
  const el = id => document.getElementById(id);
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined';

  let root = null, year = null, observer = null;
  const fired = new Set(); // confetti once per year per session

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

  /* ---------------- per-year stats (independent of global filters) ---------------- */
  function computeYear(Y) {
    SP._wrapCache = SP._wrapCache || {};
    if (SP._wrapCache[Y]) return SP._wrapCache[Y];
    const d = SP.d;
    const sub = SP.buildSubsetCustom({ year: Y, content: 'music', minListen: true, artist: null });
    const st = { year: Y, n: sub.length };
    if (!sub.length) { SP._wrapCache[Y] = st; return st; }
    const { firstTrack } = firstFlags();

    let ms = 0, night = 0, weekend = 0, discover = 0;
    const days = new Map(); // dk -> {ms, tracks:Map}
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      ms += d.ms[i];
      if (SP.hour[i] < 5) night++;
      const w = SP.weekday[i];
      if (w === 0 || w === 6) weekend++;
      if (firstTrack[i]) discover++;
      const dk = SP.dayKey[i];
      let e = days.get(dk);
      if (!e) { e = { ms: 0, tracks: new Map() }; days.set(dk, e); }
      e.ms += d.ms[i];
      const tr = d.tr[i];
      if (tr > 0) e.tracks.set(tr, (e.tracks.get(tr) || 0) + 1);
    }
    st.ms = ms; st.minutes = ms / 60000; st.hours = ms / MSH; st.plays = sub.length;
    st.activeDays = days.size;
    st.nightShare = (night / sub.length) * 100;
    st.weekendShare = (weekend / sub.length) * 100;
    st.discoveryShare = (discover / sub.length) * 100;

    const artMap = SP.byArtist(sub), trkMap = SP.byTrack(sub);
    st.uniqueArtists = artMap.size; st.uniqueTracks = trkMap.size;
    st.top5a = SP.topN(artMap, 5, 'hours');
    st.top5t = SP.topN(trkMap, 5, 'plays').filter(t => t.key > 0);
    st.topArtist = st.top5a[0];
    st.topTrack = st.top5t[0];
    st.topArtistShare = st.topArtist ? (st.topArtist.ms / ms) * 100 : 0;

    // biggest day
    let bigDk = null, bigMs = -1;
    days.forEach((e, dk) => { if (e.ms > bigMs) { bigMs = e.ms; bigDk = dk; } });
    st.bigDay = { dk: bigDk, hours: bigMs / MSH };
    const bt = days.get(bigDk).tracks;
    let bTr = null, bv = -1;
    bt.forEach((v, tr) => { if (v > bv) { bv = v; bTr = tr; } });
    st.bigDay.track = bTr != null ? d.trackName[bTr] : null;
    st.bigDay.trackPlays = bv;

    // avg session length (gap > 30 min)
    let sessCount = 0, cur = null, totalDur = 0;
    for (let j = 0; j < sub.length; j++) {
      const i = sub[j];
      const start = SP.t[i], end = start + d.ms[i] / 1000;
      if (!cur || start - cur.end > 1800) {
        if (cur) totalDur += (cur.end - cur.start);
        cur = { start, end }; sessCount++;
      } else if (end > cur.end) cur.end = end;
    }
    if (cur) totalDur += (cur.end - cur.start);
    st.avgSessionMin = sessCount ? totalDur / 60 / sessCount : 0;

    // genre + mood + lyric theme (enrichment; Phase B2)
    if (SP.en) {
      const en = SP.en;
      const gMs = new Map();
      let gTot = 0, vMs = 0, vSum = 0, eSum = 0, thTot = 0;
      const thMs = new Float64Array(en.themes.length);
      for (let j = 0; j < sub.length; j++) {
        const i = sub[j], tr = d.tr[i], m = d.ms[i];
        const u = en.artistUmbrella[d.trackArtist[tr]];
        if (u >= 0) { gMs.set(u, (gMs.get(u) || 0) + m); gTot += m; }
        const v = en.trackValence[tr];
        if (v >= 0) { vMs += m; vSum += v * m; eSum += en.trackEnergy[tr] * m; }
        const ths = en.lyrThemes[tr];
        if (ths && ths.length) { for (const th of ths) thMs[th] += m; thTot += m; }
      }
      const gOrder = Array.from(gMs.entries()).sort((a, b) => b[1] - a[1]);
      if (gOrder.length) {
        st.topGenre = { u: gOrder[0][0], share: (gOrder[0][1] / gTot) * 100 };
        st.runnerGenres = gOrder.slice(1, 3).map(([u, m]) => ({ u, share: (m / gTot) * 100 }));
      }
      if (vMs > 0) { st.valence = vSum / vMs; st.energy = eSum / vMs; }
      if (thTot > 0) {
        let bt = 0;
        for (let th = 1; th < thMs.length; th++) if (thMs[th] > thMs[bt]) bt = th;
        st.topTheme = en.themes[bt];
      }
      const THEME_WORD = {
        love: 'love songs', heartbreak: 'heartbreak', drinking_partying: 'last call',
        trucks_roads_driving: 'open road', small_town_home: 'small-town nostalgia',
        faith: 'faith', money: 'money talk', night: 'night moves', summer: 'summer',
      };
      if (st.energy != null && st.topTheme) {
        const eWord = st.energy >= 58 ? 'high-energy' : st.energy >= 45 ? 'mid-tempo' : 'low-key';
        st.moodLine = `${eWord} ${THEME_WORD[st.topTheme] || st.topTheme}`;
      }
    }

    // personality
    const cands = [];
    if (st.topArtistShare >= 15) cands.push({ score: st.topArtistShare / 15, label: 'The Loyalist', line: `<b>${esc(d.artists[st.topArtist.key])}</b> alone was <b>${SP.fmtPct(st.topArtistShare)}</b> of everything you played. When you love, you commit.` });
    if (st.discoveryShare >= 28) cands.push({ score: st.discoveryShare / 28, label: 'The Explorer', line: `<b>${SP.fmtPct(st.discoveryShare)}</b> of your plays were songs you'd never heard before. Always hunting.` });
    if (st.nightShare >= 18) cands.push({ score: st.nightShare / 18, label: 'The Night Owl', line: `<b>${SP.fmtPct(st.nightShare)}</b> of your listening happened between midnight and 5 am. The dark is your dancefloor.` });
    if (st.avgSessionMin >= 75) cands.push({ score: st.avgSessionMin / 75, label: 'The Marathoner', line: `Your average session ran <b>${Math.round(st.avgSessionMin)} minutes</b>. You don't listen — you inhabit.` });
    const yearDays = Y === SP.minYear || Y === SP.maxYear ? st.activeDays / Math.max(st.activeDays, 1) * 100 : (st.activeDays / (Y % 4 === 0 ? 366 : 365)) * 100;
    if (!cands.length && yearDays >= 85) cands.push({ score: 1, label: 'The Devotee', line: `You listened on <b>${SP.fmtPct(yearDays)}</b> of days this year. Music isn't a habit for you — it's infrastructure.` });
    if (!cands.length) cands.push({ score: 1, label: 'The All-Rounder', line: 'Day and night, old favorites and new finds — no single obsession, just a balanced diet of sound.' });
    cands.sort((a, b) => b.score - a.score);
    st.personality = cands[0];

    SP._wrapCache[Y] = st;
    return st;
  }

  /* ---------------- panels ---------------- */
  function maskNum(id, cls, txt) {
    return `<div class="wr-mask"><span class="wr-inner"><span class="wr-num ${cls || ''}" id="${id}">${txt != null ? txt : '0'}</span></span></div>`;
  }
  function maskName(cls, name) {
    return `<div class="wr-mask"><span class="wr-inner"><span class="wr-name ${cls || ''}">${esc(name)}</span></span></div>`;
  }
  const scrollHint = `<div class="wr-hint"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg> scroll</div>`;

  function panelsHTML(st) {
    const d = SP.d;
    if (!st.n) {
      return `<div class="wr-panel"><div class="wr-eyebrow">Soundprint Wrapped</div>
        <div class="wr-name">Silence.</div>
        <div class="wr-ctx">No music plays in ${st.year}. Pick another year above.</div></div>`;
    }
    const wakingPct = (st.hours / (st.activeDays * 16)) * 100;
    const p = [];
    // 1 · intro
    p.push(`<div class="wr-panel" data-panel="intro">
      <div class="wr-eyebrow">Soundprint Wrapped</div>
      ${maskNum('wr-n-year', '', st.year)}
      <div class="wr-ctx">${SP.fmtInt(st.plays)} plays. ${SP.fmtInt(st.activeDays)} days with music. One story — keep scrolling.</div>
      ${scrollHint}</div>`);
    // 2 · minutes
    p.push(`<div class="wr-panel" data-panel="minutes" data-count="${Math.round(st.minutes)}" data-target="wr-n-min">
      <div class="wr-eyebrow">You listened for</div>
      ${maskNum('wr-n-min', '', '0')}
      <div class="wr-ctx">minutes — that's <b>${SP.fmtInt(st.hours)} hours</b>, about <b>${SP.fmtPct(wakingPct)}</b> of your waking time on listening days.</div>
      ${scrollHint}</div>`);
    // 3 · top artist (cyan)
    p.push(`<div class="wr-panel cyan" data-panel="artist">
      <div class="wr-eyebrow">Your top artist</div>
      ${maskName('cyan', d.artists[st.topArtist.key])}
      <div class="wr-ctx"><b>${SP.fmtInt(st.topArtist.ms / MSH)} hours</b> together — <b>${SP.fmtPct(st.topArtistShare)}</b> of everything you played in ${st.year}.</div>
      ${scrollHint}</div>`);
    // 4 · top track
    p.push(`<div class="wr-panel" data-panel="track" data-count="${st.topTrack.plays}" data-target="wr-n-trk">
      <div class="wr-eyebrow">Your #1 song</div>
      ${maskName('', st.topTrack.key > 0 ? d.trackName[st.topTrack.key] : 'Unknown')}
      <div class="wr-ctx">by <b>${esc(d.artists[d.trackArtist[st.topTrack.key]])}</b> — you pressed play
        <span style="display:inline-block;min-width:2ch;font-weight:700;color:var(--tx-hi)" id="wr-n-trk">0</span> times.</div>
      ${scrollHint}</div>`);
    // 5 · top five
    const a5 = st.top5a.map((a, i) => `<div class="wr-t5row"><span class="r">${i + 1}</span><span class="n">${esc(d.artists[a.key])}</span><span class="m">${SP.fmtInt(a.ms / MSH)} h</span></div>`).join('');
    const t5 = st.top5t.map((t, i) => `<div class="wr-t5row"><span class="r">${i + 1}</span><span class="n" title="${esc(d.trackName[t.key])} — ${esc(d.artists[d.trackArtist[t.key]])}">${esc(d.trackName[t.key])} <small style="color:var(--tx-low);font-weight:500">· ${esc(d.artists[d.trackArtist[t.key]])}</small></span><span class="m">${SP.fmtInt(t.plays)}×</span></div>`).join('');
    p.push(`<div class="wr-panel" data-panel="top5">
      <div class="wr-eyebrow">The inner circle</div>
      <div class="wr-mask"><span class="wr-inner"><span class="wr-name" style="font-size:clamp(2rem,5vw,3.6rem)">Your top five</span></span></div>
      <div class="wr-top5"><div><h4>Artists</h4>${a5}</div><div><h4>Songs</h4>${t5}</div></div>
      ${scrollHint}</div>`);
    // 5.5 · top genre (Phase B2)
    if (st.topGenre) {
      const gname = SP.genreName(st.topGenre.u);
      const gcolor = SP.genreColor(st.topGenre.u);
      const runners = st.runnerGenres && st.runnerGenres.length
        ? ` ${st.runnerGenres.map(r => `<b>${esc(SP.genreName(r.u))}</b> (${SP.fmtPct(r.share)})`).join(' and ')} tried to keep up.`
        : '';
      p.push(`<div class="wr-panel" data-panel="genre">
        <div class="wr-eyebrow">Your sound of the year</div>
        <div class="wr-mask"><span class="wr-inner"><span class="wr-name" style="background:linear-gradient(135deg,${gcolor} 0%,#A7F432 100%);-webkit-background-clip:text;background-clip:text;color:transparent;text-transform:capitalize">${esc(gname)}</span></span></div>
        <div class="wr-ctx"><b>${SP.fmtPct(st.topGenre.share)}</b> of everything you played wore the same hat.${runners}</div>
        ${scrollHint}</div>`);
    }
    // 6 · biggest day (pink→amber)
    p.push(`<div class="wr-panel pink" data-panel="bigday" data-count="${st.bigDay.hours.toFixed(1)}" data-decimals="1" data-target="wr-n-big">
      <div class="wr-eyebrow">Your biggest day</div>
      ${maskNum('wr-n-big', 'pink', '0')}
      <div class="wr-ctx">hours on <b>${SP.fmtDate(st.bigDay.dk)}</b>${st.bigDay.track ? ` — mostly <b>${esc(st.bigDay.track)}</b>, ${st.bigDay.trackPlays} times that day` : ''}.</div>
      ${scrollHint}</div>`);
    // 7 · personality (+ mood line, Phase B2)
    const moodLine = st.moodLine ? `<br><span style="color:var(--tx-mid)">Your year sounded like:</span> <b style="color:var(--accent)">${esc(st.moodLine)}</b>.` : '';
    p.push(`<div class="wr-panel" data-panel="personality">
      <div class="wr-eyebrow">Your listening personality</div>
      ${maskName('', st.personality.label)}
      <div class="wr-ctx">${st.personality.line}${moodLine}</div>
      ${scrollHint}</div>`);
    // 8 · poster + confetti
    const pa = st.top5a.map((a, i) => `<div class="wp-row"><span class="n">${i + 1}. ${esc(d.artists[a.key])}</span><span class="v">${SP.fmtInt(a.ms / MSH)} h</span></div>`).join('');
    const pt = st.top5t.slice(0, 3).map((t, i) => `<div class="wp-row"><span class="n" title="${esc(d.trackName[t.key])} — ${esc(d.artists[d.trackArtist[t.key]])}">${i + 1}. ${esc(d.trackName[t.key])} <span style="color:rgba(244,245,241,0.5);font-weight:500">· ${esc(d.artists[d.trackArtist[t.key]])}</span></span><span class="v">${SP.fmtInt(t.plays)}×</span></div>`).join('');
    p.push(`<div class="wr-panel" data-panel="poster">
      <div class="wr-eyebrow" style="margin-bottom:var(--sp-3)">Keep this one</div>
      <div class="wr-poster wr-drift">
        <div class="wp-head"><span>Soundprint</span><span>Wrapped</span></div>
        <div class="wp-year">${st.year}</div>
        <div class="wp-tag">${esc(st.personality.label)}</div>
        <div class="wp-sec">Top artists</div>${pa}
        <div class="wp-sec">Top songs</div>${pt}
        <div class="wp-big">
          <div><div class="k">Minutes</div><div class="v">${SP.fmtInt(st.minutes)}</div></div>
          <div><div class="k">Artists</div><div class="v">${SP.fmtInt(st.uniqueArtists)}</div></div>
          <div><div class="k">Days</div><div class="v">${SP.fmtInt(st.activeDays)}</div></div>
        </div>
      </div>
      <div class="wr-ctx" style="font-size:0.85rem;margin-top:var(--sp-3)">screenshot-ready · 9:16</div>
    </div>`);
    return p.join('');
  }

  /* ---------------- reveal choreography ---------------- */
  function revealPanel(panel) {
    if (panel.dataset.done) return;
    panel.dataset.done = '1';
    const eyebrow = panel.querySelector('.wr-eyebrow');
    const inner = panel.querySelector('.wr-inner');
    const ctx = panel.querySelector('.wr-ctx');
    const top5 = panel.querySelector('.wr-top5');
    const poster = panel.querySelector('.wr-poster');

    // CountUp
    const target = panel.dataset.target;
    if (target) {
      const node = document.getElementById(target);
      const val = parseFloat(panel.dataset.count);
      const dec = panel.dataset.decimals ? +panel.dataset.decimals : 0;
      if (node) {
        if (reduce || !window.countUp) node.textContent = dec ? val.toFixed(dec) : SP.fmtInt(val);
        else {
          const cu = new countUp.CountUp(node, val, { duration: 1.6, separator: ',', decimalPlaces: dec, useEasing: true });
          if (!cu.error) cu.start(); else node.textContent = SP.fmtInt(val);
        }
      }
    }

    if (reduce || !hasGSAP) {
      if (inner) inner.style.transform = 'none';
      return;
    }
    const tl = gsap.timeline();
    if (eyebrow) tl.fromTo(eyebrow, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.25, ease: 'power2.out' });
    if (inner) tl.fromTo(inner, { yPercent: 105 }, { yPercent: 0, duration: 1.25, ease: 'power4.out' }, 0.08);
    if (ctx) tl.fromTo(ctx, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.45);
    if (top5) tl.fromTo(top5.querySelectorAll('.wr-t5row'), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06, ease: 'power3.out' }, 0.5);
    if (poster) tl.fromTo(poster, { autoAlpha: 0, y: 26, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: 'power3.out' }, 0.15);

    // confetti finale
    if (panel.dataset.panel === 'poster' && !fired.has(year) && window.confetti && !reduce) {
      fired.add(year);
      setTimeout(() => {
        confetti({
          particleCount: 150, spread: 78, startVelocity: 38, gravity: 0.9,
          origin: { y: 0.3 }, ticks: 240,
          colors: ['#1ED760', '#A7F432', '#158A4B', '#FFD97D', '#F4F5F1'],
          disableForReducedMotion: true,
        });
      }, 500);
    }
  }

  function mountObserver() {
    if (observer) observer.disconnect();
    const scroller = el('wr-scroll');
    observer = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) revealPanel(en.target); });
    }, { root: scroller, threshold: 0.55 });
    scroller.querySelectorAll('.wr-panel').forEach(pn => {
      // pre-hide animatable bits
      if (!reduce && hasGSAP) {
        const inner = pn.querySelector('.wr-inner');
        if (inner) gsap.set(inner, { yPercent: 105 });
        const ctx = pn.querySelector('.wr-ctx');
        if (ctx) gsap.set(ctx, { autoAlpha: 0 });
      }
      observer.observe(pn);
    });
  }

  /* ---------------- lifecycle ---------------- */
  function skeleton() {
    const chips = SP.years.map(y => `<button class="wr-chip" data-y="${y}">${y}</button>`).join('');
    return `
    <div class="sec-head reveal" style="margin-bottom:var(--sp-4)">
      <div>
        <div class="sec-eyebrow">Wrapped</div>
        <h1 class="sec-title">Your year, the loud version</h1>
        <p class="sec-sub">Pick a year, then scroll the story. Wrapped uses its own selector — the global filter bar doesn't apply here.</p>
      </div>
    </div>
    <div class="wr-chips reveal" role="tablist" aria-label="Wrapped year">${chips}</div>
    <div class="wr-scroll reveal" id="wr-scroll" tabindex="0" aria-label="Wrapped story — scroll"></div>`;
  }

  function renderYear() {
    const st = computeYear(year);
    const scroller = el('wr-scroll');
    scroller.innerHTML = panelsHTML(st);
    scroller.scrollTop = 0;
    root.querySelectorAll('.wr-chip').forEach(c => c.classList.toggle('on', +c.dataset.y === year));
    mountObserver();
    // reveal the first panel immediately
    const first = scroller.querySelector('.wr-panel');
    if (first) requestAnimationFrame(() => revealPanel(first));
  }

  SP.sections = SP.sections || {};
  SP.sections.wrapped = {
    render(container) {
      root = container;
      document.body.classList.add('wrapped-mode');
      root.innerHTML = skeleton();
      if (year == null) year = Math.min(SP.maxYear - (SP.maxYear > SP.minYear ? 1 : 0), SP.maxYear); // default: latest complete year
      root.querySelectorAll('.wr-chip').forEach(c => {
        c.addEventListener('click', () => { year = +c.dataset.y; renderYear(); });
      });
      renderYear();
      return root.querySelectorAll('.reveal');
    },
    // Wrapped intentionally ignores global filters (documented in the header sub).
    update() {},
    dispose() {
      document.body.classList.remove('wrapped-mode');
      if (observer) { observer.disconnect(); observer = null; }
      root = null;
    },
  };
})();
