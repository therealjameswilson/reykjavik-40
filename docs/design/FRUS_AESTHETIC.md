# FRUS Aesthetic

The visual and editorial standard for **reykjavik-40** is set by the
publications of the U.S. Department of State's Office of the Historian —
in particular the *Foreign Relations of the United States* (FRUS)
documentary series and the associated volumes issued at
[history.state.gov](https://history.state.gov). This site is intended to
read as a serious digital extension of that work: restrained, archival,
typographic, source-first.

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
  --frus-ink:       #1f2933;   /* body text */
  --frus-navy:      #12355b;   /* headers, primary navigation */
  --frus-red:       #8f2d2d;   /* Soviet / USSR accent */
  --frus-gold:      #b08d57;   /* selected states, highlights, rules */
  --frus-parchment: #f7f1e3;   /* page background */
  --frus-slate:     #4b5563;   /* secondary text, metadata */
  --frus-paper:     #fffaf0;   /* cards, transcript panes */
}
```

**Semantic use:**

| Token | Where it appears |
| --- | --- |
| `--frus-navy` | Site header rule, section headings, US-side network nodes |
| `--frus-red` | USSR-side network nodes, "declassified" layer tag, warning states |
| `--frus-gold` | Selected node / active row / hover underline; horizontal rules under headings |
| `--frus-ink` | All body text |
| `--frus-slate` | Dates, doc IDs, breadcrumbs, byline metadata |
| `--frus-parchment` | Page background |
| `--frus-paper` | Card and transcript-pane surfaces |

**Contrast:** Every combination in use is verified against WCAG 2.2 AA.
`--frus-ink` on `--frus-parchment` = 12.7 : 1; `--frus-navy` on
`--frus-parchment` = 10.6 : 1; `--frus-slate` on `--frus-parchment` =
6.4 : 1. Never place `--frus-gold` on `--frus-parchment` for text
smaller than 18 px — it is a decorative colour.

---

## Typography

- **Editorial** (headings, document titles, block quotations, source
  notes reproduced from FRUS): a transitional serif. Site default is
  the free serif stack:
  `'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif`.
- **Interface** (navigation, filters, buttons, table headers, labels):
  `'Inter', 'Helvetica Neue', Arial, sans-serif`.
- **Monospace** (document IDs, cable numbers, case numbers):
  `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`.

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

- **Negotiation Network:** US nodes are `--frus-navy`; USSR nodes are
  `--frus-red`. Node radius encodes document count. Edge width encodes
  co-occurrence weight (memcons of the summit sessions count 5×;
  other memcons 3×; other documents 1×). Topic strands (SDI, INF,
  Strategic Arms, Nuclear Testing, Human Rights) are visualised as
  edge-tint bands, not as a coloured rainbow — colour is used
  sparingly so that selection remains legible.
- **Timeline:** Days are stacked vertically; events inside each day are
  ordered by their parsed time-of-day and coloured by kind
  (chronology in `--frus-slate`, documents in `--frus-navy`).
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
