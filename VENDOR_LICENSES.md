# Vendor licenses

Soundprint's output is a single, fully offline HTML file, so all of its
front-end libraries and fonts are inlined into that file at build time. This
document records what each bundled dependency is, its license, and how it is
distributed in this repository.

## Summary

| Library | Version | License | In this repo? |
|---|---|---|---|
| [Apache ECharts](https://echarts.apache.org/) | 5.6.0 | Apache-2.0 | Committed (`site/vendor/echarts.min.js`) |
| [GSAP](https://gsap.com/) | 3.15.0 | GreenSock Standard "No Charge" License | **Not committed — fetched at build time** |
| [GSAP ScrollTrigger](https://gsap.com/scrolltrigger/) | 3.15.0 | GreenSock Standard "No Charge" License | **Not committed — fetched at build time** |
| [CountUp.js](https://github.com/inorganik/countUp.js) | 2.x | MIT | Committed (`site/vendor/countUp.umd.min.js`) |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.x | ISC | Committed (`site/vendor/confetti.min.js`) |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | — | SIL OFL 1.1 | Committed (`site/vendor/fonts/`) |
| [Manrope](https://github.com/sharanda/manrope) | — | SIL OFL 1.1 | Committed (`site/vendor/fonts/`) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | — | SIL OFL 1.1 | Committed (`site/vendor/fonts/`) |

## The GSAP decision

ECharts (Apache-2.0), CountUp.js (MIT), canvas-confetti (ISC) and the three
fonts (SIL Open Font License 1.1) all carry permissive licenses that explicitly
allow redistribution, so their files are committed directly to the repository.

GSAP is different. GSAP ships under GreenSock's *Standard "No Charge" License*,
whose header reads **"Copyright 2026, GreenSock. All rights reserved. Subject to
the terms at https://gsap.com/standard-license."** That license grants very broad
rights to *use* GSAP in unlimited websites and applications at no cost, but it is
not an open-source license and it reserves redistribution rights — it is not
clearly intended to cover shipping GSAP's minified source inside an unrelated
public code repository.

To stay unambiguously on the safe side, **this repository does not redistribute
the GSAP files.** Instead, `site/build.py` downloads `gsap.min.js` and
`ScrollTrigger.min.js` from the official
[cdnjs](https://cdnjs.cloudflare.com/ajax/libs/gsap/3.15.0/) mirror on the first
build, pinned to version 3.15.0 and verified against a known-good SHA-256 hash
before use. They are written into `site/vendor/` (which is gitignored for those
two files) and inlined into your local `soundprint.html` exactly like every other
library. The result is identical; only the *distribution* differs.

If you would rather not fetch anything at build time, you may download the two
files yourself from cdnjs (or `npm install gsap`) and drop them into
`site/vendor/`; `build.py` uses any files already present and skips the download.

Using GSAP inside the dashboard you generate for yourself is well within GSAP's
no-charge license. See https://gsap.com/community/standard-license/ for the full
terms.

## Fonts

The three font families are subset WOFF2 files under the SIL Open Font License
1.1, which permits bundling and redistribution (including embedding) provided the
fonts are not sold on their own. Base64-embedding them in the output HTML is
permitted use.
