// reykjavik-40 front end
// Three linked views (network, timeline, explorer) driven from data/*.json.
// No external dependencies.

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
  const [docs, register, stage, timeline, manifest] = await Promise.all([
    fetch("data/frus_core.json").then(r => r.json()),
    fetch("data/register.json").then(r => r.json()),
    fetch("data/summit_stage.json").then(r => r.json()),
    fetch("data/timeline.json").then(r => r.json()),
    fetch("data/manifest.json").then(r => r.json()),
  ]);
  return { docs, register, stage, timeline, manifest };
}

async function boot() {
  try {
    const { docs, register, stage, timeline, manifest } = await loadData();
    state.docs = docs;
    state.register = register;
    state.stage = stage;
    state.timeline = timeline;
    state.manifest = manifest;

    setupNav();
    setupCorpusLine();
    setupRegisterControls();
    renderRegister();
    renderStage();
    renderTimeline();
    renderExplorer();
    setupExplorerControls();
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
    body.innerHTML = `
      <p><span class="side ${sideClass(n.side)}">${escape(n.side === "other" ? "" : n.side || "")}</span></p>
      <strong>${escape(n.name || s.label || s.id)}</strong>
      <p style="color:var(--frus-slate);font-style:italic">${escape(n.role || "")}</p>
      <p><span class="tr-label">Appears in</span> ${n.total || 0} documents${span ? ` · ${span}` : ""}</p>
      <p><span class="tr-label">Top topics</span><br>${topics || '<span style="color:var(--frus-slate)">—</span>'}</p>
    `;
  } else if (s.kind === "document") {
    const d = state.docs.find(d => d.doc_id === s.id) || {};
    body.innerHTML = `
      <p><span class="tag ${d.source === "foia.state.gov" ? "tag--source-foia" : "tag--source-frus"}">${escape(d.source || "")}</span> ${d.summit_phase ? `<span class="tag tag--phase-${d.summit_phase === "summit" ? "summit" : ""}">${escape(d.summit_phase)}</span>` : ""}</p>
      <strong>${escape(d.title || s.label || s.id)}</strong>
      <p style="color:var(--frus-slate);font-family:var(--font-mono);font-size:var(--fs-xs)">${escape(d.date_display || d.date || "")}</p>
      ${d.excerpt ? `<p style="font-family:var(--font-editorial);border-left:2px solid var(--frus-gold);padding-left:0.6rem;color:var(--frus-ink)">${escape(d.excerpt)}</p>` : ""}
      ${d.url ? `<a class="tr-cta" href="${escape(d.url)}" target="_blank" rel="noopener">Read at source →</a>` : ""}
    `;
  } else if (s.kind === "topic") {
    body.innerHTML = `<strong>Topic strand</strong><p style="color:var(--frus-slate)">${escape(s.label)}</p><p>Highlighted across all three views.</p>`;
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
  // printed name for the two unregistered Soviets).
  const map = new Map();
  (state.stage.meetings || []).forEach(m => {
    m.attendees.forEach(a => {
      const key = a.id || `printed:${a.display}`;
      if (!map.has(key)) map.set(key, { key, ...a });
    });
  });
  const people = Array.from(map.values());
  const order = side => people.filter(p => p.side === side).sort((a, b) => (b.tier === "roster") - (a.tier === "roster") || a.name.localeCompare(b.name));
  return { US: order("US"), USSR: order("USSR") };
}

function stageSurname(name) {
  const parts = name.split(/\s+/).filter(t => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(t));
  return parts[parts.length - 1] || name;
}

function stageInitials(name) {
  const parts = name.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? stageSurname(name)[0] : "")).toUpperCase();
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
      g.setAttribute("aria-label", `${p.name} (${p.side})`);
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("r", 12);
      g.appendChild(c);
      const init = document.createElementNS(SVG_NS, "text");
      init.setAttribute("class", "stage-token-initials");
      init.setAttribute("text-anchor", "middle");
      init.setAttribute("y", 4);
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
      tokens.set(p.key, { el: g, home, person: p });
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
    tokens.forEach(tok => {
      const seat = attending.get(tok.person.key);
      const pos = seat || tok.home;
      tok.el.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
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
        <a class="tr-cta" href="${escape(meeting.url)}" target="_blank" rel="noopener">Read the memcon (Doc ${meeting.doc_number}) →</a>
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

    events.forEach(ev => {
      const row = document.createElement("div");
      row.className = `event event--${ev.kind}`;
      row.dataset.docId = ev.doc_id || "";
      row.dataset.date = ev.date;

      const t = document.createElement("div");
      t.className = "event__time";
      t.textContent = ev.time_hint || "—";
      const b = document.createElement("div");
      b.className = "event__text";
      if (ev.kind === "document") {
        b.innerHTML = `<a href="${escape(ev.url || "#")}" target="_blank" rel="noopener">${escape(ev.text)}</a>${ev.session ? ` <span style="color:var(--frus-slate);font-size:var(--fs-xs);font-family:var(--font-interface)">· ${escape(ev.session)}</span>` : ""}`;
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
    ${d.excerpt ? `<div class="tr-section"><p class="tr-label">Excerpt</p><blockquote class="tr-excerpt">${escape(d.excerpt)}</blockquote></div>` : ""}
    ${d.case_number ? `<div class="tr-section"><p class="tr-label">Provenance</p><p style="font-family:var(--font-mono);font-size:var(--fs-xs)">Case ${escape(d.case_number)} · ${escape(d.doctype || "")} · ${escape(d.classification || "")}${d.release_decision ? ` · ${escape(d.release_decision)}` : ""}</p></div>` : ""}
    ${persons.length ? `<div class="tr-section"><p class="tr-label">Referenced</p><div>${personTags}</div></div>` : ""}
    ${topicTags ? `<div class="tr-section"><p class="tr-label">Topics</p><div>${topicTags}</div></div>` : ""}
    ${eventTags ? `<div class="tr-section"><p class="tr-label">Events</p><div>${eventTags}</div></div>` : ""}
    ${subjectHtml ? `<div class="tr-section"><p class="tr-label">Curated subjects</p>${subjectHtml}<p class="tr-provenance">Subject and event annotations by the Office of the Historian.</p></div>` : ""}
    ${d.url ? `<a class="tr-cta" href="${escape(d.url)}" target="_blank" rel="noopener">Open at ${d.source === "foia.state.gov" ? "foia.state.gov" : "history.state.gov"} →</a>` : ""}
  `;
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

document.addEventListener("DOMContentLoaded", boot);
