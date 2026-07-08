#!/usr/bin/env python3
"""
Fetch declassified documents from the U.S. Department of State FOIA
Virtual Reading Room and emit records in the unified reykjavik-40 schema.

Endpoint
--------
    GET https://foia.state.gov/api/Search2/SubmitSimpleQuery
    (JSON; parameters mirror the SearchResults.aspx front-end form.)

The Virtual Reading Room contains records released under FOIA and other
information-access programs. All records here are marked as source
"foia.state.gov" and always live in the "declassified" layer of the
front end, distinct from FRUS documents which are edited compilations.

Every record links back to its canonical PDF on foia.state.gov via the
relative `pdfLink` field promoted to a full URL.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

BASE = "https://foia.state.gov"
ENDPOINT = f"{BASE}/api/Search2/SubmitSimpleQuery"

# Query terms tuned to surface documents that discuss the Reykjavik
# summit or the immediate diplomacy around it. We de-duplicate by
# case+PDF filename so overlap is fine.
DEFAULT_QUERIES = [
    "Reykjavik",
    "Iceland summit",
    "Gorbachev summit",
]

# Person and topic tags applied to FOIA records by keyword scan against
# subject + from/to fields. Kept intentionally conservative: FOIA
# metadata is sparse and we do not read the PDF bodies.
# Canonical IDs mirror parse_frus.py so the negotiation-network view
# collapses cross-source references to one node per person.
NETWORK_KEYWORDS = {
    "Reagan": ("reagan_gorbachev.reagan", "Ronald Reagan", "US", "President of the United States"),
    "Shultz": ("us.shultz", "George P. Shultz", "US", "Secretary of State"),
    "Nitze": ("us.nitze", "Paul H. Nitze", "US", "Special Adviser on Arms Control"),
    "Matlock": ("us.matlock", "Jack F. Matlock Jr.", "US", "NSC Senior Director, European and Soviet Affairs"),
    "Kampelman": ("us.kampelman", "Max M. Kampelman", "US", "Head, U.S. Delegation to the Nuclear and Space Talks"),
    "Ridgway": ("us.ridgway", "Rozanne L. Ridgway", "US", "Assistant Secretary of State for European and Canadian Affairs"),
    "Poindexter": ("us.poindexter", "John M. Poindexter", "US", "National Security Advisor (until Nov 1986)"),
    "Adelman": ("us.adelman", "Kenneth L. Adelman", "US", "Director, Arms Control and Disarmament Agency"),
    "Perle": ("us.perle", "Richard N. Perle", "US", "Assistant Secretary of Defense for International Security Policy"),
    "Linhard": ("us.linhard", "Robert E. Linhard", "US", "NSC Director, Defense Programs and Arms Control"),
    "Hartman": ("us.hartman", "Arthur A. Hartman", "US", "Ambassador to the Soviet Union"),
    "Weinberger": ("us.weinberger", "Caspar W. Weinberger", "US", "Secretary of Defense"),
    "Bush": ("us.bush", "George H.W. Bush", "US", "Vice President of the United States"),
    "Casey": ("us.casey", "William J. Casey", "US", "Director of Central Intelligence"),
    "Regan": ("us.regan", "Donald T. Regan", "US", "White House Chief of Staff (until Feb 1987)"),
    "Carlucci": ("us.carlucci", "Frank C. Carlucci", "US", "National Security Advisor (Dec 1986 - Nov 1987); Secretary of Defense (from Nov 1987)"),
    "Powell": ("us.powell", "Colin L. Powell", "US", "National Security Advisor (from Nov 1987)"),
    "Armacost": ("us.armacost", "Michael H. Armacost", "US", "Under Secretary of State for Political Affairs"),
    "Rowny": ("us.rowny", "Edward L. Rowny", "US", "Special Advisor on Arms Control"),
    "Glitman": ("us.glitman", "Maynard W. Glitman", "US", "Chief U.S. Negotiator on INF"),
    "Lehman": ("us.lehman", "Ronald F. Lehman II", "US", "Chief U.S. Negotiator on START"),
    "Simons": ("us.simons", "Thomas W. Simons Jr.", "US", "Director/Deputy Assistant Secretary, Soviet Union Affairs"),
    "Whitehead": ("us.whitehead", "John C. Whitehead", "US", "Deputy Secretary of State"),
    "Gorbachev": ("reagan_gorbachev.gorbachev", "Mikhail S. Gorbachev", "USSR", "General Secretary, CPSU"),
    "Shevardnadze": ("ussr.shevardnadze", "Eduard A. Shevardnadze", "USSR", "Minister of Foreign Affairs"),
    "Akhromeyev": ("ussr.akhromeyev", "Sergei F. Akhromeyev", "USSR", "Chief of the General Staff, Soviet Armed Forces"),
    "Dobrynin": ("ussr.dobrynin", "Anatoly F. Dobrynin", "USSR", "Secretary, CPSU Central Committee"),
    "Karpov": ("ussr.karpov", "Viktor P. Karpov", "USSR", "Head, Soviet Delegation to the Nuclear and Space Talks"),
    "Bessmertnykh": ("ussr.bessmertnykh", "Aleksandr A. Bessmertnykh", "USSR", "Deputy Minister of Foreign Affairs"),
    "Gromyko": ("ussr.gromyko", "Andrei A. Gromyko", "USSR", "Chairman of the Presidium of the Supreme Soviet"),
    "Dubinin": ("ussr.dubinin", "Yuri V. Dubinin", "USSR", "Soviet Ambassador to the United States (from May 1986)"),
    "Vorontsov": ("ussr.vorontsov", "Yuli M. Vorontsov", "USSR", "Head, Soviet Delegation to the Nuclear and Space Talks (1987)"),
}

TOPIC_PATTERNS = [
    ("SDI", re.compile(r"\bSDI\b|strategic defense|space[- ]based defense|ABM", re.I)),
    ("INF", re.compile(r"\bINF\b|intermediate[- ]range|SS-20|Pershing|cruise missile", re.I)),
    ("Strategic Arms", re.compile(r"\bSTART\b|strategic arms|strategic nuclear|ballistic missile", re.I)),
    ("Nuclear Testing", re.compile(r"nuclear test|test ban|CTBT", re.I)),
    ("Human Rights", re.compile(r"human rights|emigration|refusenik|Sakharov|Daniloff|Shcharansky", re.I)),
    ("Regional Issues", re.compile(r"Afghanistan|Nicaragua|Angola|regional", re.I)),
    ("Bilateral Relations", re.compile(r"cultural|consular|Aeroflot|bilateral", re.I)),
]

DOCTYPE_LABEL = {
    "TE": "Telegram",
    "ME": "Memorandum",
    "MI": "Miscellaneous",
    "BR": "Briefing paper",
    "GC": "General correspondence",
    "MD": "Memorandum for the record",
    "PR": "Press item",
    "MF": "Memorandum for the file",
    "CD": "Cable draft",
    "RP": "Report",
    "SC": "Speech / talking points",
    "TN": "Talking notes",
    "DD": "Diplomatic dispatch",
    "CC": "Cable clearance",
    "EM": "Email",
    "GS": "General subject",
}

CLASSIFICATION_LABEL = {
    "TS": "Top Secret",
    "S": "Secret",
    "C": "Confidential",
    "LOU": "Limited Official Use",
    "U": "Unclassified",
    "SBU": "Sensitive But Unclassified",
}


def fetch_query(term: str, begin: str, end: str, page_size: int = 100, delay: float = 0.5) -> list[dict[str, Any]]:
    """Fetch all pages for a single search term. Dates are YYYYMMDD."""
    all_results: list[dict[str, Any]] = []
    start = 1
    page = 1
    while True:
        params = {
            "searchText": term,
            "collectionMatch": "",
            "page": str(page),
            "start": str(start),
            "limit": str(page_size),
            "beginDate": begin,
            "endDate": end,
            "postedBeginDate": "",
            "postedEndDate": "",
            "caseNumber": "",
            "docFrom": "",
            "docTo": "",
            "email": "",
            "telegram": "",
            "misc": "",
            "me": "",
            "gc": "",
            "cc": "",
            "md": "",
            "pr": "",
            "sc": "",
            "rp": "",
            "tn": "",
            "dd": "",
            "cd": "",
            "mf": "",
            "exclude": "",
            "sort": "",
        }
        url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "reykjavik-40 pipeline (research; +https://github.com/therealjameswilson/reykjavik-40)",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results = payload.get("Results") or []
        total = int(payload.get("totalHits") or 0)
        all_results.extend(results)
        if not results or start + len(results) - 1 >= total:
            break
        start += len(results)
        page += 1
        time.sleep(delay)
    return all_results


def normalise(raw: dict[str, Any]) -> dict[str, Any]:
    subject = (raw.get("subject") or "").strip()
    case_subject = (raw.get("casesubject") or "").strip()
    frm = (raw.get("from") or "").strip()
    to = (raw.get("to") or "").strip()
    doctype_code = (raw.get("doctype") or "").strip()
    classification = (raw.get("classification") or "").strip()

    docdate_raw = (raw.get("docdate") or "").strip()
    iso_date = ""
    date_display = ""
    if docdate_raw:
        try:
            dt = datetime.fromisoformat(docdate_raw.replace("Z", ""))
            iso_date = dt.date().isoformat()
            date_display = dt.strftime("%B %d, %Y")
        except ValueError:
            iso_date = docdate_raw[:10]
            date_display = docdate_raw[:10]

    pdf = (raw.get("pdfLink") or "").lstrip("/")
    pdf_url = f"{BASE}/{pdf}" if pdf else ""
    doc_id_match = re.search(r"C(\d{8,})", pdf) if pdf else None
    doc_id = f"foia-C{doc_id_match.group(1)}" if doc_id_match else f"foia-{raw.get('casenumber','unknown')}"

    scan = " ".join([subject, case_subject, frm, to])
    persons = []
    seen_ids: set[str] = set()
    for surface, (pid, name, side, role) in NETWORK_KEYWORDS.items():
        if re.search(rf"\b{re.escape(surface)}\b", scan, re.I):
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            persons.append({"id": pid, "name": name, "surface": surface, "side": side, "role": role, "in_network": True})

    topics = [t for t, pat in TOPIC_PATTERNS if pat.search(scan)]

    # Phase classification for FOIA docs by date.
    phase = "aftermath"
    if iso_date:
        if iso_date < "1986-10-11":
            phase = "pre-summit"
        elif iso_date <= "1986-10-12":
            phase = "summit"

    return {
        "doc_id": doc_id,
        "doc_number": None,
        "source": "foia.state.gov",
        "source_kind": "declassified",
        "title": subject or case_subject or "(untitled release)",
        "case_number": raw.get("casenumber", ""),
        "case_subject": case_subject,
        "from": frm,
        "to": to,
        "message_number": (raw.get("messagenumber") or "").strip(),
        "doctype": DOCTYPE_LABEL.get(doctype_code, doctype_code or "Document"),
        "doctype_code": doctype_code,
        "classification": CLASSIFICATION_LABEL.get(classification, classification or "Unclassified"),
        "classification_code": classification,
        "release_decision": (raw.get("releasedecision") or "").strip(),
        "posted_date": (raw.get("posteddate") or "")[:10],
        "date": iso_date,
        "date_display": date_display,
        "url": pdf_url,
        "summit_phase": phase,
        "session": "",
        "persons": persons,
        "topics": topics,
        "verified": True,
        "excerpt": "",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--begin", default="19860801", help="YYYYMMDD (default 1986-08-01)")
    ap.add_argument("--end", default="19870331", help="YYYYMMDD (default 1987-03-31)")
    ap.add_argument("--queries", nargs="+", default=DEFAULT_QUERIES)
    ap.add_argument("--out", default="data/foia_reykjavik.json")
    ap.add_argument("--raw-out", default="data/raw/foia_raw.json")
    args = ap.parse_args()

    all_raw: dict[str, dict[str, Any]] = {}
    for q in args.queries:
        print(f"[foia] query: {q!r}  window {args.begin}-{args.end}", file=sys.stderr)
        results = fetch_query(q, args.begin, args.end)
        print(f"       -> {len(results)} results", file=sys.stderr)
        for r in results:
            key = (r.get("pdfLink") or r.get("casenumber") or "") + "|" + (r.get("docdate") or "") + "|" + (r.get("subject") or "")
            all_raw[key] = r

    Path(args.raw_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.raw_out).write_text(json.dumps(list(all_raw.values()), indent=2))

    records = [normalise(r) for r in all_raw.values()]

    # Score for Reykjavik relevance: keep records whose subject, case,
    # from/to, or message number contains a Reykjavik/Iceland/Gorbachev
    # summit signal. FOIA full-text search matches any occurrence in
    # the OCR'd body, so many hits are unrelated cables that merely
    # mention Reykjavik in passing.
    relevance = re.compile(
        r"reykjavik|iceland\s+(summit|meeting)|hofdi|gorbachev|shevardnadze|shultz|reagan|arms\s+control|SDI|INF|nuclear\s+(test|arms)|superpower|soviet\s+summit",
        re.I,
    )
    def is_relevant(r: dict[str, Any]) -> bool:
        blob = " ".join([
            r.get("title", ""),
            r.get("case_subject", ""),
            r.get("from", ""),
            r.get("to", ""),
        ])
        return bool(relevance.search(blob))

    records = [r for r in records if is_relevant(r)]
    # sort by date then doc_id
    records.sort(key=lambda r: (r["date"] or "9999", r["doc_id"]))

    Path(args.out).write_text(json.dumps(records, indent=2, ensure_ascii=False))

    print(f"[foia] wrote {len(records)} unique declassified records to {args.out}", file=sys.stderr)
    for r in records[:8]:
        print(f"       {r['date']}  {r['doctype']:12s} {r['title'][:70]}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
