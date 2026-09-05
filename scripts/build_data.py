#!/usr/bin/env python3
"""
Converts Facility_Compliance_Parameter_Schema.xlsx into the JSON files the
web app consumes (data/parameters.json, data/rooms.json, data/authorities.json,
data/thresholds.json, data/structural_flags.json).

parameters.json and rooms.json are mechanical extractions of the source sheets.

thresholds.json is NOT a mechanical extraction — the source "Regulatory
Threshold Library" sheet stores values as prose ("10-15 Pa (guidance)",
"Significantly higher than 20 ACH"). This script hand-encodes that prose into
{min, max} / category / boolean structures so the browser can actually compare
a user's entered value against it. Every interpretation is carried forward as
a `note` field so the UI can show its provenance rather than presenting a
made-up number as if it were an unambiguous regulatory figure.

Re-run this script if the source workbook or the curated threshold judgments
below change: `python3 build_data.py`
"""
import json
import os
import openpyxl

SRC = "/Users/psood/Downloads/himanshu-uncle-pharma/Facility_Compliance_Parameter_Schema.xlsx"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

CATEGORY_KEYS = ["ext_prep", "osd_production", "osd_rnd_pilot", "sterile"]


def parse_applicability(text):
    """Map the free-text 'Applicable Dosage Form(s)' column to the 4 category flags."""
    text = text or ""
    if text.strip().lower() == "all":
        return {k: True for k in CATEGORY_KEYS}
    flags = {k: False for k in CATEGORY_KEYS}
    if "ext.prep" in text.lower() or "ext. prep" in text.lower() or "external" in text.lower():
        flags["ext_prep"] = True
    if "osd" in text.lower():
        flags["osd_production"] = True
        flags["osd_rnd_pilot"] = True
    if "sterile" in text.lower():
        flags["sterile"] = True
    return flags


def extract_parameters(wb):
    ws = wb["Parameter Master Schema"]
    rows = list(ws.iter_rows(min_row=5, values_only=True))
    out = []
    for r in rows:
        if not r or not r[0]:
            continue
        param_id, category, name, applicable, applies_at, dtype, unit_options, baseline, severity, notes = (
            list(r) + [None] * (10 - len(r))
        )[:10]
        out.append(
            {
                "id": param_id,
                "category": category,
                "name": name,
                "applicable_raw": applicable,
                "applicability": parse_applicability(applicable),
                "applies_at": applies_at,
                "data_type": dtype,
                "unit_options": unit_options,
                "schedule_m_baseline": baseline,
                "gap_severity": severity,
                "notes": notes,
            }
        )
    return out


GRADE_PRIORITY = [
    ("Grade A", "A"),
    ("ISO 5", "A"),
    ("Grade B", "B"),
    ("Grade C", "C"),
    ("Grade D", "D"),
    ("ISO 8", "D"),
    ("ISO8", "D"),
    ("ISO 7", "C"),
    ("Technical", "Technical"),
    ("Temperature-mapped", "Controlled"),
    ("Controlled", "Controlled"),
]


def parse_grade_tag(grade_text):
    text = grade_text or ""
    for needle, tag in GRADE_PRIORITY:
        if needle in text:
            return tag
    return "Unclassified"


# Rooms where Schedule M gives an actual standalone numeric area minimum
# (as opposed to a bundled total across several rooms - see BUNDLED_AREA_NOTES).
MIN_AREA_OVERRIDES = {
    "Z-21": {"min_area_sqm": 25, "min_area_source": "Schedule M: 25 m² basic + 10 m² ancillary (Encapsulation Room)"},
    "Z-24": {"min_area_sqm": 30, "min_area_source": "Schedule M: 30 m² (Oral Powder Processing Suite)"},
    "Z-29": {"min_area_sqm": 150, "min_area_source": "Schedule M: 150 m² minimum (Aseptic Filling Suite, SVP)"},
    "Z-30": {"min_area_sqm": 25, "min_area_source": "Schedule M: 25 + 10 m² total (Ophthalmic Solution Filling)"},
}

