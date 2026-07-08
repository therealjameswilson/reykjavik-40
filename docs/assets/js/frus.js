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
  network: { nodes: [], edges: [] },
  timeline: [],
  manifest: {},
  photos: [],
  activeView: "network",
  selection: null,   // { kind: 'person'|'document'|'topic'|'session', id, label }
  topicFilter: new Set(),
};

// ------------------------ boot ------------------------
async function boot() {
  try {
    const [docs, network, timeline, manifest, photosPayload] = await Promise.all([
      fetch("data/frus_core.json").then(r => r.json()),
      fetch("data/network.json").then(r => r.json()),
      fetch("data/timeline.json").then(r => r.json()),
      fetch("data/manifest.json").then(r => r.json()),
      fetch("data/reagan_photos.json").then(r => r.json()).catch(() => ({ photos: [] })),
    ]);
    state.docs = docs;
    state.network = network;
    state.timeline = timeline;
    state.manifest = manifest;
    state.photos = (photosPayload && photosPayload.photos) || [];
    // Fold photograph events into the timeline as first-class chronological entries.
    state.timeline = mergePhotosIntoTimeline(state.timeline, state.photos);
    state.topicFilter = new Set(Object.keys(TOPIC_COLORS));

    setupNav();
    setupCorpusLine();
    renderNetwork();
    renderTimeline();
    renderExplorer();
    renderGallery();
    setupLightbox();
    setupExplorerControls();
    setupTopicFilter();
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
      state.activeView = view;
    });
  });
}

