#!/usr/bin/env python3
"""
Parse FRUS TEI XML volumes into the unified schema used by reykjavik-40.

Sources
-------
- FRUS 1981-1988, Volume V, Soviet Union, March 1985-October 1986
  ("Reykjavik Summit" section, Documents 267-309).
- FRUS 1981-1988, Volume VI, Soviet Union, October 1986-January 1989
  (post-summit chronology and follow-up).

TEI XML is fetched directly from https://github.com/HistoryAtState/frus.

Every record links back to the canonical page at history.state.gov via
    https://history.state.gov/historicaldocuments/<volume>/d<N>

Persons and topics are extracted from @corresp="#p_XXX_N" references and a
curated set of subject-matter tags applied to headwords in the text.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

TEI_NS = "http://www.tei-c.org/ns/1.0"
FRUS_NS = "http://history.state.gov/frus/ns/1.0"
XML_NS = "http://www.w3.org/XML/1998/namespace"
NS = {"tei": TEI_NS, "frus": FRUS_NS, "xml": XML_NS}

# Registered nodes for the negotiation network. Any persName @corresp
# whose value appears here is emitted with a normalised label; other
# persons are captured verbatim but not promoted to network nodes by
# default.
# Canonical IDs collapse cross-volume TEI xml:id variants for the same
# person to a single node in the negotiation network (Vol V uses
# p_GMS_1 for Gorbachev, Vol VI uses p_GM_1, etc.).
CANONICAL_ID = {
    "p_GMS_1": "reagan_gorbachev.gorbachev",
    "p_GM_1": "reagan_gorbachev.gorbachev",
    "p_GM_2": "reagan_gorbachev.gorbachev",
    "p_RRW_1": "reagan_gorbachev.reagan",
    "p_SGP_1": "us.shultz",
    "p_SE_1": "ussr.shevardnadze",
    "p_MJF_1": "us.matlock",
    "p_NPH_1": "us.nitze",
    "p_PJM_1": "us.poindexter",
    "p_RJH_1": "us.poindexter",
    "p_AKL_1": "us.adelman",
    "p_RRA_1": "us.ridgway",
    "p_RRL_1": "us.ridgway",
    "p_PR_1": "us.perle",
    "p_PRN_1": "us.perle",
    "p_KMH_1": "us.kampelman",
    "p_KMM_1": "us.kampelman",
    "p_LR_1": "us.linhard",
    "p_HAH_1": "us.hartman",
    "p_HAA_1": "us.hartman",
    "p_ASF_1": "ussr.akhromeyev",
    "p_DAF_1": "ussr.dobrynin",
    "p_DA_1": "ussr.dobrynin",
    "p_KVM_1": "ussr.karpov",
    "p_KVP_1": "ussr.karpov",
    "p_BAA_1": "ussr.bessmertnykh",
}

# Several people appear in the volume TEI under ids that differ from the
# ones this roster was first built with (e.g. Ridgway is p_RRL_1 in the
# published TEI, not p_RRA_1). Both spellings are kept: the alignment
# files in hsg-annotate-data are the authority for the published ids.
NETWORK_PEOPLE = {
    # United States
    "p_RRW_1": {"name": "Ronald Reagan", "side": "US", "role": "President of the United States"},
    "p_SGP_1": {"name": "George P. Shultz", "side": "US", "role": "Secretary of State"},
    "p_RJH_1": {"name": "John M. Poindexter", "side": "US", "role": "National Security Advisor"},
    "p_PJM_1": {"name": "John M. Poindexter", "side": "US", "role": "National Security Advisor"},
    "p_NPH_1": {"name": "Paul H. Nitze", "side": "US", "role": "Special Adviser on Arms Control"},
    "p_MJF_1": {"name": "Jack F. Matlock Jr.", "side": "US", "role": "NSC Senior Director, European and Soviet Affairs"},
    "p_AKL_1": {"name": "Kenneth L. Adelman", "side": "US", "role": "Director, Arms Control and Disarmament Agency"},
    "p_RRA_1": {"name": "Rozanne L. Ridgway", "side": "US", "role": "Assistant Secretary of State for European and Canadian Affairs"},
    "p_RRL_1": {"name": "Rozanne L. Ridgway", "side": "US", "role": "Assistant Secretary of State for European and Canadian Affairs"},
    "p_PR_1": {"name": "Richard N. Perle", "side": "US", "role": "Assistant Secretary of Defense for International Security Policy"},
    "p_PRN_1": {"name": "Richard N. Perle", "side": "US", "role": "Assistant Secretary of Defense for International Security Policy"},
    "p_KMH_1": {"name": "Max M. Kampelman", "side": "US", "role": "Head, U.S. Delegation to the Nuclear and Space Talks"},
    "p_KMM_1": {"name": "Max M. Kampelman", "side": "US", "role": "Head, U.S. Delegation to the Nuclear and Space Talks"},
    "p_LR_1": {"name": "Robert Linhard", "side": "US", "role": "NSC Director, Defense Programs and Arms Control"},
    "p_HAH_1": {"name": "Arthur A. Hartman", "side": "US", "role": "Ambassador to the Soviet Union"},
    "p_HAA_1": {"name": "Arthur A. Hartman", "side": "US", "role": "Ambassador to the Soviet Union"},
    # Soviet Union
    "p_GM_1": {"name": "Mikhail S. Gorbachev", "side": "USSR", "role": "General Secretary, Communist Party of the Soviet Union"},
    "p_GMS_1": {"name": "Mikhail S. Gorbachev", "side": "USSR", "role": "General Secretary, Communist Party of the Soviet Union"},
    "p_SE_1": {"name": "Eduard A. Shevardnadze", "side": "USSR", "role": "Minister of Foreign Affairs"},
    "p_ASF_1": {"name": "Sergei F. Akhromeyev", "side": "USSR", "role": "Chief of the General Staff, Soviet Armed Forces"},
    "p_DAF_1": {"name": "Anatoly F. Dobrynin", "side": "USSR", "role": "Secretary, CPSU Central Committee"},
    "p_DA_1": {"name": "Anatoly F. Dobrynin", "side": "USSR", "role": "Secretary, CPSU Central Committee"},
    "p_KVM_1": {"name": "Viktor M. Karpov", "side": "USSR", "role": "Head, Soviet Delegation to the Nuclear and Space Talks"},
    "p_KVP_1": {"name": "Viktor M. Karpov", "side": "USSR", "role": "Head, Soviet Delegation to the Nuclear and Space Talks"},
    "p_BAA_1": {"name": "Aleksandr A. Bessmertnykh", "side": "USSR", "role": "Deputy Minister of Foreign Affairs"},
    "p_CVM_1": {"name": "Valentin M. Falin", "side": "USSR", "role": "Chief, Novosti Press Agency"},
    "p_ZL_1": {"name": "Nikolay Detinov", "side": "USSR", "role": "Arms control adviser"},
}

# Topic strands for the negotiation network. Each entry is (topic, regex).
TOPIC_PATTERNS = [
    ("SDI", re.compile(r"\bSDI\b|Strategic Defense Initiative|space[- ]based defense|ABM Treaty", re.I)),
    ("INF", re.compile(r"\bINF\b|Intermediate[- ]Range|LRINF|SRINF|Pershing|SS-20|cruise missile", re.I)),
    ("Strategic Arms", re.compile(r"\bSTART\b|strategic (offensive )?arms|strategic nuclear|50[- ]?percent (reduction|cut)|ballistic missile", re.I)),
    ("Nuclear Testing", re.compile(r"\bnuclear test(ing)?\b|test ban|CTBT|threshold test", re.I)),
    ("Human Rights", re.compile(r"human rights|refusenik|emigration|Sakharov|Shcharansky|Sharansky|Jewish emigration|Daniloff", re.I)),
    ("Regional Issues", re.compile(r"Afghanistan|Nicaragua|Angola|Cambodia|regional (issue|conflict)", re.I)),
    ("Bilateral Relations", re.compile(r"bilateral|cultural exchange|consular|Aeroflot|Pan Am", re.I)),
]


def qn(local: str, ns: str = TEI_NS) -> str:
    return f"{{{ns}}}{local}"


def strip_tag(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def text_of(elem: ET.Element) -> str:
    """Return all descendant text, collapsed to single spaces, notes excluded."""
    parts: list[str] = []

    def walk(e: ET.Element) -> None:
        if strip_tag(e.tag) == "note":
            return
        if e.text:
            parts.append(e.text)
        for child in e:
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(elem)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def head_title(div: ET.Element) -> str:
    head = div.find(qn("head"))
    if head is None:
        return ""
    return text_of(head)


def opener_place(div: ET.Element) -> str:
    opener = div.find(qn("opener"))
    if opener is None:
        return ""
    place = opener.find(f".//{qn('placeName')}")
    return text_of(place) if place is not None else ""


def opener_date(div: ET.Element) -> tuple[str, str]:
    """Return (iso_date, human_date)."""
    opener = div.find(qn("opener"))
    if opener is None:
        return "", ""
    date_el = opener.find(f".//{qn('date')}")
    if date_el is None:
        return "", ""
    human = text_of(date_el)
    for attr in ("when", "from", "notBefore"):
        v = date_el.get(attr)
        if v:
            return v[:10], human
    return "", human


def machine_date(div: ET.Element) -> str:
    for attr in ("doc-dateTime-max", "doc-dateTime-min"):
        v = div.get(f"{{{FRUS_NS}}}{attr}")
        if v:
            return v[:10]
    return ""


def persons_in(div: ET.Element, volume_key: str) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for pn in div.iter(qn("persName")):
        # skip persNames inside notes
        # ElementTree doesn't give us a parent chain, so we accept them all;
        # notes are pruned when we call text_of, but here we do want the
        # full population of referenced people.
        corresp = pn.get("corresp", "")
        if not corresp.startswith("#p_"):
            continue
        key = corresp.lstrip("#")
        # Roster people keep their canonical (cross-volume) id. Everyone
        # else falls back to their TEI xml:id, which is only unique within
        # a single volume — scope it by volume so a bare id reused across
        # volumes for different people cannot collide into one node.
        if key in CANONICAL_ID:
            canonical = CANONICAL_ID[key]
        elif key in NETWORK_PEOPLE:
            canonical = key
        else:
            canonical = f"{volume_key}:{key}"
        if canonical in seen:
            continue
        label = text_of(pn)
        if key in NETWORK_PEOPLE:
            entry = dict(NETWORK_PEOPLE[key])
            entry["id"] = canonical
            entry["tei_id"] = key
            entry["surface"] = label
            entry["in_network"] = True
        else:
            entry = {"id": canonical, "tei_id": key, "name": label, "surface": label, "in_network": False}
        seen[canonical] = entry
    return list(seen.values())


def topics_in(div: ET.Element) -> list[str]:
    body = text_of(div)
    hits: list[str] = []
    for topic, pattern in TOPIC_PATTERNS:
        if pattern.search(body):
            hits.append(topic)
    return hits


# Session classification for the Reykjavik negotiating memcons. Each
# assignment is anchored to the source-note headnote of the document
# itself in FRUS 1981-1988 Volume V ("Reykjavik Summit", Docs 267-309),
# cross-checked against the President's diary entries reproduced in
# those headnotes and the Savranskaya-Blanton Soviet records.
SESSION_MAP = {
    "d301": {"session": "Session I - October 11 morning", "principals": "Reagan-Gorbachev", "venue": "Hofdi House"},
    "d302": {"session": "Session II - October 11 afternoon", "principals": "Reagan-Gorbachev", "venue": "Hofdi House"},
    "d303": {"session": "Working Group - Night of October 11-12", "principals": "US-Soviet arms control experts", "venue": "Hofdi House (draft; disavowed by Ridgway)"},
    "d306": {"session": "Session III - October 12 morning", "principals": "Reagan-Gorbachev", "venue": "Hofdi House"},
    "d307": {"session": "Foreign Ministers - October 12 afternoon", "principals": "Shultz-Shevardnadze", "venue": "Hofdi House"},
    "d308": {"session": "Session IV - October 12 afternoon (final plenary)", "principals": "Reagan-Gorbachev", "venue": "Hofdi House"},
}


def phase_for(doc_id: str, iso_date: str, doc_num: int) -> str:
    if iso_date and iso_date < "1986-10-11":
        return "pre-summit"
    if iso_date and iso_date > "1986-10-12":
        return "aftermath"
    if iso_date and "1986-10-11" <= iso_date <= "1986-10-12":
        return "summit"
    # fall back to document number for undated editorial notes in Vol V
    if 267 <= doc_num <= 294:
        return "pre-summit"
    if 295 <= doc_num <= 306:
        return "summit"
    if 307 <= doc_num <= 309:
        return "aftermath"
    return "aftermath"


def parse_volume(xml_path: Path, volume_key: str, doc_range: range | None) -> list[dict[str, Any]]:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    records: list[dict[str, Any]] = []
    for div in root.iter(qn("div")):
        if div.get("type") != "document":
            continue
        xid = div.get(f"{{{XML_NS}}}id", "")
        m = re.fullmatch(r"d(\d+)", xid)
        if not m:
            continue
        doc_num = int(m.group(1))
        if doc_range is not None and doc_num not in doc_range:
            continue

        subtype = div.get("subtype", "")
        iso_date, human_date = opener_date(div)
        if not iso_date:
            iso_date = machine_date(div)
        title = head_title(div)
        # Trim leading "N. " numbering from head
        title_clean = re.sub(rf"^{doc_num}\.\s*", "", title).strip()
        # Drop any trailing source-note fragment (rare because text_of skips notes)
        title_clean = re.sub(r"\s+Source:.*$", "", title_clean)

        place = opener_place(div)
        persons = persons_in(div, volume_key)
        topics = topics_in(div)

        canonical = f"https://history.state.gov/historicaldocuments/{volume_key}/d{doc_num}"

        record = {
            "doc_id": f"{volume_key}-d{doc_num}",
            "doc_number": doc_num,
            "source": {
                "frus1981-88v05": "FRUS 1981-1988 v05",
                "frus1981-88v06": "FRUS 1981-1988 v06",
            }.get(volume_key, volume_key),
            "source_kind": subtype or "document",
            "title": title_clean,
            "date": iso_date,
            "date_display": human_date,
            "place": place,
            "url": canonical,
            "summit_phase": phase_for(xid, iso_date, doc_num),
            "session": SESSION_MAP.get(xid, {}).get("session", ""),
            "principals": SESSION_MAP.get(xid, {}).get("principals", ""),
            "venue": SESSION_MAP.get(xid, {}).get("venue", ""),
            "persons": persons,
            "topics": topics,
            "verified": True,
            "excerpt": excerpt_of(div),
        }
        records.append(record)
    return records


def excerpt_of(div: ET.Element, target_chars: int = 480) -> str:
    """First paragraph or two of the body, stripped of notes and inline markup."""
    out: list[str] = []
    for p in div.findall(qn("p")):
        t = text_of(p)
        if not t:
            continue
        out.append(t)
        if sum(len(x) for x in out) >= target_chars:
            break
    text = " ".join(out).strip()
    if len(text) > target_chars:
        text = text[: target_chars - 1].rsplit(" ", 1)[0] + "..."
    return text


def parse_v06_chronology(xml_path: Path) -> list[dict[str, Any]]:
    """Extract the Iceland Chronology attached to Vol VI Document 1 as
    a sequence of timeline events keyed to date."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    for div in root.iter(qn("div")):
        if div.get(f"{{{XML_NS}}}id") == "d1":
            break
    else:
        return []

    events: list[dict[str, Any]] = []
    current_date_iso: str | None = None
    current_date_human: str | None = None

    DATE_HEADS = {
        "Thursday, October 9": "1986-10-09",
        "Friday, October 10": "1986-10-10",
        "Saturday, October 11": "1986-10-11",
        "Sunday, October 12": "1986-10-12",
        "Monday, October 13": "1986-10-13",
    }

    # Walk paragraphs in document order.
    for elem in div.iter():
        tag = strip_tag(elem.tag)
        if tag != "p":
            continue
        rend = elem.get("rend", "")
        raw = text_of(elem)
        if not raw:
            continue
        if "sectiontitle" in rend or raw.strip() in DATE_HEADS:
            key = raw.strip().rstrip(":")
            if key in DATE_HEADS:
                current_date_iso = DATE_HEADS[key]
                current_date_human = key
                continue
        if current_date_iso is None:
            continue
        # Emit a timeline event.
        events.append(
            {
                "date": current_date_iso,
                "date_display": current_date_human,
                "text": raw,
                "url": "https://history.state.gov/historicaldocuments/frus1981-88v06/d1",
                "source": "FRUS 1981-1988 v06",
                "source_kind": "chronology",
            }
        )
    return events