BUNDLED_AREA_NOTE_EXT_PREP = (
    "Part of Schedule M's bundled 30+10 m² total Ext. Preparations production area "
    "(covers Liquids/Emulsions/Suspensions/Creams/Ointments/Gels/Dusting Powder combined) "
    "— not an individual room minimum."
)
BUNDLED_AREA_NOTE_OSD_GRAN = (
    "Part of Schedule M's bundled 60 m² total OSD tablet-production area "
    "(Granulation/Drying/Blending/Compression combined) — not an individual room minimum."
)
BUNDLED_AREA_NOTE_OSD_COATING = (
    "Part of Schedule M's bundled 60 m² tablet-production allocation plus 30 m² additional "
    "for coating — not an individual room minimum."
)
BUNDLED_AREA_NOTES = {
    "Z-09": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-10": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-11": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-12": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-13": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-14": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-15": BUNDLED_AREA_NOTE_EXT_PREP,
    "Z-16": BUNDLED_AREA_NOTE_OSD_GRAN,
    "Z-17": BUNDLED_AREA_NOTE_OSD_GRAN,
    "Z-18": BUNDLED_AREA_NOTE_OSD_GRAN,
    "Z-19": BUNDLED_AREA_NOTE_OSD_GRAN,
    "Z-20": BUNDLED_AREA_NOTE_OSD_GRAN,
    "Z-22": BUNDLED_AREA_NOTE_OSD_COATING,
    "Z-23": BUNDLED_AREA_NOTE_OSD_COATING,
}


def extract_rooms(wb):
    ws = wb["Room-Zone Master List"]
    rows = list(ws.iter_rows(min_row=5, values_only=True))
    out = []
    for r in rows:
        if not r or not r[0]:
            continue
        zone_id, stage, name, ext_prep, osd_prod, osd_rnd, sterile, grade, area_given, notes = (
            list(r) + [None] * (10 - len(r))
        )[:10]
        room = {
            "id": zone_id,
            "process_stage": stage,
            "name": name,
            "applies_to": {
                "ext_prep": bool(ext_prep),
                "osd_production": bool(osd_prod),
                "osd_rnd_pilot": bool(osd_rnd),
                "sterile": bool(sterile),
            },
            "typical_grade": grade,
            "grade_tag": parse_grade_tag(grade),
            "schedule_m_area_given": area_given,
            "notes": notes,
            "min_area_sqm": None,
            "min_area_source": None,
            "bundled_area_note": BUNDLED_AREA_NOTES.get(zone_id),
        }
        if zone_id in MIN_AREA_OVERRIDES:
            room.update(MIN_AREA_OVERRIDES[zone_id])
        out.append(room)
    return out


# ---------------------------------------------------------------------------
# Curated Regulatory Threshold Library -> structured, comparable values.
# ---------------------------------------------------------------------------

NC = {"covered": False}


def auth(specified, min=None, max=None, category=None, note=None):
    d = {"covered": True, "specified": specified}
    if min is not None:
        d["min"] = min
    if max is not None:
        d["max"] = max
    if category is not None:
        d["category"] = category
    if note is not None:
        d["note"] = note
    return d


def finalize_authorities(d):
    d.setdefault("uk_mhra", NC)
    d.setdefault("tga_australia", NC)
    d.setdefault("sahpra", NC)
    d.setdefault("sfda", NC)
    return d


