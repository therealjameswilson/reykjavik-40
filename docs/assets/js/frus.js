// reykjavik-40 front end
// Four linked views (participation register, Höfði House stage, timeline,
// document explorer) driven from data/*.json. No external dependencies.

const SVG_NS = "http://www.w3.org/2000/svg";

const TOPIC_COLORS = {
  "SDI": "var(--topic-sdi)",
  "INF": "var(--topic-inf)",
  "Strategic Arms": "var(--topic-strategic)",
  "Nuclear Testing": "var(--topic-testing)",
  "Human Rights": "var(--topic-human)",
  "Regional Issues": "var(--topic-regional)",
  "Bilateral Relations": "var(--topic-bilateral)",
};

const state = {
  docs: [],
  register: { months: [], people: [], notes: [] },
  stage: { meetings: [] },
  timeline: [],
  manifest: {},
  foiaPdfs: { documents: [] },
  portraits: {},     // person id -> { name, credit, license, source_url, local_url }
  activeView: "register",
  selection: null,   // { kind: 'person'|'document'|'topic'|'session', id, label }
  regMin: 5,         // participants appearing in >= N documents
  regSort: "total",  // 'total' | 'first'
  activeNote: null,  // editorial note number, or null
  stageBeat: 0,      // index into the stage beat sequence
  stagePlaying: false,
};

function sideClass(side) {
  return side === "US" ? "us" : side === "USSR" ? "ussr" : "other";
}

function sideColor(side) {
  return side === "US" ? "var(--frus-navy)" : side === "USSR" ? "var(--frus-red)" : "var(--frus-slate)";
}

// ------------------------ boot ------------------------
async function loadData() {
  // The standalone single-file edition embeds the corpus in the page
  // (see scripts/build_standalone.py); the served site fetches it.
  const embedded = document.getElementById("embedded-data");
  if (embedded) return JSON.parse(embedded.textContent);
  const [docs, register, stage, timeline, manifest, foiaPdfs, portraits] = await Promise.all([
    fetch("data/frus_core.json").then(r => r.json()),
    fetch("data/register.json").then(r => r.json()),
    fetch("data/summit_stage.json").then(r => r.json()),
    fetch("data/timeline.json").then(r => r.json()),
    fetch("data/manifest.json").then(r => r.json()),
    // The declassified PDF library is optional; the rest of the edition
    // renders even if the manifest is absent.
    fetch("data/foia_pdfs.json").then(r => r.ok ? r.json() : null).catch(() => null),
    // Participant portraits are optional and provenance-gated: the person
    // card shows one only where a sourced image exists (see
    // scripts/fetch_portraits.py). Absent manifest → discs and cards as before.
    fetch("data/portraits.json").then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return { docs, register, stage, timeline, manifest, foiaPdfs, portraits };
}

async function boot() {
  try {
    const { docs, register, stage, timeline, manifest, foiaPdfs, portraits } = await loadData();
    state.docs = docs;
    state.register = register;
    state.stage = stage;
    state.timeline = timeline;
    state.manifest = manifest;
    state.foiaPdfs = foiaPdfs || { documents: [] };
    state.portraits = (portraits && portraits.portraits) || {};

    setupNav();
    setupCorpusLine();
    setupRegisterControls();
    renderRegister();
    renderStage();
    renderTimeline();
    renderExplorer();
    setupExplorerControls();
    renderFoia();
    setupFoiaControls();
    setupSelectionClose();
  } catch (err) {
    console.error("[reykjavik-40] failed to load data", err);
    document.getElementById("main").insertAdjacentHTML(
      "afterbegin",
      `<p style="padding:1rem;color:#8f2d2d;font-family:'Inter',sans-serif">Failed to load the corpus. Run <code>python3 scripts/build_core.py</code> and refresh.</p>`
    );
  }
}

// ------------------------ nav ------------------------
function setupNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      document.querySelectorAll(".nav-btn").forEach(b => {
        const isActive = b === btn;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      document.querySelectorAll(".views > .view").forEach(v => {
        const on = v.dataset.view === view;
        v.classList.toggle("is-active", on);
        v.hidden = !on;
      });
      if (view !== "stage") stageStop();
      state.activeView = view;
    });
  });
}

function setupCorpusLine() {
  const c = state.manifest.counts || {};
  const line = document.getElementById("corpus-line");
  if (!line) return;
  line.textContent = `${c.total_documents || 0} documents · ${c.participants || state.register.people.length} participants · ${c.timeline_events || 0} timeline events · generated ${(state.manifest.generated || "").slice(0, 10)}`;
}

function setupSelectionClose() {
  document.getElementById("selection-close").addEventListener("click", () => clearSelection());
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") clearSelection();
  });
}

// A concise 1–2 sentence overview for a document. Prefers a curated
// `summary`; otherwise derives the opening sentence(s) of the excerpt so
// cards and panels never dump multi-paragraph raw document text.
function docSummary(d) {
  if (d.summary) return d.summary;
  const ex = (d.excerpt || "").replace(/\s+/g, " ").trim();
  if (!ex) return "";
  const sentences = ex.match(/[^.!?]+[.!?]+/g) || [ex];
  let out = (sentences[0] || "").trim();
  if (out.length < 90 && sentences[1]) out = `${out} ${sentences[1].trim()}`.trim();
  if (out.length > 260) out = `${out.slice(0, 257).trimEnd()}…`;
  return out;
}

// ------------------------ selection sync ------------------------
function setSelection(kind, id, label, extra = {}) {
  state.selection = { kind, id, label, ...extra };
  updateSelectionPanel();
  crossHighlight();
}

function clearSelection() {
  state.selection = null;
  document.getElementById("selection").hidden = true;
  crossHighlight();
}

