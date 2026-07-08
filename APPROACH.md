# Approach

How this edition was researched, built, and verified — and the
principles that governed each decision. This documents the July 2026
expansion, in which the edition grew from a 26-document summit-days
site into a 171-document annotated edition with two new views.

## The three-repository ecosystem

This project sits downstream of two sibling repositories maintained
alongside it:

- **`hsg-annotate-data`** — the Office of the Historian's annotated
  TEI corpus: ~4,600 FRUS documents across 16 volumes carrying inline
  entity annotations (People, Places, Organizations, Events, Topics,
  Programs, Compound Subjects) linked to the Department's entity
  registry, plus per-volume annotation extracts and people-id
  alignment lists.
- **`frus-subjects`** — the published FRUS subject taxonomy (543
  subjects, 13 categories, 1.4M references across 552 volumes),
  carved out of `hsg-annotate-data` as a standalone, citable
  vocabulary with a TEI standOff authority file.

The founding observation of the expansion: this edition and those
repositories describe the same documents. `hsg-annotate-data` carries
"Reykjavik Summit (1986)" as a tagged Event entity across the very
volumes this site parses; `frus-subjects` maps curated subjects onto
every document in the corpus. Rather than maintain a parallel,
regex-based topic and person apparatus, the edition consumes the
Office of the Historian's own annotation layers.

## Phases

### 1. Annotation enrichment

`scripts/enrich_core.py` joins both annotation layers onto every FRUS
record: curated `subjects[]` (taxonomy refs with category paths, from
`frus-subjects`), `events[]` and `annotation_profile{}` (from the
`hsg-annotate-data` extracts). Two principles from this phase:

- **Cache what you consume.** A compact extract is written to
  `data/raw/annotations_supplement.json` so the pipeline re-runs
  without the sibling repositories present.
- **Audit, don't assume.** The "Reykjavik Summit (1986)" Event entity
  became a corpus audit: any tagged document missing from the corpus
  is written to `data/corpus_candidates.json`. This report is what
  motivated the corpus expansion — and it now stands empty as a
  tripwire for future upstream annotation updates.

### 2. Corpus expansion to all source material

The summit-days date filter was retired. The corpus is now: the full
Reykjavík section of Vol. V (Docs 267–309), the Vol. VI aftermath
window, the relevance-filtered FOIA releases, and — via
`scripts/parse_hsg_docs.py` — all 74 documents tagged with the summit
Event entity that fall outside those ranges (the Vol. XI START I
negotiation trail and Vol. V Doc 206), parsed from the annotated
per-document TEI. Undated editorial notes take their summit phase
from the nearest preceding dated document, since FRUS volume order is
chronological; their `date` field stays honestly empty.

### 3. Person identity

The participant data arrives under three id schemes, none reliable
across sources: TEI xml:ids that change convention between volumes
(`p_RRW_1` vs `p_RWReagan_1`), registry record ids assigned
per-volume (the same person gets a different id in each volume's
People table), and alignment files with crossed entries (Vol. V
assigns Nancy Reagan the same registry idno as Ronald Reagan; the
Shcharanskiy/Sakharov TEI ids are swapped).

Identity is therefore resolved by **normalized name keys** (surname +
first given name) with transliteration tolerance
(Aleksandr/Alexander) guarded by matching initials, implemented in
`PersonResolver` in `scripts/enrich_core.py`. The curated roster
supplies canonical ids and sides for the principals; everyone else
gets a stable name-derived id (`person.<surname>-<given>`). Original
TEI ids, registry ids, and surface forms are preserved on every
person entry for auditability, and a replaced TEI entry is retained
verbatim under `tei_source` — which is also what makes enrichment
idempotent rather than compounding across re-runs.

Upstream data errors discovered this way were reported back to the
`hsg-annotate-data` maintainers rather than silently patched; the
roster TEI-id corrections in `parse_frus.py` are additive, with the
alignment files treated as the authority for published ids.

### 4. From network to register

