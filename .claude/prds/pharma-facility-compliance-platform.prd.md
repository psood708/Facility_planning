# Pharma Facility Compliance Platform

## Problem
Pharma facility planners, GMP consultants and QA/regulatory teams have no single tool that checks a facility design (rooms, areas, cleanroom grades) against a regulator's benchmarks. Today they cross-check each authority's guidance PDFs by hand and keep spreadsheets of room areas and grades, or they pay consultants for each target market. Gaps often surface only at inspection or late in design, when fixing them is most expensive.

## Evidence
- Problem identified first-hand by a co-founder with 20+ years of experience in pharma facility planning.
- Observed practice: manual PDF cross-checking, spreadsheets, and a consultant engaged per market.
- Assumption — the evidence so far comes from one expert. Needs validation via interviews and prototype sessions with 3–5 more planners or consultants.
- Market timing: the revised Schedule M is pushing Indian manufacturers to upgrade, and firms targeting US and EU exports need to check readiness for several authorities. Validate the size of this demand via pilot sign-ups.

## Users
- **Primary**: in-house facility and engineering planners at pharma manufacturers, and GMP consultants or design firms. They need this when designing a new plant, upgrading an existing one (for example under the revised Schedule M), or preparing to enter a new export market.
- **Secondary**: QA/regulatory staff preparing for inspections; management or investors assessing a plant before expansion.
- **Not for**: regulators or auditors issuing formal certification; HVAC or architectural engineers who need detailed engineering design tools.

## Hypothesis
We believe **a platform that checks a facility design against a chosen authority's benchmarks, then reports its gaps against other authorities with specific suggested changes**, will **cut the time and consultant cost of checking a facility's readiness for a market** for **pharma facility planners and GMP consultants**.
We'll know we're right when **a planner can go from entering a facility to a cross-authority gap report in under 1 hour (versus days today), and the domain expert plus 3 pilot users agree the gaps it finds match their expert review in at least 90% of cases.**

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Time from new project to finished gap report | < 1 hour | Timed pilot sessions |
| Agreement with expert review | ≥ 90% of reported gaps confirmed, < 10% missed | Domain expert + 3 pilot users review reports for real or reference facilities |
| Pilot users who would subscribe | TBD — needs validation via pilot pricing conversations | Post-pilot interviews |
| Repeat use | TBD — needs validation via analytics after launch | Saved projects re-opened per user per month |

## Scope
**MVP**
- User accounts with saved projects, so a planner can create, save, reopen and edit facility projects.
- The planner enters a facility as structured data: dosage form or product type (external preparations, OSD production, OSD R&D/pilot, sterile) and its rooms, each with area and cleanroom grade.
- Check against one authority the user picks, showing pass, fail or not covered for each requirement, with the source of each benchmark cited.
- Comparison across all authorities that have data: India Schedule M, US FDA, EU-GMP/PIC/S, WHO GMP, China NMPA, Japan PMDA.
- A gap report that clearly separates **mandatory requirements** from **recommendations**, and gives a specific suggested change for each gap, ranked by how many authorities the change satisfies.
- When the benchmark data changes, users are notified and their saved projects are re-checked. *(Milestone 2 delivers detection on reopen: a stale project shows its saved results read-only with "Re-evaluate with current data". Proactive notification and automatic re-checks are not built yet.)*
- User project data is kept until 6 months after its last edit, then flagged with in-app warnings and permanently deleted 30 days later (see Decisions).
- Export the gap report as a shareable document.
- Subscription access to the platform; billing details TBD.