function updateSelectionPanel() {
  const el = document.getElementById("selection");
  const body = document.getElementById("selection-body");
  if (!state.selection) { el.hidden = true; return; }
  el.hidden = false;
  const s = state.selection;
  if (s.kind === "person") {
    const n = state.register.people.find(p => p.id === s.id) || {};
    const topics = (n.top_topics || []).map(t => `<span class="tag">${escape(t.topic)} · ${t.count}</span>`).join(" ");
    const span = n.first ? `${monthLabel(n.first)} – ${monthLabel(n.last)}` : "";
    // Portraits are provenance-gated and optional; the figure stays hidden
    // until the image actually loads, so a manifest entry whose file has not
    // been fetched yet simply shows nothing rather than a broken image. Only
    // same-origin relative asset paths are honoured (no javascript:/data:).
    const portrait = state.portraits[s.id];
    const portraitOk = portrait && /^assets\/[\w./-]+\.(jpe?g|png|webp)$/i.test(portrait.local_url || "");
    const portraitHtml = portraitOk ? `
      <figure class="tr-portrait" hidden>
        <img alt="${escape(portrait.name || n.name || "")}" />
        <figcaption>${escape(portrait.credit || "")}</figcaption>
      </figure>` : "";
    body.innerHTML = `
      ${portraitHtml}
      <p><span class="side ${sideClass(n.side)}">${escape(n.side === "other" ? "" : n.side || "")}</span></p>
      <strong>${escape(n.name || s.label || s.id)}</strong>
      <p style="color:var(--frus-slate);font-style:italic">${escape(n.role || "")}</p>
      <p><span class="tr-label">Appears in</span> ${n.total || 0} documents${span ? ` · ${span}` : ""}</p>
      <p><span class="tr-label">Top topics</span><br>${topics || '<span style="color:var(--frus-slate)">—</span>'}</p>
    `;
    if (portraitOk) {
      const fig = body.querySelector(".tr-portrait");
      const img = fig.querySelector("img");
      img.addEventListener("load", () => fig.hidden = false);
      img.addEventListener("error", () => fig.remove());
      img.src = portrait.local_url;  // relative, same-origin asset path
    }
  } else if (s.kind === "document") {
    const d = state.docs.find(d => d.doc_id === s.id) || {};
    body.innerHTML = `
      <p><span class="tag ${d.source === "foia.state.gov" ? "tag--source-foia" : "tag--source-frus"}">${escape(d.source || "")}</span> ${d.summit_phase ? `<span class="tag tag--phase-${d.summit_phase === "summit" ? "summit" : ""}">${escape(d.summit_phase)}</span>` : ""}</p>
      <strong>${escape(d.title || s.label || s.id)}</strong>
      <p style="color:var(--frus-slate);font-family:var(--font-mono);font-size:var(--fs-xs)">${escape(d.date_display || d.date || "")}</p>
      ${docSummary(d) ? `<p class="doc-summary">${escape(docSummary(d))}</p>` : ""}
      ${safeHttpUrl(d.url) ? `<a class="tr-cta" href="${escape(safeHttpUrl(d.url))}" target="_blank" rel="noopener">${d.source === "foia.state.gov" ? "Open the declassified PDF" : "Read the FRUS document"} →</a>` : ""}
    `;
  } else if (s.kind === "topic") {
    body.innerHTML = `<strong>Topic strand</strong><p style="color:var(--frus-slate)">${escape(s.label)}</p><p>Highlighted across the linked views.</p>`;
  }
}

function crossHighlight() {
  // Register
  applyRegisterEmphasis();
  // Stage
  applyStageEmphasis();
  // Timeline
  highlightTimeline();
  // Explorer
  highlightExplorer();
}

// ------------------------ participation register ------------------------
// The register is an archival finding aid: participants as rows grouped
// by delegation, months as columns, cell shading by documents per month.
// Numbered editorial notes anchor episodes that are legible in the
// record itself. Deterministic SVG, no layout simulation.

const REGISTER_RAMPS = {
  US: ["#c7d6e6", "#8fadcc", "#4a76a3", "#12355b"],
  USSR: ["#e8c9c9", "#d29393", "#b45454", "#8f2d2d"],
  other: ["#ddd6ca", "#bdb3a2", "#93876f", "#5f5347"],
};

function registerCellFill(side, count) {
  const ramp = REGISTER_RAMPS[side] || REGISTER_RAMPS.other;
  return count <= 1 ? ramp[0] : count <= 3 ? ramp[1] : count <= 6 ? ramp[2] : ramp[3];
}

