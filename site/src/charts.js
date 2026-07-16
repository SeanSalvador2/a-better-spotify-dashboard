/* ============================================================
   SOUNDPRINT — charts.js
   ECharts dark base theme · makeChart factory · branded tooltip · SVG sparklines
   ============================================================ */
(function () {
  'use strict';
  const SP = (window.SP = window.SP || {});

  const CAT = ['#1ED760', '#34D3EB', '#FF6B9D', '#FFB347', '#7CC4FF', '#C792EA', '#F45B5B', '#E8E6DF'];
  SP.CAT = CAT;
  const HAIR = 'rgba(255,255,255,0.07)';
  const HAIR2 = 'rgba(255,255,255,0.12)';
  SP.RAMP_GREEN = ['#0E1A12', '#10402A', '#158A4B', '#1ED760', '#A7F432'];
  SP.RAMP_WARM = ['#12100E', '#3A2A12', '#B0641E', '#FF9F1C', '#FFD97D'];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  SP.reduceMotion = reduceMotion;

  /* ---------- branded tooltip base ---------- */
  const tooltipBase = {
    backgroundColor: '#22271F',
    borderColor: HAIR2,
    borderWidth: 1,
    padding: [10, 12],
    textStyle: { color: '#F4F5F1', fontFamily: 'Manrope, sans-serif', fontSize: 12.5 },
    extraCssText: 'border-radius:10px;box-shadow:0 12px 40px -12px rgba(0,0,0,0.7);backdrop-filter:blur(6px);',
    confine: true,
  };
  SP.tooltipBase = tooltipBase;

  /* ---------- base option merged into every chart ---------- */
  SP.chartBase = function chartBase() {
    return {
      color: CAT.slice(),
      backgroundColor: 'transparent',
      textStyle: { color: '#AEB4A9', fontFamily: 'Manrope, sans-serif' },
      animationDuration: reduceMotion ? 0 : 900,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 18, top: 24, bottom: 8, containLabel: true },
      tooltip: Object.assign({}, tooltipBase),
      textStyleAxis: { color: '#6B716A' },
    };
  };

  // shared axis styling snippets
  SP.axisLine = { lineStyle: { color: HAIR } };
  SP.splitLine = { lineStyle: { color: HAIR, type: 'dashed' } };
  SP.axisLabel = { color: '#6B716A', fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5 };

  // deep-merge only top-level keys we care about (tooltip/textStyle merge shallowly)
  function applyBase(option) {
    const base = SP.chartBase();
    const out = Object.assign({}, base, option);
    // merge tooltip so callers can override formatter while keeping look
    if (option.tooltip !== false) {
      out.tooltip = Object.assign({}, base.tooltip, option.tooltip || {});
    }
    if (option.color === undefined) out.color = base.color;
    delete out.textStyleAxis;
    return out;
  }

  /* ---------- chart registry + factory ---------- */
  const registry = new Map(); // el -> chart

  SP.makeChart = function makeChart(el, option, opts) {
    if (!el) return null;
    let chart = registry.get(el);
    if (!chart || chart.isDisposed()) {
      chart = echarts.init(el, null, { renderer: 'canvas', useDirtyRect: true });
      registry.set(el, chart);
      if (!SP._ro) {
        SP._ro = new ResizeObserver(entries => {
          for (const en of entries) {
            const c = registry.get(en.target);
            if (c && !c.isDisposed()) c.resize();
          }
        });
      }
      SP._ro.observe(el);
    }
    // Full options are rebuilt on every filter change; replace (notMerge) by
    // default so stale series/calendars never linger.
    chart.setOption(applyBase(option), { notMerge: !(opts && opts.merge) });
    return chart;
  };

  SP.getChart = el => registry.get(el);

  SP.resizeAll = function () {
    registry.forEach(c => { if (!c.isDisposed()) c.resize(); });
  };

  SP.disposeChartsIn = function (root) {
    registry.forEach((c, el) => {
      if (root && root.contains(el)) {
        if (SP._ro) SP._ro.unobserve(el);
        if (!c.isDisposed()) c.dispose();
        registry.delete(el);
      }
    });
  };

  window.addEventListener('resize', () => { SP.resizeAll(); });

  /* ---------- SVG sparkline generator (shared, no ECharts) ---------- */
  // values: number[]; returns inline <svg> string
  SP.sparkline = function sparkline(values, opts) {
    opts = opts || {};
    const w = opts.w || 64, h = opts.h || 20, pad = opts.pad != null ? opts.pad : 1.5;
    const stroke = opts.color || '#1ED760';
    const fill = opts.fill;
    if (!values || values.length === 0) return '';
    let max = -Infinity, min = Infinity;
    for (const v of values) { if (v > max) max = v; if (v < min) min = v; }
    if (max === min) { max = min + 1; }
    const n = values.length;
    const dx = n > 1 ? (w - pad * 2) / (n - 1) : 0;
    const sy = (h - pad * 2) / (max - min);
    let pts = '';
    for (let i = 0; i < n; i++) {
      const x = pad + i * dx;
      const y = h - pad - (values[i] - min) * sy;
      pts += (i ? ' ' : '') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    const id = 'sg' + Math.random().toString(36).slice(2, 8);
    let areaEl = '';
    if (fill) {
      areaEl = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${stroke}" stop-opacity="0.28"/>` +
        `<stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>` +
        `<polygon points="${pad},${h - pad} ${pts} ${w - pad},${h - pad}" fill="url(#${id})" stroke="none"/>`;
    }
    return `<svg class="lb-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" preserveAspectRatio="none">` +
      areaEl +
      `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`;
  };

  /* ---------- gradient fill for area/line series ---------- */
  SP.areaGradient = function (color, topAlpha, botAlpha) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: SP.rgba(color, topAlpha != null ? topAlpha : 0.32) },
      { offset: 1, color: SP.rgba(color, botAlpha != null ? botAlpha : 0.02) },
    ]);
  };
  SP.rgba = function (hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };
})();