**Out of scope**
- CAD or layout drawing and import. The facility is entered as structured data, which keeps the MVP focused on the compliance logic.
- Detailed HVAC, airflow or pressure checks. These belong in engineering tools and would greatly expand the benchmark data needed.
- UK MHRA, TGA (Australia), SAHPRA (South Africa) and SFDA (Saudi Arabia). No sourced benchmark data exists for them yet.
- Formal certification or legal compliance sign-off. All output is advisory, which limits liability.
- Team collaboration and shared multi-user workspaces. Single-user accounts are enough to test the hypothesis.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Trusted benchmark engine | The existing prototype's checks are verified against the domain expert's reference cases, and each result cites its source and is marked mandatory or recommended | pending | — |
| 2 | Accounts & saved projects | A planner can sign up, create a facility project, save it and come back to it | in-progress — built and tested against a local stack (2026-11-24); goes to complete once the hosted Supabase (Mumbai) + Vercel project is live with custom SMTP | [plan](../plans/milestone-2-accounts.md) |
| 3 | Single-authority compliance check | A planner picks an authority and sees pass, fail or not covered for each room and requirement | pending | — |
| 4 | Cross-authority gap report + suggestions | A planner sees how the facility performs across all covered authorities, with a specific suggested change for each gap | pending | — |
| 5 | Report export | A planner can export and share the gap report | pending | — |
| 6 | Subscription access | Access requires an active subscription; the pilot can convert to paid | pending | — |
| 7 | Pilot validation | The domain expert and 3+ pilot users run real facilities and the success metrics are measured | pending | — |

## Decisions (resolved 2026-11-23)
- **User project data retention:** 6 months.
- **Regulatory updates:** when the benchmark data changes, users are notified and their saved projects are re-checked automatically.
- **Conflicting or missing benchmarks:** when authorities conflict, or one gives no number (for example, Schedule M often gives no area in m²), the report falls back to international standards (e.g. ISO 14644, WHO GMP) and labels the fallback as such.
- **Ranking suggestions:** suggested changes are ranked by how many authorities they satisfy.

## Decisions (resolved 2026-11-24, Milestone 2)
- **Retention rule:** the clock is the project's last *edit* (opening doesn't count). 6 months after the last edit the project is flagged; 30 days later it is permanently deleted. An amber hint shows in the 30 days before flagging; a flagged project gets a red badge (date + days left), is sorted to the top, and shows a full-width banner when opened. "Keep this project" (or any save) restarts the clock.
- **Warning emails: not in Milestone 2.** Warnings are in-app only, so a user who doesn't sign in during the grace period loses the project without notice. This limitation is stated in the README.
- **Sign-in:** one-time email link only (no passwords); same response whether or not an account exists.
- **Hosting:** Supabase (Postgres + Auth, row level security) in Mumbai `ap-south-1`; static site on Vercel. Production needs custom SMTP: Supabase's built-in sender only reaches the organization's own team.
- **Saved results:** a project stores inputs, a compact results snapshot (ids + statuses), and the data hash and engine version. If either changed, reopening shows the saved results read-only with a Re-evaluate button.

## Open Questions
- [x] Retention detail: 6 months from the last edit; in-app warnings before and after flagging; "Keep this project" extends; deleted 30 days after flagging (2026-11-24). Export arrives with Milestone 5; warning emails are still open (see next item).
- [ ] Warning emails before deletion: which sender (Supabase Edge Function on a cron, or a mail provider) and how many reminders?
- [ ] Who maintains the benchmark data, and how often is it refreshed? TBD — needs validation with the domain expert.
- [ ] Which international standards are the fallback, and in what order? TBD — needs validation with the domain expert.
- [ ] Subscription details: tiers, pricing, per-seat or per-organization, trial or pilot terms. TBD — needs validation via pilot pricing conversations.
- [ ] Data privacy expectations for confidential facility designs, such as hosting region and access controls. TBD — needs validation with pilot users.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Benchmark data is wrong or out of date, so users get wrong gap findings | Medium | High | Cite the source on every result; expert reviews every data update; show the data date on reports; notify users and re-check saved projects on update |
| Users lose project data at the 6-month retention limit | Medium | Medium | In-app hint 30 days before flagging, red badge + banner during the 30-day grace, "Keep this project". Gap: no warning emails yet, so users who don't sign in aren't told; export comes with Milestone 5 |
| Users treat advisory output as regulatory sign-off | Medium | High | Clear advisory disclaimer on the platform and on exported reports |
| Validation relies on one expert's view of the problem | Medium | Medium | Milestone 7 pilot with 3+ outside users before scaling |
| Overlap with existing patents on rule checking that varies by jurisdiction (e.g. US11797733, US12462080, US12197829, from the preliminary USPTO scan on 2026-11-23) | Low–Medium | Medium | Patent attorney review before commercial launch |
| Planners find entering rooms by hand too slow compared with their CAD workflow | Medium | Medium | Measure entry time in the pilot; consider CAD import after the MVP |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