function monthLabel(m) {
  const [y, mo] = m.split("-");
  const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[parseInt(mo, 10)]} ${y}`;
}

function registerRows() {
  const rows = state.register.people.filter(p => p.total >= state.regMin);
  const sideOrder = { US: 0, USSR: 1 };
  const byProminence = (a, b) => b.total - a.total || a.name.localeCompare(b.name);
  const byFirst = (a, b) => (a.first || "9999").localeCompare(b.first || "9999") || byProminence(a, b);
  rows.sort((a, b) => {
    const sa = sideOrder[a.side] ?? 2, sb = sideOrder[b.side] ?? 2;
    if (sa !== sb) return sa - sb;
    return state.regSort === "first" ? byFirst(a, b) : byProminence(a, b);
  });
  return rows;
}

function renderRegister() {
  const canvas = document.getElementById("register-canvas");
  canvas.innerHTML = "";

  const months = state.register.months;
  const rows = registerRows();
  const meta = document.getElementById("register-meta");
  if (meta) meta.textContent = `Showing ${rows.length} of ${state.register.people.length} participants.`;
  if (!months.length || !rows.length) return;

  const width = canvas.clientWidth || 940;
  const LABEL_W = Math.min(200, Math.max(140, width * 0.22));
  const CW = Math.max(9, Math.min(24, (width - LABEL_W - 16) / months.length));
  const RH = 22;
  const GROUP_H = 26;
  const TOP = 58;

  // Row geometry with a group header band at each side change.
  let y = TOP;
  let prevSide = null;
  const groups = [];
  rows.forEach(r => {
    if (r.side !== prevSide) {
      groups.push({ side: r.side, y });
      y += GROUP_H;
      prevSide = r.side;
    }
    r._y = y;
    y += RH;
  });
  const H = y + 14;
  const W = LABEL_W + months.length * CW + 16;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.dataset.labelW = LABEL_W;
  svg.dataset.cw = CW;
  canvas.appendChild(svg);

  const colX = i => LABEL_W + i * CW;

  // Summit month band.
  const si = months.indexOf(state.register.summit_month);
  if (si >= 0) {
    const band = document.createElementNS(SVG_NS, "rect");
    band.setAttribute("x", colX(si));
    band.setAttribute("y", TOP - 20);
    band.setAttribute("width", CW);
    band.setAttribute("height", H - TOP + 12);
    band.setAttribute("class", "reg-summit-band");
    svg.appendChild(band);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", colX(si) + CW / 2);
    t.setAttribute("y", TOP - 24);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "reg-month-label");
    t.textContent = "summit";
    svg.appendChild(t);
  }

  // Note-range overlay (shown when an editorial note is active).
  const noteBand = document.createElementNS(SVG_NS, "rect");
  noteBand.setAttribute("class", "reg-note-band");
  noteBand.setAttribute("y", TOP - 4);
  noteBand.setAttribute("height", H - TOP + 2);
  noteBand.setAttribute("visibility", "hidden");
  svg.appendChild(noteBand);

  // Month axis: year boundaries plus the anchor months.
  months.forEach((m, i) => {
    if (m.endsWith("-01") || i === 0) {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", colX(i) + CW / 2);
      t.setAttribute("y", TOP - 8);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("class", "reg-month-label");
      t.textContent = i === 0 ? monthLabel(m).slice(0, 3) + " " + m.slice(2, 4) : "19" + m.slice(2, 4);
      svg.appendChild(t);
      if (m.endsWith("-01")) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", colX(i)); l.setAttribute("x2", colX(i));
        l.setAttribute("y1", TOP - 4); l.setAttribute("y2", H - 8);
        l.setAttribute("class", "reg-year-rule");
        svg.appendChild(l);
      }
    }
  });

  // Group headers.
  const GROUP_LABELS = { US: "United States", USSR: "Soviet Union" };
  groups.forEach(g => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", 4);
    t.setAttribute("y", g.y + GROUP_H - 8);
    t.setAttribute("class", "reg-group-label");
    t.textContent = (GROUP_LABELS[g.side] || "Other / unattributed").toUpperCase();
    svg.appendChild(t);
    const l = document.createElementNS(SVG_NS, "line");
    l.setAttribute("x1", 4); l.setAttribute("x2", W - 8);
    l.setAttribute("y1", g.y + GROUP_H - 2); l.setAttribute("y2", g.y + GROUP_H - 2);
    l.setAttribute("class", "reg-group-rule");
    svg.appendChild(l);
  });

  // Rows.
  rows.forEach(r => {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "reg-row");
    g.dataset.id = r.id;
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${r.name}${r.role ? ", " + r.role : ""}. Appears in ${r.total} documents, ${monthLabel(r.first)} to ${monthLabel(r.last)}.`);

    const hit = document.createElementNS(SVG_NS, "rect");
    hit.setAttribute("x", 0); hit.setAttribute("y", r._y);
    hit.setAttribute("width", W); hit.setAttribute("height", RH);
    hit.setAttribute("class", "reg-row-hit");
    g.appendChild(hit);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", LABEL_W - 14);
    label.setAttribute("y", r._y + RH / 2 + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "reg-name");
    label.textContent = r.name;
    g.appendChild(label);

    if (r.tier === "roster") {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", LABEL_W - 7);
      dot.setAttribute("cy", r._y + RH / 2);
      dot.setAttribute("r", 2.5);
      dot.setAttribute("class", "reg-roster-dot");
      g.appendChild(dot);
    }

    months.forEach((m, i) => {
      const c = r.counts[m];
      if (!c) return;
      const cell = document.createElementNS(SVG_NS, "rect");
      cell.setAttribute("x", colX(i) + 1);
      cell.setAttribute("y", r._y + 2);
      cell.setAttribute("width", Math.max(CW - 2, 6));
      cell.setAttribute("height", RH - 4);
      cell.setAttribute("rx", 2);
      cell.setAttribute("fill", registerCellFill(r.side, c));
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${r.name} — ${monthLabel(m)}: ${c} document${c === 1 ? "" : "s"}`;
      cell.appendChild(title);
      g.appendChild(cell);
    });

    const activate = () => {
      const s = state.selection;
      if (s && s.kind === "person" && s.id === r.id) clearSelection();
      else setSelection("person", r.id, r.name);
    };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
    svg.appendChild(g);
  });

  // Editorial note markers along the top rail.
  (state.register.notes || []).forEach(note => {
    const i = months.indexOf(note.months[0]);
    if (i < 0) return;
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "reg-note-marker");
    g.dataset.note = note.n;
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `Editorial note ${note.n}: ${note.title}`);
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", colX(i) + CW / 2);
    c.setAttribute("cy", 14);
    c.setAttribute("r", 9);
    g.appendChild(c);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", colX(i) + CW / 2);
    t.setAttribute("y", 18);
    t.setAttribute("text-anchor", "middle");
    t.textContent = note.n;
    g.appendChild(t);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${note.title} — ${note.text}`;
    g.appendChild(title);
    const toggle = () => setActiveNote(state.activeNote === note.n ? null : note.n);
    g.addEventListener("click", toggle);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    svg.appendChild(g);
  });

  renderRegisterNotes();
  applyRegisterEmphasis();
}

function renderRegisterNotes() {
  const ol = document.getElementById("register-notes");
  if (!ol) return;
  ol.innerHTML = "";
  (state.register.notes || []).forEach(note => {
    const li = document.createElement("li");
    li.className = "register-note" + (state.activeNote === note.n ? " is-active" : "");
    li.dataset.note = note.n;
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.innerHTML = `<span class="register-note__num">${note.n}</span><span class="register-note__body"><strong>${escape(note.title)}.</strong> ${escape(note.text)}</span>`;
    const toggle = () => setActiveNote(state.activeNote === note.n ? null : note.n);
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    ol.appendChild(li);
  });
}

function setActiveNote(n) {
  state.activeNote = n;
  renderRegisterNotes();
  applyRegisterEmphasis();
}

function applyRegisterEmphasis() {
  const svg = document.querySelector("#register-canvas svg");
  if (!svg) return;
  const months = state.register.months;
  const note = (state.register.notes || []).find(x => x.n === state.activeNote) || null;
  const notePeople = note ? new Set(note.people) : null;
  const sel = state.selection;

  const band = svg.querySelector(".reg-note-band");
  if (band) {
    if (note) {
      const i0 = months.indexOf(note.months[0]);
      const i1 = months.indexOf(note.months[note.months.length - 1]);
      const labelW = parseFloat(svg.dataset.labelW);
      const cw = parseFloat(svg.dataset.cw);
      band.setAttribute("x", labelW + i0 * cw);
      band.setAttribute("width", (i1 - i0 + 1) * cw);
      band.setAttribute("visibility", "visible");
    } else {
      band.setAttribute("visibility", "hidden");
    }
  }

  svg.querySelectorAll(".reg-row").forEach(row => {
    row.classList.remove("is-selected", "is-faded", "is-note-hi");
    const id = row.dataset.id;
    if (sel && sel.kind === "person") {
      if (id === sel.id) row.classList.add("is-selected");
      else row.classList.add("is-faded");
    } else if (note && notePeople.size) {
      if (notePeople.has(id)) row.classList.add("is-note-hi");
      else row.classList.add("is-faded");
    }
  });
  svg.querySelectorAll(".reg-note-marker").forEach(m => {
    m.classList.toggle("is-active", note && parseInt(m.dataset.note, 10) === note.n);
  });
}

function setupRegisterControls() {
  const min = document.getElementById("reg-min");
  const sort = document.getElementById("reg-sort");
  if (!min || !sort) return;
  min.value = String(state.regMin);
  sort.value = state.regSort;
  min.addEventListener("change", () => {
    state.regMin = parseInt(min.value, 10) || 1;
    renderRegister();
  });
  sort.addEventListener("change", () => {
    state.regSort = sort.value === "first" ? "first" : "total";
    renderRegister();
  });
}

// ------------------------ Höfði House stage ------------------------
// Documented meetings only: attendance from each memcon's printed list
// of participants, times from the datelines. Figures move between their
// delegation benches and the table as the beats advance.

const STAGE_W = 900, STAGE_H = 580;

// Assigned by renderStage so the nav can pause playback on view change.
let stageStop = () => {};

function stageDayLabel(iso) {
  return iso.startsWith("1986-10-12") ? "Sunday, October 12, 1986" : "Saturday, October 11, 1986";
}

