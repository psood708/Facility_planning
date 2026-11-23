#!/usr/bin/env python3
"""
Builds data/provenance.json — the citation and mandatory/recommended label for
every benchmark the engine checks — plus expert-review/provenance_review.csv,
the review sheet the domain expert fills in.

Expert workflow (no JSON editing needed): open the CSV in Excel, fill the
expert_obligation / expert_citation / reviewed_by / reviewed_on columns, save,
and re-run this script. Filled rows are applied to provenance.json as
expert_confirmed / expert_verified and survive every later re-run.

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
OUT_CSV = os.path.join(ROOT, "expert-review", "provenance_review.csv")
VALID_OBLIGATIONS = {"mandatory", "recommended"}

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


def read_expert_edits():
    """Rows of the review CSV where the expert filled an expert_* column."""
    if not os.path.exists(OUT_CSV):
        return {}
    edits = {}
    with open(OUT_CSV, newline="", encoding="utf-8-sig") as f:  # utf-8-sig: Excel adds a BOM
        for row in csv.DictReader(f):
            obligation = (row.get("expert_obligation") or "").strip().lower()
            citation = (row.get("expert_citation") or "").strip()
            if not obligation and not citation:
                continue
            if obligation and obligation not in VALID_OBLIGATIONS:
                raise SystemExit(f"{row['benchmark_id']}/{row['authority']}: expert_obligation must be 'mandatory' or 'recommended', got '{obligation}'")
            edits[(row["benchmark_id"], row["authority"])] = {
                "obligation": obligation,
                "citation": citation,
                "reviewed_by": (row.get("reviewed_by") or "").strip() or None,
                "reviewed_on": (row.get("reviewed_on") or "").strip() or None,
            }
    return edits


def apply_expert_edits(entries, edits):
    for (key, data_key), edit in edits.items():
        entry = entries.get(key, {}).get(data_key)
        if entry is None:
            print(f"warning: CSV row {key}/{data_key} matches no benchmark — skipped")
            continue
        if edit["obligation"]:
            entry.update(obligation=edit["obligation"], obligation_status="expert_confirmed", draft_basis=None)
        if edit["citation"]:
            entry.update(citation=edit["citation"], citation_status="expert_verified")
        entry.update(reviewed_by=edit["reviewed_by"] or entry.get("reviewed_by"), reviewed_on=edit["reviewed_on"] or entry.get("reviewed_on"))


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

    apply_expert_edits(entries, read_expert_edits())

    doc = {
        "_meta": {
            "schema_version": 1,
            "generated_on": date.today().isoformat(),
            "about": "Citation and mandatory/recommended label per benchmark. Generated — do not edit by hand. "
            "The expert fills expert-review/provenance_review.csv and re-runs scripts/build_provenance.py.",
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

    os.makedirs(os.path.dirname(OUT_CSV), exist_ok=True)
    with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow([
            "benchmark_id", "authority", "current_obligation", "obligation_status", "draft_basis", "current_citation", "citation_status",
            "expert_obligation", "expert_citation", "reviewed_by", "reviewed_on",
        ])
        for key in sorted(entries):
            for data_key, e in entries[key].items():
                confirmed = e["obligation_status"] == "expert_confirmed"
                verified = e["citation_status"] == "expert_verified"
                w.writerow([
                    key, data_key, e["obligation"] or "", e["obligation_status"], e["draft_basis"] or "", e["citation"] or "", e["citation_status"],
                    e["obligation"] if confirmed else "", e["citation"] if verified else "", e.get("reviewed_by") or "", e.get("reviewed_on") or "",
                ])

    rows = [e for v in entries.values() for e in v.values()]
    counts = {}
    for e in rows:
        counts[e["obligation_status"]] = counts.get(e["obligation_status"], 0) + 1
    print(f"wrote {OUT_JSON} ({len(rows)} entries: {counts}) and {OUT_CSV}")


if __name__ == "__main__":
    build()
