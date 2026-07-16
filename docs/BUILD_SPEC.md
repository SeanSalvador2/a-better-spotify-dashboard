# BUILD SPEC — "Soundprint" Spotify Dashboard

Personal listening analytics for Sean: 225,845 plays, Nov 2020 → Jul 2026. Single-file HTML deliverable.

## Architecture

Work in `/root/spotify_dashboard/site/src/` with separate files for sanity, then a build script produces ONE self-contained `soundprint.html`:

```
site/src/index.html        — skeleton with <!-- INLINE:xxx --> markers
site/src/styles.css        — all CSS (design tokens from DESIGN_BRIEF.md)
site/src/core.js           — data decode, derived typed arrays, filter engine, aggregation helpers
site/src/charts.js         — ECharts base theme, chart factory helpers, SVG sparkline generator
site/src/sections/*.js     — one file per section (overview, trends, artists, tracks, clock, behavior, wrapped)
site/src/app.js            — routing, filter bar, section lifecycle, GSAP choreography
site/build.py              — inlines CSS+JS, embeds dataset.json.gz as base64, inlines vendor libs + fonts → ../soundprint.html
```

**Fully self-contained requirement:** download ECharts 5.5.1, GSAP 3.15.0 + ScrollTrigger, CountUp 2.10.0, canvas-confetti 1.9.4 from cdnjs into `site/vendor/` and INLINE them into the final HTML (works offline, immune to CSP). Download woff2 subsets of Bricolage Grotesque (400/600/800), Manrope (400/500/600/700), JetBrains Mono (500/700) from Google Fonts and inline as base64 `@font-face` (latin subset only to keep size down). No external requests in the final file at all.

**Data:** embed `dataset.json.gz` as base64 in a `<script type="application/gzip-base64">` tag; decode via fetch(data:)/DecompressionStream per `docs/DATA_SPEC.md` snippet. Fallback: if DecompressionStream unavailable, show a friendly "please use a modern browser" note.

**Startup:** decode → build derived typed arrays ONCE (year, month index, day-of-year key, dayKey = days since epoch, hour, weekday, minutes = ms/60000) → compute base aggregates → render Overview. Show a branded loading splash with progress ("Decoding 225,845 plays…") that transitions into the GSAP entrance.

**Filter engine (global, applies to EVERY section):**
- Date range: year chips (All · 2020 … 2026) + custom range via a brush timeline (ECharts dataZoom) in the filter bar drawer.
- Content type: Music / Podcasts / All toggle.
- Metric mode: **Hours vs Plays** toggle — every ranking/chart respects it.
- Min-listen threshold toggle: "count a play only if ≥30s" (on by default for rankings; skips still tracked separately).
- Artist focus: search box with typeahead over all 2,660 artists; selecting one scopes EVERY section to that artist (dashboard becomes "artist detail mode" — banner chip shows active filter, X to clear).
- Filter state = plain JS object + pub/sub; on change, recompute aggregates for the ACTIVE section only (typed-array loops over 225k rows are <10ms, fine synchronously).
- Filtered subset = Uint32Array of play indices, computed once per filter change, shared by all aggregators.

