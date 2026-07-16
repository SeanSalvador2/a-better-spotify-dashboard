/* ============================================================
   SOUNDPRINT — app.js
   Routing · sidebar · global filter bar · splash · GSAP · lifecycle
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});
  const $ = id => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined';

  /* ---------------- nav config (Lucide-style inline icons) ---------------- */
  const ICON = {
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    trends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-4 4"/></svg>',
    artists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
    tracks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    genres: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/></svg>',
    mood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2.5-6 4 12 3-8 1.8 2H22"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.02V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
    roots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    behavior: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    wrapped: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 4.6L18.5 9l-3.3 3.2.8 4.8L12 14.8 7.9 17l.8-4.8L5.5 9l4.6-1.4z"/></svg>',
  };
  const NAV = [
    { id: 'overview', label: 'Overview' },
    { id: 'trends', label: 'Trends' },
    { id: 'artists', label: 'Artists' },
    { id: 'genres', label: 'Genres' },
    { id: 'mood', label: 'Mood' },
    { id: 'lyrics', label: 'Lyrics Lab' },
    { id: 'roots', label: 'Roots & Rarity' },
    { id: 'tracks', label: 'Tracks & Albums' },
    { id: 'clock', label: 'Listening Clock' },
    { id: 'behavior', label: 'Discovery & Behavior' },
    { id: 'wrapped', label: 'Wrapped' },
  ];

  /* ---------------- placeholder sections ---------------- */
  const PH = {
    trends: ['Calendar heatmaps per year', 'Monthly hours + plays combo', 'Year-over-year comparison', 'Rolling 30-day momentum', 'Streaks & records', 'Seasonal profile'],
    artists: ['Top 25 leaderboard', 'Rank bump chart', 'Taste streamgraph', 'Discovery timeline', 'Loyalty & depth', 'Rising vs fading', 'One-hit wonders'],
    tracks: ['Top 25 tracks', 'On-repeat binges', 'Track lifespans', 'Never-skip vs most-skipped', 'Completion histogram', 'Top albums', 'Podcast corner'],
    clock: ['Hour × weekday matrix', 'Radial 24h clock', 'Weekday vs weekend', 'Night-owl panel', 'Hourly personality', 'Sessions analysis'],
    behavior: ['Skip anatomy', 'Start/end reasons', 'Shuffle behavior', 'Platform evolution', 'Countries & travel', 'Discovery timeline', 'Diversity index', 'Era detection'],
    wrapped: ['Scroll-snap story', 'Top artist & track reveals', 'Biggest day', 'Listening personality', 'Shareable poster', 'Confetti finale'],
    genres: ['Umbrella share donut', 'Genre streamgraph', 'Genre bump chart', 'Season & daypart heatmaps', 'Genre discovery timeline', 'Diversity trend', 'Subgenre treemap'],
    mood: ['Audio DNA radar', 'Mood quadrant', 'Valence over time', 'Mood by hour & weekday', 'Tempo histogram', 'Acousticness trend', 'Per-year fingerprints'],
  };
  function makePlaceholder(id, label) {
    return {
      render(container) {
        const items = (PH[id] || []).map(x => `<span>${x}</span>`).join('');
        container.innerHTML = `<div class="ph reveal">
          <div class="ph-badge">Coming in a later phase</div>
          <h1 class="ph-title"><span>${label}</span></h1>
          <p class="ph-desc">This section is wired into the same global filter engine and dark chart theme as Overview. It'll render the moment its phase lands.</p>
          <div class="ph-list">${items}</div>
        </div>`;
        return container.querySelectorAll('.reveal');
      },
      update() {},
      dispose() {},
    };
  }

  /* ---------------- sidebar ---------------- */
  function buildSidebar() {
    const nav = $('nav'); nav.innerHTML = '';
    const bottom = $('bottombar'); bottom.innerHTML = '';
    NAV.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'nav-item'; btn.dataset.id = item.id;
      btn.innerHTML = `${ICON[item.id]}<span class="nav-label">${item.label}</span>`;
      btn.addEventListener('click', () => go(item.id));
      nav.appendChild(btn);

      const bb = document.createElement('button');
      bb.dataset.id = item.id; bb.setAttribute('aria-label', item.label);
      bb.innerHTML = ICON[item.id];
      bb.addEventListener('click', () => go(item.id));
      bottom.appendChild(bb);
    });
  }
  function refreshProfile() {
    $('profile-plays').textContent = SP.fmtInt(SP.meta.totalPlays || SP.n) + ' plays';
    const [a, b] = SP.meta.dateRange || [];
    $('profile-span').textContent = a && b ? `${a} → ${b}` : '';
  }

  /* ---------------- filter bar ---------------- */
  function seg(groupLabel, opts, current, onPick, soft, group) {
    const wrap = document.createElement('div'); wrap.className = 'fgroup';
    if (groupLabel) { const l = document.createElement('span'); l.className = 'fgroup-label'; l.textContent = groupLabel; wrap.appendChild(l); }
    const box = document.createElement('div'); box.className = 'seg' + (soft ? ' seg-soft' : '');
    if (group) box.dataset.group = group;
    opts.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o.label; b.dataset.val = o.val;
      if (String(o.val) === String(current)) b.classList.add('on');
      b.addEventListener('click', () => onPick(o.val));
      box.appendChild(b);
    });
    wrap.appendChild(box);
    return wrap;
  }

  function buildFilterBar() {
    const bar = $('filterbar'); bar.innerHTML = '';
    const f = SP.filter;

    // year chips — generated from data; long histories (>8 yrs) collapse into a
    // horizontally scrollable chip row so a 40-year export still fits the bar.
    const years = SP.years;
    const yearOpts = [{ label: 'All', val: 'all' }].concat(years.map(y => ({ label: String(y), val: y })));
    const yearSeg = seg('Year', yearOpts, f.year, v => SP.setFilter({ year: v === 'all' ? 'all' : +v }), false, 'year');
    if (years.length > 8) {
      yearSeg.querySelector('.seg').classList.add('seg-scroll');
      // keep the selected year visible
      requestAnimationFrame(() => {
        const on = yearSeg.querySelector('.seg button.on');
        if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
      });
    }
    bar.appendChild(yearSeg);

    bar.appendChild(divider());

    // content
    bar.appendChild(seg('Type', [
      { label: 'Music', val: 'music' }, { label: 'Podcasts', val: 'podcasts' }, { label: 'All', val: 'all' },
    ], f.content, v => SP.setFilter({ content: v }), false, 'content'));

    // genre multi-select (enrichment-powered)
    if (SP.en) bar.appendChild(buildGenrePicker());

    // metric
    bar.appendChild(seg('Metric', [
      { label: 'Hours', val: 'hours' }, { label: 'Plays', val: 'plays' },
    ], f.metric, v => SP.setFilter({ metric: v }), true, 'metric'));

    // min listen toggle
    const mlWrap = document.createElement('div'); mlWrap.className = 'fgroup';
    const ml = document.createElement('div'); ml.className = 'seg seg-soft';
    const mlBtn = document.createElement('button');
    mlBtn.textContent = '≥ 30s only';
    if (f.minListen) mlBtn.classList.add('on');
    mlBtn.setAttribute('aria-pressed', String(f.minListen));
    mlBtn.addEventListener('click', () => SP.setFilter({ minListen: !SP.filter.minListen }));
    ml.appendChild(mlBtn); mlWrap.appendChild(ml);
    bar.appendChild(mlWrap);

    // spacer + artist search
    const spacer = document.createElement('div'); spacer.style.flex = '1 1 auto'; spacer.style.minWidth = '8px';
    bar.appendChild(spacer);
    bar.appendChild(buildSearch());
    syncSegs();
  }
  SP.rebuildFilterBar = buildFilterBar; // exposed for dev/long-span testing

  function divider() { const d = document.createElement('div'); d.className = 'divider'; return d; }

  /* ---------------- genre multi-select dropdown ---------------- */
  function buildGenrePicker() {
    const en = SP.en;
    const wrap = document.createElement('div'); wrap.className = 'fgroup gpick';
    const btn = document.createElement('button');
    btn.className = 'gpick-btn'; btn.id = 'genre-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    wrap.appendChild(btn);
    let panel = null;

    function label() {
      const g = SP.filter.genres;
      if (!g.length) { btn.innerHTML = `Genres <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>`; btn.classList.remove('on'); return; }
      const first = SP.genreName(g[0]);
      btn.innerHTML = `<span class="gdot" style="background:${SP.genreColor(g[0])}"></span>${esc(first)}${g.length > 1 ? ` +${g.length - 1}` : ''}`;
      btn.classList.add('on');
    }
    SP._genreBtnSync = label;
    label();

    function close() { if (panel) { panel.remove(); panel = null; btn.setAttribute('aria-expanded', 'false'); } }
    function open() {
      if (panel) { close(); return; }
      panel = document.createElement('div'); panel.className = 'typeahead gpick-panel'; panel.setAttribute('role', 'listbox');
      const MSH = SP.CONST.MS_PER_HOUR;
      const rows = SP.genreOrder
        .filter(u => SP.genreTotalsMs[u] > 0)
        .map(u => {
          const on = SP.filter.genres.includes(u);
          return `<div class="gp-item ${on ? 'on' : ''}" data-u="${u}" role="option" aria-selected="${on}">
            <span class="gdot" style="background:${SP.genreColor(u)}"></span>
            <span class="gp-name">${esc(en.umbrellas[u])}</span>
            <span class="gp-meta">${SP.fmtInt(SP.genreTotalsMs[u] / MSH)} h</span>
            <span class="gp-check">${on ? '✓' : ''}</span>
          </div>`;
        }).join('');
      panel.innerHTML = rows + `<div class="gp-foot"><button class="chip-clear" id="gp-clear">Clear genres</button></div>`;
      wrap.appendChild(panel);
      btn.setAttribute('aria-expanded', 'true');
      panel.querySelectorAll('.gp-item').forEach(node => {
        node.addEventListener('click', () => {
          const u = +node.dataset.u;
          const cur = SP.filter.genres.slice();
          const at = cur.indexOf(u);
          if (at >= 0) cur.splice(at, 1); else cur.push(u);
          SP.setFilter({ genres: cur });
          close(); open(); // refresh checks, keep panel up
        });
      });
      panel.querySelector('#gp-clear').addEventListener('click', () => { SP.setFilter({ genres: [] }); close(); });
    }
    btn.addEventListener('click', open);
    document.addEventListener('click', e => { if (panel && !wrap.contains(e.target)) close(); });
    return wrap;
  }

  function syncSegs() {
    // reflect current filter state onto segmented buttons (scoped per group)
    const f = SP.filter;
    document.querySelectorAll('#filterbar .seg[data-group]').forEach(box => {
      const group = box.dataset.group;
      box.querySelectorAll('button[data-val]').forEach(b => {
        const v = b.dataset.val;
        let on = false;
        if (group === 'year') on = (v === 'all') ? (f.year === 'all') : (+v === f.year);
        else if (group === 'content') on = f.content === v;
        else if (group === 'metric') on = f.metric === v;
        b.classList.toggle('on', on);
      });
    });
  }

  /* ---------------- artist search / typeahead ---------------- */
  let artistIndex = null;
  function buildArtistIndex() {
    const d = SP.d, counts = new Uint32Array(d.artists.length);
    for (let i = 0; i < SP.n; i++) { if (d.ty[i] === 0) counts[d.trackArtist[d.tr[i]]]++; }
    artistIndex = [];
    for (let id = 1; id < d.artists.length; id++) { if (counts[id] > 0) artistIndex.push({ id, name: d.artists[id], plays: counts[id], lc: d.artists[id].toLowerCase() }); }
    artistIndex.sort((a, b) => b.plays - a.plays);
    SP.artistIndex = artistIndex;
  }

  function buildSearch() {
    const wrap = document.createElement('div'); wrap.className = 'fgroup search';
    wrap.innerHTML = `<div class="search-input">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" id="artist-search" placeholder="Search 2,660 artists…" autocomplete="off" spellcheck="false" aria-label="Search artists">
    </div>`;
    const input = wrap.querySelector('input');
    let box = null, hlIdx = -1, matches = [];

    function close() { if (box) { box.remove(); box = null; hlIdx = -1; } }
    function open() {
      const q = input.value.trim().toLowerCase();
      matches = [];
      if (q) {
        for (const a of artistIndex) { if (a.lc.includes(q)) { matches.push(a); if (matches.length >= 8) break; } }
      } else {
        matches = artistIndex.slice(0, 8);
      }
      if (!box) { box = document.createElement('div'); box.className = 'typeahead'; wrap.appendChild(box); }
      hlIdx = -1;
      if (!matches.length) { box.innerHTML = `<div class="ta-empty">No artist matches “${esc(input.value)}”.</div>`; return; }
      box.innerHTML = matches.map((a, i) =>
        `<div class="ta-item" data-i="${i}"><span class="ta-name">${esc(a.name)}</span><span class="ta-meta">${SP.fmtInt(a.plays)} plays</span></div>`).join('');
      box.querySelectorAll('.ta-item').forEach(node => {
        node.addEventListener('mousedown', e => { e.preventDefault(); pick(+node.dataset.i); });
      });
    }
    function pick(i) { const a = matches[i]; if (!a) return; SP.setFilter({ artist: a.id }); input.value = ''; close(); input.blur(); }
    function hl(dir) {
      if (!box || !matches.length) return;
      hlIdx = (hlIdx + dir + matches.length) % matches.length;
      box.querySelectorAll('.ta-item').forEach((n, i) => n.classList.toggle('hl', i === hlIdx));
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); hl(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hl(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(hlIdx >= 0 ? hlIdx : 0); }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    return wrap;
  }

  /* ---------------- active filter chips ---------------- */
  function refreshChips() {
    const bar = $('activebar'); const f = SP.filter; const chips = [];
    if (f.artist != null) chips.push(chip('Artist', SP.d.artists[f.artist], () => SP.setFilter({ artist: null }), true));
    (f.genres || []).forEach(u => {
      const c = chip('Genre', SP.genreName(u), () => SP.setFilter({ genres: SP.filter.genres.filter(x => x !== u) }));
      const dot = document.createElement('span'); dot.className = 'gdot'; dot.style.background = SP.genreColor(u);
      c.insertBefore(dot, c.firstChild);
      chips.push(c);
    });
    if (f.year !== 'all') chips.push(chip('Year', String(f.year), () => SP.setFilter({ year: 'all' })));
    if (f.content !== 'music') chips.push(chip('Type', f.content === 'all' ? 'All content' : 'Podcasts', () => SP.setFilter({ content: 'music' })));
    if (!f.minListen) chips.push(chip('Threshold', 'Counting < 30s', () => SP.setFilter({ minListen: true })));

    if (!chips.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false; bar.innerHTML = '';
    const lbl = document.createElement('span'); lbl.className = 'al'; lbl.textContent = 'Active'; bar.appendChild(lbl);
    chips.forEach(c => bar.appendChild(c));
    const clr = document.createElement('button'); clr.className = 'chip-clear'; clr.textContent = 'Clear all';
    clr.addEventListener('click', () => SP.setFilter({ year: 'all', content: 'music', minListen: true, artist: null, genres: [] }));
    bar.appendChild(clr);
  }
  function chip(k, v, onX, accent) {
    const c = document.createElement('span'); c.className = 'chip' + (accent ? ' accent' : '');
    c.innerHTML = `<span>${esc(k)}: <b>${esc(v)}</b></span><button class="chip-x" aria-label="Remove ${esc(k)} filter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    c.querySelector('.chip-x').addEventListener('click', onX);
    return c;
  }

  /* ---------------- routing / lifecycle ---------------- */
  const sections = {};
  NAV.forEach(n => { sections[n.id] = SP.sections[n.id] || makePlaceholder(n.id, n.label); });
  let active = null, activeId = null;

  function go(id) { if (id === activeId) return; location.hash = '#/' + id; }
  function currentHash() { const m = (location.hash || '').match(/#\/(\w+)/); return m && sections[m[1]] ? m[1] : 'overview'; }

  function setActiveNav(id) {
    document.querySelectorAll('.nav-item, .bottombar button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  }

  function activate(id, firstLoad) {
    if (active && active.dispose) active.dispose();
    const content = $('content');
    SP.disposeChartsIn(content);
    content.innerHTML = '';
    active = sections[id]; activeId = id;
    setActiveNav(id);
    const reveals = active.render(content) || [];
    // resize charts once laid out
    requestAnimationFrame(() => SP.resizeAll());
    if (!firstLoad) entrance(reveals, true);
    content.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function onFilterChange() {
    syncSegs();
    refreshChips();
    if (SP._genreBtnSync) SP._genreBtnSync();
    if (active && active.update) active.update();
    requestAnimationFrame(() => SP.resizeAll());
  }

  /* ---------------- entrance choreography (GSAP) ---------------- */
  function entrance(reveals, sectionOnly) {
    reveals = Array.from(reveals || []);
    if (reduce || !hasGSAP) { reveals.forEach(n => { n.style.opacity = ''; n.style.transform = ''; }); return; }
    if (sectionOnly) {
      gsap.fromTo($('content'), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: 'power2.out' });
      gsap.fromTo(reveals, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.05, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
      return;
    }
    const tl = gsap.timeline();
    tl.fromTo('.brand', { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.4, ease: 'power2.out' })
      .fromTo('.profile', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' }, '-=0.25')
      .fromTo('.nav-item', { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.045, ease: 'power3.out' }, '-=0.25')
      .fromTo('.filterbar > *', { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.03, ease: 'power2.out' }, '-=0.3')
      .fromTo(reveals, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out', clearProps: 'transform,opacity,visibility' }, '-=0.25');
  }

  /* ---------------- splash ---------------- */
  function setSplash(pct, txt) {
    const bar = $('splash-bar'); if (bar) bar.style.width = pct + '%';
    if (txt) { const s = $('splash-sub'); if (s) s.textContent = txt; }
  }
  function hideSplash() {
    const sp = $('splash');
    $('app').hidden = false;
    if (reduce) { sp.remove(); return; }
    sp.style.opacity = '0';
    setTimeout(() => sp.remove(), 520);
  }
  function raf() { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }

  function showUnsupported() {
    $('splash').innerHTML = `<div class="splash-inner"><div class="splash-word">Soundprint</div>
      <div class="splash-sub" style="max-width:32ch;line-height:1.6">This dashboard decodes its data with <b>DecompressionStream</b>, which your browser doesn't support. Please open it in an up-to-date Chrome, Edge, Firefox, or Safari.</div></div>`;
  }

  function esc(str) { return String(str == null ? '' : str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- boot ---------------- */
  async function boot() {
    const node = $('dataset');
    const b64 = node ? node.textContent.replace(/\s+/g, '') : '';
    if (!SP.hasDecompression || !b64) { showUnsupported(); return; }
    try {
      setSplash(12, 'Decoding your listening history…');
      await raf();
      await SP.decode(b64);
      setSplash(38, 'Building time indexes…');
      await raf();
      SP.derive();
      // optional enrichment block (genres · moods · lyrics stats)
      const enNode = $('enrichment');
      if (enNode) {
        setSplash(56, 'Enriching with genres & moods…');
        await raf();
        try {
          await SP.decodeEnrichment(enNode.textContent.replace(/\s+/g, ''));
          SP.initGenreColors();
        } catch (e) { console.warn('enrichment decode failed — continuing without it', e); }
      }
      setSplash(70, 'Crunching aggregates…');
      await raf();
      buildArtistIndex();
      SP.recompute();
      setSplash(84, 'Composing your dashboard…');
      buildSidebar();
      refreshProfile();
      buildFilterBar();
      refreshChips();
      SP.onFilter(onFilterChange);
      window.addEventListener('hashchange', () => activate(currentHash(), false));
      setSplash(100, 'Ready');
      await raf();
      hideSplash();
      activate(currentHash(), true);
      if (!reduce && hasGSAP) requestAnimationFrame(() => entrance($('content').querySelectorAll('.reveal'), false));
    } catch (e) {
      console.error('boot failed', e);
      $('splash').innerHTML = `<div class="splash-inner"><div class="splash-word">Soundprint</div><div class="splash-sub">Something went wrong while loading. Check the console.</div></div>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
