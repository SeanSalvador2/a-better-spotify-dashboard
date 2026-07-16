# DESIGN BRIEF

Machine-consumed. Dense and prescriptive. Build target: one `.html` file, dark theme, 7-section SPA, ~30+ charts over 225k Spotify plays.

## 1. Design principles (distilled from the best sources)

These are the concrete, repeatedly-cited rules from Anthropic's official "Prompting for frontend aesthetics" cookbook, the reverse-engineered frontend-design skill, and the "purple gradient" analysis. Follow them literally.

**Typography rules**
- **Banned fonts** (the #1 AI-slop tell): Inter, Roboto, Arial, Open Sans, Lato, system-ui defaults. Also treat Space Grotesk as overused/burned.
- Pick **one distinctive display face + one clean body face + one mono for data**. High contrast between them = interesting (display + mono, or grotesque + geometric sans).
- **Use weight extremes**: pair 200–300 against 700–800, not 400 vs 600.
- **Use size extremes**: hero-to-body jumps of 3x+ (not the timid 1.25x modular scale everywhere). Big numbers should be genuinely huge.
- Always `font-variant-numeric: tabular-nums` on any metric/counter so digits don't jitter when animating.
- `text-wrap: balance` on headings, `text-wrap: pretty` on body.

**Color rules**
- **Dominant color + sharp accents beats a timid, evenly-distributed palette.** Commit to ONE aesthetic. Drive everything from CSS custom properties (use `oklch()` where possible for perceptually even ramps).
- Dark-mode specifics: **never pure black `#000`** (use near-black grey/green), **never pure white text `#fff`** (causes halation/vibration — use off-white). Limit vibrant accents to **2–3 max**; desaturate bright hues slightly because they over-saturate on dark. Keep secondary data muted, reserve the loud accent for the single most important metric per view.

**Spacing & layout rules**
- Use a strict spacing scale (below). Generous whitespace between components — data-dense dashboards fail from cramming, not from too much air.
- Avoid the three-box icon grid, the centered-hero, the cookie-cutter SaaS shell. Prefer **asymmetric, editorial, split layouts** and real CSS Grid.

**Motion rules**
- **One well-orchestrated page-load with staggered reveals beats scattered micro-interactions.** Concentrate motion into high-impact moments (page enter, section reveal, counter run), keep the rest calm.
- CSS-first for simple stuff; a real timeline lib (GSAP) for choreography.

**Concrete scales to hard-code as tokens:**
- Spacing (4px base): `4, 8, 12, 16, 24, 32, 48, 64, 96, 128` → `--sp-1..--sp-10`.
- Radius: `6px` (controls), `12px` (cards), `20px` (feature panels), `999px` (pills).
- Type scale (rem): `0.75 (label) · 0.8125 (caption) · 0.9375 (body) · 1.125 (lead) · 1.5 (h3) · 2 (h2) · 2.75 (h1) · clamp(4,12vw,11) (wrapped hero)`. Ratio ~1.33 for UI; deliberate 3–4x jump to the hero tier.
- Line-height: `1.05` display, `1.2` headings, `1.55` body.
- Letter-spacing: `-0.03em` on huge display numbers, `-0.01em` headings, `0.08em` uppercase labels.

## 2. Visual direction

**Concept:** "Spotify listening lab, after dark." Elevated Spotify green on a near-black warm-charcoal base, Linear/Stripe-grade restraint, one loud accent per screen, subtle green bloom/glow as atmosphere rather than flat fills. Editorial big-type recap moments (Wrapped) contrast with dense, precise analytics grids.

**Palette (exact hex — set as CSS vars):**

Surfaces (layered elevation, warm near-black with a green undertone):
- `--bg-0` page: `#0A0C0B`
- `--bg-1` card/surface: `#121513`
- `--bg-2` raised/hover: `#1A1E1B`
- `--bg-3` popover/tooltip: `#22271F`
- `--hairline` border: `rgba(255,255,255,0.07)`
- `--hairline-strong`: `rgba(255,255,255,0.12)`

Text (off-white, never `#fff`):
- `--tx-hi`: `#F4F5F1`
- `--tx-mid`: `#AEB4A9`
- `--tx-low`: `#6B716A`

Accent (Spotify green, elevated):
- `--accent`: `#1ED760` (primary, the loud one)
- `--accent-deep`: `#1DB954` (Spotify canonical, for solid fills/hover)
- `--accent-lime`: `#A7F432` (gradient partner / highlight)
- Signature gradient: `linear-gradient(135deg, #1ED760 0%, #A7F432 100%)` and for glow `radial-gradient(60% 60% at 50% 0%, rgba(30,215,96,0.18), transparent 70%)`.

Data-viz categorical set (dark-tuned, saturation-capped, ordered by priority so #1 = green):
`#1ED760 · #34D3EB · #FF6B9D · #FFB347 · #7CC4FF · #C792EA · #F45B5B · #E8E6DF`
(Green, cyan, pink, amber, sky, soft-violet-used-sparingly, coral, bone. 6–7 distinguishable series before switching to shape/label.)

Sequential ramp for heatmaps (green, low→high): `#0E1A12 → #10402A → #158A4B → #1ED760 → #A7F432`. For the hour×weekday "peak listening" matrix use a warmer ramp for emotional pop: `#12100E → #3A2A12 → #B0641E → #FF9F1C → #FFD97D`.

**Typography (all on Google Fonts, loaded via `<link>`):**
- Display / hero numbers: **Bricolage Grotesque** — weights 400/600/800, variable. Section titles and Wrapped big numbers.
- Body / UI: **Manrope** — weights 400/500/600/700.
- Data / mono / counters: **JetBrains Mono** — 500/700, for stat tiles, axis labels, big animated counters.
- Font CSS: `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap`

**Card / border / shadow / texture specs:**
- Cards: `--bg-1`, `1px solid var(--hairline)`, radius `12px`, inner top highlight `inset 0 1px 0 rgba(255,255,255,0.04)`. Do NOT use the generic `0 1px 3px rgba(0,0,0,.1)` drop shadow. Lift with a soft, colored, wide shadow only on hover: `0 8px 40px -12px rgba(0,0,0,0.6)` plus, on active/featured cards, a faint green glow `0 0 0 1px rgba(30,215,96,0.25), 0 12px 48px -16px rgba(30,215,96,0.18)`.
- Feature/Wrapped panels: radius `20px`, layered radial green bloom behind, subtle grain.
- Texture/atmosphere: page background = `--bg-0` + one fixed radial green bloom top-center at ~12–18% alpha + an optional ~2–3% opacity SVG noise/grain overlay (data-URI). Hairline 1px grid or dot texture at 3–4% alpha in hero areas for depth.
- Focus ring (accessibility, required): `outline: 2px solid var(--accent); outline-offset: 2px;` on all interactive elements.

## 3. Layout & navigation pattern

- **Left vertical sidebar rail** for the 7 sections (Overview, Trends/Timeline, Artists, Tracks & Albums, Listening Clock, Discovery/Behavior, Wrapped Recap). Width ~240px expanded; each item = icon + label + active state (green left indicator bar + `--bg-2` fill + green text). Compact "profile" header (total plays / date span) at top of rail.
- **Client-side routing:** hash-based (`#/overview`) or JS `showSection()` swap — no framework, no build. Only mount/instantiate a section's charts when it becomes active.
- **Global filter bar:** sticky at the top of the content column, holding: year segmented control (All · 2020…2026), date-range brush/dataZoom, and toggles. Filter state lives in a JS object in memory (no localStorage). Changing a filter re-renders only the active section's charts via `setOption` (never full rebuild).
- **Content grid:** 12-col CSS Grid, `max-width: 1440px`, gutters `--sp-6`. Mix tile sizes (asymmetric): hero stat row of 3–4 KPI tiles, then 2/3 + 1/3 splits. Avoid uniform equal boxes.
- **Responsive:** ≥1200px sidebar + multi-col grid. 768–1199px sidebar collapses to icon-only rail (64px), grid → 1–2 col. <768px sidebar → bottom tab bar, all charts full-width single column. Charts must call `.resize()` on breakpoint + on becoming visible.

## 4. Animation spec

**Libraries (verified cdnjs URLs — plain `<script>` tags, UMD globals):**
- GSAP 3.15.0: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js`
- GSAP ScrollTrigger 3.15.0: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/ScrollTrigger.min.js` (load after core, `gsap.registerPlugin(ScrollTrigger)`)
- CountUp.js 2.10.0 (UMD global `countUp.CountUp`): `https://cdnjs.cloudflare.com/ajax/libs/countup.js/2.10.0/countUp.umd.min.js`
- canvas-confetti 1.9.4 (global `confetti`): `https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.9.4/confetti.min.js`

Standardize on GSAP as the single motion engine (no anime.js). ECharts supplies its own chart entrance animations.

**Where each animation goes:**
- **App first load:** GSAP timeline, staggered reveal of sidebar items then KPI tiles (`y: 16→0, opacity: 0→1, stagger: 0.05, ease: "power3.out"`).
- **KPI counters:** CountUp on hero stat tiles, 1.2–1.8s, `useEasing: true`, trigger when tile enters viewport.
- **Chart entrances:** ECharts built-in `animationDuration: 900, animationEasing: 'cubicOut'`, plus GSAP fade/rise on the chart card wrapper. Stagger sibling charts by 60–80ms. Only animate a chart the first time its section mounts.
- **Page/section transitions:** cross-fade + 8–12px slide of the content column (GSAP, 250–350ms).
- **Hover microinteractions:** cards lift (`translateY(-2px)` + colored shadow/glow), 150ms; sidebar items slide indicator; chart tooltips ECharts-native. All transform/opacity only.
- **Scroll reveals (Wrapped + long sections):** ScrollTrigger `batch()` with `start: "top 85%"` to fade/rise elements once.
- **Wrapped finale:** `confetti()` in Spotify green/lime palette on the final recap card.

**Performance rules (mandatory):**
- Animate **only `transform` and `opacity`**. `will-change: transform` only on currently-animating nodes, remove after.
- **`prefers-reduced-motion`**: wrap all GSAP/ScrollTrigger/confetti in a guard; when reduced, set final states instantly, show final numbers, disable confetti.
- Use `ScrollTrigger.batch` (not one trigger per element). Kill/refresh ScrollTriggers on section change.
- Don't animate off-screen charts.

## 5. Charting recommendation

**Primary library: Apache ECharts 5.5.1 (canvas renderer).** Global `echarts`:
`https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js`
Optional D3 7.9.0 (only for custom bump/radial): `https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js`

**Dark theming ECharts:** don't rely on a theme file — reusable base-option merged into every chart: `textStyle.color: '#AEB4A9'`, `backgroundColor: 'transparent'`, axisLine/splitLine `rgba(255,255,255,0.07)`, global `color: [<categorical array from §2>]`. Tooltips: `backgroundColor: '#22271F'`, `borderColor: 'rgba(255,255,255,0.12)'`, `textStyle.color: '#F4F5F1'`.

**Chart-type mapping:**
- **Calendar heatmap** (plays per day): ECharts `calendar` coordinate + `heatmap` series, one `calendar` block per year stacked vertically, green sequential ramp via `visualMap`. `cellSize: ['auto', 14]`.
- **Hour × weekday matrix** (24×7): ECharts `heatmap` on two `category` axes, warm ramp `visualMap`, rounded cells via `itemStyle.borderRadius`.
- **Rank bump chart** (top-artist rank over time): ECharts `line` series, one per artist, y-axis rank `inverse: true`, `smooth: true`, emphasis focus fade for non-hovered.
- **Streamgraph** (artist share over time): ECharts `themeRiver` for the "flow of taste" feature moment; or stacked `line` with `areaStyle`, `stack:'total'`, `sampling:'lttb'`.
- **Brush date selector**: ECharts `dataZoom` — `type:'slider'` + `type:'inside'` on a `time` x-axis. This drives the global filter bar.
- **Bar race** (top artists month by month): ECharts `timeline` + horizontal `bar` with `realtimeSort:true`; alternative: static ranked bar with year toggle.
- **Sparklines**: do NOT instantiate dozens of ECharts instances — hand-roll tiny inline SVG polylines (shared 40×16 generator). Reserve ECharts for ~1 large chart per section.

**Performance for 225k records + 30+ charts:**
- **Pre-aggregate once on load.** Charts consume aggregates (hundreds–few-thousand points), never 225k raw rows. Heavy parsing/aggregation in an inlined Web Worker (Blob URL) if needed so UI never blocks.
- **Lazy-init per section:** create ECharts instances only when a section activates. `chart.resize()` on show. Optionally `.dispose()`/`.clear()` previous section.
- ECharts opts: `renderer:'canvas'`, `useDirtyRect:true`, `progressive` for big heatmaps, `sampling:'lttb'` on long lines, `animationThreshold`.

## 6. Wrapped-recap screen spec

Goal: **bold type on flat color, high-contrast palette, numerals treated as graphic form, constant gentle motion, one custom reveal per stat.** A story you scroll through, not a dashboard page.

- **Structure:** full-viewport vertical slides, `scroll-snap-type: y mandatory; scroll-snap-align: start` on each 100vh panel; ScrollTrigger `pin` for counter beats. 6–9 panels: total minutes → top artist → top track → biggest listening day → "personality" line → shareable summary card → confetti finale.
- **Type sizes:** the number is the hero — `clamp(4rem, 14vw, 12rem)`, Bricolage Grotesque 800, `letter-spacing:-0.04em`, `line-height:0.95`. Label above in JetBrains Mono uppercase `0.8125rem`, `letter-spacing:0.12em`, `--tx-mid`. Context line below in Manrope `1.125–1.5rem`.
- **Gradient recipe:** fill the big number with `background: linear-gradient(135deg,#1ED760,#A7F432); -webkit-background-clip:text; color:transparent;` + soft green bloom behind (radial gradient, 18–24% alpha). Vary one panel to cyan→green, one to pink→amber — keep most panels near-monochrome so the pops land.
- **Reveal choreography (per panel, on scroll into view):** (1) label fades/drops in first (200ms), (2) big number: CountUp runs from 0 while doing a masked wipe-up (GSAP `yPercent` reveal behind overflow-hidden mask), 1.2–1.6s, `power4.out`, (3) context line + mini-chart stagger in 120ms later. Slow perpetual drift (2–4px, 6s yoyo) so panels feel alive.
- **Finale card:** composed shareable summary (top 5 artists, minutes) on a green-gradient panel with grain; fire `confetti()` once, `origin:{y:0.3}`, respecting reduced-motion.

## 7. Anti-patterns to avoid

- Purple/indigo/violet gradients as primary theme — violet only as one minor categorical series.
- Inter / Roboto / Arial / system-ui / Open Sans anywhere. No Space Grotesk.
- Pure `#000000` backgrounds or pure `#ffffff` text.
- Generic `box-shadow: 0 1px 3px rgba(0,0,0,0.1)` on every card; uniform equal-size box grids; centered-everything layouts; three-icon feature rows.
- Emoji used as UI icons; use real inline-SVG icons (Lucide/Feather markup pasted in).
- Evenly-weighted rainbow palettes; one dominant + muted rest.
- Over-animation: entrance animation on every element, bouncy easings everywhere. Concentrate motion; keep body calm.
- One ECharts instance per sparkline; feeding raw 225k rows to any chart; re-rendering all sections' charts on every filter change; animating width/height/box-shadow.
- Glassmorphism/blur overload and neon-on-black cyberpunk clichés — stay in the "elevated Spotify / Linear-quality" lane.
- Timid 1.25x type scale with no true hero tier; low-contrast grey-on-grey text below WCAG.
- Ignoring `prefers-reduced-motion`; missing visible focus rings.

**Verified CDN URLs to hard-code (all cdnjs, UMD globals, no build):**
- `https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/gsap.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/ScrollTrigger.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/countup.js/2.10.0/countUp.umd.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/canvas-confetti/1.9.4/confetti.min.js`
- (optional) `https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js`
- Fonts: `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap`