function stageBeats() {
  const meetings = state.stage.meetings || [];
  const beats = [];
  beats.push({
    kind: "interval",
    label: "Saturday, October 11, 1986",
    text: "The delegations arrive. Reagan hosts the first session at Höfði House.",
  });
  meetings.forEach((m, i) => {
    beats.push({ kind: "meeting", meeting: m });
    if (i < meetings.length - 1) {
      const next = meetings[i + 1];
      const overnight = m.end && next.start && m.end.slice(0, 10) !== m.start.slice(0, 10);
      beats.push({
        kind: "interval",
        label: overnight || next.start.slice(0, 10) !== m.start.slice(0, 10)
          ? "Sunday morning, October 12, 1986"
          : stageDayLabel(m.start),
        text: "Recess — the delegations confer separately.",
      });
    }
  });
  beats.push({
    kind: "interval",
    label: "Sunday evening, October 12, 1986",
    text: "The summit ends without agreement over SDI. The delegations depart Reykjavík.",
  });
  return beats;
}

function stagePeople() {
  // Union of attendees across meetings, keyed by canonical id (or the
  // printed name for the two unregistered Soviets). `meetingCount` tallies
  // how many of the documented meetings each figure sat in, so the stage
  // can shade the busiest participants more deeply than the one-off ones.
  const map = new Map();
  (state.stage.meetings || []).forEach(m => {
    m.attendees.forEach(a => {
      const key = a.id || `printed:${a.display}`;
      const existing = map.get(key);
      if (existing) existing.meetingCount += 1;
      else map.set(key, { ...a, key, meetingCount: 1 });
    });
  });
  const people = Array.from(map.values());
  const maxMeetings = people.reduce((m, p) => Math.max(m, p.meetingCount), 1);
  const order = side => people.filter(p => p.side === side).sort((a, b) => (b.tier === "roster") - (a.tier === "roster") || a.name.localeCompare(b.name));
  return { US: order("US"), USSR: order("USSR"), maxMeetings };
}

function stageSurname(name) {
  const parts = name.split(/\s+/).filter(t => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(t));
  return parts[parts.length - 1] || name;
}

