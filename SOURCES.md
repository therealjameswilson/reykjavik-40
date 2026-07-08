# Sources

Every record in `data/frus_core.json` is traceable to one of the three
primary feeds below. Together they cover the pre-summit diplomacy, the
Reykjavik meeting itself (October 11–12, 1986, at Höfði House), and
the post-summit reception and follow-up.

Records are keyed by a stable `doc_id` and always carry a canonical
`url` pointing back to the publisher. When a document number cannot be
verified against a live page at history.state.gov it is emitted with
`verified: false`; the front end flags such records with a dashed
outline and a caveat in the transcript pane.

---

## Feed 1 — FRUS 1981–1988, Volume V (the Reykjavik Summit section)

- **Publication:** [*Foreign Relations of the United States,
  1981–1988, Volume V, Soviet Union, March 1985–October 1986*](https://history.state.gov/historicaldocuments/frus1981-88v05)
- **Editor:** Elizabeth C. Charles, Office of the Historian
- **Section:** *"SDI and the Reykjavik Summit"*, Documents 267–309.
- **What it contains:**
  - Pre-summit strategy and correspondence (Docs 267–294), including
    the Daniloff-Zakharov exchange that nearly cancelled the meeting.
  - The Reykjavik plenary and expert-group memcons (Docs 295–308).
    Four principal Reagan–Gorbachev sessions are recorded:
      - **Session I** – October 11 morning: Doc 301.
      - **Session II** – October 11 afternoon: Doc 302.
      - **Session III** – October 12 morning: Doc 306.
      - **Session IV** – October 12 afternoon (final plenary): Doc 308.
    Doc 307 is the Shultz–Shevardnadze foreign-ministers' meeting on
    the afternoon of October 12; Doc 303 is the draft working-group
    memcon of the night of October 11–12 (subsequently disavowed by
    Assistant Secretary Rozanne Ridgway and included as a matter of
    record only).
  - The editorial notes closing the section (Docs 309 and following).
- **Retrieval method:** TEI/XML source is fetched from
  [`HistoryAtState/frus`](https://github.com/HistoryAtState/frus)
  (`volumes/frus1981-88v05.xml`) rather than the rendered HTML,
  because the TEI carries structured `persName`, `date`, and
  `frus:doc-dateTime-*` attributes that the HTML does not expose.
- **Ingestion script:** `scripts/parse_frus.py --v05 <path>`.

---

## Feed 2 — FRUS 1981–1988, Volume VI (post-summit chronology and follow-up)

- **Publication:** [*Foreign Relations of the United States,
  1981–1988, Volume VI, Soviet Union, October 1986–January 1989*](https://history.state.gov/historicaldocuments/frus1981-88v06)
- **What we use:**
  - **Document 1** — the "Iceland Chronology," a Memorandum for the
    Record dated October 18, 1986 that gives a paragraph-by-paragraph
    reconstruction of the four days in Reykjavik. The chronology is
    the anchor for the Hour-by-Hour Timeline view; we parse a
    time-of-day expression from each paragraph and emit an event
    tied back to Doc 1.
  - **Documents 2 – ca. 39** — the immediate aftermath: post-summit
    briefings, allied consultations, subsequent Shultz–Shevardnadze
    exchanges, and the negotiating record that led to the December
    1987 INF Treaty. We currently ingest the first 39 documents; the
    range is configurable in `scripts/parse_frus.py`.
- **Retrieval method:** TEI/XML from the same repository
  (`volumes/frus1981-88v06.xml`).
- **Ingestion script:** `scripts/parse_frus.py --v06 <path>`.

---

## Feed 3 — foia.state.gov (Virtual Reading Room, declassified releases)

- **Publisher:** U.S. Department of State,
  [Virtual Reading Room](https://foia.state.gov/).
- **Endpoint used:** `GET https://foia.state.gov/api/Search2/SubmitSimpleQuery`
  (JSON; parameters mirror the site's `SearchResults.aspx` form).
- **Queries issued** (window: `1986-08-01` – `1987-03-31`; de-duplicated
  by PDF filename):
  1. `Reykjavik`
  2. `Iceland summit`
  3. `Gorbachev summit`
- **Post-processing:** Because the FOIA full-text search matches any
  OCR'd token in the release, many raw hits are cables that mention
  the summit only in passing (weekly press summaries, unrelated
  regional traffic). We filter the result set to records whose
  `subject`, `case_subject`, `from`, or `to` fields contain a
  Reykjavik / Iceland-meeting / Gorbachev-Shevardnadze-Shultz-Reagan /
  arms-control signal. See `scripts/fetch_foia.py` for the exact
  regex and the doctype/classification code tables.
- **What the records look like:** Each FOIA record carries a case
  number (e.g. `F-2006-01579`), a doctype (`ME` – memorandum, `TE` –
  telegram, `GC` – general correspondence, etc.), a classification
  marking (`S`, `C`, `LOU`, `U`, ...), a release-decision code, and a
  direct link to the released PDF on `foia.state.gov`.
- **How it appears in the site:** FOIA records live in a clearly
  labelled *Declassified* layer of the Document Explorer, on the
  same schema as FRUS records. They are never merged into the FRUS
  narrative silently; every FOIA card shows its classification and
  release decision alongside the case number.

---

## Feed 4 — Ronald Reagan Presidential Library, White House Photographic Collection

- **Publication:** [*Summits with Mikhail Gorbachev — White House Photo Collection Galleries*](https://www.reaganlibrary.gov/archives/audiovisual/white-house-photo-collection-galleries/summits-mikhail-gorbachev),
  Ronald Reagan Presidential Library and Museum, National Archives and Records
  Administration.
- **What we use:** nineteen photographs by the White House Photographic
  Office covering the two summit days at Höfði House on 11 and 12 October
  1986. Each frame carries a `Cxxxxx-xx` accession number, an official
  White House caption, and a calendar date. The plates are stored in
  `docs/assets/photos/reagan/` with 640-pixel thumbnails under `thumbs/`
  and metadata in `docs/data/reagan_photos.json`.
- **Chronological anchoring:** every plate is assigned a `time_hint` that
  matches an event line in the Iceland Chronology (FRUS Vol. VI, Doc 1) —
  arrival at Höfði (10:30), one-on-one and expanded morning sessions
  (11:15), the U.S. Ambassador’s luncheon (13:00), Sunday-morning staff
  briefings (08:00–09:00), the Sunday final farewell (18:00), and the
  Keflavík departure briefing (20:00). The Timeline view interleaves the
  plate with the chronology paragraph that describes it; the Photograph
  Gallery view arranges them as a two-day sequence of numbered plates.
- **Rights:** photographs by the White House Photographic Office are
  works of the United States Federal Government and are in the public
  domain. Attribution is given to the Ronald Reagan Presidential Library
  and Museum on every plate.

---

## Feed 5 — FRUS 1981–1988, Volume XI (START I)

- **Publication:** [*Foreign Relations of the United States,
  1981–1988, Volume XI, START I*](https://history.state.gov/historicaldocuments/frus1981-88v11)
- **Editor:** James Graham Wilson, Office of the Historian
- **What it contains:** the full documentary record of the Strategic
  Arms Reduction Talks from their opening in 1981 through the end of
  the Reagan administration, organized in four chapters:
    - **Chapter 1** — July 1981 – January 1985 (opening of START,
      pre-Geneva groundwork).
    - **Chapter 2** — January 1985 – October 1986 (Geneva through
      Reykjavik; the arms-control track that carried the 50-percent
      strategic-offensive-reductions proposal into Höfði House).
    - **Chapter 3** — October 1986 – December 1987 (post-Reykjavik
      negotiations running in parallel with the INF endgame).
    - **Chapter 4** — December 1987 – January 1989 (the final Reagan
      push toward a signed START treaty, handed off to the incoming
      Bush administration), plus an appendix.
- **Why it belongs alongside Volumes V and VI:** the Reykjavik record
  in Volume V and the immediate aftermath in Volume VI both refer
  repeatedly to "the START channel" and to specific U.S. and Soviet
  strategic-arms proposals whose full drafting history lives only in
  Volume XI. Volume XI is therefore the companion documentary series
  for the strategic-offensive-arms half of the Reykjavik package (the
  INF half is covered in the parallel INF volume).
- **Retrieval method:** TEI/XML from
  [`HistoryAtState/frus`](https://github.com/HistoryAtState/frus)
  (`volumes/frus1981-88v11.xml`), same pipeline as Volumes V and VI.
- **Ingestion status:** listed here as a canonical source for
  cross-referencing; ingestion into `data/frus_core.json` is not yet
  wired into `scripts/parse_frus.py` and will be added under a
  `--v11` flag on the same schema as the existing volume parsers.

---

## Cross-source identity

Persons are collapsed to a canonical id in `scripts/parse_frus.py`
(`CANONICAL_ID`) so that a reference to Mikhail Gorbachev in Volume V
(TEI id `p_GMS_1`), Volume VI (`p_GM_1`), and a FOIA cable
(`Gorbachev` keyword match) resolves to a single network node
(`reagan_gorbachev.gorbachev`). The `persons[]` array on each record
preserves the original TEI id in a `tei_id` field for auditability.

---

## Rate limiting and etiquette

- The FRUS TEI files are static assets; we fetch each volume once and
  cache under `data/raw/`.
- The FOIA search API is hit at most a few times per full rebuild
  with a 500 ms delay between pages. The user-agent identifies the
  project.
- Neither service is used for redistribution of PDFs; the site links
  back to canonical URLs at the publisher.