NUMERIC_THRESHOLDS = [
    dict(
        id="THR-001", linked_param_id="HVAC-002", parameter_name="Temperature",
        context="sterile_filling", unit="°C", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Dependent on product; not uncomfortable"),
            us_fda=auth(False, note="Not specified; 'appropriate'"),
            eu_gmp_pics=auth(True, min=18, max=22, note="Not formally mandated — CCS-driven; typical 18–22°C"),
            who_gmp=auth(False, note="Controlled; compatible with operations (no number given)"),
            china_nmpa=auth(True, min=18, max=22, note="20±2°C typical"),
            japan_pmda=auth(True, min=18, max=26, note="Typical 18–26°C, continuous monitoring"),
            industry=auth(True, min=18, max=22, note="18–22°C filling; 20–24°C gowning (ISPE)"),
        )),
    ),
    dict(
        id="THR-002", linked_param_id="HVAC-002", parameter_name="Temperature",
        context="non_sterile_manufacturing", unit="°C", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="No specific range"),
            us_fda=auth(False, note="Controlled 'when appropriate' — no number"),
            eu_gmp_pics=auth(False, note="No specific range"),
            who_gmp=auth(True, min=20, max=25, note="Typically 20–25°C (guidance)"),
            china_nmpa=auth(True, min=18, max=26, note="18–26°C typical"),
            japan_pmda=auth(True, min=20, max=25, note="Product-specific, ~20–25°C"),
            industry=auth(True, min=20, max=25, note="20–25°C (ISPE)"),
        )),
    ),
    dict(
        id="THR-003", linked_param_id="HVAC-003", parameter_name="Relative Humidity",
        context="sterile_filling", unit="% RH", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Dependent on product; monitored"),
            us_fda=auth(False, note="Not specified; 'appropriate'"),
            eu_gmp_pics=auth(True, min=30, max=55, note="Not formally mandated — CCS-driven; typical 30–55%"),
            who_gmp=auth(False, note="Controlled (no number)"),
            china_nmpa=auth(True, min=40, max=50, note="45±5% typical"),
            japan_pmda=auth(True, min=35, max=55, note="Typical 45±10%"),
            industry=auth(True, min=30, max=55, note="30–55% general; 20–35% for dry-powder fill"),
        )),
    ),
    dict(
        id="THR-004", linked_param_id="HVAC-003", parameter_name="Relative Humidity",
        context="non_sterile_manufacturing", unit="% RH", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="No specific range"),
            us_fda=auth(False, note="Controlled 'when appropriate'"),
            eu_gmp_pics=auth(False, note="No specific range"),
            who_gmp=auth(True, max=65, note="≤65% (guidance)"),
            china_nmpa=auth(True, min=45, max=65, note="45–65% typical"),
            japan_pmda=auth(True, min=45, max=65),
            industry=auth(True, min=35, max=65),
        )),
    ),
    dict(
        id="THR-005", linked_param_id="HVAC-004", parameter_name="Air Changes per Hour",
        context="grade_b", unit="ACH", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not specified numerically"),
            us_fda=auth(True, min=20, note="'Significantly higher than 20 ACH' — interpreted as a minimum exceeding 20; FDA does not codify an exact figure"),
            eu_gmp_pics=auth(False, note="Not specified; 'effective flushing'"),
            who_gmp=auth(False, note="Not specified numerically"),
            china_nmpa=auth(True, min=30, note="≥30 ACH typical"),
            japan_pmda=auth(True, min=30, note="≥30 ACH; 15–20 min recovery expected"),
            industry=auth(True, min=30, max=60, note="30–60 ACH (ISPE)"),
        )),
    ),
    dict(
        id="THR-006", linked_param_id="HVAC-004", parameter_name="Air Changes per Hour",
        context="grade_c", unit="ACH", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not specified numerically"),
            us_fda=auth(True, min=20, note="Not formally specified; >20 ACH implied"),
            eu_gmp_pics=auth(False, note="Not specified numerically"),
            who_gmp=auth(False, note="Not specified numerically"),
            china_nmpa=auth(True, min=20, note="≥20 ACH"),
            japan_pmda=auth(True, min=20, note="≥20 ACH"),
            industry=auth(True, min=20, max=40),
        )),
    ),
    dict(
        id="THR-007", linked_param_id="HVAC-004", parameter_name="Air Changes per Hour",
        context="grade_d", unit="ACH", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not specified numerically"),
            us_fda=auth(True, min=20, note="≥20 ACH for ISO 8"),
            eu_gmp_pics=auth(False, note="Not specified numerically"),
            who_gmp=auth(False, note="Not specified numerically"),
            china_nmpa=auth(True, min=15, note="≥15 ACH typical"),
            japan_pmda=auth(False, note="Not specified"),
            industry=auth(True, min=15, max=25),
        )),
    ),
    dict(
        id="THR-008", linked_param_id="HVAC-004", parameter_name="Air Changes per Hour",
        context="non_sterile_production", unit="ACH", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Effective ventilation' — no number"),
            us_fda=auth(True, min=20, note="20 ACH is industry practice, not an FDA regulation"),
            eu_gmp_pics=auth(False, note="Not specified; industry range 10–20 ACH"),
            who_gmp=auth(False, note="Not prescriptive; typical 10–20 ACH"),
            china_nmpa=auth(True, min=15, max=25, note="15–25 ACH typical"),
            japan_pmda=auth(True, min=15, max=20, note="Risk-based, typical 15–20 ACH"),
            industry=auth(True, min=15, max=20),
        )),
    ),
    dict(
        id="THR-009", linked_param_id="HVAC-005", parameter_name="Pressure Differential",
        context="between_adjacent_grades", unit="Pa", severity="Aligned",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, min=10, max=15, note="10–15 Pa (guidance)"),
            us_fda=auth(True, min=10, max=15, note="10–15 Pa; ≥12.5 Pa vs unclassified space"),
            eu_gmp_pics=auth(True, min=10, note="≥10 Pa minimum"),
            who_gmp=auth(True, min=10, max=15),
            china_nmpa=auth(True, min=10, note="≥10 Pa"),
            japan_pmda=auth(True, min=10, max=15, note="≥10–15 Pa, continuous monitoring"),
            industry=auth(True, min=10, max=15, note="10–15 Pa normal; ≥15 Pa at A/B interface"),
        )),
    ),
    dict(
        id="THR-010", linked_param_id="HVAC-005", parameter_name="Pressure Differential",
        context="non_sterile", unit="Pa", severity="Aligned",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, min=10, max=15, note="10–15 Pa (Ext.Prep); ≥15 Pa mfg-vs-support (OSD, stricter)"),
            us_fda=auth(False, note="Adequate control expected, no Pa value given"),
            eu_gmp_pics=auth(False, note="Not specified for non-sterile"),
            who_gmp=auth(True, min=5, max=20, note="5–20 Pa acceptable"),
            china_nmpa=auth(True, min=10, note="≥10 Pa clean vs non-clean"),
            japan_pmda=auth(True, min=10, max=15),
            industry=auth(True, min=10, max=15),
        )),
    ),
    dict(
        id="THR-011", linked_param_id="HVAC-009", parameter_name="Unidirectional Airflow (UDAF) Velocity",
        context="grade_a", unit="m/s", severity="Aligned",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, min=0.36, max=0.54),
            us_fda=auth(True, min=0.36, max=0.54, note="0.45 m/s ±20%"),
            eu_gmp_pics=auth(True, min=0.36, max=0.54, note="Guidance value"),
            who_gmp=auth(True, min=0.36, max=0.54),
            china_nmpa=auth(True, min=0.36, max=0.54),
            japan_pmda=auth(True, min=0.36, max=0.54, note="0.45 m/s ±20%"),
            industry=auth(True, min=0.36, max=0.54),
        )),
    ),
    dict(
        id="THR-012", linked_param_id="HVAC-008", parameter_name="HEPA Filter Efficiency",
        context="all", unit="% at 0.3µm", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, min=99.97, note="H13+ minimum"),
            us_fda=auth(True, min=99.97),
            eu_gmp_pics=auth(True, min=99.995, note="H14 required for Grade A/B terminal filters"),
            who_gmp=auth(True, min=99.97),
            china_nmpa=auth(True, min=99.995, note="H14 for Grade A/B"),
            japan_pmda=auth(True, min=99.97, note="Integrity tested"),
            industry=auth(True, min=99.97, note="H14 (99.995%) for A/B; H13 (99.97%) acceptable for C/D"),
        )),
    ),
    dict(
        # context="all": this is the only Recovery Time row in the source Threshold Library
        # (it's specifically about Grade B recovery, but visibility is already restricted to
        # Grade A/B rooms via PARAM_ROOM_FILTERS in app.js, so no room-context branch is needed
        # here — and resolveContext() has none for HVAC-010, so it must stay "all" to match).
        id="THR-013", linked_param_id="HVAC-010", parameter_name="Recovery Time (Grade B)",
        context="all", unit="minutes", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not formally specified (100:1 in 15–20 min is mentioned informally)"),
            us_fda=auth(False, note="Not specified; rapid recovery expected"),
            eu_gmp_pics=auth(True, max=20, note="Not specified formally; 15–20 min is the working guidance"),
            who_gmp=auth(True, max=20, note="15–20 min for 100-fold reduction"),
            china_nmpa=auth(True, max=20, note="15–20 min direct support"),
            japan_pmda=auth(True, max=20),
            industry=auth(True, max=20, note="15–20 min (100:1, at-rest→operational)"),
        )),
    ),
    dict(
        id="THR-014", linked_param_id="LGT-001", parameter_name="Illumination",
        context="general_processing", unit="lux", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Adequate lighting', no value"),
            us_fda=auth(False, note="Not specified"),
            eu_gmp_pics=auth(False, note="Not specified"),
            who_gmp=auth(False, note="Not specified"),
            china_nmpa=auth(False, note="Not specified"),
            japan_pmda=auth(False, note="Not specified"),
            industry=auth(True, min=300, max=500),
        )),
    ),
    dict(
        id="THR-015", linked_param_id="LGT-001", parameter_name="Illumination",
        context="filling_area", unit="lux", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Adequate lighting', no value"),
            us_fda=auth(False, note="Not specified"),
            eu_gmp_pics=auth(False, note="Not specified"),
            who_gmp=auth(False, note="Not specified"),
            china_nmpa=auth(False, note="Not specified"),
            japan_pmda=auth(False, note="Not specified"),
            industry=auth(True, min=500, max=750),
        )),
    ),
    dict(
        id="THR-016", linked_param_id="LGT-001", parameter_name="Illumination",
        context="inspection", unit="lux", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Well lit', no numeric value"),
            us_fda=auth(False, note="'Suitable conditions for inspection'"),
            eu_gmp_pics=auth(False, note="Implied adequate for inspection"),
            who_gmp=auth(False, note="'Adequate lighting'"),
            china_nmpa=auth(False, note="Not specified"),
            japan_pmda=auth(False, note="'Qualified lighting'"),
            industry=auth(True, min=750, note="750–2000+ lux for parenteral visual inspection"),
        )),
    ),
    dict(
        id="THR-017", linked_param_id="LGT-001", parameter_name="Illumination",
        context="storage", unit="lux", severity="Critical",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Adequate lighting'"),
            us_fda=auth(True, min=150, max=200, note="IESNA ~150–200 lux (guidance only)"),
            eu_gmp_pics=auth(False, note="'Adequate lighting'"),
            who_gmp=auth(True, min=100, max=200, note="Guidance"),
            china_nmpa=auth(True, min=150, note="150 lux (GB 50073)"),
            japan_pmda=auth(True, min=100, max=200),
            industry=auth(True, min=150, max=200),
        )),
    ),
    dict(
        id="THR-018", linked_param_id="UTIL-001", parameter_name="Compressed Air Quality Class",
        context="all", unit="ISO 8573-1 class", severity="Critical",
        source="regulatory_threshold_library", type="categorical",
        hierarchy=["Class 2", "Class 1.2.1", "Class 1"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Filtered/oil-free expected, but no ISO class mandated"),
            us_fda=auth(False, note="'Appropriate purity', no class given"),
            eu_gmp_pics=auth(True, category="Class 1.2.1", note="Class 1.2.1 or better"),
            who_gmp=auth(False, note="ISO 8573-1 referenced but no specific class given"),
            china_nmpa=auth(True, category="Class 2", note="Class 2 or better, oil-free"),
            japan_pmda=auth(False, note="'Validated gas quality', no class given"),
            industry=auth(True, category="Class 1.2.1", note="Product-contact air"),
        )),
    ),
    dict(
        id="THR-019", linked_param_id="WTR-002", parameter_name="Water Conductivity",
        context="all", unit="µS/cm", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Per pharmacopoeia, no explicit value"),
            us_fda=auth(True, max=1.3),
            eu_gmp_pics=auth(True, max=4.3, note="Ph.Eur. Stage 1"),
            who_gmp=auth(False, note="Per pharmacopoeia"),
            china_nmpa=auth(False, note="Per ChP"),
            japan_pmda=auth(False, note="Per JP"),
            industry=auth(True, max=4.3, note="≤1.3–4.3 µS/cm depending on stage/pharmacopoeia"),
        )),
    ),
    dict(
        id="THR-020", linked_param_id="WTR-003", parameter_name="Water TOC",
        context="all", unit="ppb", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Per pharmacopoeia"),
            us_fda=auth(True, max=500),
            eu_gmp_pics=auth(True, max=500),
            who_gmp=auth(False, note="Per pharmacopoeia"),
            china_nmpa=auth(False, note="Per ChP"),
            japan_pmda=auth(False, note="Per JP"),
            industry=auth(True, max=500),
        )),
    ),
    dict(
        id="THR-021", linked_param_id="WTR-004", parameter_name="Water Microbial Limit",
        context="all", unit="CFU/mL", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Per pharmacopoeia"),
            us_fda=auth(True, max=100, note="E. coli must also be absent"),
            eu_gmp_pics=auth(False, note="Per risk assessment"),
            who_gmp=auth(False, note="Per pharmacopoeia"),
            china_nmpa=auth(False, note="Per ChP"),
            japan_pmda=auth(False, note="Per JP"),
            industry=auth(True, max=100),
        )),
    ),
    dict(
        id="THR-022", linked_param_id="SHE-001", parameter_name="Noise Limit",
        context="all", unit="dBA", severity="Significant",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not specified (Factories Act general reference only)"),
            us_fda=auth(False, note="OSHA general industry standard, no pharma-specific figure"),
            eu_gmp_pics=auth(True, max=85, note="Common EU/UK threshold"),
            who_gmp=auth(False, note="References national regulations"),
            china_nmpa=auth(False, note="GBZ occupational limits, no single figure"),
            japan_pmda=auth(False, note="MHLW workplace standards, no single figure"),
            industry=auth(True, max=90, note="85 dBA (EU/UK) vs ~90 dBA elsewhere"),
        )),
    ),
    dict(
        id="THR-023", linked_param_id="DFS-003", parameter_name="MDF / Buccal Film Environmental Control (RH)",
        context="all", unit="% RH", severity="Critical",
        source="industry_guidance_notes",
        applies_to_specific_forms=["MDF", "Buccal Film"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="NOT ADDRESSED in Schedule M"),
            us_fda=auth(False, note="No India-specific figure; design to FDA/EU/WHO guidance"),
            eu_gmp_pics=auth(False),
            who_gmp=auth(False),
            china_nmpa=auth(False),
            japan_pmda=auth(False),
            industry=auth(True, max=35, note="RH ≤30–35% with tight temperature control"),
        )),
    ),
    # Industry-only dimensional bands (no authority anywhere gives a hard number).
    dict(
        id="THR-024", linked_param_id="DIM-004", parameter_name="Room Clear Height",
        context="all", unit="m", severity="Significant",
        source="industry_guidance_notes",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not specified"), us_fda=auth(False, note="Not specified"),
            eu_gmp_pics=auth(False, note="Not specified"), who_gmp=auth(False, note="Not specified"),
            china_nmpa=auth(False, note="Not specified"), japan_pmda=auth(False, note="Not specified"),
            industry=auth(True, min=2.7, max=6.0, note="Depends heavily on room/equipment — wide band"),
        )),
    ),
    dict(
        id="THR-025", linked_param_id="DIM-005", parameter_name="Corridor / Buffer Zone Width",
        context="all", unit="m", severity="Critical",
        source="industry_guidance_notes",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="No buffer-zone concept defined for OSD"), us_fda=auth(False),
            eu_gmp_pics=auth(False), who_gmp=auth(False), china_nmpa=auth(False), japan_pmda=auth(False),
            industry=auth(True, min=1.8, max=2.5),
        )),
    ),
    dict(
        id="THR-026", linked_param_id="DIM-006", parameter_name="Airlock Internal Dimension (smallest side)",
        context="all", unit="m", severity="Critical",
        source="industry_guidance_notes",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Airlock referenced, no dimensions given"), us_fda=auth(False),
            eu_gmp_pics=auth(False), who_gmp=auth(False), china_nmpa=auth(False), japan_pmda=auth(False),
            industry=auth(True, min=2.0, max=3.0, note="Per side, depends on PAL/MAL type"),
        )),
    ),
    dict(
        id="THR-027", linked_param_id="FLOW-003", parameter_name="Gowning Stages",
        context="all", unit="count", severity="Partial",
        source="regulatory_threshold_library",
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Change rooms required; stage count not detailed"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(True, min=2, note="Mandates two-stage gowning explicitly"),
            japan_pmda=auth(False),
            industry=auth(True, min=2, note="Two-stage gowning recommended"),
        )),
    ),
]