function stageInitials(name) {
  const parts = String(name ?? "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? stageSurname(name)[0] : "")).toUpperCase();
}

// Sequential shade per delegation: a figure who sat in more of the six
// documented meetings gets a deeper disc, so the summit's core cast
// (Shultz, Shevardnadze, the principals and their interpreters) reads
// darker than the one-session participants. Endpoints run from a pale
// tint (one meeting) to the full side colour (attended the most).
const STAGE_SHADE = {
  US:    { light: [157, 179, 201], dark: [18, 53, 91] },   // pale steel → navy
  USSR:  { light: [211, 165, 165], dark: [143, 45, 45] },  // pale rose → red
  other: { light: [176, 166, 158], dark: [91, 74, 61] },   // pale → slate
};

// count is the running number of meetings a figure has entered so far; the
// disc deepens toward the full side colour as playback accumulates them.
function stageShade(side, count, maxMeetings) {
  const ramp = STAGE_SHADE[side] || STAGE_SHADE.other;
  const t = maxMeetings > 0 ? Math.min(count, maxMeetings) / maxMeetings : 0;
  const rgb = ramp.light.map((lo, i) => Math.round(lo + (ramp.dark[i] - lo) * t));
  // White initials need a dark enough disc; fall back to ink on pale ones.
  const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return { fill: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, ink: luma > 0.62 ? "var(--frus-ink)" : "var(--frus-paper)" };
}

function renderStage() {
  const canvas = document.getElementById("stage-canvas");
  if (!canvas) return;
  canvas.innerHTML = "";
  const beats = stageBeats();
  const people = stagePeople();

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${STAGE_W} ${STAGE_H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  canvas.appendChild(svg);

  // The house and the table.
  const house = document.createElementNS(SVG_NS, "rect");
  house.setAttribute("x", 235); house.setAttribute("y", 70);
  house.setAttribute("width", 430); house.setAttribute("height", 440);
  house.setAttribute("rx", 4);
  house.setAttribute("class", "stage-house");
  svg.appendChild(house);

  const houseLabel = document.createElementNS(SVG_NS, "text");
  houseLabel.setAttribute("x", STAGE_W / 2); houseLabel.setAttribute("y", 96);
  houseLabel.setAttribute("text-anchor", "middle");
  houseLabel.setAttribute("class", "stage-house-label");
  houseLabel.textContent = "HÖFÐI HOUSE";
  svg.appendChild(houseLabel);

  const table = document.createElementNS(SVG_NS, "ellipse");
  table.setAttribute("cx", STAGE_W / 2); table.setAttribute("cy", 290);
  table.setAttribute("rx", 150); table.setAttribute("ry", 52);
  table.setAttribute("class", "stage-table");
  svg.appendChild(table);

  const meetingTitle = document.createElementNS(SVG_NS, "text");
  meetingTitle.setAttribute("x", STAGE_W / 2); meetingTitle.setAttribute("y", 286);
  meetingTitle.setAttribute("text-anchor", "middle");
  meetingTitle.setAttribute("class", "stage-meeting-title");
  meetingTitle.setAttribute("id", "stage-meeting-title");
  svg.appendChild(meetingTitle);

  const meetingTime = document.createElementNS(SVG_NS, "text");
  meetingTime.setAttribute("x", STAGE_W / 2); meetingTime.setAttribute("y", 304);
  meetingTime.setAttribute("text-anchor", "middle");
  meetingTime.setAttribute("class", "stage-meeting-time");
  meetingTime.setAttribute("id", "stage-meeting-time");
  svg.appendChild(meetingTime);

  // Bench labels.
  [["UNITED STATES", 108], ["SOVIET UNION", STAGE_W - 108]].forEach(([label, x]) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", 56);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "stage-bench-label");
    t.textContent = label;
    svg.appendChild(t);
  });

  // Tokens with fixed bench homes: two columns per delegation so the
  // name labels don't collide.
  const tokens = new Map();
  const benchTop = 92, benchRowH = 58, benchColOff = 46;
  const makeTokens = (list, benchX) => {
    list.forEach((p, i) => {
      const homeX = benchX + (i % 2 === 0 ? -benchColOff : benchColOff);
      const homeY = benchTop + Math.floor(i / 2) * benchRowH;
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", `stage-token ${sideClass(p.side)}${p.tier === "roster" ? " is-roster" : ""}`);
      if (p.id) {
        g.dataset.id = p.id;
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
      }
      const meetingsWord = p.meetingCount === 1 ? "meeting" : "meetings";
      g.setAttribute("aria-label", `${p.name} (${p.side}) — attends ${p.meetingCount} of ${state.stage.meetings.length} documented ${meetingsWord}`);
      // Discs begin empty (no meetings entered yet) and deepen in applyBeat
      // as playback accumulates each figure's attendance.
      const shade0 = stageShade(p.side, 0, people.maxMeetings);
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("r", 12);
      c.style.fill = shade0.fill;
      g.appendChild(c);
      const init = document.createElementNS(SVG_NS, "text");
      init.setAttribute("class", "stage-token-initials");
      init.setAttribute("text-anchor", "middle");
      init.setAttribute("y", 4);
      init.style.fill = shade0.ink;
      init.textContent = stageInitials(p.name);
      g.appendChild(init);
      const nm = document.createElementNS(SVG_NS, "text");
      nm.setAttribute("class", "stage-token-name");
      nm.setAttribute("text-anchor", "middle");
      nm.setAttribute("y", 26);
      nm.textContent = stageSurname(p.name);
      g.appendChild(nm);
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = p.name;
      g.appendChild(title);
      const home = { x: homeX, y: homeY };
      g.setAttribute("transform", `translate(${home.x}, ${home.y})`);
      if (p.id) {
        const activate = () => {
          const s = state.selection;
          if (s && s.kind === "person" && s.id === p.id) clearSelection();
          else setSelection("person", p.id, p.name);
        };
        g.addEventListener("click", activate);
        g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
      }
      svg.appendChild(g);
      tokens.set(p.key, { el: g, circle: c, initials: init, home, person: p });
    });
  };
  makeTokens(people.US, 108);
  makeTokens(people.USSR, STAGE_W - 108);

  // Seat positions around the table: US along the lower arc, USSR the
  // upper, principals at the centre of their row.
  const seatFor = (side, index, count) => {
    const offsets = [];
    for (let k = 0; k < count; k++) offsets.push((k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2));
    const spread = Math.min(64, 320 / Math.max(count - 1, 1));
    const x = STAGE_W / 2 + offsets[index] * spread;
    // Zigzag alternate seats away from the table so neighbouring name
    // labels don't collide.
    const zig = (Math.abs(offsets[index]) % 2) * 18;
    const y = side === "US" ? 290 + 52 + 34 + zig : 290 - 52 - 44 - zig;
    return { x, y };
  };

  const scrub = document.getElementById("stage-scrub");
  scrub.max = String(beats.length - 1);

  const applyBeat = idx => {
    state.stageBeat = idx;
    scrub.value = String(idx);
    const beat = beats[idx];
    const meeting = beat.kind === "meeting" ? beat.meeting : null;
    svg.classList.toggle("is-meeting", !!meeting);

    const attending = new Map();
    if (meeting) {
      const bySide = { US: [], USSR: [] };
      meeting.attendees.forEach(a => bySide[a.side] && bySide[a.side].push(a));
      // Principals to the middle seats.
      const principalFirst = arr => arr.slice().sort((a, b) =>
        (b.id === "reagan_gorbachev.reagan" || b.id === "reagan_gorbachev.gorbachev" || b.id === "us.shultz" || b.id === "ussr.shevardnadze") -
        (a.id === "reagan_gorbachev.reagan" || a.id === "reagan_gorbachev.gorbachev" || a.id === "us.shultz" || a.id === "ussr.shevardnadze"));
      ["US", "USSR"].forEach(side => {
        principalFirst(bySide[side]).forEach((a, i, arr) => {
          attending.set(a.id || `printed:${a.display}`, seatFor(side, i, arr.length));
        });
      });
    }
    // Running attendance through the current beat: a figure's disc deepens
    // each time they enter another of the six meetings, so by the final
    // beat the depth of colour reflects how many they attended in all.
    const cumCount = new Map();
    for (let i = 0; i <= idx; i++) {
      if (beats[i].kind !== "meeting") continue;
      beats[i].meeting.attendees.forEach(a => {
        const key = a.id || `printed:${a.display}`;
        cumCount.set(key, (cumCount.get(key) || 0) + 1);
      });
    }

    tokens.forEach(tok => {
      const seat = attending.get(tok.person.key);
      const pos = seat || tok.home;
      tok.el.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
      const shade = stageShade(tok.person.side, cumCount.get(tok.person.key) || 0, people.maxMeetings);
      tok.circle.style.fill = shade.fill;
      tok.initials.style.fill = shade.ink;
      tok.el.classList.toggle("is-benched", !!meeting && !seat);
    });

    document.getElementById("stage-meeting-title").textContent = meeting ? (meeting.session.split(" - ")[0] || "Meeting") : "";
    document.getElementById("stage-meeting-time").textContent = meeting ? meeting.time_display.replace(/^.*?\d{4},\s*/, "") : "";

    const cap = document.getElementById("stage-caption");
    if (meeting) {
      const notes = meeting.attendees.filter(a => a.note).map(a => `${escape(a.display)} — ${escape(a.note)}`);
      cap.innerHTML = `
        <p class="stage-cap-day">${escape(stageDayLabel(meeting.start))}</p>
        <p class="stage-cap-title">${escape(meeting.session)}</p>
        <p class="stage-cap-meta">${escape(meeting.time_display)} · ${escape(meeting.venue)}</p>
        <p class="stage-cap-meta">${meeting.attendees.length} participants, as printed in the memcon</p>
        ${notes.length ? `<p class="stage-cap-note">${notes.join("<br>")}</p>` : ""}
        ${meeting.caption_note ? `<p class="stage-cap-note">${escape(meeting.caption_note)}</p>` : ""}
        <a class="tr-cta" href="${escape(safeHttpUrl(meeting.url) || "#")}" target="_blank" rel="noopener">Read the memcon (Doc ${meeting.doc_number}) →</a>
      `;
    } else {
      cap.innerHTML = `
        <p class="stage-cap-day">${escape(beat.label)}</p>
        <p class="stage-cap-text">${escape(beat.text)}</p>
      `;
    }
  };

  // Transport.
  let timer = null;
  const playBtn = document.getElementById("stage-play");
  const stop = () => {
    state.stagePlaying = false;
    playBtn.textContent = "Play";
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const scheduleNext = () => {
    const beat = beats[state.stageBeat];
    timer = setTimeout(() => {
      if (state.stageBeat >= beats.length - 1) { stop(); return; }
      applyBeat(state.stageBeat + 1);
      scheduleNext();
    }, beat.kind === "meeting" ? 3400 : 1800);
  };
  const play = () => {
    if (state.stageBeat >= beats.length - 1) applyBeat(0);
    state.stagePlaying = true;
    playBtn.textContent = "Pause";
    scheduleNext();
  };
  playBtn.addEventListener("click", () => (state.stagePlaying ? stop() : play()));
  document.getElementById("stage-prev").addEventListener("click", () => { stop(); applyBeat(Math.max(0, state.stageBeat - 1)); });
  document.getElementById("stage-next").addEventListener("click", () => { stop(); applyBeat(Math.min(beats.length - 1, state.stageBeat + 1)); });
  scrub.addEventListener("input", () => { stop(); applyBeat(parseInt(scrub.value, 10) || 0); });
  stageStop = stop;

  applyBeat(0);
}

function applyStageEmphasis() {
  const svg = document.querySelector("#stage-canvas svg");
  if (!svg) return;
  const sel = state.selection;
  svg.querySelectorAll(".stage-token").forEach(tok => {
    tok.classList.remove("is-selected", "is-dimmed");
    if (sel && sel.kind === "person") {
      if (tok.dataset.id === sel.id) tok.classList.add("is-selected");
      else tok.classList.add("is-dimmed");
    }
  });
}

// ------------------------ timeline view ------------------------
function renderTimeline() {
  const el = document.getElementById("timeline-canvas");
  el.innerHTML = "";
  const days = groupBy(state.timeline, e => e.date);
  const orderedDates = Object.keys(days).sort();

  orderedDates.forEach(date => {
    const events = days[date];
    const day = document.createElement("section");
    day.className = "day";

    const head = document.createElement("header");
    head.className = "day__head";
    const h = document.createElement("h3");
    h.className = "day__date";
    h.textContent = events[0].date_display || date;
    const meta = document.createElement("span");
    meta.className = "day__meta";
    meta.textContent = `${events.length} events`;
    head.append(h, meta);
    day.appendChild(head);

    // A day made up entirely of declassified PDFs gets a caption that
    // makes the supplemental nature (and the missing per-document dates)
    // explicit, so these never read as dated FRUS chronology.
    if (events.every(e => e.kind === "foia")) {
      day.classList.add("day--foia");
      const cap = document.createElement("p");
      cap.className = "day__caption";
      // The undated band (sentinel date) groups documents whose date could
      // not be determined; dated bands carry document dates derived from the
      // PDF text (cable date-time groups, in-text dates, or event context).
      cap.textContent = events.some(e => e.dated)
        ? "Declassified PDFs supplementing the FRUS record — dates derived from each document's contents (est./uncertain where marked)."
        : "Declassified PDFs supplementing the FRUS record — these documents' dates could not be determined from the release.";
      day.appendChild(cap);
    }

    events.forEach(ev => {
      const row = document.createElement("div");
      row.className = `event event--${ev.kind}`;
      row.dataset.docId = ev.doc_id || "";
      row.dataset.date = ev.date;

      const t = document.createElement("div");
      t.className = "event__time";
      t.textContent = ev.kind === "photo" ? "PHOTO" : (ev.time_hint || "—");
      const b = document.createElement("div");
      b.className = "event__text";
      if (ev.kind === "photo") {
        const img = safeLocalImg(ev.thumb_url) || safeLocalImg(ev.local_url);
        const full = safeLocalImg(ev.local_url);
        const source = safeHttpUrl(ev.url);
        const cap = escape(ev.caption || ev.text || "");
        const figure = img
          ? `<a class="event__photo-link" href="${escape(full || img)}" target="_blank" rel="noopener">`
            + `<img class="event__photo-img" src="${escape(img)}" alt="${cap}" loading="lazy" width="240" />`
            + `</a>`
          : "";
        b.innerHTML = figure
          + `<span class="event__photo-cap">${cap}</span>`
          + `<span class="event__photo-credit">${escape(ev.credit || "")}`
          + (source ? ` · <a href="${escape(source)}" target="_blank" rel="noopener">Reagan Library</a>` : "")
          + `</span>`;
      } else if (ev.kind === "foia") {
        const local = safeLocalPdf(ev.local_url);
        const source = safeHttpUrl(ev.url);
        // Date is the grouping key; the PDF file number is kept internally
        // (row.dataset.docId) but no longer shown as the visible heading.
        const foiaTitle = ev.description || ev.detail || "Declassified document";
        b.innerHTML = `<span class="event__foia-title">${escape(foiaTitle)}</span>`
          + `<span class="tag tag--source-foia">${escape(ev.classification || "Declassified")}</span>`
          + (ev.detail && ev.detail !== foiaTitle ? ` <span class="event__foia-detail">${escape(ev.detail)}</span>` : "")
          + `<span class="event__foia-links">`
          + (local ? `<a href="${escape(local)}" target="_blank" rel="noopener">Open PDF &rarr;</a>` : "")
          + (source ? `<a href="${escape(source)}" target="_blank" rel="noopener">Source at foia.state.gov</a>` : "")
          + `</span>`;
      } else if (ev.kind === "document") {
        b.innerHTML = `<a href="${escape(safeHttpUrl(ev.url) || "#")}" target="_blank" rel="noopener">${escape(ev.text)}</a>${ev.session ? ` <span style="color:var(--frus-slate);font-size:var(--fs-xs);font-family:var(--font-interface)">· ${escape(ev.session)}</span>` : ""}`;
        row.style.cursor = "pointer";
        row.addEventListener("click", (e) => {
          if (e.target.tagName !== "A") {
            const s = state.selection;
            if (s && s.kind === "document" && s.id === ev.doc_id) clearSelection();
            else setSelection("document", ev.doc_id, ev.text);
          }
        });
      } else {
        b.textContent = ev.text;
      }
      row.append(t, b);
      day.appendChild(row);
    });
    el.appendChild(day);
  });
}

function highlightTimeline() {
  const s = state.selection;
  document.querySelectorAll(".timeline .event").forEach(row => {
    row.classList.remove("is-selected", "is-faded");
    if (!s) return;
    if (s.kind === "document") {
      if (row.dataset.docId === s.id) row.classList.add("is-selected");
      else row.classList.add("is-faded");
    } else if (s.kind === "person") {
      // Fade rows whose linked document doesn't include this person; keep
      // chronology paragraphs highlighted normally.
      if (row.classList.contains("event--document")) {
        const doc = state.docs.find(d => d.doc_id === row.dataset.docId);
        if (doc && doc.persons.some(p => p.id === s.id)) row.classList.add("is-selected");
        else row.classList.add("is-faded");
      }
    } else if (s.kind === "topic") {
      if (row.classList.contains("event--document")) {
        const doc = state.docs.find(d => d.doc_id === row.dataset.docId);
        if (doc && doc.topics.includes(s.id)) row.classList.add("is-selected");
        else row.classList.add("is-faded");
      }
    }
  });
}

// ------------------------ explorer view ------------------------
function renderExplorer() {
  // populate select controls once
  const sources = uniq(state.docs.map(d => d.source)).sort();
  const topics = uniq(state.docs.flatMap(d => d.topics)).sort();
  const subjects = uniq(state.docs.flatMap(d => (d.subjects || []).map(s => s.name))).sort();
  const persons = uniq(state.docs.flatMap(d => d.persons.filter(p => p.in_network).map(p => JSON.stringify({ id: p.id, name: p.name }))))
    .map(JSON.parse)
    .sort((a, b) => a.name.localeCompare(b.name));

  fillSelect("explorer-source", sources.map(s => ({ value: s, label: s })));
  fillSelect("explorer-topic", topics.map(t => ({ value: t, label: t })));
  fillSelect("explorer-subject", subjects.map(s => ({ value: s, label: s })));
  fillSelect("explorer-person", persons.map(p => ({ value: p.id, label: p.name })));

  renderExplorerRows();
}

function setupExplorerControls() {
  ["explorer-search", "explorer-source", "explorer-phase", "explorer-topic", "explorer-subject", "explorer-person"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderExplorerRows);
    document.getElementById(id).addEventListener("change", renderExplorerRows);
  });
  document.getElementById("explorer-clear").addEventListener("click", () => {
    ["explorer-search", "explorer-source", "explorer-phase", "explorer-topic", "explorer-subject", "explorer-person"].forEach(id => {
      document.getElementById(id).value = "";
    });
    clearSelection();
    renderExplorerRows();
  });
}

