#!/usr/bin/env python3
"""
Enrich the core dataset with curated subject and event annotations from
the Office of the Historian's annotation program.

Two sibling repositories provide the annotation layers:

  frus-subjects       - the published FRUS subject taxonomy: per-document
                        curated subjects with stable refs, category paths,
                        and LCSH links (data/document_subjects.json,
                        data/taxonomy.json)
  hsg-annotate-data   - the annotated TEI corpus: entity annotations
                        (People, Places, Organizations, Events, Topics,
                        Programs, Compound Subjects) extracted per volume
                        (tei/annotations_<volume>.xml)

Outputs
-------
data/frus_core.json           - records gain `subjects[]`, `events[]`, and
                                `annotation_profile{}` (also mirrored to
                                docs/data/)
data/manifest.json            - annotation counts and provenance (mirrored)
data/raw/annotations_supplement.json
                              - compact cached extract so the pipeline
                                re-runs without the sibling repositories
data/corpus_candidates.json   - documents tagged with the "Reykjavik
                                Summit (1986)" event entity that are NOT
                                in the current corpus, for editorial
                                review of the corpus scope

Run after build_core.py (which rebuilds frus_core.json from the raw
feeds and therefore discards enrichment):

    python3 scripts/build_core.py
    python3 scripts/enrich_core.py
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from build_core import build_network
from parse_frus import CANONICAL_ID, NETWORK_PEOPLE

DATA = Path("data")
DOCS_DATA = Path("docs") / "data"
CACHE = DATA / "raw" / "annotations_supplement.json"

DEFAULT_HSG = Path("../hsg-project/repos/hsg-annotate-data")
DEFAULT_FRUS_SUBJECTS = Path("../frus-subjects")

# Volumes with annotation extracts relevant to the summit. v05 covers the
# summit itself, v06 the aftermath (People-only so far upstream), v11 the
# START I negotiation trail.
ANNOTATED_VOLUMES = ["frus1981-88v05", "frus1981-88v06", "frus1981-88v11"]

REYKJAVIK_EVENT = "Reykjavik Summit (1986)"

TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}


def doc_key(volume: str, doc: str) -> str:
    """Core-dataset primary key, e.g. frus1981-88v05-d306."""
    return f"{volume}-{doc}"


# ------------------------ person identity ------------------------
#
# Identity is resolved by normalized (surname, first-given-name) keys,
# NOT by the alignment files' ids: the alignment data has crossed ids
# (v05 assigns Nancy Reagan the same Airtable idno as Ronald Reagan)
# and inconsistent TEI id conventions across volumes (p_RRW_1 in v05,
# p_RWReagan_1 in v11). The entity_name in the annotation extracts is
# fetched directly from the registry and is the authority for a record
# id; the alignment files contribute occupation text and the volume
# TEI xml:id only when the name agrees.

SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _strip_nicknames(raw: str) -> str:
    name = re.sub(r"\s*\([^)]*\)", "", raw)          # parenthetical nicknames
    name = re.sub(r"\s*[\"“][^\"”]*[\"”]", "", name)  # quoted nicknames
    return re.sub(r"\s+", " ", name).strip()


def _is_suffix(part: str) -> bool:
    return part.rstrip(".").lower() in SUFFIXES


def display_name(raw: str) -> str:
    """'Carlucci, Frank C., III' -> 'Frank C. Carlucci III'."""
    name = _strip_nicknames(raw)
    if "," in name:
        parts = [p.strip() for p in name.split(",") if p.strip()]
        surname, rest = parts[0], parts[1:]
        given = [p for p in rest if not _is_suffix(p)]
        suffix = [p for p in rest if _is_suffix(p)]
        name = " ".join(given + [surname] + suffix)
    return re.sub(r"\s+", " ", name).strip()


def name_key(raw: str) -> tuple[str, str] | None:
    """Normalized (surname, first-given-name), or None if there is no
    usable given name to match on."""
    name = _strip_nicknames(raw)
    if "," in name:
        parts = [p.strip() for p in name.split(",") if p.strip()]
        surname = parts[0]
        given_parts = [p for p in parts[1:] if not _is_suffix(p)]
        given = given_parts[0].split()[0] if given_parts and given_parts[0].split() else ""
    else:
        tokens = [t for t in name.split() if not _is_suffix(t)]
        if len(tokens) < 2:
            return None
        surname, given = tokens[-1], tokens[0]
    if not surname or not given:
        return None
    return (surname.lower(), given.rstrip(".").lower())


def side_for(occupation: str) -> str:
    """US / USSR / other, inferred from the alignment file's occupation
    text. US postings *to* the Soviet Union are neutralized before the
    Soviet markers are tested (e.g. 'Ambassador to the Soviet Union')."""
    occ = occupation or ""
    neutral = re.sub(r"[^;,]*?(to|in|with) the Soviet Union", "", occ, flags=re.I)
    if re.search(r"Soviet|USSR|CPSU|KGB|Politburo|Red Army", neutral, re.I):
        return "USSR"
    if re.search(
        r"U\.S\.|United States|Department of State|Department of Defense|White House|"
        r"National Security|NSC|ACDA|USAF|USIA|Central Intelligence|Joint Chiefs|"
        r"Arms Control and Disarmament Agency|Senator|Congress|"
        r"Secretary of (State|Defense|Commerce|Energy|the Treasury)|"
        r"Under Secretary|Deputy Secretary|(Advisor|Adviser|Assistant) to the President|"
        r"Office of Management and Budget|\bUSA\b|\bUSN\b|\bUSMC\b",
        occ, re.I,
    ):
        return "US"
    return "other"


def _surname_of(raw: str) -> str:
    name = _strip_nicknames(raw)
    if "," in name:
        return name.split(",")[0].strip().lower()
    tokens = [t for t in name.split() if not _is_suffix(t)]
    return tokens[-1].lower() if tokens else ""


def _by_surname(entries: dict[tuple[str, str], dict[str, str]]) -> dict[str, dict[str, str]]:
    """Surname -> entry, only where the surname is unambiguous."""
    counts = Counter(surname for surname, _ in entries)
    return {
        surname: entry
        for (surname, _), entry in entries.items()
        if counts[surname] == 1
    }


class PersonResolver:
    """
    Resolves annotation People entities to final person entries.

    Three identity shapes occur in the extracts:
    - Airtable record ids with registry names ('Reagan, Ronald') — the
      normal case; matched to the roster/alignment by name key.
    - Legacy TEI xml:ids as record ids ('p_RRW_1', 69 entries in v05) —
      matched to the curated roster by TEI id directly.
    - Surface-form names without a given name ('Haig', 'Malone') —
      matched by surname when the surname is unambiguous.
    """

    def __init__(self, hsg: Path):
        self.alignment: dict[tuple[str, str], dict[str, str]] = {}
        for volume in ANNOTATED_VOLUMES:
            path = hsg / "import" / "people-id-alignment" / f"{volume}_people-airtable-id-alignment.xml"
            if not path.exists():
                continue
            # Earlier volumes win so v05/v06 TEI ids (the convention the
            # parsed volumes use) take precedence over v11's.
            for person in ET.parse(path).findall(".//person"):
                raw = person.findtext("persName") or ""
                key = name_key(raw)
                if key is None:
                    continue
                self.alignment.setdefault(
                    key,
                    {
                        "tei_id": person.get("{http://www.w3.org/XML/1998/namespace}id", ""),
                        "name": raw,
                        "occupation": re.sub(r"\s+", " ", person.findtext("occupation") or "").strip(),
                    },
                )

        self.roster: dict[tuple[str, str], dict[str, str]] = {}
        for tei_id, info in NETWORK_PEOPLE.items():
            key = name_key(info["name"])
            if key is not None:
                self.roster.setdefault(key, {**info, "id": CANONICAL_ID.get(tei_id, tei_id)})

        self.roster_surname = _by_surname(self.roster)
        self.alignment_surname = _by_surname(self.alignment)

    @staticmethod
    def _roster_entry(info: dict[str, str], record_id: str, tei_id: str) -> dict[str, Any]:
        return {
            "id": info["id"],
            "name": info["name"],
            "side": info["side"],
            "role": info["role"],
            "tier": "roster",
            "in_network": True,
            "airtable_id": record_id if record_id.startswith("rec") else "",
            "tei_id": tei_id,
        }

    def resolve(self, record_id: str, extract_name: str) -> dict[str, Any]:
        if record_id in NETWORK_PEOPLE:
            info = {**NETWORK_PEOPLE[record_id], "id": CANONICAL_ID.get(record_id, record_id)}
            return self._roster_entry(info, record_id, tei_id=record_id)

        key = name_key(extract_name)
        if key is not None:
            info = self.roster.get(key)
            aligned = self.alignment.get(key, {})
            # Transliteration tolerance ('Alexander' vs 'Aleksandr'): fall
            # back to an unambiguous surname when the given initials agree.
            surname, given = key
            if info is None:
                candidate = self.roster_surname.get(surname)
                if candidate and name_key(candidate["name"])[1][:1] == given[:1]:
                    info = candidate
            if not aligned:
                candidate = self.alignment_surname.get(surname)
                if candidate:
                    ckey = name_key(candidate["name"])
                    if ckey and ckey[1][:1] == given[:1]:
                        aligned = candidate
        else:
            surname = _surname_of(extract_name)
            info = self.roster_surname.get(surname)
            aligned = self.alignment_surname.get(surname, {})

        tei_id = aligned.get("tei_id") or (record_id if not record_id.startswith("rec") else "")
        if info:
            return self._roster_entry(info, record_id, tei_id)

        occupation = aligned.get("occupation", "")
        # For surname-only surface forms, the alignment's full name is
        # better than the surface form itself.
        name = display_name(extract_name if key is not None else (aligned.get("name") or extract_name))
        # The registry assigns separate People records per volume, so the
        # record id does NOT unify one person across volumes — a stable
        # name-derived id does.
        final_key = name_key(name)
        slug = ("-".join(final_key) if final_key else _surname_of(name)) or record_id
        return {
            "id": f"person.{slug}",
            "name": name,
            "side": side_for(occupation),
            "role": occupation[:160],
            "tier": "annotated",
            "in_network": True,
            "airtable_id": record_id if record_id.startswith("rec") else "",
            "tei_id": tei_id,
        }


# ------------------------ extraction from sibling repos ------------------------

def load_annotation_entries(hsg: Path, volume: str) -> list[dict[str, Any]]:
    """Flatten one annotations_<volume>.xml extract into entry dicts."""
    path = hsg / "tei" / f"annotations_{volume}.xml"
    if not path.exists():
        return []
    entries = []
    for e in ET.parse(path).findall(".//entry"):
        entries.append(
            {
                "id": e.findtext("recordID", ""),
                "table": e.findtext("table_name", ""),
                "name": e.findtext("entity_name", ""),
                "docs": sorted(
                    {
                        (d.findtext("doc_number") or "").split("#")[1]
                        for d in e.findall(".//document")
                        if "#" in (d.findtext("doc_number") or "")
                    }
                ),
            }
        )
    return entries


def load_document_subjects(frus_subjects: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    ds = json.loads((frus_subjects / "data" / "document_subjects.json").read_text())
    return ds["subjectsIndex"], ds["subjects"]


def tei_doc_summary(hsg: Path, volume: str, doc: str) -> dict[str, Any]:
    """Title, canonical URL, and document date from a per-document TEI file."""
    path = hsg / "data" / "documents" / volume / f"{doc}.xml"
    out: dict[str, Any] = {"title": "", "url": "", "date": ""}
    if not path.exists():
        return out
    root = ET.parse(path).getroot()
    title = root.find(".//tei:titleStmt/tei:title", TEI_NS)
    out["title"] = (title.text or "").strip() if title is not None else ""
    canonical = root.find(".//tei:relatedItem[@type='canonical']", TEI_NS)
    if canonical is not None:
        out["url"] = canonical.get("target", "")
    # Only trust dates in a dateline; editorial notes cite earlier
    # documents, so the first <date> anywhere can be years off.
    for date in root.findall(".//tei:dateline//tei:date", TEI_NS):
        when = date.get("when") or date.get("notBefore") or ""
        m = re.match(r"\d{4}-\d{2}-\d{2}", when)
        if m:
            out["date"] = m.group(0)
            break
    return out


def build_supplement(hsg: Path, frus_subjects: Path, corpus_keys: set[str]) -> dict[str, Any]:
    """
    Compact per-document extract of both annotation layers, plus the full
    document list for the Reykjavik Summit event entity (used for the
    corpus-candidates report).
    """
    subjects_index, subjects_map = load_document_subjects(frus_subjects)
    resolver = PersonResolver(hsg)

    per_doc: dict[str, dict[str, Any]] = {}

    def doc_record(key: str) -> dict[str, Any]:
        return per_doc.setdefault(
            key, {"subjects": [], "events": [], "people": [], "annotation_profile": {}}
        )

    # Curated subjects from frus-subjects (per volume, per doc).
    for ref, volumes in subjects_map.items():
        info = subjects_index.get(ref, {})
        for volume in ANNOTATED_VOLUMES:
            docs = volumes.get(volume)
            if not docs:
                continue
            for doc in (d.strip() for d in docs.split(",")):
                key = doc_key(volume, doc)
                if key not in corpus_keys:
                    continue
                doc_record(key)["subjects"].append(
                    {
                        "ref": ref,
                        "name": info.get("name", ""),
                        "category": info.get("category", ""),
                        "subcategory": info.get("subcategory", ""),
                    }
                )

    # Entity annotations from hsg-annotate-data.
    event_docs: dict[str, list[str]] = {}
    for volume in ANNOTATED_VOLUMES:
        for entry in load_annotation_entries(hsg, volume):
            if entry["table"] == "Events" and entry["name"] == REYKJAVIK_EVENT:
                event_docs[volume] = entry["docs"]
            for doc in entry["docs"]:
                key = doc_key(volume, doc)
                if key not in corpus_keys:
                    continue
                rec = doc_record(key)
                profile = rec["annotation_profile"]
                profile[entry["table"]] = profile.get(entry["table"], 0) + 1
                if entry["table"] == "Events":
                    rec["events"].append({"id": entry["id"], "name": entry["name"]})
                elif entry["table"] == "People":
                    rec["people"].append(resolver.resolve(entry["id"], entry["name"]))

    for rec in per_doc.values():
        rec["subjects"].sort(key=lambda s: (s["category"], s["name"]))
        rec["events"].sort(key=lambda e: e["name"])
        rec["people"].sort(key=lambda p: p["name"])

    # Candidate documents: tagged with the summit event but not in the corpus.
    candidates = []
    for volume, docs in sorted(event_docs.items()):
        for doc in docs:
            if doc_key(volume, doc) in corpus_keys:
                continue
            summary = tei_doc_summary(hsg, volume, doc)
            candidates.append(
                {
                    "volume": volume,
                    "doc": doc,
                    "doc_number": int(doc[1:]) if doc[1:].isdigit() else None,
                    "title": summary["title"],
                    "date": summary["date"],
                    "url": summary["url"] or f"https://history.state.gov/historicaldocuments/{volume}/{doc}",
                }
            )
    candidates.sort(key=lambda c: (c["date"] or "9999", c["volume"], c["doc_number"] or 0))

    return {
        "sources": {
            "frus-subjects": "data/document_subjects.json (FRUS subject taxonomy, Office of the Historian)",
            "hsg-annotate-data": f"tei/annotations_{{{','.join(ANNOTATED_VOLUMES)}}}.xml",
        },
        "per_doc": per_doc,
        "reykjavik_event": {
            "entity": REYKJAVIK_EVENT,
            "tagged_docs": event_docs,
            "candidates_not_in_corpus": candidates,
        },
    }


# ------------------------ participation register ------------------------

def month_range(first: str, last: str) -> list[str]:
    """Continuous calendar months from first to last, inclusive."""
    y, m = int(first[:4]), int(first[5:7])
    ly, lm = int(last[:4]), int(last[5:7])
    out = []
    while (y, m) <= (ly, lm):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def build_register(records: list[dict[str, Any]]) -> dict[str, Any]:
    """
    The Participation Register: per-person monthly presence across the
    dated FRUS record, plus editorial notes anchored to the register.
    Note texts embed counts computed from the data at build time so they
    cannot drift from the record they describe.
    """
    frus = [r for r in records if r.get("source_kind") != "declassified"]
    dated = [r for r in frus if r.get("date")]

    people: dict[str, dict[str, Any]] = {}
    for r in frus:
        month = (r.get("date") or "")[:7]
        for p in r["persons"]:
            if not p.get("in_network"):
                continue
            entry = people.setdefault(
                p["id"],
                {
                    "id": p["id"],
                    "name": p.get("name", p["id"]),
                    "side": p.get("side", ""),
                    "tier": p.get("tier", "roster"),
                    "role": p.get("role", ""),
                    "total": 0,
                    "counts": Counter(),
                    "topics": Counter(),
                },
            )
            entry["total"] += 1
            if month:
                entry["counts"][month] += 1
            for t in r.get("topics", []):
                entry["topics"][t] += 1

    all_months = sorted(m for p in people.values() for m in p["counts"])
    months = month_range(all_months[0], all_months[-1]) if all_months else []

    rows = []
    for p in sorted(people.values(), key=lambda p: (-p["total"], p["name"])):
        active = sorted(p["counts"])
        rows.append(
            {
                "id": p["id"],
                "name": p["name"],
                "side": p["side"],
                "tier": p["tier"],
                "role": p["role"],
                "total": p["total"],
                "first": active[0] if active else "",
                "last": active[-1] if active else "",
                "counts": dict(p["counts"]),
                "top_topics": [
                    {"topic": t, "count": c} for t, c in p["topics"].most_common(5)
                ],
            }
        )

    # Editorial notes: the register's finding-aid apparatus. Anchors are
    # validated against the data; counts are computed, not asserted.
    by_month = Counter((r["date"] or "")[:7] for r in dated)
    mobilization = by_month["1986-09"] + by_month["1986-10"]
    notes_spec = [
        {
            "title": "The mobilization",
            "months": ["1986-09", "1986-10"],
            "people": [],
            "text": (
                f"{mobilization} of the {len(dated)} dated documents fall in "
                "September and October 1986 — the Daniloff crisis, the decision "
                "to meet, and the two days at Höfði House."
            ),
        },
        {
            "title": "The Daniloff affair",
            "months": ["1986-08", "1986-10"],
            "people": ["person.daniloff-nicholas", "person.zakharov-gennady"],
            "text": (
                "Nicholas Daniloff and Gennady Zakharov appear almost solely in "
                "the crisis weeks: arrested within days of each other in "
                "August–September 1986 and released on the eve of the summit "
                "announcement."
            ),
        },
        {
            "title": "The NSC turnover",
            "months": ["1986-11", "1987-03"],
            "people": ["us.poindexter", "person.carlucci-frank", "person.powell-colin"],
            "text": (
                "Poindexter leaves the record after November 1986, resigning "
                "over Iran-Contra; Carlucci enters it in January 1987 and "
                "Powell in March 1987."
            ),
        },
        {
            "title": "The START trail",
            "months": ["1987-01", "1989-01"],
            "people": ["us.kampelman", "ussr.karpov"],
            "text": (
                "After Reykjavik the record passes to the negotiators: "
                "Kampelman and Karpov carry the Nuclear and Space Talks thread "
                "toward the treaty endgame while the principals' presence thins."
            ),
        },
    ]
    known = {r["id"] for r in rows}
    notes = []
    for i, n in enumerate(notes_spec, start=1):
        missing = [p for p in n["people"] if p not in known]
        if missing:
            print(f"register note '{n['title']}' skipped; unknown ids: {missing}", file=sys.stderr)
            continue
        notes.append({**n, "n": i})

    return {
        "months": months,
        "summit_month": "1986-10",
        "people": rows,
        "notes": notes,
    }


# ------------------------ apply to the core dataset ------------------------

def merge_persons(existing: list[dict[str, Any]], annotated: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Merge annotated People into the TEI-derived persons list. Annotated
    entries are authoritative for name/side/role and REPLACE a matching
    TEI entry (matched by resolved id, then by the TEI xml:id from the
    alignment file) — otherwise the same human would appear under a TEI
    id in documents parsed from the volume XML and under the resolved id
    everywhere else, splitting their network node. The TEI entry's
    surface form is preserved for auditability. Every emitted annotated
    entry is flagged `from_annotation` so enrichment is idempotent:
    re-runs strip and rebuild them rather than compounding.
    """
    merged: dict[str, dict[str, Any]] = {}
    by_tei: dict[str, dict[str, Any]] = {}
    for p in existing:
        p = dict(p)
        merged[p["id"]] = p
        if p.get("tei_id"):
            by_tei[p["tei_id"]] = p

    for person in annotated:
        entry = {**person, "from_annotation": True}
        old = merged.get(entry["id"]) or by_tei.get(entry.get("tei_id") or "\x00")
        if old is not None and old.get("from_annotation"):
            # Two annotated entities can claim the same TEI id when the
            # alignment file has crossed ids (e.g. Shcharanskiy/Sakharov
            # both -> p_SA_1 in v05). Only pristine TEI entries may be
            # absorbed; annotated entries coexist under their own ids.
            if old["id"] == entry["id"]:
                continue
            old = None
        if old is not None:
            # Keep the replaced TEI entry verbatim so a re-run can
            # reconstruct the pristine persons list (idempotency).
            entry["tei_source"] = old
            if old.get("surface"):
                entry["surface"] = old["surface"]
            if not entry.get("tei_id") and old.get("tei_id"):
                entry["tei_id"] = old["tei_id"]
            merged.pop(old["id"], None)
        merged[entry["id"]] = entry
        if entry.get("tei_id"):
            by_tei[entry["tei_id"]] = entry

    return list(merged.values())