CATEGORICAL_THRESHOLDS = [
    dict(
        id="THR-028", linked_param_id="HVAC-007", parameter_name="Filtration Stage",
        context="all", severity="Aligned", source="regulatory_threshold_library", type="categorical",
        hierarchy=["G4", "G4+F8", "G4+F8+H13", "H14"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, category="G4+F8+H13", note="Explicitly specified for Ext.Prep recirculated air — Schedule M leads here"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(False), japan_pmda=auth(False),
            industry=auth(True, category="G4+F8+H13"),
        )),
    ),
    dict(
        id="THR-029", linked_param_id="FLOW-004", parameter_name="Personnel Flow Type",
        context="all", severity="Partial", source="regulatory_threshold_library", type="categorical",
        hierarchy=["Logical flow", "Unidirectional", "Strict unidirectional"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, category="Logical flow"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(True, category="Strict unidirectional", note="China mandates strict unidirectional flow"),
            japan_pmda=auth(False),
            industry=auth(True, category="Unidirectional"),
        )),
    ),
    dict(
        id="THR-030", linked_param_id="FLOW-005", parameter_name="Material Flow Segregation",
        context="all", severity="Partial", source="regulatory_threshold_library", type="categorical",
        hierarchy=["Basic segregation", "Dedicated de-boxing room", "Dedicated MAL"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(True, category="Basic segregation", note="Airlock required; no de-boxing detail"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(True, category="Dedicated de-boxing room", note="China requires a mandatory dedicated de-boxing room"),
            japan_pmda=auth(False),
            industry=auth(True, category="Dedicated de-boxing room"),
        )),
    ),
    dict(
        id="THR-031", linked_param_id="FLOW-002", parameter_name="Airlock Interlock Type",
        context="all", severity="Critical", source="industry_guidance_notes", type="categorical",
        hierarchy=["None", "Mechanical", "Electronic"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Not detailed"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(False), japan_pmda=auth(False),
            industry=auth(True, category="Mechanical", note="At minimum an interlocked airlock is expected"),
        )),
    ),
    dict(
        id="THR-032", linked_param_id="DFS-004", parameter_name="Barrier Technology Type",
        context="all", severity="Partial", source="regulatory_threshold_library", type="categorical",
        hierarchy=["Conventional", "RABS", "Isolator"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="Referenced via CCS, not mandated"),
            us_fda=auth(False), who_gmp=auth(False), china_nmpa=auth(False), japan_pmda=auth(False),
            eu_gmp_pics=auth(True, category="RABS", note="EU Annex 1 strongly prefers RABS/Isolator for new greenfield sterile lines — a preference, not an absolute mandate"),
            industry=auth(False),
        )),
    ),
    dict(
        id="THR-033", linked_param_id="UTIL-003", parameter_name="Steam Type Required",
        context="all", severity="Partial", source="regulatory_threshold_library", type="categorical",
        hierarchy=["Utility Steam", "Clean Steam", "Pure Steam (EN 285)"],
        applies_to_dosage_category=["sterile"],
        authorities=finalize_authorities(dict(
            schedule_m=auth(False, note="'Suitable quality' tested chemically/micro/endotoxin — no EN 285 reference"),
            us_fda=auth(False), eu_gmp_pics=auth(False), who_gmp=auth(False),
            china_nmpa=auth(False), japan_pmda=auth(False),
            industry=auth(True, category="Pure Steam (EN 285)", note="Expected for sterile applications"),
        )),
    ),
]

