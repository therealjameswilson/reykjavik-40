#!/usr/bin/env python3
"""
Merge FRUS and FOIA feeds into the unified reykjavik-40 core dataset.

Outputs
-------
data/frus_core.json   - all records, canonical primary key
data/frus_core.csv    - flat CSV mirror for spreadsheet users
data/network.json     - nodes and edges for the negotiation network view
data/timeline.json    - hour-by-hour timeline events for Oct 9-13
data/manifest.json    - counts and provenance summary for the UI header

Every record is traceable to a canonical source URL. Records whose
document numbers cannot be verified against history.state.gov are
emitted with `verified: false`; the UI is expected to flag them.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA = Path("data")


def load(p: Path) -> list[dict[str, Any]]:
    return json.loads(p.read_text()) if p.exists() else []


def normalize_record(r: dict[str, Any]) -> dict[str, Any]:
    """Ensure every record has all schema fields."""
    return {
        "doc_id": r.get("doc_id", ""),
        "doc_number": r.get("doc_number"),
        "source": r.get("source", ""),
        "source_kind": r.get("source_kind", ""),
        "title": r.get("title", ""),
        "date": r.get("date", ""),
        "date_display": r.get("date_display", ""),
        "place": r.get("place", ""),
        "url": r.get("url", ""),
        "summit_phase": r.get("summit_phase", ""),
        "session": r.get("session", ""),
        "principals": r.get("principals", ""),
        "venue": r.get("venue", ""),
        "persons": r.get("persons", []),
        "topics": r.get("topics", []),
        "verified": r.get("verified", True),
        "excerpt": r.get("excerpt", ""),
        # FOIA-specific
        "case_number": r.get("case_number", ""),
        "case_subject": r.get("case_subject", ""),
        "from": r.get("from", ""),
        "to": r.get("to", ""),
        "message_number": r.get("message_number", ""),
        "doctype": r.get("doctype", ""),
        "classification": r.get("classification", ""),
        "release_decision": r.get("release_decision", ""),
        "posted_date": r.get("posted_date", ""),
    }


def build_network(records: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Nodes: persons flagged in_network across all records.
    Edges: co-occurrence in the same document, weighted by (a) whether
    the document is a memcon (edge weight *3) and (b) session (memcons
    of the summit sessions weight *5). Edges also carry the set of
    topics that co-occur in that document, used for topic strand
    coloring in the graph.
    """
    node_map: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str], dict[str, Any]] = {}

    for r in records:
        network_people = [p for p in r["persons"] if p.get("in_network")]
        for p in network_people:
            pid = p["id"]
            if pid not in node_map:
                node_map[pid] = {
                    "id": pid,
                    "name": p.get("name", pid),
                    "side": p.get("side", ""),
                    "role": p.get("role", ""),
                    "tier": p.get("tier", "roster"),
                    "doc_count": 0,
                    "sessions": set(),
                    "topics": Counter(),
                }
            node_map[pid]["doc_count"] += 1
            if r["session"]:
                node_map[pid]["sessions"].add(r["session"])
            for t in r["topics"]:
                node_map[pid]["topics"][t] += 1

        ids = sorted({p["id"] for p in network_people})
        base = 1
        if "Memorandum of Conversation" in r["title"] and r["source_kind"] == "historical-document":
            base = 3
        if r["session"] and r["summit_phase"] == "summit":
            base = 5

        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = (ids[i], ids[j])
                if key not in edges:
                    edges[key] = {
                        "source": ids[i],
                        "target": ids[j],
                        "weight": 0,
                        "doc_ids": [],
                        "topics": Counter(),
                        "sessions": set(),
                    }
                e = edges[key]
                e["weight"] += base
                e["doc_ids"].append(r["doc_id"])
                for t in r["topics"]:
                    e["topics"][t] += 1
                if r["session"]:
                    e["sessions"].add(r["session"])

    # Serialise
    nodes = []
    for n in node_map.values():
        nodes.append(
            {
                "id": n["id"],
                "name": n["name"],
                "side": n["side"],
                "role": n["role"],
                "tier": n["tier"],
                "doc_count": n["doc_count"],
                "sessions": sorted(n["sessions"]),
                "topics": [{"topic": t, "count": c} for t, c in n["topics"].most_common()],
            }
        )
    edge_list = []
    for e in edges.values():
        edge_list.append(
            {
                "source": e["source"],
                "target": e["target"],
                "weight": e["weight"],
                "doc_count": len(e["doc_ids"]),
                # doc_ids omitted: with the full participant web the edge set
                # runs to thousands and the id lists dominate the payload.
                "topics": [{"topic": t, "count": c} for t, c in e["topics"].most_common(5)],
                "sessions": sorted(e["sessions"]),
            }
        )
    return {"nodes": nodes, "edges": edge_list}


