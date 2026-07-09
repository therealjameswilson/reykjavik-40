# Reykjavík 40

A documentary web edition commemorating the 40th anniversary of the Reykjavík
Summit between Ronald Reagan and Mikhail Gorbachev at Höfði House, 11–12
October 1986.

The site presents every document from the Reykjavík section of the *Foreign
Relations of the United States* series alongside declassified cables from the
State Department FOIA Virtual Reading Room and the post-summit chronology from
FRUS 1981–1988 Volume VI. Four synchronized views — a **Participation
Register** (an archival attendance chart of who is present in the record,
month by month, with numbered editorial notes), **Höfði House** (a
playable staging of the six documented meetings of the two summit days,
with attendance exactly as printed in each memcon's list of
participants), an **Hour-by-Hour Timeline**, a filterable **FRUS Document
Explorer**, and a **Declassified PDFs from FOIA 1986-04261** library — cross-link every visual
element to its canonical primary source. The PDF Library serves the full
73-document FOIA release for case F-1986-04261 (the Reykjavík meeting)
locally from `docs/assets/pdf/`, with a link back to each canonical copy
in the Department of State's Virtual Reading Room.

The tone and typography are modeled on the U.S. Department of State's Office
of the Historian. See [`docs/design/FRUS_AESTHETIC.md`](docs/design/FRUS_AESTHETIC.md) for
the design system and [`SOURCES.md`](SOURCES.md) for provenance and query
terms for every feed.

## What the site contains

The edition ships the full source material: the whole Reykjavík section
of Volume V, the Volume VI aftermath window, every document the Office
of the Historian's annotation program tagged with the *Reykjavik Summit
(1986)* Event entity (which pulls in the Volume XI START I negotiation
trail), and the relevance-filtered FOIA releases. A date filter
(`FRUS_DATE_ALLOWLIST` in `scripts/build_core.py`) remains available to
cut a summit-days-only sub-edition.

| Feed | Documents | Range |
|---|---|---|
| FRUS 1981–1988 Vol. V (Reykjavík section, Docs 267–309) | 43 | Sep – Oct 1986 |
| FRUS 1981–1988 Vol. VI (aftermath; Doc 1 anchors the timeline) | 39 | Oct 1986 – Mar 1987 |
| Reykjavik-tagged documents from annotated TEI (Vol. XI + Vol. V Doc 206) | 74 | Mar 1986 – Dec 1988 |
| foia.state.gov Virtual Reading Room (relevance-filtered) | 15 | Aug 1986 – Mar 1987 |
| **Total documents** | **171** | |

