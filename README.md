# Reykjavík 40

A documentary web edition commemorating the 40th anniversary of the Reykjavík
Summit between Ronald Reagan and Mikhail Gorbachev at Höfði House, 11–12
October 1986.

The site presents every document from the Reykjavík section of the *Foreign
Relations of the United States* series alongside declassified cables from the
State Department FOIA Virtual Reading Room and the post-summit chronology from
FRUS 1981–1988 Volume VI. Three synchronized views — a **Negotiation Network**,
an **Hour-by-Hour Timeline**, and a filterable **Document Explorer** — cross-link
every visual element to its canonical primary source.

The tone and typography are modeled on the U.S. Department of State's Office
of the Historian. See [`docs/FRUS_AESTHETIC.md`](docs/FRUS_AESTHETIC.md) for
the design system and [`SOURCES.md`](SOURCES.md) for provenance and query
terms for every feed.

## What the site contains

| Feed | Documents | Range |
|---|---|---|
| FRUS 1981–1988 Vol. V (Reykjavík section, Docs 267–309) | 43 | Sep – Oct 1986 |
| FRUS 1981–1988 Vol. VI (aftermath) | 39 | Oct 1986 – Mar 1987 |
| foia.state.gov Virtual Reading Room (relevance-filtered) | 15 | Aug 1986 – Mar 1987 |
| **Total documents** | **97** | |

Every document row exposes `doc_id`, `source`, `title`, `date`, canonical
`url`, `summit_phase`, `session`, `persons[]`, and `topics[]`. FOIA releases
are rendered in a clearly labeled "Declassified" layer distinct from FRUS
records.

## Repository layout

```
reykjavik-40/
├── site/                       # Static site (deploy root)
│   ├── index.html
│   ├── assets/{css,js}/
│   └── data/                   # frus_core.json, network.json, timeline.json, manifest.json
├── scripts/
│   ├── parse_frus.py           # TEI ingestion for Vols V and VI
│   ├── fetch_foia.py           # foia.state.gov API client + relevance filter
│   └── build_core.py           # Merges the three feeds into the site data files
├── data/
│   ├── raw/                    # Cached TEI XML from HistoryAtState/frus
│   └── processed/              # frus_core.{json,csv}, network.json, timeline.json, manifest.json
├── docs/FRUS_AESTHETIC.md      # Design system: typography, palette, motion, accessibility
├── SOURCES.md                  # Provenance and query terms for every feed
└── screenshots/                # Playwright captures used during QA
```

## Data pipeline

The pipeline is deterministic and re-runnable from source. Each step writes
into `data/processed/` and the final step also mirrors artifacts into
`site/data/` so the front end has no external dependencies at runtime.

```bash
# 1. Ingest FRUS TEI from HistoryAtState/frus (Vols V and VI cached under data/raw/)
python3 scripts/parse_frus.py

# 2. Fetch declassified releases from foia.state.gov and apply the relevance filter
python3 scripts/fetch_foia.py

# 3. Merge the three feeds into frus_core.json/csv, network.json, timeline.json, manifest.json
python3 scripts/build_core.py
```

Requirements: Python 3.9+ and the standard library only (`urllib`, `xml.etree`,
`json`, `csv`, `re`). No third-party packages are used in the pipeline or on
the site.

### Session mapping (correction of note)

The initial brief identified Doc 306 as the "final full memcon." Cross-checking
the source-note headnotes in the TEI and the Reagan diary excerpts published
alongside the volume yields the following canonical session map, which the
parser encodes in `SESSION_MAP`:

| Doc | Session |
|---|---|
| 301 | Session I — Reagan/Gorbachev, morning 11 Oct 1986 |
| 302 | Session II — Reagan/Gorbachev, afternoon 11 Oct 1986 |
| 303 | Overnight working group draft (subsequently disavowed by Ridgway) |
| 306 | Session III — Reagan/Gorbachev, morning 12 Oct 1986 |
| 307 | Shultz–Shevardnadze foreign ministers meeting, 12 Oct 1986 |
| 308 | Session IV — Reagan/Gorbachev, final plenary, afternoon 12 Oct 1986 |

The correction is documented in code comments in `scripts/parse_frus.py` and
in `SOURCES.md`.

## Local preview

```bash
cd site
python3 -m http.server 8081
# open http://localhost:8081/
```

The site is a static single-page application with no build step. All data is
loaded from `site/data/*.json` at page load.

## Deployment (GitHub Pages)

The `site/` directory is the publish root. To serve on GitHub Pages:

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main`, folder: `/site`
3. A `.nojekyll` file is included in `site/` to disable Jekyll processing so
   that any underscore-prefixed paths and raw JSON in `site/data/` are served
   as-is.

Any static host (Cloudflare Pages, Netlify, S3+CloudFront) can serve the
`site/` directory unchanged.

## Standards

- **Provenance.** Every document card and every network/timeline element
  links back to the canonical source URL on `history.state.gov` or
  `foia.state.gov`. Unverified document numbers, if any, are surfaced in
  `manifest.json → unverified` and flagged in the UI.
- **Accessibility.** WCAG AA contrast for all foreground/background token
  pairs; keyboard navigation across the three views and the transcript pane;
  visible focus rings; semantic landmarks.
- **No third-party runtime dependencies.** The site is vanilla HTML, CSS, and
  JavaScript. The network graph is drawn with hand-written SVG rather than a
  force-directed library so that the layout is deterministic and reviewable.

## Sources

- *Foreign Relations of the United States, 1981–1988, Volume V, Soviet Union,
  March 1985–October 1986* — Office of the Historian, U.S. Department of
  State. <https://history.state.gov/historicaldocuments/frus1981-88v05>
- *Foreign Relations of the United States, 1981–1988, Volume VI, Soviet
  Union, October 1986–January 1989* — Office of the Historian.
  <https://history.state.gov/historicaldocuments/frus1981-88v06>
- TEI XML source: <https://github.com/HistoryAtState/frus>
- foia.state.gov Virtual Reading Room: <https://foia.state.gov/>

See [`SOURCES.md`](SOURCES.md) for exact URLs, TEI paths, and FOIA query terms.

## License

The primary source documents are U.S. Government works and are in the public
domain. Editorial code, design system, and derived data files in this
repository are released under the MIT License; see `LICENSE` if present.