The first visualization of the enriched participant data was a
co-occurrence network (212 nodes, 5,031 edges). It was abandoned on a
measurement: the median FRUS document lists 11 network participants
and the largest lists 39, so a single document manufactures between
55 and 741 "ties." Co-occurrence in a memcon is an artifact of
document length, not evidence of interaction — and a force-directed
look implies geometry the data never measured.

Its replacement, the **Participation Register**, uses the data's
actual shape (person → appears in document → at a date): participants
as rows grouped by delegation, months as columns, cells shaded by
documents per month. Four numbered **editorial notes** — the
mobilization, the Daniloff affair, the NSC turnover, the START
trail — anchor episodes that are legible in the record itself, in the
manner of the printed series' editorial apparatus. Their counts are
computed from the data at build time so the text cannot drift from
the record; a note whose anchors disappear in a future build is
dropped with a warning, never shipped stale. `network.json` is still
generated as a data product for researchers, but the site does not
load it.

### 5. The Höfði House stage

The playable staging of the two summit days
(`scripts/build_summit_stage.py`) uses only what the memcons
themselves record: attendance from each document's printed
`<list type="participants">` (interpreters, notetakers, and
marginalia like "Shultz (came in at 11:30)" included) and meeting
windows from the dateline `from`/`to` attributes. One machine-reading
error is corrected against the printed text (Doc 303's window);
printed titles ("The President") are mapped to canonical ids
explicitly because surnames alone are ambiguous. Two working-group
Soviets who appear in no other annotated document remain unlinked
tokens rather than forced matches, and the arms-control group that
produced no US memcon is cited to Doc 304 rather than staged.

## Principles

- **Provenance over inference.** Every visual element traces to a
  canonical URL at history.state.gov or foia.state.gov. Where a view
  needed data the record doesn't hold (sides for minor figures), the
  inference is labeled as such in the UI and documented in SOURCES.md.
- **The printed text wins.** Where machine-readable attributes and
  the printed document disagree, the printed text is authoritative
  and the correction is commented at the point of use.
- **Honest forms.** A visualization should claim only what the data
  measured. Presence over time earned a register; documented
  attendance earned a stage; co-occurrence earned retirement.
- **Deterministic rendering.** No force simulation, no randomness;
  layouts are reviewable arithmetic, and playback respects
  `prefers-reduced-motion`.
- **Idempotent, resumable pipeline.** Every step re-runs to the same
  output; annotation sources are cached; each step prints what it
  did, including what it could not resolve.
- **Report upstream, work around locally.** Source-data errors are
  flagged to their maintainers; local workarounds are additive and
  documented, never silent rewrites of the record.

## Verification

Each phase was verified against the live site, not just the build
output: pipeline runs checked for idempotency (byte-identical
re-runs), enriched records spot-checked against the printed volumes
(session times, attendance, the d306 subject set), and every view
exercised in a browser — filters, cross-view selection, keyboard
access, playback transport — before being called done.

## Repository anatomy: data vs. code

This repository deliberately stores its data products in git — the
site is static, the pipeline is reproducible, and reviewability of
the derived data is part of the editorial method. The consequence is
that line counts overwhelmingly measure **data, not code**:

- ~190,000 lines: the two cached FRUS TEI volumes under `data/raw/`
  (inputs, fetched once from HistoryAtState/frus).
- ~115,000 lines: the enriched corpus `frus_core.json`
  (pretty-printed, ~57,000 lines) stored twice by design — once as
  the pipeline's source of truth in `data/`, once as the static
  site's copy in `docs/data/`.
- ~45,000 lines: the annotation cache and other derived JSON.
- **~3,300 lines: the actual program** — five Python pipeline
  scripts, one vanilla-JS front end, one stylesheet, one HTML page.

So a "110,000 lines changed" diff after a pipeline run is the
enriched dataset being regenerated, not code churn. If the doubled
corpus copy ever becomes an irritant, the candidates are: compact
serialization for `frus_core.json` (as `network.json` and
`register.json` already do), or a `.gitattributes` marking
`data/` and `docs/data/` as `linguist-generated` so hosting
platforms exclude them from language statistics and diff rendering.
