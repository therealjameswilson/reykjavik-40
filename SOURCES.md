# Sources

Every record in `data/frus_core.json` is traceable to one of the three
primary feeds below. Together they cover the pre-summit diplomacy, the
Reykjavik meeting itself (October 11–12, 1986, at Höfði House), and
the post-summit reception and follow-up. Two annotation feeds
(Feeds 4 and 5) enrich the FRUS records with curated subjects and
event entities from the Office of the Historian's annotation program.

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
  labelled *Declassified* layer of the FRUS Document Explorer, on the
  same schema as FRUS records. They are never merged into the FRUS
  narrative silently; every FOIA card shows its classification and
  release decision alongside the case number.

---

## Feed 4 — FRUS subject taxonomy (curated subjects)

- **Source:** the `frus-subjects` repository — the curated subject
  taxonomy of the *Foreign Relations of the United States* series,
  maintained by the Office of the Historian (543 subjects in 13
  categories, applied across 552 annotated volumes).
- **What we use:** `data/document_subjects.json`, the
  subject → volume → document map. For every FRUS record in the
  corpus we attach the curated subjects that the Office of the
  Historian's annotation program applied to that document, as
  `subjects[]` entries carrying the stable subject `ref`, the display
  name, and the category/subcategory path. The `ref` is the citable
  identifier in the taxonomy's TEI authority file
  (`frus-subjects-authority.xml`).
- **Ingestion script:** `scripts/enrich_core.py --frus-subjects <path>`.

---

## Feed 5 — HSG annotated TEI (entity annotations, including events)

- **Source:** the `hsg-annotate-data` repository — the Office of the
  Historian's annotated TEI corpus, in which FRUS documents carry
  inline entity annotations (People, Places, Organizations, Events,
  Topics, Programs, Compound Subjects) linked to the Department's
  entity registry.
- **What we use:** the per-volume annotation extracts
  (`tei/annotations_frus1981-88v05.xml`, `...v06.xml`, `...v11.xml`),
  the per-document TEI files, and the people-id-alignment lists.
  For every FRUS record in the corpus we attach:
  - `events[]` — Event entities tagged in the document (e.g.
    *Reykjavik Summit (1986)*, *Geneva Summit (1985)*, *Strategic
    Arms Reduction Talks (1982–1991)*), each carrying the registry
    record id and display name;
  - `persons[]` enrichment — the annotation program's People entities
    are merged with the TEI-encoded persons into one canonical
    participant list per document (see *Cross-source identity*);
    occupations come from the volumes' lists of persons
    (`import/people-id-alignment/`), and each person's side
    (US / USSR / other) is inferred from that occupation text;
  - `annotation_profile{}` — counts of unique annotated entities by
    type, a density signal for the document record.
- **Document feed:** the corpus itself is extended from this source.
  Every document tagged with the *Reykjavik Summit (1986)* Event
  entity that falls outside the Vol. V/VI parse ranges — the Volume
  XI (START I) negotiation trail and Vol. V Doc 206 — is ingested by
  `scripts/parse_hsg_docs.py` from the per-document TEI files
  (title, dateline date/place, canonical URL, excerpt, topic
  strands). Undated editorial notes take their summit phase from the
  nearest preceding dated document in volume order.
- **Corpus audit:** `scripts/enrich_core.py` writes any
  Reykjavik-tagged documents still missing from the corpus to
  `data/corpus_candidates.json`; with the full ingest this list is
  empty, and a future annotation update upstream will surface new
  candidates there.
- **Coverage note:** Volume VI's annotation extract currently covers
  People only; subject coverage for Volume VI records comes from
  Feed 4.
- **Ingestion scripts:** `scripts/parse_hsg_docs.py --hsg <path>` and
  `scripts/enrich_core.py --hsg <path>`. A compact extract is cached
  under `data/raw/annotations_supplement.json` so the enrichment
  step re-runs without the sibling repositories.

---

## Meeting attendance (Höfði House view)

The playable staging of the two summit days uses only what the memcons
themselves record. `scripts/build_summit_stage.py` extracts, from each
Oct 11–12 document in Volume V that carries them:

- **Attendance** from the TEI `<list type="participants">` — the list
  of participants exactly as printed at the head of each memorandum,
  by side, including interpreters and notetakers and marginalia such
  as "Shultz (came in at 11:30)".
- **Meeting windows** from the dateline `<date from=".." to="..">`
  attributes. One correction: Doc 303's machine-readable window
  duplicates Session II's; its printed dateline ("October 11–12,
  1986, 8 p.m.–4 a.m.") is used instead.

Attendees are resolved to the same canonical person ids as the
register (via the TEI ids and unambiguous surnames already in
`frus_core.json`); printed titles ("The President," "The General
Secretary") are mapped to the principals explicitly. Two Soviet
working-group members (Mikol'chak, Shishlin) appear in no other
annotated document and remain unlinked tokens. The overnight
arms-control working group (Nitze–Akhromeyev) produced no US memcon;
the view cites Doc 304, the editorial note that preserves its record.

---

## Cross-source identity

Persons arrive under three id schemes — TEI xml:ids in the volume XML
(`p_GMS_1` in Vol. V, `p_GM_1` in Vol. VI, `p_RWReagan_1` in Vol. XI),
registry record ids in the annotation extracts, and keyword matches in
FOIA cables — and none of them is reliable across sources: the
registry assigns separate People records per volume, and the
people-id-alignment files contain crossed ids (Vol. V assigns Nancy
Reagan the same registry idno as Ronald Reagan).

Identity is therefore resolved by **normalized name keys**
(surname + first given name, tolerant of transliteration variants
like *Aleksandr/Alexander* via an initial-guarded surname fallback)
in `scripts/enrich_core.py` (`PersonResolver`). The curated roster in
`scripts/parse_frus.py` (`CANONICAL_ID`, `NETWORK_PEOPLE`) supplies
canonical ids, sides, and roles for the principals and delegations;
all other participants get a stable name-derived id
(`person.<surname>-<given>`). The `persons[]` array on each record
preserves the original TEI id (`tei_id`), registry id
(`airtable_id`), and TEI surface form (`surface`) for auditability;
a replaced TEI entry is retained verbatim under `tei_source`.

---

## Rate limiting and etiquette

- The FRUS TEI files are static assets; we fetch each volume once and
  cache under `data/raw/`.
- The FOIA search API is hit at most a few times per full rebuild
  with a 500 ms delay between pages. The user-agent identifies the
  project.
- Neither service is used for redistribution of PDFs; the site links
  back to canonical URLs at the publisher.
