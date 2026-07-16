/* ============================================================
   SOUNDPRINT — core.js
   Data decode · derived typed arrays · filter engine · aggregation
   ============================================================ */
(function () {
  'use strict';

  const SP = (window.SP = window.SP || {});
  const MS_PER_HOUR = 3600000;
  const SEC_PER_DAY = 86400;
  const MIN_LISTEN_MS = 30000;

  /* ---------- gzip-base64 decode via DecompressionStream ---------- */
  SP.hasDecompression = typeof DecompressionStream !== 'undefined';

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  SP.decode = async function decode(b64) {
    const gz = base64ToBytes(b64);
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([gz]).stream().pipeThrough(ds)).arrayBuffer();
    const d = JSON.parse(new TextDecoder().decode(buf));
    SP.d = d;
    SP.n = d.n;
    SP.meta = d.meta || {};
    return d;
  };

  /* ---------- enrichment decode (genres · audio features · lyrics stats) ---------- */
  SP.decodeEnrichment = async function decodeEnrichment(b64) {
    const gz = base64ToBytes(b64);
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([gz]).stream().pipeThrough(ds)).arrayBuffer();
    const en = JSON.parse(new TextDecoder().decode(buf));
    SP.en = en;
    return en;
  };

  // Umbrella genre of a play (music only). -1 when unknown / not music.
  SP.umbrellaOf = function (i) {
    const d = SP.d;
    if (d.ty[i] !== 0) return -1;
    return SP.en ? SP.en.artistUmbrella[d.trackArtist[d.tr[i]]] : -1;
  };

  // Stable umbrella-genre colors: ordered by total listening time, assigned from
  // the brief's categorical palette (country/green first since it dominates),
  // muted greys for the long tail. Computed once after enrichment loads.
  SP.initGenreColors = function initGenreColors() {
    const d = SP.d, en = SP.en;
    if (!en) return;
    const totals = new Float64Array(en.umbrellas.length);
    for (let i = 0; i < SP.n; i++) {
      if (d.ty[i] !== 0) continue;
      const u = en.artistUmbrella[d.trackArtist[d.tr[i]]];
      if (u >= 0) totals[u] += d.ms[i];
    }
    const order = Array.from(totals.keys()).sort((a, b) => totals[b] - totals[a]);
    const MAIN = ['#1ED760', '#34D3EB', '#FF6B9D', '#FFB347', '#7CC4FF', '#C792EA', '#F45B5B', '#E8E6DF'];
    const TAIL = ['#8FA396', '#6E8C7B', '#B4A98F', '#7B8A99', '#9A8FA6', '#8C7B6E', '#5E6B63', '#4A554E'];
    const map = new Array(en.umbrellas.length).fill(TAIL[TAIL.length - 1]);
    order.forEach((u, rank) => {
      map[u] = rank < MAIN.length ? MAIN[rank] : TAIL[Math.min(rank - MAIN.length, TAIL.length - 1)];
    });
    SP._genreColors = map;
    SP.genreOrder = order;           // umbrella ids, biggest first
    SP.genreTotalsMs = totals;
  };
  SP.genreColor = function (u) {
    return (u >= 0 && SP._genreColors) ? SP._genreColors[u] : '#5E6B63';
  };
  SP.genreName = function (u) {
    return (u >= 0 && SP.en) ? SP.en.umbrellas[u] : 'unknown';
  };

  // Daypart bucketing: 0 morning 6-11 · 1 afternoon 12-17 · 2 evening 18-22 · 3 night 23-5
  SP.DAYPARTS = ['Morning', 'Afternoon', 'Evening', 'Night'];
  SP.daypartOf = function (h) {
    if (h >= 6 && h <= 11) return 0;
    if (h >= 12 && h <= 17) return 1;
    if (h >= 18 && h <= 22) return 2;
    return 3;
  };

  /* ---------- derive typed arrays once ---------- */
  SP.derive = function derive() {
    const d = SP.d, n = SP.n;
    const t = new Float64Array(n);       // local-shifted epoch seconds
    const year = new Int16Array(n);
    const month = new Uint8Array(n);     // 0..11
    const monthKey = new Int32Array(n);  // (year-2020)*12 + month  (monotonic bucket)
    const dayKey = new Int32Array(n);    // integer days since epoch (local)
    const dayOfYear = new Int16Array(n); // 0..365
    const hour = new Uint8Array(n);
    const weekday = new Uint8Array(n);   // 0=Sun..6=Sat
    const minutes = new Float32Array(n); // ms/60000

    let acc = d.t0;
    // dynamic base year: month buckets stay non-negative for any history length
    const BASE_YEAR = new Date(d.t0 * 1000).getUTCFullYear();
    SP.BASE_YEAR = BASE_YEAR;
    for (let i = 0; i < n; i++) {
      acc += d.dt[i];
      t[i] = acc;
      const date = new Date(acc * 1000);
      const y = date.getUTCFullYear();
      const mo = date.getUTCMonth();
      year[i] = y;
      month[i] = mo;
      monthKey[i] = (y - BASE_YEAR) * 12 + mo;
      dayKey[i] = Math.floor(acc / SEC_PER_DAY);
      hour[i] = date.getUTCHours();
      weekday[i] = date.getUTCDay();
      minutes[i] = d.ms[i] / 60000;
      // day of year
      const startY = Date.UTC(y, 0, 1) / 1000;
      dayOfYear[i] = Math.floor((acc - startY) / SEC_PER_DAY);
    }

    SP.t = t; SP.year = year; SP.month = month; SP.monthKey = monthKey;
    SP.dayKey = dayKey; SP.dayOfYear = dayOfYear; SP.hour = hour;
    SP.weekday = weekday; SP.minutes = minutes;

    // span
    SP.firstDayKey = dayKey[0];
    SP.lastDayKey = dayKey[n - 1];
    SP.minYear = year[0];
    SP.maxYear = year[n - 1];
    SP.years = [];
    for (let y = SP.minYear; y <= SP.maxYear; y++) SP.years.push(y);
    SP.monthKeyMax = monthKey[n - 1];

    return SP;
  };

  /* ---------- name / metadata resolution ---------- */
  SP.nameOf = function nameOf(i) {
    const d = SP.d, tr = d.tr[i];
    switch (d.ty[i]) {
      case 0: return {
        title: d.trackName[tr],
        artist: d.artists[d.trackArtist[tr]],
        album: d.albumName[d.trackAlbum[tr]],
        artistId: d.trackArtist[tr],
      };
      case 1: return { title: d.epName[tr], show: d.shows[d.epShow[tr]], podcast: true };
      case 2: return { title: d.abTitle[tr], audiobook: true };
    }
    return { title: 'Unknown' };
  };
  SP.artistIdOf = function (i) { return SP.d.ty[i] === 0 ? SP.d.trackArtist[SP.d.tr[i]] : -1; };
  SP.albumIdOf = function (i) { return SP.d.ty[i] === 0 ? SP.d.trackAlbum[SP.d.tr[i]] : -1; };
  SP.trackIdOf = function (i) { return SP.d.ty[i] === 0 ? SP.d.tr[i] : -1; };

  // flag helpers
  SP.isShuffle = i => !!(SP.d.fl[i] & 1);
  SP.isSkipped = i => !!(SP.d.fl[i] & 2);
  SP.isOffline = i => !!(SP.d.fl[i] & 4);
  SP.isIncognito = i => !!(SP.d.fl[i] & 8);

  /* ---------- filter engine ---------- */
  SP.filter = {
    year: 'all',      // 'all' | number
    content: 'music', // 'music' | 'podcasts' | 'all'
    metric: 'hours',  // 'hours' | 'plays'
    genres: [],       // umbrella-genre ids (multi-select; empty = all)
    minListen: true,  // count play only if >=30s
    artist: null,     // artistId | null
  };

  const subs = new Set();
  SP.onFilter = function (fn) { subs.add(fn); return () => subs.delete(fn); };

  SP.buildSubset = function buildSubset() {
    const d = SP.d, n = SP.n, year = SP.year, f = SP.filter;
    const idx = new Uint32Array(n);
    let k = 0;
    const wantMusic = f.content === 'music';
    const wantPod = f.content === 'podcasts';
    const yr = f.year;
    const artist = f.artist;
    const ml = f.minListen;
    const gset = (f.genres && f.genres.length && SP.en) ? new Set(f.genres) : null;
    const umbrella = SP.en ? SP.en.artistUmbrella : null;
    for (let i = 0; i < n; i++) {
      const ty = d.ty[i];
      if (wantMusic) { if (ty !== 0) continue; }
      else if (wantPod) { if (ty !== 1) continue; }
      if (yr !== 'all' && year[i] !== yr) continue;
      if (ml && d.ms[i] < MIN_LISTEN_MS) continue;
      if (artist != null) {
        if (ty !== 0 || d.trackArtist[d.tr[i]] !== artist) continue;
      }
      if (gset) {
        if (ty !== 0 || !gset.has(umbrella[d.trackArtist[d.tr[i]]])) continue;
      }
      idx[k++] = i;
    }
    return idx.subarray(0, k);
  };

  // Custom-scoped subset: same content/minListen/artist rules as the live filter,
  // but with overridable year and optional dayKey range. Used for YoY ghosts,
  // rank-delta baselines and rising/fading windows.
  SP.buildSubsetCustom = function buildSubsetCustom(opts) {
    opts = opts || {};
    const d = SP.d, n = SP.n, year = SP.year, dayKey = SP.dayKey, f = SP.filter;
    const idx = new Uint32Array(n);
    let k = 0;
    const content = opts.content !== undefined ? opts.content : f.content;
    const wantMusic = content === 'music';
    const wantPod = content === 'podcasts';
    const yr = opts.year !== undefined ? opts.year : f.year;
    const artist = opts.artist !== undefined ? opts.artist : f.artist;
    const ml = opts.minListen !== undefined ? opts.minListen : f.minListen;
    const dMin = opts.dayMin != null ? opts.dayMin : -Infinity;
    const dMax = opts.dayMax != null ? opts.dayMax : Infinity;
    const genres = opts.genres !== undefined ? opts.genres : f.genres;
    const gset = (genres && genres.length && SP.en) ? new Set(genres) : null;
    const umbrella = SP.en ? SP.en.artistUmbrella : null;
    for (let i = 0; i < n; i++) {
      const ty = d.ty[i];
      if (wantMusic) { if (ty !== 0) continue; }
      else if (wantPod) { if (ty !== 1) continue; }
      if (yr !== 'all' && year[i] !== yr) continue;
      const dk = dayKey[i];
      if (dk < dMin || dk > dMax) continue;
      if (ml && d.ms[i] < MIN_LISTEN_MS) continue;
      if (artist != null) {
        if (ty !== 0 || d.trackArtist[d.tr[i]] !== artist) continue;
      }
      if (gset) {
        if (ty !== 0 || !gset.has(umbrella[d.trackArtist[d.tr[i]]])) continue;
      }
      idx[k++] = i;
    }
    return idx.subarray(0, k);
  };

  // Estimated track duration (ms) = max observed ms_played per track, computed
  // once over ALL plays. Used for completion-% metrics.
  SP.trackDurations = function trackDurations() {
    if (SP._trackDur) return SP._trackDur;
    const d = SP.d, n = SP.n;
    const dur = new Float64Array(d.trackName.length);
    for (let i = 0; i < n; i++) {
      if (d.ty[i] !== 0) continue;
      const tr = d.tr[i];
      if (d.ms[i] > dur[tr]) dur[tr] = d.ms[i];
    }
    SP._trackDur = dur;
    return dur;
  };

  SP.recompute = function recompute() { SP.subset = SP.buildSubset(); return SP.subset; };

  SP.setFilter = function setFilter(patch) {
    Object.assign(SP.filter, patch);
    SP.recompute();
    subs.forEach(fn => { try { fn(SP.filter, SP.subset); } catch (e) { console.error(e); } });
  };

  /* ---------- aggregation helpers ---------- */
  // key function returns a numeric key (>=0) or -1/null to skip
  SP.groupSum = function groupSum(subset, keyOf) {
    const d = SP.d, m = new Map();
    for (let j = 0; j < subset.length; j++) {
      const i = subset[j];
      const key = keyOf(i);
      if (key == null || key < 0) continue;
      let e = m.get(key);
      if (!e) { e = { plays: 0, ms: 0, skips: 0 }; m.set(key, e); }
      e.plays++;
      e.ms += d.ms[i];
      if (SP.isSkipped(i)) e.skips++;
    }
    return m;
  };

  SP.metricVal = function (e, metric) {
    metric = metric || SP.filter.metric;
    return metric === 'hours' ? e.ms / MS_PER_HOUR : e.plays;
  };

  // Map -> sorted array [{key, plays, ms, skips, val}]
  SP.topN = function topN(map, n, metric) {
    metric = metric || SP.filter.metric;
    const arr = [];
    map.forEach((e, key) => { arr.push({ key, plays: e.plays, ms: e.ms, skips: e.skips, val: SP.metricVal(e, metric) }); });
    arr.sort((a, b) => b.val - a.val);
    return n ? arr.slice(0, n) : arr;
  };

  // Convenience aggregators over a subset
  SP.byArtist = subset => SP.groupSum(subset, SP.artistIdOf);
  SP.byTrack = subset => SP.groupSum(subset, SP.trackIdOf);
  SP.byAlbum = subset => SP.groupSum(subset, SP.albumIdOf);
  SP.byDay = subset => SP.groupSum(subset, i => SP.dayKey[i]);
  SP.byMonthKey = subset => SP.groupSum(subset, i => SP.monthKey[i]);
  SP.byHour = subset => SP.groupSum(subset, i => SP.hour[i]);
  SP.byWeekday = subset => SP.groupSum(subset, i => SP.weekday[i]);

  // Per-key bucketed series (for sparklines). keySet = Set of keys of interest.
  SP.seriesFor = function seriesFor(subset, keyOf, bucketOf, nBuckets, keySet, metric) {
    metric = metric || SP.filter.metric;
    const d = SP.d, out = new Map();
    keySet.forEach(k => out.set(k, new Float64Array(nBuckets)));
    const useHours = metric === 'hours';
    for (let j = 0; j < subset.length; j++) {
      const i = subset[j];
      const arr = out.get(keyOf(i));
      if (!arr) continue;
      const b = bucketOf(i);
      if (b < 0 || b >= nBuckets) continue;
      arr[b] += useHours ? d.ms[i] / MS_PER_HOUR : 1;
    }
    return out;
  };

  /* ---------- date / number formatting ---------- */
  const fmtN = new Intl.NumberFormat('en-US');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  SP.MONTHS = MONTHS; SP.WEEKDAYS = WEEKDAYS;

  SP.fmtInt = v => fmtN.format(Math.round(v));
  SP.fmtHours = h => fmtN.format(Math.round(h)) + ' h';
  SP.fmt1 = v => fmtN.format(Math.round(v * 10) / 10);
  SP.fmtPct = (v, dp) => (dp != null ? v.toFixed(dp) : Math.round(v)) + '%';

  // smart big-hours: days when large
  SP.fmtHoursSmart = function (h) {
    if (h >= 48) return SP.fmt1(h / 24) + ' days';
    return SP.fmt1(h) + ' h';
  };

  SP.dayKeyToDate = dk => new Date(dk * SEC_PER_DAY * 1000);
  SP.fmtDate = function (dk, opts) {
    const d = SP.dayKeyToDate(dk);
    const mo = MONTHS[d.getUTCMonth()], day = d.getUTCDate(), y = d.getUTCFullYear();
    if (opts === 'short') return `${mo} ${day}`;
    return `${mo} ${day}, ${y}`;
  };
  SP.fmtSecDate = function (sec) {
    const d = new Date(sec * 1000);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  };
  SP.monthKeyLabel = function (mk, withYear) {
    const y = (SP.BASE_YEAR || 2020) + Math.floor(mk / 12), mo = mk % 12;
    return withYear ? `${MONTHS[mo]} ’${String(y).slice(2)}` : MONTHS[mo];
  };

  SP.CONST = { MS_PER_HOUR, SEC_PER_DAY, MIN_LISTEN_MS };
})();