**Section lifecycle:** hash routing (#/overview etc.), lazy chart init on first activation, `resize()` on show, ECharts `setOption` (not rebuild) on filter change. Charts render only for active section.

## Sections & metrics (implement ALL)

### 1. Overview (#/overview)
- KPI hero row (CountUp): total hours, total plays, unique artists, unique tracks, unique albums, days-with-listening / total days ("you listened on 87% of days").
- Cumulative listening area chart (hours over time, full span, with dataZoom brush).
- "Lifetime in numbers" strip: avg hours/day, avg plays/day, longest streak (consecutive days), biggest single day (date + hours + what you played), total skips, distinct countries.
- Milestones timeline: first play ever (track/date), 50k/100k/150k/200k-th play (what+when), each year's first & last song.
- Top 5 artists / top 5 tracks mini-leaderboards (respect metric toggle) with inline SVG spark trends and share-of-listening bars.
- "% of waking life" fun stat for the selected range.

### 2. Trends (#/trends)
- Calendar heatmaps, one per year (ECharts calendar+heatmap, green ramp), tooltip = date, hours, top track that day.
- Monthly listening bar/line combo (hours + plays overlay), with YoY ghost overlay toggle.
- Year-over-year grouped comparison (hours per year, plays per year).
- Rolling 30-day average line ("listening momentum") with era annotations (top artist of each 6-month window labeled on the chart).
- Streaks & records panel: longest daily streak (with dates), longest drought, top 10 biggest days table.
- Seasonal profile: avg hours by month-of-year across all years (radar or bar).

### 3. Artists (#/artists)
- Top artists leaderboard (top 25, animated horizontal bars, rank ± vs previous equivalent period, spark trend per artist, hours & plays & % share columns). Click an artist row → sets global artist focus.
- Rank bump chart: top 10 artists' rank evolution per half-year (ECharts inverse-y lines, emphasis focus).
- Artist streamgraph (themeRiver) of top 12 artists' monthly hours — "the flow of taste".
- Discovery timeline: scatter/strip of when each significant artist (≥3h total) was FIRST heard, x=date, y=eventual total hours, point size=plays; tooltip tells the first track.
- Loyalty & depth panel: for top 15 — days in rotation (first→last play span), catalog depth (unique tracks), obsession score (peak month hours / avg month hours).
- Rising vs fading: biggest rank climbers/fallers comparing last 12 months vs prior 12.
- One-hit wonders: artists with huge plays on exactly 1 track.

### 4. Tracks & Albums (#/tracks)
- Top tracks leaderboard (top 25, same treatment as artists; shows artist, hours, plays, completion %, skip %).
- "On repeat" binges: most plays of one track in a single day (top 10, with date).
- Track lifespans gantt-ish chart: top 15 tracks' first→last play bars with play-density shading.
- Never-skip songs (≥50 plays, lowest skip rate) vs most-skipped (highest skip rate, ≥20 plays).
- Completion-rate distribution histogram (how much of songs you play before moving on).
- Top albums leaderboard (top 15) + album loyalty (listened tracks per album).
- Podcast corner (if podcasts in filter): top shows by hours, episode count.

### 5. Listening Clock (#/clock)
- Hour × weekday heatmap 24×7 (warm ramp) — the centerpiece.
- Radial 24h clock (hours by hour-of-day, ECharts polar bar) with day/night shading.
- Weekday vs weekend split donut + hours-by-weekday bars.
- Night-owl panel: % of listening midnight–5am, your top "3am songs" list, latest-night sessions.
- Hourly personality per period: "Your peak hour is 5pm" callout; morning/afternoon/evening/night stacked composition over years (are you becoming more of a night listener?).
- Sessions: definition = gap >30min splits sessions. Session count, median/avg length, longest session ever (date, duration, tracklist size), sessions-per-day trend, session length histogram.

### 6. Behavior (#/behavior)
- Skip anatomy: skip rate over time (monthly line), skip rate by hour-of-day, skip rate by platform; "songs die at X seconds" — distribution of ms_played for skipped plays.
- How plays start/end: reason_start & reason_end breakdown (clickable → trackdone vs fwdbtn etc.), autoplay vs chosen ("intentionality index" = clickrow+playbtn+backbtn share) over time.
- Shuffle: shuffle rate over time + shuffle vs sequential by artist (who do you album-listen vs shuffle).
- Platforms: device mix donut + platform evolution stacked area over time (Windows era → iPhone era), plays by platform by hour heatmap strip.
- Travel map-ish: countries listened from (list with flags via unicode regional indicators, hours each, date ranges — 8 countries).
- Offline & incognito counts, offline listening over time.

### 7. Discovery (#/discovery)
- New-artists-discovered per month bar chart + cumulative unique artists curve.
- Explore vs repeat ratio over time (share of plays that are first-ever plays of a track, monthly).
- Diversity index: monthly Shannon entropy of artist distribution, plotted over time — "are your tastes narrowing?" with plain-English annotation.
- Era detection: contiguous periods where one artist dominated (≥25% share over ≥60 days) rendered as a horizontal era-band timeline ("The Zach Bryan Era: Mar 2022 – Nov 2023").
- Discovery hall of fame: tracks/artists discovered each year that became top-100 lifetime.
- "Time machine": pick any past month (dropdown) → snapshot card of that month's top 5 artists/tracks + hours.

### 8. Wrapped (#/wrapped)
- Year selector (2020…2026 chips) → full-viewport scroll-snap story per DESIGN_BRIEF §6: total minutes → top artist (with share %) → top track (play count) → top 5 list → biggest day → listening personality (derived label from stats: e.g. "The Loyalist" high repeat share, "The Explorer" high discovery, "Night Owl", "Marathoner") → summary share card → confetti finale.
- Summary card styled as a shareable 9:16-ish poster (pure DOM, looks screenshot-able).

## Phasing (you'll be driven phase by phase)
1. Shell: build system, tokens/CSS, sidebar+routing, splash, data decode+derived arrays, filter engine, filter bar, Overview complete, GSAP entrance.
2. Trends + Artists + Tracks.
3. Clock + Behavior + Discovery + Wrapped + confetti.
4. Polish & fix pass from screenshot review.

## Quality bar
- Follow DESIGN_BRIEF.md exactly (tokens, fonts, palette, animation spec, anti-patterns).
- Every chart: dark base theme, branded tooltip, respects filters + metric toggle, no jank.
- Numbers formatted: 1,234 separators, hours as "1,204 h" or "50.2 days" where fun, tabular-nums.
- Empty states: if a filter yields no data (e.g. podcasts in 2020), show a tasteful empty state, never NaN.
- Test in headless Chromium (Playwright is available, executablePath /opt/pw-browsers/chromium) after each phase: zero console errors, screenshot each section.