function currentExplorerFilters() {
  return {
    q: (document.getElementById("explorer-search").value || "").toLowerCase().trim(),
    source: document.getElementById("explorer-source").value,
    phase: document.getElementById("explorer-phase").value,
    topic: document.getElementById("explorer-topic").value,
    subject: document.getElementById("explorer-subject").value,
    person: document.getElementById("explorer-person").value,
  };
}

function filteredDocs() {
  const f = currentExplorerFilters();
  const s = state.selection;
  return state.docs.filter(d => {
    if (f.source && d.source !== f.source) return false;
    if (f.phase && d.summit_phase !== f.phase) return false;
    if (f.topic && !d.topics.includes(f.topic)) return false;
    if (f.subject && !(d.subjects || []).some(s => s.name === f.subject)) return false;
    if (f.person && !d.persons.some(p => p.id === f.person)) return false;
    if (f.q) {
      const blob = [
        d.title, d.excerpt, d.session, d.principals,
        d.persons.map(p => p.name).join(" "),
        d.topics.join(" "),
        (d.subjects || []).map(s => s.name).join(" "),
        (d.events || []).map(e => e.name).join(" "),
        d.doc_id,
      ].join(" ").toLowerCase();
      if (!blob.includes(f.q)) return false;
    }
    // Cross-view selection also narrows the explorer
    if (s) {
      if (s.kind === "person" && !d.persons.some(p => p.id === s.id)) return false;
      if (s.kind === "topic" && !d.topics.includes(s.id)) return false;
    }
    return true;
  });
}

