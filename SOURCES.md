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