BOOLEAN_THRESHOLDS = [
    dict(id="THR-B01", linked_param_id="DFS-001", parameter_name="Dust Containment Required", severity="Partial",
         schedule_m_explicit=True, note="Required for dusting-powder/granulation/compression rooms; exhaust capacity specified qualitatively, not quantitatively."),
    dict(id="THR-B02", linked_param_id="DFS-002", parameter_name="Solvent Vapor Extraction Required", severity="Partial",
         schedule_m_explicit=True, note="Exhaust system required; no quantified extraction rate given."),
    dict(id="THR-B03", linked_param_id="DFS-005", parameter_name="Contamination Control Strategy (CCS) Document", severity="Partial",
         schedule_m_explicit=False, note="Concept introduced, not a mandatory structured document. EU Annex 1 §3 requires a formal, living CCS."),
    dict(id="THR-B04", linked_param_id="DFS-006", parameter_name="Container-Closure Integrity Test", severity="Partial",
         schedule_m_explicit=True, note="Required implicitly."),
    dict(id="THR-B05", linked_param_id="SHE-003", parameter_name="Dust Explosion Zone Classification (ATEX/NFPA)", severity="Critical",
         schedule_m_explicit=False, note="Not covered by Schedule M. Relevant to granulation, blending, compression, dusting-powder and solvent coating rooms."),
    dict(id="THR-B06", linked_param_id="SHE-006", parameter_name="Emergency Shower / Eyewash Provision", severity="Critical",
         schedule_m_explicit=False, note="Not explicit in Schedule M text."),
    dict(id="THR-B07", linked_param_id="WTR-006", parameter_name="Grey Water (Process Effluent) Treatment", severity="Critical",
         schedule_m_explicit=True, note="Defers to local SPCB/CPCB norms; no pharma-specific API-deactivation requirement (EU/China/Japan expect stricter, pharma-specific limits)."),
    dict(id="THR-B08", linked_param_id="WTR-007", parameter_name="Black Water (Sewage) Treatment", severity="Aligned",
         schedule_m_explicit=True, note="Per Factories Act 1948 and local norms — all authorities defer to local sewage regulation, rare full alignment."),
]

