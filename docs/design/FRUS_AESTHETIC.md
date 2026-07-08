# FRUS Aesthetic — Ruby Buckram Edition

The visual and editorial standard for **reykjavik-40** is set by the
printed **FRUS Starter Pack**: the ruby-red buckram bindings and gold
letterhead of the *Foreign Relations of the United States* documentary
series, published by the U.S. Department of State's Office of the
Historian at [history.state.gov](https://history.state.gov). This site
is intended to read as a serious digital extension of that printed
series: restrained, archival, typographic, source-first, and
instantly recognisable as FRUS.

The rules below are enforced by `assets/css/frus.css`.

---

## First principles

1. **The document is the artefact.** The interface never obscures the
   primary source. Titles, dates, and provenance are visible before any
   interpretation is offered.
2. **Every claim is traceable.** Every node in the graph, every event
   on the timeline, every card in the explorer links to a canonical
   URL at `history.state.gov` or `foia.state.gov`.
3. **Serif for the historical voice; sans-serif for the interface.**
   The user should always be able to tell what is FRUS text and what
   is UI chrome.
4. **Dense is fine, cluttered is not.** Show many documents at once
   only when each is filterable, sortable, and explainable.
5. **No slogans.** No mission statements, no self-congratulation. The
   rigour of the sources and the quality of the presentation make the
   argument.

---

## Colour tokens

```css
:root {
  --frus-ink:          #1f2226;   /* body text */
  --frus-buckram:      #5B1A18;   /* masthead / cover — deep ruby buckram */
  --frus-buckram-dark: #6B1D1D;   /* interior headers, theme bars, section rules */
  --frus-navy:         #12355b;   /* US-side network nodes (semantic only) */
  --frus-red:          #8f2d2d;   /* USSR-side network nodes (semantic only) */
  --frus-gold:         #C9A84C;   /* cover text, rules under headings, active states */
  --frus-gold-deep:    #B08D3B;   /* darker gold, for links and hover */
  --frus-parchment:    #f4ecd8;   /* page background */
  --frus-slate:        #5b4a3d;   /* secondary text, metadata */
  --frus-paper:        #fffaf0;   /* cards, transcript panes */
}
```

**Semantic use:**

| Token | Where it appears |
| --- | --- |
| `--frus-buckram` | Sticky masthead bar (ruby cover), skip link background |
| `--frus-buckram-dark` | Section headings, theme header bars over each timeline day, explorer table header row, transcript accent, colophon top rule, document tags |
| `--frus-gold` | Masthead lettering, active nav pill, rules under headings, selection highlights, gold pinstripe below the buckram bar |
| `--frus-gold-deep` | Link hover, FOIA-source tags |
| `--frus-navy` | US-side network nodes only (semantic) |
| `--frus-red` | USSR-side network nodes only (semantic) |
| `--frus-ink` | All body text |
| `--frus-slate` | Dates, doc IDs, breadcrumbs, byline metadata |
| `--frus-parchment` | Page background |
| `--frus-paper` | Card and transcript-pane surfaces |

**Contrast:** Every combination in use is verified against WCAG 2.2 AA.
`--frus-ink` on `--frus-parchment` ≈ 12 : 1; `--frus-buckram-dark` on
`--frus-parchment` ≈ 8.5 : 1; `--frus-gold` on `--frus-buckram` ≈ 6.4 : 1
(large text and iconography only, matching the printed cover). Never
place `--frus-gold` on `--frus-parchment` for text smaller than 18 px —
it is a decorative colour on the parchment surface.

---

## Typography

- **Editorial** (headings, document titles, block quotations, source
  notes reproduced from FRUS, and now table headers and buttons that
  should carry the printed FRUS voice): Times New Roman, matching the
  printed Starter Pack. Stack:
  `'Times New Roman', 'Tinos', Times, 'Source Serif 4', Georgia, serif`.
- **Interface** (small controls, filter chips, legend labels): a
  neutral sans, used sparingly:
  `'Inter', 'Helvetica Neue', Arial, sans-serif`.
- **Monospace** (document IDs, cable numbers, case numbers):
  `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`.

The editorial face carries the archival voice. When in doubt, use it.
Interface sans is a background utility — never a header, never a title.

**Scale.** Use a 1.200 minor-third scale anchored at 16 px:

```
--fs-6xl: 3.815rem;  /* hero, once per page */
--fs-5xl: 3.052rem;  /* section title */
--fs-4xl: 2.441rem;
--fs-3xl: 1.953rem;
--fs-2xl: 1.563rem;
--fs-xl:  1.250rem;
--fs-lg:  1.125rem;
--fs-md:  1.000rem;  /* body */
--fs-sm:  0.875rem;
--fs-xs:  0.750rem;  /* metadata */
```

**Rules of use:**

- Body text: `--fs-md`, `line-height: 1.65`, `max-width: 68ch`.
- Section headings sit above a 1 px `--frus-gold` rule.
- Small-caps are permitted for `SOURCE`, `SECRET`, `SENSITIVE`, and
  other declassification markings quoted from the documents.
- Never italicise headings. Italic is reserved for book and volume
  titles (as in FRUS itself).

---

## Layout

- Single content column, `72ch` maximum, with a generous left rail for
  metadata and a right rail for citations on desktop widths.
- The three flagship views (Network, Timeline, Explorer) render inside
  a shared shell so a selection in one view highlights the
  corresponding elements in the other two without a full re-render.
- Every card carries **document id · date · source** as its dateline,
  in `--frus-slate` monospace at `--fs-xs`.

---

## Graphs and tables

- **Participation Register:** an archival attendance chart in the
  manner of a finding aid. Rows are participants grouped by delegation;
  columns are calendar months; cell shading encodes documents per month
  on a four-stop ramp per side (US on `--frus-navy`, USSR on
  `--frus-red`, unattributed on a warm slate). The curated delegation
  roster carries a `--frus-gold-deep` dot beside the name; the summit
  month is washed in `--frus-gold`; numbered editorial notes are
  gold-ringed numerals on the top rail, echoing the numbered editorial
  notes of the printed series. Colour is used sparingly so that
  selection and note emphasis remain legible.
- **Timeline:** Days are stacked vertically. Each day carries a
  full-width dark-red theme header bar (echoing the theme bars in the
  printed Starter Pack) with the date in white small caps and the
  descriptor in gold italic. Events inside each day are ordered by
  their parsed time-of-day and coloured by kind (chronology in
  `--frus-slate`, documents in `--frus-buckram-dark` with a
  white-on-red `Document` tag).
- **Explorer:** A flat, sortable table of documents with filters for
  source, phase, session, person, and topic. The first click on a row
  opens a transcript pane on `--frus-paper`; the second click follows
  the canonical URL.

---

## Motion

- Selection highlights transition in `120ms ease-out`.
- Cross-view synchronisation transitions in `200ms ease-out`.
- No parallax. No fades on load. No entrance animations of any kind.

---

## What we do not do

- No hero videos, no autoplaying background media.
- No stock photography.
- No emoji.
- No dark mode gimmicks. If a dark theme is added later it is a
  separate exercise, not an aesthetic derivative.
- No copy that praises the project, its makers, or the "importance of
  history." The documents are enough.