Every document row exposes `doc_id`, `source`, `title`, `date`, canonical
`url`, `summit_phase`, `session`, `persons[]`, and `topics[]`. FRUS records
additionally carry curated annotations from the Office of the Historian's
annotation program: `subjects[]` (taxonomy subjects with stable refs and
category paths), `events[]` (tagged Event entities such as *Reykjavik
Summit (1986)*), and `annotation_profile{}` (entity counts by type).
`persons[]` merges the TEI-encoded persons with the annotation program's
People entities — 212 network participants in all, each with a canonical
id, side (inferred from the volumes' lists of persons), and role. FOIA
releases are rendered in a clearly labeled "Declassified" layer distinct
from FRUS records.

Alongside the documents, 19 White House Photo Office plates of the two
summit days (11–12 October 1986) are drawn from the Ronald Reagan
Presidential Library's *Summits with Mikhail Gorbachev* gallery and
folded into the Hour-by-Hour Timeline at the moments they depict. They
render as image cards distinct from documents, each credited to the
*White House Photographic Collection, Ronald Reagan Presidential Library*
with a source link. See `SOURCES.md` Feed 6 and `scripts/fetch_reagan_photos.py`.

## Repository layout

```
reykjavik-40/
├── docs/                       # Static site (GitHub Pages publish root)
│   ├── index.html
│   ├── assets/{css,js}/
│   ├── data/                   # frus_core.json, network.json, timeline.json, manifest.json
│   └── design/FRUS_AESTHETIC.md
├── scripts/
│   ├── parse_frus.py           # TEI ingestion for Vols V and VI
│   ├── fetch_foia.py           # foia.state.gov API client + relevance filter
│   ├── fetch_foia_pdfs.py      # Downloads a full FOIA case's PDFs + builds data/foia_pdfs.json
│   ├── parse_hsg_docs.py       # Ingests Reykjavik-tagged docs from annotated TEI (Vol. XI trail)
│   ├── build_core.py           # Merges the four feeds into the site data files
│   ├── enrich_core.py          # Joins subject/event/person annotations; register + network
│   ├── build_summit_stage.py   # Meeting attendance/times for the Höfði House view
│   └── build_standalone.py     # Packages the single-file standalone edition
├── data/                       # Pipeline outputs (source of truth)
│   ├── raw/                    # Cached TEI XML from HistoryAtState/frus
│   └── *.json,*.csv            # frus_core.{json,csv}, network.json, timeline.json, manifest.json
├── SOURCES.md                  # Provenance and query terms for every feed
└── screenshots/                # Playwright captures used during QA
```

## Data pipeline

The pipeline is deterministic and re-runnable from source. Each step writes
into `data/processed/` and the final step also mirrors artifacts into
`docs/data/` so the front end has no external dependencies at runtime.

```bash
# 1. Ingest FRUS TEI from HistoryAtState/frus (Vols V and VI cached under data/raw/)
python3 scripts/parse_frus.py

# 2. Fetch declassified releases from foia.state.gov and apply the relevance filter
python3 scripts/fetch_foia.py

# 3. Ingest the Reykjavik-tagged documents outside Vols V/VI from the
#    annotated TEI corpus (sibling hsg-annotate-data repository)
python3 scripts/parse_hsg_docs.py

# 4. Merge the four feeds into frus_core.json/csv, network.json, timeline.json, manifest.json
python3 scripts/build_core.py

# 5. Join curated subject, event, and person annotations onto the FRUS
#    records; build the participation register (register.json, with its
#    editorial notes) and the co-occurrence network (network.json, kept
#    as a data product). Sources: the sibling frus-subjects and
#    hsg-annotate-data repositories, or the cached extract in
#    data/raw/annotations_supplement.json.
python3 scripts/enrich_core.py

# 6. Extract the summit-day meetings for the Höfði House view: attendance
#    from each memcon's <list type="participants">, windows from the
#    dateline from/to attributes (d303's machine window is corrected to
#    its printed dateline).
python3 scripts/build_summit_stage.py

# 7. Package the standalone single-file edition: stylesheet, script, and
#    all five data artifacts inlined into one HTML file that opens from
#    disk with no server and no Python.
python3 scripts/build_standalone.py
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
cd docs
python3 -m http.server 8081
# open http://localhost:8081/
```

The site is a static single-page application with no build step. All data is
loaded from `docs/data/*.json` at page load.

### Standalone single-file edition

`docs/reykjavik-40-standalone.html` (~1.3 MB) is the whole edition in
one file — stylesheet, script, and all data embedded. It opens directly
from disk (`file://`) with no server, makes no data requests, and can be
emailed or archived as a single artifact. The front end detects the
embedded data block and skips fetching, so the same `frus.js` serves
both the site and the standalone. Regenerate it with
`python3 scripts/build_standalone.py` after any data change.

## Deployment (GitHub Pages)

The `docs/` directory is the publish root. To serve on GitHub Pages:

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main`, folder: `/docs`
3. A `.nojekyll` file is included in `docs/` to disable Jekyll processing so
   that raw JSON in `docs/data/` is served as-is.

Any static host (Cloudflare Pages, Netlify, S3+CloudFront) can serve the
`docs/` directory unchanged.

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
- White House Photographic Collection, Ronald Reagan Presidential Library —
  *Summits with Mikhail Gorbachev* gallery.
  <https://www.reaganlibrary.gov/archives/audiovisual/white-house-photo-collection-galleries/summits-mikhail-gorbachev>
- FRUS subject taxonomy (`frus-subjects`) and annotated TEI corpus
  (`hsg-annotate-data`) — Office of the Historian annotation program;
  see `SOURCES.md` Feeds 4 and 5.

See [`SOURCES.md`](SOURCES.md) for exact URLs, TEI paths, and FOIA query terms.

## License

The primary source documents are U.S. Government works and are in the public
domain. Editorial code, design system, and derived data files in this
repository are released under the MIT License; see `LICENSE` if present.