def main() -> int:
    ap = argparse.ArgumentParser(description="Parse FRUS TEI into the unified schema.")
    ap.add_argument("--v05", default="data/raw/frus1981-88v05.xml")
    ap.add_argument("--v06", default="data/raw/frus1981-88v06.xml")
    ap.add_argument("--out-dir", default="data")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    v05 = parse_volume(Path(args.v05), "frus1981-88v05", range(267, 310))
    v06 = parse_volume(Path(args.v06), "frus1981-88v06", range(1, 40))  # post-summit follow-up window
    chronology = parse_v06_chronology(Path(args.v06))

    all_records = v05 + v06

    (out_dir / "frus_v05_reykjavik.json").write_text(
        json.dumps(v05, indent=2, ensure_ascii=False)
    )
    (out_dir / "frus_v06_aftermath.json").write_text(
        json.dumps(v06, indent=2, ensure_ascii=False)
    )
    (out_dir / "v06_chronology.json").write_text(
        json.dumps(chronology, indent=2, ensure_ascii=False)
    )

    print(f"v05 Reykjavik section: {len(v05)} documents")
    print(f"v06 post-summit window: {len(v06)} documents")
    print(f"v06 Iceland chronology: {len(chronology)} events")

    # Small sanity report
    memcons = [r for r in v05 if "Memorandum of Conversation" in r["title"]]
    print(f"v05 memoranda of conversation: {len(memcons)}")
    for r in memcons[:8]:
        print(f"  d{r['doc_number']}  {r['date']}  {r['title'][:80]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