def build_timeline(records: list[dict[str, Any]], v06_chronology: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    The timeline is anchored to the Iceland Chronology (FRUS Vol VI
    Doc 1). Each chronology paragraph becomes a timed event; we then
    fold in the FRUS memcons and editorial notes for Oct 9-13 as
    linked event markers, and append aftermath cables from Vol VI /
    FOIA as follow-on events with looser timing.
    """
    events: list[dict[str, Any]] = []

    # Chronology events: parse a leading time-of-day expression from
    # the paragraph text (e.g. "At 9:45 am", "shortly after 8 pm").
    time_re = re.compile(
        r"\b(?:at\s+)?(?:about\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b",
        re.I,
    )
    for i, e in enumerate(v06_chronology):
        m = time_re.search(e["text"])
        time_hint = ""
        sort_key = f"{e['date']}T00:00:{i:04d}"
        if m:
            hour = int(m.group(1))
            minute = int(m.group(2) or "0")
            mer = m.group(3).lower().replace(".", "")
            if mer == "pm" and hour != 12:
                hour += 12
            if mer == "am" and hour == 12:
                hour = 0
            time_hint = f"{hour:02d}:{minute:02d}"
            sort_key = f"{e['date']}T{hour:02d}:{minute:02d}:{i:04d}"
        events.append(
            {
                "kind": "chronology",
                "date": e["date"],
                "date_display": e["date_display"],
                "time_hint": time_hint,
                "sort_key": sort_key,
                "text": e["text"],
                "url": e["url"],
                "source": e["source"],
                "doc_id": "frus1981-88v06-d1",
            }
        )

    # Fold in memcons and editorial notes dated Oct 9-13 as marker
    # events; they cluster the graph and give the user a way to jump
    # from the timeline into the document explorer.
    for r in records:
        if not r["date"]:
            continue
        if "1986-10-09" <= r["date"] <= "1986-10-13":
            events.append(
                {
                    "kind": "document",
                    "date": r["date"],
                    "date_display": r["date_display"] or r["date"],
                    "time_hint": "",
                    "sort_key": f"{r['date']}T00:00:{r['doc_id']}",
                    "text": r["title"],
                    "session": r["session"],
                    "principals": r["principals"],
                    "url": r["url"],
                    "source": r["source"],
                    "doc_id": r["doc_id"],
                    "topics": r["topics"],
                    "excerpt": r["excerpt"],
                }
            )

    events.sort(key=lambda e: e["sort_key"])
    return events


# Undated FOIA release documents are grouped under one band that sorts
# after the dated summit days rather than being scattered onto invented
# dates. The sentinel is a valid ISO date so date-keyed UI code (which
# sorts the grouped days lexically) keeps working.
FOIA_UNDATED_KEY = "9999-12-31"


def build_foia_supplement(foia_pdfs: dict[str, Any]) -> list[dict[str, Any]]:
    """Timeline entries derived from a declassified FOIA PDF release.

    These *supplement* the FRUS record — they are typed `foia` so the
    front end can label and style them distinctly and never displace a
    FRUS document. Each entry carries a locally-served copy and its
    foia.state.gov source. The manifest exposes no per-document authored
    date (only a 2024 posting date), so any document that does expose an
    ISO `date` is placed on that day; the rest are grouped under a single
    labeled band anchored after the summit — no dates are invented.
    """
    payload = foia_pdfs or {}
    case = payload.get("case_number", "")
    source = payload.get("source", "foia.state.gov")
    source_kind = payload.get("source_kind", "declassified")
    events: list[dict[str, Any]] = []
    for d in payload.get("documents", []):
        date = (d.get("date") or "").strip()
        dated = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", date))
        key = date if dated else FOIA_UNDATED_KEY
        idx = d.get("doc_index") or 0
        detail = " · ".join(
            part for part in (
                d.get("doctype", ""),
                f"{d.get('page_count')} p." if d.get("page_count") else "",
            ) if part
        )
        # Dated documents carry a curated, human date (with an est./uncertain
        # marker where the day is inferred rather than stamped); the rest keep
        # the labeled undated-band caption.
        display = (d.get("date_display") or date) if dated else (
            f"Declassified FOIA release · {case}"
        )
        events.append(
            {
                "kind": "foia",
                "date": key,
                "date_display": display,
                "time_hint": "",
                "sort_key": f"{key}T00:00:foia-{idx:04d}",
                "text": d.get("filename") or d.get("doc_id", ""),
                "detail": detail,
                "description": d.get("description", "") or d.get("summary", ""),
                "date_confidence": d.get("date_confidence", ""),
                "url": d.get("source_url", ""),
                "local_url": d.get("local_url", ""),
                "source": source,
                "source_kind": source_kind,
                "case_number": case,
                "classification": d.get("classification", ""),
                "doc_id": d.get("doc_id", ""),
                "dated": dated,
            }
        )
    return events


def build_photo_supplement(reagan_photos: dict[str, Any]) -> list[dict[str, Any]]:
    """Timeline entries derived from White House Photo Office plates.

    Each plate carries an ISO `date` (11 or 12 October 1986) and a
    `time_hint` marking its place in the summit day, so the photo sorts
    next to the chronology entry it depicts rather than forming a
    disconnected gallery. Photos are typed `photo` so the front end can
    render them as image cards, distinct from FRUS documents and FOIA
    PDFs, and never displace either. Credit and source link travel with
    every entry.
    """
    payload = reagan_photos or {}
    credit = payload.get("credit") or payload.get("collection", "")
    source = payload.get("source", "")
    events: list[dict[str, Any]] = []
    for p in payload.get("photos", []):
        date = (p.get("date") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        hint = (p.get("time_hint") or "").strip()
        m = re.fullmatch(r"(\d{2}):(\d{2})", hint)
        tod = f"{m.group(1)}:{m.group(2)}" if m else "23:59"
        seq = p.get("seq") or 0
        events.append(
            {
                "kind": "photo",
                "date": date,
                "date_display": p.get("date_display") or date,
                "time_hint": hint,
                "sort_key": f"{date}T{tod}:photo-{seq:04d}",
                "text": p.get("caption", ""),
                "caption": p.get("caption", ""),
                "credit": credit,
                "photo_id": p.get("id", ""),
                "local_url": p.get("local_url", ""),
                "thumb_url": p.get("thumb_url", "") or p.get("local_url", ""),
                "url": p.get("source_url", ""),
                "source": source,
                "source_kind": "photograph",
            }
        )
    return events


# Restrict FRUS documents to the two summit days themselves.
# FOIA records are NOT filtered here — the user will filter FOIA manually.
# Set to None (or an empty set) to disable the filter.
# Disabled 2026-07-08: the edition now ships the full source material —
# the whole Reykjavik section of Vol. V, the Vol. VI aftermath window,
# and the Reykjavik-tagged Vol. XI START I trail.
FRUS_DATE_ALLOWLIST: set[str] | None = None


def _filter_frus(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not FRUS_DATE_ALLOWLIST:
        return records
    return [r for r in records if r.get("date") in FRUS_DATE_ALLOWLIST]


def main() -> int:
    v05 = [normalize_record(r) for r in load(DATA / "frus_v05_reykjavik.json")]
    v06 = [normalize_record(r) for r in load(DATA / "frus_v06_aftermath.json")]
    hsg = [normalize_record(r) for r in load(DATA / "frus_hsg_supplement.json")]
    foia = [normalize_record(r) for r in load(DATA / "foia_reykjavik.json")]
    chronology = load(DATA / "v06_chronology.json")

    v05 = _filter_frus(v05)
    v06 = _filter_frus(v06)
    hsg = _filter_frus(hsg)

    all_records = v05 + v06 + hsg + foia
    all_records.sort(key=lambda r: (r["date"] or "9999", r["source"], r["doc_id"]))

    (DATA / "frus_core.json").write_text(json.dumps(all_records, indent=2, ensure_ascii=False))

    # CSV mirror (flattened persons and topics).
    csv_fields = [
        "doc_id",
        "doc_number",
        "source",
        "source_kind",
        "title",
        "date",
        "date_display",
        "place",
        "summit_phase",
        "session",
        "principals",
        "venue",
        "persons",
        "topics",
        "verified",
        "url",
        "case_number",
        "doctype",
        "classification",
    ]
    with (DATA / "frus_core.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=csv_fields, extrasaction="ignore")
        w.writeheader()
        for r in all_records:
            row = dict(r)
            row["persons"] = "; ".join(p.get("name", p.get("id", "")) for p in r["persons"])
            row["topics"] = "; ".join(r["topics"])
            w.writerow(row)

    network = build_network(all_records)
    (DATA / "network.json").write_text(
        json.dumps(network, separators=(",", ":"), ensure_ascii=False)
    )

    timeline = build_timeline(all_records, chronology)
    # Fold the declassified FOIA PDF release in as supplemental, typed
    # entries. Derived from data/foia_pdfs.json so the standalone build
    # (which embeds timeline.json) and the served site stay in sync.
    foia_pdfs = json.loads((DATA / "foia_pdfs.json").read_text()) if (DATA / "foia_pdfs.json").exists() else {}
    foia_events = build_foia_supplement(foia_pdfs)
    timeline += foia_events
    # Fold in White House Photo Office plates, anchored to their summit
    # date/time so they sit alongside the chronology entries they depict.
    reagan_photos = json.loads((DATA / "reagan_photos.json").read_text()) if (DATA / "reagan_photos.json").exists() else {}
    photo_events = build_photo_supplement(reagan_photos)
    timeline += photo_events
    timeline.sort(key=lambda e: e["sort_key"])
    (DATA / "timeline.json").write_text(json.dumps(timeline, indent=2, ensure_ascii=False))
    foia_undated = sum(1 for e in foia_events if not e["dated"])

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {
            "frus_v05_reykjavik": len(v05),
            "frus_v06_aftermath": len(v06),
            "frus_hsg_supplement": len(hsg),
            "foia_declassified": len(foia),
            "total_documents": len(all_records),
            "network_nodes": len(network["nodes"]),
            "network_edges": len(network["edges"]),
            "timeline_events": len(timeline),
            "foia_timeline_entries": len(foia_events),
            "foia_timeline_undated": foia_undated,
            "reagan_photo_entries": len(photo_events),
        },
        "by_phase": dict(Counter(r["summit_phase"] for r in all_records)),
        "by_source": dict(Counter(r["source"] for r in all_records)),
        "by_topic": dict(Counter(t for r in all_records for t in r["topics"])),
        "unverified": [r["doc_id"] for r in all_records if not r["verified"]],
        "sources": {
            "FRUS 1981-1988 v05": "https://history.state.gov/historicaldocuments/frus1981-88v05",
            "FRUS 1981-1988 v06": "https://history.state.gov/historicaldocuments/frus1981-88v06",
            "FRUS 1981-1988 v11": "https://history.state.gov/historicaldocuments/frus1981-88v11",
            "foia.state.gov": "https://foia.state.gov/",
            "TEI source": "https://github.com/HistoryAtState/frus",
        },
    }
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    print(json.dumps(manifest["counts"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