STRUCTURAL_FLAGS = [
    {
        "id": "SF-01",
        "trigger": {"specific_dosage_form_any_of": ["MDF (Mouth Dissolving Film)", "Buccal Film", "Implant"]},
        "message": "No Schedule M basis exists for this dosage form — design directly to FDA/EU/WHO guidance and document the rationale for regulatory review.",
    },
    {
        "id": "SF-02",
        "trigger": {"facility_development_stage_any_of": ["R&D Lab", "Pilot Plant"]},
        "message": "R&D/Pilot rooms are not aligned 1:1 with production rooms in Schedule M — this is a structural gap, not a parameter mismatch. Design to production-equivalent standards and document the rationale for regulatory review.",
    },
]

AUTHORITIES = [
    {"key": "schedule_m", "data_key": "schedule_m", "label": "India — Schedule M", "covered": True},
    {"key": "us_fda", "data_key": "us_fda", "label": "US FDA", "covered": True},
    {"key": "eu_gmp", "data_key": "eu_gmp_pics", "label": "EU-GMP", "covered": True,
     "shared_note": "Shares source data with PIC/S in this dataset (Threshold Library does not distinguish them)."},
    {"key": "uk_mhra", "data_key": None, "label": "UK MHRA", "covered": False},
    {"key": "pics", "data_key": "eu_gmp_pics", "label": "PIC/S", "covered": True,
     "shared_note": "Shares source data with EU-GMP in this dataset (Threshold Library does not distinguish them)."},
    {"key": "who_gmp", "data_key": "who_gmp", "label": "WHO GMP", "covered": True},
    {"key": "tga_australia", "data_key": None, "label": "TGA (Australia)", "covered": False},
    {"key": "china_nmpa", "data_key": "china_nmpa", "label": "NMPA (China)", "covered": True},
    {"key": "japan_pmda", "data_key": "japan_pmda", "label": "PMDA (Japan)", "covered": True},
    {"key": "sahpra", "data_key": None, "label": "SAHPRA (South Africa)", "covered": False},
    {"key": "sfda", "data_key": None, "label": "SFDA (Saudi Arabia)", "covered": False},
]


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    parameters = extract_parameters(wb)
    rooms = extract_rooms(wb)

    for t in NUMERIC_THRESHOLDS:
        t.setdefault("type", "numeric")
    thresholds = NUMERIC_THRESHOLDS + CATEGORICAL_THRESHOLDS

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "parameters.json"), "w") as f:
        json.dump(parameters, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "rooms.json"), "w") as f:
        json.dump(rooms, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "thresholds.json"), "w") as f:
        json.dump(thresholds, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "boolean_thresholds.json"), "w") as f:
        json.dump(BOOLEAN_THRESHOLDS, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "authorities.json"), "w") as f:
        json.dump(AUTHORITIES, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "structural_flags.json"), "w") as f:
        json.dump(STRUCTURAL_FLAGS, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(parameters)} parameters, {len(rooms)} rooms, "
          f"{len(thresholds)} scored thresholds, {len(BOOLEAN_THRESHOLDS)} boolean checks "
          f"to {OUT_DIR}")


if __name__ == "__main__":
    main()
