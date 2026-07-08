#!/usr/bin/env python3
"""
Download the full declassified PDF release for a single FOIA case from the
U.S. Department of State Virtual Reading Room and mirror it into the site.

Target case
-----------
    F-1986-04261 — "Meeting of President Reagan and Soviet leader Mikhail
    Gorbachev in Reykjavik, Iceland, Oct 11-12, 1986"

The case is a 73-document microfiche release (documentclass
FOIA_Micro_Aug2024_9). The public SearchResults.aspx front end and its
JSON backend (api/Search2/SubmitSimpleQuery) return the case metadata but
paginate unreliably for a caseNumber-only query, so the document set is
enumerated from the stable, sequential PDF numbering that the case uses:

    DOCUMENTS/FOIA_Micro_Aug2024_9/F-1986-04261/DOC_0C09000NNN/C09000NNN.pdf

with NNN running 001..073 ("Document N of 73"). Shared case metadata
(subject, posted date, document class) is read once from the live JSON
backend; if the backend is unreachable the download still proceeds using
committed defaults.

Outputs
-------
    docs/assets/pdf/foia/F-1986-04261/C09000NNN.pdf   - the PDFs (committed)
    data/foia_pdfs.json                               - manifest (source of truth)
    docs/data/foia_pdfs.json                          - mirror served by the site

Modes
-----
    (default)         download any missing PDFs, then (re)write the manifest
    --manifest-only   rebuild the manifest from files already on disk, no network
    --force           re-download every PDF even if present

The default build pipeline does NOT invoke this script (it needs network
and the PDFs are committed); run it by hand to refresh the release.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE = "https://foia.state.gov"
ENDPOINT = f"{BASE}/api/Search2/SubmitSimpleQuery"

CASE_NUMBER = "F-1986-04261"
DOC_CLASS = "FOIA_Micro_Aug2024_9"
DOC_COUNT = 73
SEARCH_URL = f"{BASE}/FOIALIBRARY/SearchResults.aspx?caseNumber={CASE_NUMBER}"

# Committed fallbacks used when the JSON backend is unreachable. These match
# the values the backend returns for this case as of the Aug 2024 release.
FALLBACK_SUBJECT = (
    "Meeting of President Reagan and Soviet leader Mikhail Gorbachev in "
    "Reykjavik, Iceland, Oct 11-12, 1986"
)
FALLBACK_POSTED = "2024-08-16"

PDF_DIR = Path("docs/assets/pdf/foia") / CASE_NUMBER
# Path the served site (rooted at docs/) uses to reach a PDF.
SITE_PDF_PREFIX = f"assets/pdf/foia/{CASE_NUMBER}"
OUT = Path("data/foia_pdfs.json")
DOCS_OUT = Path("docs/data/foia_pdfs.json")

USER_AGENT = (
    "reykjavik-40 pipeline (research; "
    "+https://github.com/therealjameswilson/reykjavik-40)"
)

DOCTYPE_LABEL = {
    "MF": "Memorandum for the file",
    "ME": "Memorandum",
    "MI": "Miscellaneous",
    "TE": "Telegram",
    "BR": "Briefing paper",
    "RP": "Report",
}
CLASSIFICATION_LABEL = {
    "UNCLASS": "Unclassified",
    "U": "Unclassified",
    "C": "Confidential",
    "S": "Secret",
    "TS": "Top Secret",
}


def doc_stem(n: int) -> str:
    return f"C0900{n:04d}"  # C09000001 .. C09000073


def pdf_link(n: int) -> str:
    stem = doc_stem(n)
    return f"DOCUMENTS/{DOC_CLASS}/{CASE_NUMBER}/DOC_0{stem}/{stem}.pdf"


def fetch_case_meta() -> dict[str, dict[str, Any]]:
    """Best-effort: map C09000NNN stem -> raw backend record. Never raises."""
    params = {
        "searchText": "*",
        "caseNumber": CASE_NUMBER,
        "page": "1", "start": "1", "limit": "200",
        "beginDate": "", "endDate": "", "postedBeginDate": "", "postedEndDate": "",
        "collectionMatch": "", "docFrom": "", "docTo": "", "email": "",
        "telegram": "", "misc": "", "me": "", "gc": "", "cc": "", "md": "",
        "pr": "", "sc": "", "rp": "", "tn": "", "dd": "", "cd": "", "mf": "",
        "exclude": "", "sort": "",
    }
    url = f"{ENDPOINT}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    out: dict[str, dict[str, Any]] = {}
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        for r in payload.get("Results") or []:
            link = (r.get("pdfLink") or "")
            stem = Path(link).stem  # C09000NNN
            if stem:
                out[stem] = r
        print(f"[foia-pdf] backend metadata for {len(out)} document(s)", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 - network is optional here
        print(f"[foia-pdf] backend metadata unavailable ({exc}); using defaults",
              file=sys.stderr)
    return out


def download(n: int, force: bool, delay: float) -> None:
    stem = doc_stem(n)
    dest = PDF_DIR / f"{stem}.pdf"
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return
    url = f"{BASE}/{pdf_link(n)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if not data.startswith(b"%PDF"):
        raise ValueError(f"{stem}: response is not a PDF (starts {data[:8]!r})")
    dest.write_bytes(data)
    print(f"[foia-pdf] downloaded {stem}.pdf  {len(data):,} bytes", file=sys.stderr)
    time.sleep(delay)


def page_count(path: Path) -> int | None:
    """Best-effort page count from the PDF page-tree markers."""
    try:
        blob = path.read_bytes()
    except OSError:
        return None
    count = blob.count(b"/Type/Page") + blob.count(b"/Type /Page")
    # Each page tree node is "/Type/Pages"; subtract those double-counted hits.
    pages_nodes = blob.count(b"/Type/Pages") + blob.count(b"/Type /Pages")
    n = count - pages_nodes
    return n if n > 0 else None


def iso_date(raw: str | None) -> str:
    """Return YYYY-MM-DD, dropping the FOIA 'unknown' sentinel 0001-01-01."""
    if not raw:
        return ""
    head = raw[:10]
    if head.startswith("0001"):
        return ""
    return head


def build_record(n: int, meta: dict[str, Any] | None) -> dict[str, Any]:
    stem = doc_stem(n)
    dest = PDF_DIR / f"{stem}.pdf"
    size = dest.stat().st_size if dest.exists() else 0
    meta = meta or {}
    doctype_code = (meta.get("doctype") or "MF").strip()
    classification = (meta.get("classification") or "UNCLASS").strip()
    subject = (meta.get("subject") or "").strip()
    title = subject or f"{FALLBACK_SUBJECT}   Document {n} of {DOC_COUNT}"
    numpages = meta.get("numpages") or 0
    pages = numpages if numpages else page_count(dest)
    return {
        "doc_id": f"foia-{stem}",
        "case_number": CASE_NUMBER,
        "case_subject": (meta.get("casesubject") or FALLBACK_SUBJECT).strip(),
        "doc_index": n,
        "doc_total": DOC_COUNT,
        "title": title,
        "filename": f"{stem}.pdf",
        "local_url": f"{SITE_PDF_PREFIX}/{stem}.pdf",
        "source_url": f"{BASE}/{pdf_link(n)}",
        "date": iso_date(meta.get("docdate")),
        "posted_date": iso_date(meta.get("posteddate")) or FALLBACK_POSTED,
        "doctype_code": doctype_code,
        "doctype": DOCTYPE_LABEL.get(doctype_code, doctype_code or "Document"),
        "classification_code": classification,
        "classification": CLASSIFICATION_LABEL.get(classification, classification or "Unclassified"),
        "document_class": (meta.get("documentclass") or DOC_CLASS).strip(),
        "release_decision": (meta.get("releasedecision") or "").strip(),
        "from": (meta.get("from") or "").strip(),
        "to": (meta.get("to") or "").strip(),
        "size_bytes": size,
        "page_count": pages,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest-only", action="store_true",
                    help="rebuild the manifest from files on disk; no network")
    ap.add_argument("--force", action="store_true",
                    help="re-download every PDF even if already present")
    ap.add_argument("--delay", type=float, default=0.4,
                    help="seconds to pause between downloads (default 0.4)")
    args = ap.parse_args()

    PDF_DIR.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    DOCS_OUT.parent.mkdir(parents=True, exist_ok=True)

    meta = {} if args.manifest_only else fetch_case_meta()

    if not args.manifest_only:
        for n in range(1, DOC_COUNT + 1):
            try:
                download(n, args.force, args.delay)
            except Exception as exc:  # noqa: BLE001
                print(f"[foia-pdf] ERROR downloading document {n}: {exc}",
                      file=sys.stderr)
                return 1

    records = [build_record(n, meta.get(doc_stem(n))) for n in range(1, DOC_COUNT + 1)]

    missing = [r["filename"] for r in records if r["size_bytes"] == 0]
    if missing:
        print(f"[foia-pdf] ERROR: {len(missing)} PDF(s) missing on disk: "
              f"{', '.join(missing)}", file=sys.stderr)
        return 1

    total_bytes = sum(r["size_bytes"] for r in records)
    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "case_number": CASE_NUMBER,
        "case_subject": records[0]["case_subject"],
        "source": "foia.state.gov",
        "source_kind": "declassified",
        "search_url": SEARCH_URL,
        "document_class": DOC_CLASS,
        "count": len(records),
        "expected_count": DOC_COUNT,
        "total_bytes": total_bytes,
        "documents": records,
    }

    payload = json.dumps(manifest, indent=2, ensure_ascii=False)
    OUT.write_text(payload)
    DOCS_OUT.write_text(payload)

    print(f"[foia-pdf] {len(records)} documents, {total_bytes/1_048_576:.1f} MB total",
          file=sys.stderr)
    print(f"[foia-pdf] wrote {OUT} and {DOCS_OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
