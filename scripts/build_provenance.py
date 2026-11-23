#!/usr/bin/env python3
"""
Builds data/provenance.json — the citation and mandatory/recommended label for
every benchmark the engine checks — plus data/provenance_review.csv, a review
list for the domain expert.

Why a separate file: data/thresholds.json holds the benchmark *values*;
provenance holds *where each value comes from and how binding it is*. The
expert maintains provenance without touching the values or re-running
build_data.py.

Honesty rules:
  * Citations are never invented. Every threshold citation starts as null
    ("pending expert review"). The only pre-filled citations are the room-area
    sources already present in rooms.json (from the source workbook).
  * Mandatory/recommended labels are DRAFTS inferred from note wording, marked
    obligation_status="draft" with the wording that triggered them. Only the
    expert sets obligation_status="expert_confirmed".
  * Re-running this script keeps any entry the expert has confirmed or cited.

Usage: python3 scripts/build_provenance.py
"""
import csv
import json
import os
import re
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT_JSON = os.path.join(DATA, "provenance.json")
OUT_CSV = os.path.join(DATA, "provenance_review.csv")

REGULATORS = ["schedule_m", "us_fda", "eu_gmp_pics", "who_gmp", "china_nmpa", "japan_pmda"]

# Wording that signals a value is guidance rather than a binding requirement.
# Checked first, so "not mandated" never matches the mandatory pattern.
RECOMMENDED_RE = re.compile(
    r"not formally|not mandated|does not codify|not codified|not an? \w+ regulation|industry practice|"
    r"typical|guidance|recommend|best practice|good practice|CCS-driven|expected|implied|interpreted|not specified",
    re.I,
)
MANDATORY_RE = re.compile(r"mandat|must|shall|required|requires|minimum|limit|≥|≤", re.I)


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf8") as f:
        return json.load(f)


def draft_obligation(note):
    note = note or ""
    m = RECOMMENDED_RE.search(note)
    if m:
        return "recommended", m.group(0)
    m = MANDATORY_RE.search(note)
    if m:
        return "mandatory", m.group(0)
    return None, None


def blank_entry():
    return {
        "citation": None,
        "citation_status": "pending",
        "obligation": None,
        "obligation_status": "unclassified",
        "draft_basis": None,
        "reviewed_by": None,
        "reviewed_on": None,
    }


def is_expert_touched(entry):
    return entry.get("obligation_status") == "expert_confirmed" or entry.get("citation_status") == "expert_verified"


def build():
    thresholds = load("thresholds")
    rooms = load("rooms")
    booleans = load("boolean_thresholds")
    previous = {}
    if os.path.exists(OUT_JSON):
        with open(OUT_JSON, encoding="utf8") as f:
            previous = json.load(f).get("entries", {})

    entries = {}

    def put(key, data_key, entry):
        prior = previous.get(key, {}).get(data_key)
        entries.setdefault(key, {})[data_key] = prior if prior and is_expert_touched(prior) else entry

    for t in thresholds:
        for data_key in REGULATORS:
            a = t["authorities"].get(data_key) or {}
            if not a.get("covered") or not a.get("specified"):
                continue  # nothing to cite or classify when the authority gives no value
            e = blank_entry()
            obligation, basis = draft_obligation(a.get("note"))
            if obligation:
                e.update(obligation=obligation, obligation_status="draft", draft_basis=f"note wording: '{basis}'")
            put(t["id"], data_key, e)

    for r in rooms:
        if r.get("min_area_sqm") is None:
            continue
        e = blank_entry()
        e.update(
            citation=r["min_area_source"],
            citation_status="workbook",
            obligation="mandatory",
            obligation_status="draft",
            draft_basis="Schedule M states a minimum area in m²",
        )
        put(f"AREA-{r['id']}", "schedule_m", e)

    for b in booleans:
        e = blank_entry()
        if b.get("schedule_m_explicit"):
            e.update(obligation="mandatory", obligation_status="draft", draft_basis="schedule_m_explicit=true in workbook")
        put(b["id"], "schedule_m", e)

    doc = {
        "_meta": {
            "schema_version": 1,
            "generated_on": date.today().isoformat(),
            "about": "Citation and mandatory/recommended label per benchmark. Edit entries here; set "
            "obligation_status='expert_confirmed' / citation_status='expert_verified' and fill reviewed_by/"
            "reviewed_on so re-running scripts/build_provenance.py keeps your edits.",
            "fallback": {
                "data_key": "industry",
                "label": "International/industry standard",
                "obligation": "recommended",
                "why": "Used only when a selected authority gives no number, or selected authorities conflict. "
                "Never treated as an authority requirement.",
            },
        },
        "entries": entries,
    }
    with open(OUT_JSON, "w", encoding="utf8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with open(OUT_CSV, "w", newline="", encoding="utf8") as f:
        w = csv.writer(f)
        w.writerow(["benchmark_id", "authority", "draft_obligation", "obligation_status", "draft_basis", "citation", "citation_status"])
        for key in sorted(entries):
            for data_key, e in entries[key].items():
                w.writerow([key, data_key, e["obligation"] or "", e["obligation_status"], e["draft_basis"] or "", e["citation"] or "", e["citation_status"]])

    rows = [e for v in entries.values() for e in v.values()]
    counts = {}
    for e in rows:
        counts[e["obligation_status"]] = counts.get(e["obligation_status"], 0) + 1
    print(f"wrote {OUT_JSON} ({len(rows)} entries: {counts}) and {OUT_CSV}")


if __name__ == "__main__":
    build()