def enrich_records(records: list[dict[str, Any]], per_doc: dict[str, dict[str, Any]]) -> None:
    for r in records:
        extra = per_doc.get(r["doc_id"], {})
        r["subjects"] = extra.get("subjects", [])
        r["events"] = extra.get("events", [])
        r["annotation_profile"] = extra.get("annotation_profile", {})
        annotated_people = extra.get("people", [])
        base = []
        for p in r.get("persons", []):
            if p.get("from_annotation"):
                if p.get("tei_source"):
                    base.append(p["tei_source"])
            else:
                base.append(p)
        if annotated_people:
            r["persons"] = merge_persons(base, annotated_people)
        else:
            r["persons"] = base


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--hsg", type=Path, default=DEFAULT_HSG,
                    help="path to the hsg-annotate-data repository")
    ap.add_argument("--frus-subjects", type=Path, default=DEFAULT_FRUS_SUBJECTS,
                    help="path to the frus-subjects repository")
    args = ap.parse_args()

    core_path = DATA / "frus_core.json"
    records = json.loads(core_path.read_text())
    # Every FRUS-derived record (memcons AND editorial notes) is
    # annotatable; only FOIA releases fall outside the annotated corpus.
    corpus_keys = {r["doc_id"] for r in records if re.match(r"^frus.+-d\d+$", r["doc_id"])}

    have_sources = (args.hsg / "tei").is_dir() and (args.frus_subjects / "data").is_dir()
    if have_sources:
        supplement = build_supplement(args.hsg, args.frus_subjects, corpus_keys)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(supplement, indent=2, ensure_ascii=False))
    elif CACHE.exists():
        print(f"annotation source repositories not found; using cache {CACHE}", file=sys.stderr)
        supplement = json.loads(CACHE.read_text())
    else:
        print(
            "error: annotation sources not found and no cache present.\n"
            f"  expected {args.hsg} and {args.frus_subjects}, or {CACHE}",
            file=sys.stderr,
        )
        return 1

    enrich_records(records, supplement["per_doc"])
    core_path.write_text(json.dumps(records, indent=2, ensure_ascii=False))

    # The annotated People change the participant web, so the network is
    # rebuilt here from the enriched records (build_core's network.json
    # only knows the TEI-derived roster).
    network = build_network(records)
    (DATA / "network.json").write_text(
        json.dumps(network, separators=(",", ":"), ensure_ascii=False)
    )

    register = build_register(records)
    (DATA / "register.json").write_text(
        json.dumps(register, separators=(",", ":"), ensure_ascii=False)
    )

    candidates = supplement["reykjavik_event"]["candidates_not_in_corpus"]
    (DATA / "corpus_candidates.json").write_text(
        json.dumps(supplement["reykjavik_event"], indent=2, ensure_ascii=False)
    )

    # Update the manifest with annotation provenance and counts.
    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    unique_subjects = {s["ref"] for r in records for s in r["subjects"]}
    unique_events = {e["id"] for r in records for e in r["events"]}
    manifest["counts"]["curated_subjects"] = len(unique_subjects)
    manifest["counts"]["event_entities"] = len(unique_events)
    manifest["counts"]["corpus_candidates"] = len(candidates)
    manifest["counts"]["network_nodes"] = len(network["nodes"])
    manifest["counts"]["network_edges"] = len(network["edges"])
    manifest["counts"]["participants"] = len(register["people"])
    manifest["counts"]["register_notes"] = len(register["notes"])
    manifest["enriched"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    manifest["sources"]["FRUS subject taxonomy"] = "https://github.com/HistoryAtState/frus-subjects"
    manifest["sources"]["HSG annotated TEI"] = "https://history.state.gov (Office of the Historian annotation program)"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    # Mirror the site's data artifacts (timeline comes from build_core
    # unchanged but is mirrored here so docs/data/ is always consistent).
    (DOCS_DATA / "frus_core.json").write_text(core_path.read_text())
    (DOCS_DATA / "manifest.json").write_text(manifest_path.read_text())
    (DOCS_DATA / "network.json").write_text((DATA / "network.json").read_text())
    (DOCS_DATA / "register.json").write_text((DATA / "register.json").read_text())
    (DOCS_DATA / "timeline.json").write_text((DATA / "timeline.json").read_text())

    enriched = sum(1 for r in records if r["subjects"] or r["events"])
    print(
        json.dumps(
            {
                "documents_enriched": enriched,
                "curated_subjects": len(unique_subjects),
                "event_entities": len(unique_events),
                "network_nodes": len(network["nodes"]),
                "network_edges": len(network["edges"]),
                "register_participants": len(register["people"]),
                "register_notes": len(register["notes"]),
                "corpus_candidates": len(candidates),
                "candidates_by_volume": dict(
                    Counter(c["volume"] for c in candidates)
                ),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