function renderExplorerRows() {
  const rows = filteredDocs();
  const tbody = document.getElementById("explorer-tbody");
  tbody.innerHTML = "";
  const meta = document.getElementById("explorer-meta");
  meta.textContent = `${rows.length} of ${state.docs.length} documents`;

  const frag = document.createDocumentFragment();
  rows.forEach(d => {
    const tr = document.createElement("tr");
    tr.dataset.docId = d.doc_id;
    if (state.selection && state.selection.kind === "document" && state.selection.id === d.doc_id) tr.classList.add("is-selected");

    tr.innerHTML = `
      <td class="col-date">${escape(d.date || "—")}</td>
      <td class="col-source">
        <span class="tag ${d.source === "foia.state.gov" ? "tag--source-foia" : "tag--source-frus"}">${escape(d.source)}</span>
        ${d.verified === false ? `<span class="tag tag--unverified">unverified</span>` : ""}
      </td>
      <td class="col-title">
        ${d.doc_number ? `<span class="doc-num">#${d.doc_number}</span>` : ""}
        ${escape(d.title || "(untitled)")}
        ${d.summit_phase === "summit" ? `<br><span class="tag tag--phase-summit">Summit</span>` : ""}
      </td>
      <td class="col-session">${escape(d.session || "")}</td>
      <td class="col-topics">${(d.topics || []).map(t => `<span class="tag">${escape(t)}</span>`).join(" ")}</td>
    `;
    tr.addEventListener("click", () => {
      const s = state.selection;
      if (s && s.kind === "document" && s.id === d.doc_id) clearSelection();
      else setSelection("document", d.doc_id, d.title);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  renderTranscript();
}

function highlightExplorer() {
  document.querySelectorAll("#explorer-tbody tr").forEach(row => {
    row.classList.toggle(
      "is-selected",
      !!(state.selection && state.selection.kind === "document" && state.selection.id === row.dataset.docId)
    );
  });
  renderExplorerRows(); // reflect person/topic narrowing
  renderTranscript();
}

function renderTranscript() {
  const el = document.getElementById("transcript");
  const s = state.selection;
  if (!s || s.kind !== "document") {
    el.innerHTML = `<div class="transcript__empty">Select a document to open its record here.</div>`;
    return;
  }
  const d = state.docs.find(d => d.doc_id === s.id);
  if (!d) { el.innerHTML = `<div class="transcript__empty">Not found.</div>`; return; }

  const persons = (d.persons || []).filter(p => p.in_network);
  const personTags = persons.map(p => `<span class="tag" style="border-color:${sideColor(p.side)};color:${sideColor(p.side)}">${escape(p.name)}</span>`).join(" ");
  const topicTags = (d.topics || []).map(t => `<span class="tag" style="border-color:${TOPIC_COLORS[t] || "var(--frus-slate)"};color:${TOPIC_COLORS[t] || "var(--frus-slate)"}">${escape(t)}</span>`).join(" ");
  const eventTags = (d.events || []).map(e => `<span class="tag">${escape(e.name)}</span>`).join(" ");
  const subjectGroups = groupBy(d.subjects || [], s => s.category);
  const subjectHtml = Object.keys(subjectGroups).sort().map(cat => `
    <p class="tr-subject-cat">${escape(cat)}</p>
    <div>${subjectGroups[cat].map(s => `<span class="tag" title="${escape(cat)}${s.subcategory ? escape(" · " + s.subcategory) : ""}">${escape(s.name)}</span>`).join(" ")}</div>
  `).join("");

  el.innerHTML = `
    <p class="tr-eyebrow">${escape(d.source_kind || "document")} · ${escape(d.source || "")}</p>
    <h3 class="tr-title">${d.doc_number ? `${d.doc_number}. ` : ""}${escape(d.title || "")}</h3>
    <p class="tr-meta">${escape(d.date_display || d.date || "")} ${d.place ? `· ${escape(d.place)}` : ""}${d.doc_id ? ` · <span>${escape(d.doc_id)}</span>` : ""}</p>
    ${d.verified === false ? `<div class="tr-caveat"><strong>Unverified.</strong> This document number has not been confirmed against a live page at history.state.gov.</div>` : ""}
    ${d.session ? `<div class="tr-section"><p class="tr-label">Session</p><p>${escape(d.session)}${d.principals ? ` — ${escape(d.principals)}` : ""}${d.venue ? ` · ${escape(d.venue)}` : ""}</p></div>` : ""}
    ${docSummary(d) ? `<div class="tr-section"><p class="tr-label">Overview</p><p class="doc-summary">${escape(docSummary(d))}</p></div>` : ""}
    ${d.case_number ? `<div class="tr-section"><p class="tr-label">Provenance</p><p style="font-family:var(--font-mono);font-size:var(--fs-xs)">Case ${escape(d.case_number)} · ${escape(d.doctype || "")} · ${escape(d.classification || "")}${d.release_decision ? ` · ${escape(d.release_decision)}` : ""}</p></div>` : ""}
    ${persons.length ? `<div class="tr-section"><p class="tr-label">Referenced</p><div>${personTags}</div></div>` : ""}
    ${topicTags ? `<div class="tr-section"><p class="tr-label">Topics</p><div>${topicTags}</div></div>` : ""}
    ${eventTags ? `<div class="tr-section"><p class="tr-label">Events</p><div>${eventTags}</div></div>` : ""}
    ${subjectHtml ? `<div class="tr-section"><p class="tr-label">Curated subjects</p>${subjectHtml}<p class="tr-provenance">Subject and event annotations by the Office of the Historian.</p></div>` : ""}
    ${safeHttpUrl(d.url) ? `<a class="tr-cta" href="${escape(safeHttpUrl(d.url))}" target="_blank" rel="noopener">${d.source === "foia.state.gov" ? "Open the declassified PDF at foia.state.gov" : "Read the FRUS document at history.state.gov"} →</a>` : ""}
  `;
}

// ------------------------ declassified PDF library ------------------------
// A flat list of every PDF in a single FOIA case release, served locally
// from docs/assets/pdf/ with a link back to the canonical foia.state.gov
// copy. Data comes from data/foia_pdfs.json (see scripts/fetch_foia_pdfs.py).

function humanBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

function setupFoiaControls() {
  const search = document.getElementById("foia-search");
  if (search) search.addEventListener("input", renderFoiaRows);

  const m = state.foiaPdfs || {};
  const caseEl = document.getElementById("foia-case-number");
  if (caseEl) caseEl.textContent = m.case_number || "";
  const subjEl = document.getElementById("foia-case-subject");
  if (subjEl) subjEl.textContent = m.case_subject || "";
  const link = document.getElementById("foia-source-link");
  const href = safeHttpUrl(m.search_url);
  if (link && href) link.setAttribute("href", href);
  else if (link) link.style.display = "none";
}

function renderFoia() {
  const nav = document.querySelector('.nav-btn[data-view="foia"]');
  const docs = (state.foiaPdfs && state.foiaPdfs.documents) || [];
  // Hide the whole view if the manifest is missing or empty.
  if (nav) nav.hidden = docs.length === 0;
  renderFoiaRows();
}

function renderFoiaRows() {
  const grid = document.getElementById("foia-grid");
  if (!grid) return;
  const all = (state.foiaPdfs && state.foiaPdfs.documents) || [];
  const q = (document.getElementById("foia-search")?.value || "").toLowerCase().trim();
  const rows = q
    ? all.filter(d => `${d.filename} ${d.title} ${d.doc_index} ${d.doctype} ${d.description || ""} ${d.date_display || ""}`.toLowerCase().includes(q))
    : all;

  const meta = document.getElementById("foia-meta");
  if (meta) {
    const totalBytes = state.foiaPdfs.total_bytes || 0;
    meta.textContent = `${rows.length} of ${all.length} declassified documents`
      + (totalBytes ? ` · ${humanBytes(totalBytes)} total` : "");
  }

  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  rows.forEach(d => {
    const li = document.createElement("li");
    li.className = "foia-card";
    const local = safeLocalPdf(d.local_url);
    const source = safeHttpUrl(d.source_url);
    const pages = d.page_count ? `${d.page_count} page${d.page_count === 1 ? "" : "s"}` : "";
    const size = humanBytes(d.size_bytes);
    const detail = [pages, size].filter(Boolean).join(" · ");
    const dateDisp = d.date_display || d.date || "";
    const desc = d.description || d.summary || "";
    li.innerHTML = `
      <div class="foia-card__index">${escape(String(d.doc_index || ""))}<span class="foia-card__total">/${escape(String(d.doc_total || ""))}</span></div>
      <div class="foia-card__body">
        <p class="foia-card__title">${escape(d.filename || "")}</p>
        ${dateDisp ? `<p class="foia-card__date">${escape(dateDisp)}</p>` : ""}
        ${desc ? `<p class="foia-card__desc">${escape(desc)}</p>` : ""}
        <p class="foia-card__meta">
          <span class="tag tag--source-foia">${escape(d.classification || "Unclassified")}</span>
          ${d.doctype ? `<span class="tag">${escape(d.doctype)}</span>` : ""}
          ${detail ? `<span class="foia-card__detail">${escape(detail)}</span>` : ""}
        </p>
        <p class="foia-card__links">
          ${local ? `<a class="tr-cta" href="${escape(local)}" target="_blank" rel="noopener">Open PDF &rarr;</a>` : ""}
          ${source ? `<a class="foia-card__source" href="${escape(source)}" target="_blank" rel="noopener">Source at foia.state.gov</a>` : ""}
        </p>
      </div>`;
    frag.appendChild(li);
  });
  grid.appendChild(frag);
}

// ------------------------ utils ------------------------
function fillSelect(id, options) {
  const el = document.getElementById(id);
  const first = el.querySelector("option");
  el.innerHTML = "";
  if (first) el.appendChild(first);
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value; opt.textContent = o.label;
    el.appendChild(opt);
  });
}

function groupBy(arr, keyFn) {
  const out = {};
  arr.forEach(x => {
    const k = keyFn(x);
    (out[k] = out[k] || []).push(x);
  });
  return out;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// Only http(s) URLs are safe as outbound href values; escape() blocks
// attribute breakout but not javascript:/data: and other schemes.
// Returns the normalized URL for valid http(s) links, otherwise "".
function safeHttpUrl(url) {
  try {
    const u = new URL(String(url ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

// Same-site relative path to a locally-served PDF. The manifest is
// generated by our own pipeline, but we still constrain the value to a
// safe relative "assets/pdf/…/NNN.pdf" shape so a bad entry can't emit a
// javascript:/data: href or escape the assets tree.
function safeLocalPdf(url) {
  const s = String(url ?? "").trim();
  return /^assets\/pdf\/[\w./-]+\.pdf$/.test(s) && !s.includes("..") ? s : "";
}

// Same-site relative path to a locally-served photo, constrained to the
// photos tree so a bad manifest entry can't emit a javascript:/data:
// src or escape the assets directory.
function safeLocalImg(url) {
  const s = String(url ?? "").trim();
  return /^assets\/photos\/[\w./-]+\.jpe?g$/i.test(s) && !s.includes("..") ? s : "";
}

document.addEventListener("DOMContentLoaded", boot);