function setupCorpusLine() {
  const c = state.manifest.counts || {};
  const line = document.getElementById("corpus-line");
  if (!line) return;
  const photoCount = (state.photos && state.photos.length) || c.photographs || 0;
  line.textContent = `${c.total_documents || 0} documents · ${c.network_nodes || 0} network nodes · ${c.timeline_events || 0} timeline events · ${photoCount} photographs · generated ${(state.manifest.generated || "").slice(0, 10)}`;
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
    const n = state.network.nodes.find(n => n.id === s.id) || {};
    const topics = (n.topics || []).slice(0, 5).map(t => `<span class="tag">${escape(t.topic)} · ${t.count}</span>`).join(" ");
    body.innerHTML = `
      <p><span class="side ${n.side === "US" ? "us" : "ussr"}">${escape(n.side || "")}</span></p>
      <strong>${escape(n.name || s.label || s.id)}</strong>
      <p style="color:var(--frus-slate);font-style:italic">${escape(n.role || "")}</p>
      <p><span class="tr-label">Appears in</span> ${n.doc_count || 0} documents</p>
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
  // Network
  highlightNetwork();
  // Timeline
  highlightTimeline();
  // Explorer
  highlightExplorer();
}

// ------------------------ network view ------------------------
function renderNetwork() {
  const canvas = document.getElementById("network-canvas");
  canvas.innerHTML = "";

  const width = canvas.clientWidth || 900;
  const height = canvas.clientHeight || 620;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  canvas.appendChild(svg);

  const gEdges = document.createElementNS(SVG_NS, "g");
  gEdges.setAttribute("class", "edges");
  const gNodes = document.createElementNS(SVG_NS, "g");
  gNodes.setAttribute("class", "nodes");
  svg.appendChild(gEdges);
  svg.appendChild(gNodes);

  const nodes = state.network.nodes.map(n => ({ ...n }));
  const edges = state.network.edges;

  // ---- Deterministic layout: US on the left arc, USSR on the right arc,
  //      Reagan & Gorbachev in the centre so their edges dominate.
  const padX = 90, padY = 90;
  const cx = width / 2;
  const cy = height / 2;
  const armX = (width / 2) - padX;   // horizontal distance from centre to the outer nodes
  const armY = (height / 2) - padY;
  const rInner = Math.min(width, height) * 0.09;

  const usNodes = nodes.filter(n => n.side === "US" && n.id !== "reagan_gorbachev.reagan");
  const ussrNodes = nodes.filter(n => n.side === "USSR" && n.id !== "reagan_gorbachev.gorbachev");
  usNodes.sort((a, b) => b.doc_count - a.doc_count);
  ussrNodes.sort((a, b) => b.doc_count - a.doc_count);

  // Place US nodes along a vertical column on the left, spaced from top to bottom.
  const layoutColumn = (arr, side) => {
    if (arr.length === 0) return;
    const xBase = side === "left" ? cx - armX : cx + armX;
    // Alternate slightly around the column to reduce label collision.
    arr.forEach((n, i) => {
      const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
      const y = cy - armY + t * (armY * 2);
      const jitter = (i % 2 === 0 ? 1 : -1) * (side === "left" ? 45 : -45);
      n.x = xBase + jitter;
      n.y = y;
    });
  };
  layoutColumn(usNodes, "left");
  layoutColumn(ussrNodes, "right");

  const reagan = nodes.find(n => n.id === "reagan_gorbachev.reagan");
  const gorbachev = nodes.find(n => n.id === "reagan_gorbachev.gorbachev");
  if (reagan) { reagan.x = cx - rInner; reagan.y = cy; }
  if (gorbachev) { gorbachev.x = cx + rInner; gorbachev.y = cy; }

  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));

  // node radius: scale with sqrt(doc_count)
  const maxDocs = Math.max(...nodes.map(n => n.doc_count));
  const radius = n => 8 + 20 * Math.sqrt(n.doc_count / maxDocs);

  // Draw edges as curved paths, coloured by dominant topic when in the topic filter.
  const maxWeight = Math.max(...edges.map(e => e.weight));
  edges.forEach(e => {
    const a = byId[e.source], b = byId[e.target];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const midx = (a.x + b.x) / 2, midy = (a.y + b.y) / 2;
    const off = Math.hypot(dx, dy) * 0.12;
    const cx1 = midx + (-dy / Math.hypot(dx, dy)) * off;
    const cy1 = midy + (dx / Math.hypot(dx, dy)) * off;

    // Choose an edge colour by top topic *that is in the filter*.
    const topTopic = (e.topics || []).find(t => state.topicFilter.has(t.topic));
    const stroke = topTopic ? TOPIC_COLORS[topTopic.topic] : "var(--frus-slate)";
    const width = 1 + 5 * (e.weight / maxWeight);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${a.x} ${a.y} Q ${cx1} ${cy1} ${b.x} ${b.y}`);
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", width);
    path.setAttribute("class", "edge");
    path.dataset.source = e.source;
    path.dataset.target = e.target;
    path.dataset.topics = (e.topics || []).map(t => t.topic).join("|");
    if (topTopic) path.dataset.topTopic = topTopic.topic;
    gEdges.appendChild(path);
  });

  nodes.forEach(n => {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", `node ${n.side === "US" ? "us" : "ussr"}`);
    g.setAttribute("transform", `translate(${n.x}, ${n.y})`);
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${n.name}, ${n.role}. ${n.doc_count} documents.`);
    g.dataset.id = n.id;

    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("r", radius(n));
    g.appendChild(c);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("y", radius(n) + 14);
    label.textContent = shortLabel(n.name);
    g.appendChild(label);

    const activate = () => {
      const s = state.selection;
      if (s && s.kind === "person" && s.id === n.id) clearSelection();
      else setSelection("person", n.id, n.name);
    };
    g.addEventListener("click", activate);
    g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });

    gNodes.appendChild(g);
  });

  highlightNetwork();
}

function shortLabel(name) {
  // "Ronald Reagan" -> "R. Reagan"; skip generational suffixes so
  // "Jack F. Matlock Jr." -> "J. Matlock", not "J. Jr.".
  const parts = (name || "").split(/\s+/);
  if (parts.length < 2) return name || "";
  const SUFFIXES = new Set(["Jr.", "Sr.", "II", "III", "IV"]);
  let last = parts.length - 1;
  while (last > 0 && SUFFIXES.has(parts[last])) last--;
  // Strip a single initial (e.g. "P.") if it appears right before the surname.
  const surname = parts[last];
  return `${parts[0][0]}. ${surname}`;
}

function highlightNetwork() {
  const svg = document.querySelector("#network-canvas svg");
  if (!svg) return;
  const sel = state.selection;

  svg.querySelectorAll(".node").forEach(n => {
    n.classList.remove("is-selected", "is-faded");
  });
  svg.querySelectorAll(".edge").forEach(e => {
    e.classList.remove("is-hi", "is-faded");
    const topics = (e.dataset.topics || "").split("|").filter(Boolean);
    const inFilter = topics.length === 0 || topics.some(t => state.topicFilter.has(t));
    if (!inFilter) e.classList.add("is-faded");
  });

  if (!sel) return;
  if (sel.kind === "person") {
    svg.querySelectorAll(".node").forEach(n => {
      if (n.dataset.id === sel.id) n.classList.add("is-selected");
      else n.classList.add("is-faded");
    });
    svg.querySelectorAll(".edge").forEach(e => {
      if (e.dataset.source === sel.id || e.dataset.target === sel.id) {
        e.classList.remove("is-faded");
        e.classList.add("is-hi");
      } else {
        e.classList.add("is-faded");
      }
    });
  } else if (sel.kind === "document") {
    const doc = state.docs.find(d => d.doc_id === sel.id);
    if (!doc) return;
    const ids = new Set(doc.persons.filter(p => p.in_network).map(p => p.id));
    svg.querySelectorAll(".node").forEach(n => {
      if (ids.has(n.dataset.id)) n.classList.add("is-selected");
      else n.classList.add("is-faded");
    });
    svg.querySelectorAll(".edge").forEach(e => {
      if (ids.has(e.dataset.source) && ids.has(e.dataset.target)) {
        e.classList.remove("is-faded");
        e.classList.add("is-hi");
      } else {
        e.classList.add("is-faded");
      }
    });
  } else if (sel.kind === "topic") {
    svg.querySelectorAll(".edge").forEach(e => {
      const topics = (e.dataset.topics || "").split("|");
      if (topics.includes(sel.id)) {
        e.classList.remove("is-faded");
        e.classList.add("is-hi");
      } else {
        e.classList.add("is-faded");
      }
    });
  }
}

function setupTopicFilter() {
  const el = document.getElementById("topic-filter");
  Object.entries(TOPIC_COLORS).forEach(([topic, color]) => {
    const id = `topic-${topic.replace(/\s+/g, "-").toLowerCase()}`;
    const label = document.createElement("label");
    label.className = "topic-toggle";
    label.innerHTML = `<input type="checkbox" id="${id}" checked><span class="topic-swatch" style="background:${color}"></span>${escape(topic)}`;
    el.appendChild(label);
    label.querySelector("input").addEventListener("change", (ev) => {
      if (ev.target.checked) state.topicFilter.add(topic);
      else state.topicFilter.delete(topic);
      renderNetwork();
    });
    // Also allow clicking the swatch to select this as a topic
    label.querySelector(".topic-swatch").addEventListener("click", (e) => {
      e.preventDefault();
      const s = state.selection;
      if (s && s.kind === "topic" && s.id === topic) clearSelection();
      else setSelection("topic", topic, topic);
    });
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
      } else if (ev.kind === "photo") {
        row.style.cursor = "zoom-in";
        b.innerHTML = `
          <div class="event__photo">
            <div class="event__photo-thumb"><img loading="lazy" src="${escape(ev.thumb)}" alt="${escape(ev.text)}" /></div>
            <div class="event__photo-caption">
              <span class="event__photo-plate">Plate ${ev.photo_seq} · ${escape(ev.photo_id)}</span>
              <span class="event__photo-text">${escape(ev.text)}</span>
              <span class="event__photo-credit">${escape(ev.credit || "")}</span>
            </div>
          </div>`;
        row.addEventListener("click", () => openLightbox(ev.photo_seq));
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
  const persons = uniq(state.docs.flatMap(d => d.persons.filter(p => p.in_network).map(p => JSON.stringify({ id: p.id, name: p.name })))).map(JSON.parse);

  fillSelect("explorer-source", sources.map(s => ({ value: s, label: s })));
  fillSelect("explorer-topic", topics.map(t => ({ value: t, label: t })));
  fillSelect("explorer-person", persons.map(p => ({ value: p.id, label: p.name })));

  renderExplorerRows();
}

function setupExplorerControls() {
  ["explorer-search", "explorer-source", "explorer-phase", "explorer-topic", "explorer-person"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderExplorerRows);
    document.getElementById(id).addEventListener("change", renderExplorerRows);
  });
  document.getElementById("explorer-clear").addEventListener("click", () => {
    ["explorer-search", "explorer-source", "explorer-phase", "explorer-topic", "explorer-person"].forEach(id => {
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
    if (f.person && !d.persons.some(p => p.id === f.person)) return false;
    if (f.q) {
      const blob = [
        d.title, d.excerpt, d.session, d.principals,
        d.persons.map(p => p.name).join(" "),
        d.topics.join(" "),
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
  const personTags = persons.map(p => `<span class="tag" style="border-color:${p.side === "US" ? "var(--frus-navy)" : "var(--frus-red)"};color:${p.side === "US" ? "var(--frus-navy)" : "var(--frus-red)"}">${escape(p.name)}</span>`).join(" ");
  const topicTags = (d.topics || []).map(t => `<span class="tag" style="border-color:${TOPIC_COLORS[t] || "var(--frus-slate)"};color:${TOPIC_COLORS[t] || "var(--frus-slate)"}">${escape(t)}</span>`).join(" ");

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

// ------------------------ photograph gallery ------------------------
function mergePhotosIntoTimeline(timeline, photos) {
  if (!photos || !photos.length) return timeline;
  const photoEvents = photos.map((p, i) => ({
    kind: "photo",
    date: p.date,
    date_display: dateDisplayFromISO(p.date),
    time_hint: p.time_hint || "",
    // Sort photos AFTER same-time chronology entries so the image follows the
    // narrative that describes it.
    sort_key: `${p.date}T${(p.time_hint || "99:99")}:9${String(i).padStart(2,"0")}`,
    text: p.caption,
    photo_id: p.id,
    photo_seq: p.seq,
    thumb: `assets/photos/reagan/thumbs/${p.filename}`,
    full: `assets/photos/reagan/${p.filename}`,
    credit: "White House Photographic Office · Ronald Reagan Presidential Library",
  }));
  const merged = timeline.concat(photoEvents);
  merged.sort((a, b) => (a.sort_key || `${a.date}T${a.time_hint||""}`).localeCompare(b.sort_key || `${b.date}T${b.time_hint||""}`));
  return merged;
}

function dateDisplayFromISO(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function renderGallery() {
  const el = document.getElementById("gallery-canvas");
  if (!el) return;
  el.innerHTML = "";
  const days = groupBy(state.photos, p => p.date);
  Object.keys(days).sort().forEach(date => {
    const section = document.createElement("section");
    section.className = "gallery__day";
    const h = document.createElement("h3");
    h.className = "gallery__date";
    h.textContent = dateDisplayFromISO(date) + ", 1986";
    section.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "gallery__grid";
    days[date].forEach(p => {
      const fig = document.createElement("figure");
      fig.className = "plate";
      fig.dataset.photoId = p.id;
      fig.tabIndex = 0;
      fig.setAttribute("role", "button");
      fig.setAttribute("aria-label", `Plate ${p.seq}: ${p.caption}`);
      fig.innerHTML = `
        <div class="plate__mount">
          <img class="plate__img" loading="lazy" src="assets/photos/reagan/thumbs/${escape(p.filename)}" alt="${escape(p.caption)}" />
        </div>
        <figcaption class="plate__caption">
          <span class="plate__number">Plate ${p.seq}</span>
          <span class="plate__time">${escape(p.time_hint || "")}</span>
          <span class="plate__text">${escape(p.caption)}</span>
          <span class="plate__id">${escape(p.id)}</span>
        </figcaption>
      `;
      fig.addEventListener("click", () => openLightbox(p.seq));
      fig.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(p.seq); }
      });
      grid.appendChild(fig);
    });
    section.appendChild(grid);
    el.appendChild(section);
  });
}

// ------------------------ lightbox ------------------------
let lightboxIndex = 0;
function setupLightbox() {
  const box = document.getElementById("lightbox");
  if (!box) return;
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-prev").addEventListener("click", () => stepLightbox(-1));
  document.getElementById("lightbox-next").addEventListener("click", () => stepLightbox(1));
  box.addEventListener("click", (e) => { if (e.target === box) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });
}
function openLightbox(seq) {
  const idx = state.photos.findIndex(p => p.seq === seq);
  if (idx < 0) return;
  lightboxIndex = idx;
  showLightboxPhoto();
  const box = document.getElementById("lightbox");
  box.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  const box = document.getElementById("lightbox");
  box.hidden = true;
  document.body.style.overflow = "";
}
function stepLightbox(delta) {
  if (!state.photos.length) return;
  lightboxIndex = (lightboxIndex + delta + state.photos.length) % state.photos.length;
  showLightboxPhoto();
}
function showLightboxPhoto() {
  const p = state.photos[lightboxIndex];
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-caption");
  img.src = `assets/photos/reagan/${p.filename}`;
  img.alt = p.caption;
  cap.innerHTML = `
    <span class="lightbox__plate">Plate ${p.seq} of ${state.photos.length}</span>
    <span class="lightbox__text">${escape(p.caption)}</span>
    <span class="lightbox__meta"><span>${escape(p.id)}</span> · <span>${escape(dateDisplayFromISO(p.date))}, 1986${p.time_hint ? " · " + escape(p.time_hint) : ""}</span> · <span>White House Photographic Office · Ronald Reagan Presidential Library</span></span>
  `;
}

document.addEventListener("DOMContentLoaded", boot);
