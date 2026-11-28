# LOADCALC audit and roadmap

Audit date: 2026-11-25, on commit `0f420e5`. I clicked through the built app
in a browser using both bundled datasets: the 20-element "3D Demo" and the
1885S benchmark `Sjson.json`, which has 279 entities and 43 pipes. I also read
the code.

## Verdict

The app is **stable but cannot produce a Load Calc result out of the box**.
- **Stable:** it boots cleanly with no console errors, and 312 tests pass.
- **Not usable yet:** neither bundled dataset gets through the 8-step Load Calc
  workflow to Results. The main gap is master data that doesn't ship with the
  app, not broken code.
- **3D Edit:** it opens, selects and inspects models, but I could not finish an
  edit-and-commit round trip in the audit.

## Audit findings

Severity: **P0** blocks the core use, **P1** misleads or confuses users,
**P2** is technical debt.

### Load Calc (first priority)

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| L1 | P0 | **No dataset can reach Results.** Every pipe needs a Line List row to find its piping class, and no Line List ships with the app. | Benchmark: `Generate proposals from approved masters` → "No approved-master proposal could be derived for 43 pipe(s). 43 blocker(s): LOAD_CALC_MASTER_LINE_UNRESOLVED" (`src/workspace/load-calc-master-candidates.js:83`). |
| L2 | P0 | Input Check stays blocked even after the master step. | Demo: 9 blockers, including MASTER_NOT_READY, ACTIVE_SOURCE_HASH_MISSING, MISSING_VALUE and STALE_SOURCE_HASH. "14 components still need mass evidence". "1 of 15 governed entities resolved". |
| L3 | P1 | **Run claims "ONE-CLICK" while inputs are blocked.** Pressing it shows an internal message and leaves the page where it was. | Message: "A product screening snapshot requires a fully READY Common Input checker report." |
| L4 | P1 | Step counts and states disagree. | Step 2's card says "8 BLOCKERS" while the panel lists 10 findings. Four steps say "NEXT" at once. Step 5 says "AFTER MASTERS" while step 4 is still "NEXT". The Input Check page is titled "STEP 5", but the navigation shows it as step 6. |
| L5 | P1 | The demo dataset is the 3D Edit topology demo, which is broken on purpose. Using it for Load Calc gives 10 HIGH/MEDIUM findings on first open. | Some may be false positives: two CENTERLINE_CLASH findings say "Edge centerlines are 0.00mm apart" (not verified). |
| L6 | P1 | Internal vocabulary is shown to users. | Examples: `BLOCKED_NOT_READY`, `EXACT_APPROVED_MASTER`, `fnv1a64:` receipts, "Phase 3 · Common preprocessing", authority-order prose. A banner saying "Project Data changed. Nothing is sealed…" appears on a fresh load. |
| L7 | P1 | When "Generate proposals" fails, it lists blocker codes but doesn't say what to do (load a Line List, or map line → class). | Same message as L1. |
| L8 | P2 | Engineering data is hard-coded in JS. | `DN_TO_OD_MM` table in `load-calc-master-candidates.js`. A 606 kB weight master inlined in `default-weight-master-rows.js`, which loads at startup. |
| L9 | P2 | At least five support-load computations overlap, and which one "Run" uses isn't written down anywhere. | `support-load-screening`, `vertical-beam-solver`, `model-calculation-package`, empirical V2/V3 COG gravity methods (`engineering-loads/`), and the CII port's `supportLoadEngine.js`. |
| L10 | P2 | Some files are very large. | `load-calc-consumer-controller.js` 1,130 lines; `empirical-beam-contact-runtime.js` 1,473; `support-load-distribution-v3.js` 1,201; `non-fea-common-checker/index.js` 984. |
| L11 | P2 | No test runs the whole pipeline (dataset → masters → enrichment → Run → Results). Tests cover contracts and individual steps. | 312 tests pass. Only `load-calc-current-common-input-run-routing-check.mjs` touches the run path. |

### 3D Edit

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| E1 | P1 | On the benchmark model, the status bar shows **"Basis: incomplete"** and command notes say BLOCKED. Elbows are "read-only in the current implementation slice". | 169 nodes, 127 edges, 139 supports. Note: "endpoint … must be graph-open on exactly edge …". |
| E2 | P1 | Could not stage an edit in the audit. With an edge selected, *Move +Z* left the draft at "Clean · 0 edits", and selection jumped to another node. | It is not verified whether a 3D Edit commit updates the Load Calc inputs. |
| E3 | P1 | The DOM holds **1,533 buttons**, with controls duplicated (8× "Move +Z"). This hurts accessibility and makes the UI hard to test or automate. | Counted in the browser. |
| E4 | P2 | The Engineering table opens as an overlay covering the viewport, so you can't see what you selected. | Screenshot during the audit. |
| E5 | P2 | The 3D Edit chunk is 1.15 MB, loaded lazily (see `vite.config.js`). | Accepted for now. |

### Workspace, repo and infrastructure

| # | Sev | Finding |
| --- | --- | --- |
| R1 | P0 | **The public repo has no LICENSE**, and upstream has none either. Legally that means all rights reserved. Choose a license, or make the repo private. **Decision 2026-11-25:** stays public with no license. |
| R2 | P1 | `xlsx@0.18.5` has a high-severity advisory (`npm audit`). SheetJS no longer publishes fixes to npm, so the fixed version has to be installed from SheetJS's own CDN. |
| R3 | P1 | No CI. `npm test` and `npm run build` don't run on push or PR. |
| R4 | P2 | No linter or formatter config. Line endings are mixed (upstream CRLF, my edits LF). |
| R5 | P2 | Some names are misleading: `lfea-svg/` is the 2D sketcher's scene builder, and "empirical" is the Load Calc engine family. |
| R6 | P2 | Re-syncing from upstream is manual (`scripts/trace-deps.mjs` + copy). |

## Roadmap

Each phase ends with something you can demo. The order follows "Load Calc first".

### Phase 0 — Hygiene (½ day)
- R1: add a LICENSE (or make the repo private).
- R3: GitHub Actions running `npm ci && npm test && npm run build` on push and PR.
- R2: move `xlsx` to the SheetJS CDN build (0.20.x) and re-run the import/export tests.
- R4: `.editorconfig` + `.gitattributes` (LF), and ESLint using upstream's flat config.

**Done when:** CI passes on `main`, `npm audit` is clean, and the LICENSE is present.

**Status (2026-11-25):** done. The owner chose to keep the repo public
without a license. `xlsx` is 0.20.3 from the SheetJS CDN, `vite` is 7.3.8, and `npm audit`
reports 0 vulnerabilities. CI (`.github/workflows/ci.yml`) runs audit, lint,
tests and build. ESLint 9 uses upstream's rules; it reports 0 errors and 39
`no-unused-vars` warnings, left for later.

### Phase 1 — Load Calc golden path (1–2 weeks) · fixes L1, L2, L3, L5, L11
1. Ship a **sample master set** for the 1885S benchmark under `public/master-data/`: a Line List (line → piping class, material), plus the piping-class mapping and Project Data values the Input Check asks for.
2. Add a **"Load sample project"** button that loads `Sjson.json` and those masters in one step.
3. Write down which Load Calc pipeline "Run" executes, and which engine it uses (L9).
4. **Gate Run on Input Check.** Show "Blocked: N issues — open Input Check" instead of ONE-CLICK, and turn the internal error into a sentence a user can act on.
5. Add an **end-to-end test**: sample project → masters → auto-enrichment → Input Check READY → Run → Results package with support loads. Include golden numbers for at least 5 supports, checked against the upstream 1885S benchmark evidence.

**Progress (2026-11-25), step 1 — Line List.** `public/master-data/sample-1885s-line-list.csv`
holds the 5 lines in the benchmark (S8810101, S8810103, S8810111, S8810112,
S8811951). The class (91261M7) and material (CSS) come from the model's own
line names and from the upstream qualification record for S8811951
(`1885s-webgl-load-benchmark.json`). Uploading it in the browser takes the
benchmark from 0 to 129 accepted proposals. Applying the 26 catalogue weights
with a clear winner brings Input Check to 79/127 entities resolved. Follow-up
fixes the same day:

| Gap | Status |
| --- | --- |
| Operating fluid density, 4 lines | **Fixed.** Owner-approved fallback `DEFAULT: 1000 kg/m³` in Project Data; Load Calc proposes it (as PROJECT_CONFIGURED_DEFAULT) when a Line List row has no density. S8811951 keeps 67 kg/m³ from the sample Line List. |
| Project Data `STALE_SOURCE_HASH` | **Fixed.** The bundled profile now points at the sample Line List. A Line List the user loads is now re-bound in Project Data (before, only bundled masters were). Locally, `Sjson.json` also read as stale because Git checked it out with CRLF; it is now LF, matching the committed file. |
| `pipeSectionProperties` `MISSING_VALUE` | **Fixed.** An approved empty map is accepted, as it already was for insulation densities and component weights. Section sizes come from accepted per-entity master proposals. |
| Fitting weights, 5 items | **Placeholders (owner-approved 2026-11-26).** Closest 900# catalogue items, labelled SAMPLE ASSUMPTION; listed in `public/master-data/sample-1885s-placeholder-weights.json`. With them, Input Check passes with 0 blockers. |
| Run authorization (upstream bug) | **Fixed.** The run decision sorts its method IDs but the coordinator's receipt keeps registry order; an exact JSON compare made every Run fail with "receipt that does not bind the system Run authorization". Now compared as sets. |
| Run error message | **Improved.** "selectedMethod must be a non-empty trimmed string" now says why no gravity method qualified and names the component. |
| Zero-length branch B5 (pressure gauge 88-PG-10052) | **Fixed.** A branch made only of zero-length point items now attaches to the one READY route on the same line that it touches; the gauge acts at the B4 blind flange. Test: `tests/route-partition-point-only-branch.test.mjs`. |
| Configured-default unit spelling | **Fixed.** Project Data writes `kg/m³`, common-enriched fields name `kg/m3`; the overlay now compares them as one unit. |
| Elbow / lumped CoG | **Fixed.** The mass projection now applies the existing product default PD-COMPONENT-COG-FALLBACK (geometric midpoint) when no CoG evidence exists, and records `applicationPointBasis` per row. |
| Zero-mass point with no position | **Fixed.** Mass ledger treats a 0 kg point (e.g. gasket) without an application point as zero moment; a non-zero one fails with a coded error. |
| Model length unit + support attachment | **Fixed.** The shared model reads mm from the SJSON POSI text when the package declares no unit (only if every POSI agrees). That exposed two attachment bugs, both fixed: a straight component's reference target snapped supports to its centre instead of projecting onto its centreline; and source order picked elbow 23 for B1 supports that sit on the TAIL pipe (indexed later); exact containment now corrects an order-based pick. All 139 supports attach within 0.5 mm; 37 distinct sites kept. Test: `tests/load-calc-run-path-fixes.test.mjs`. |
| Insulation thickness | **Sample assumption.** Project Data configured default `1885S_INSULATION_THICKNESS_SAMPLE_ZERO` = 0 mm, labelled SAMPLE ASSUMPTION. Benchmark Run now completes: EMPTY case 87,618 N evaluated, 86,617 N allocated (98.9 %), 1,001 N unallocated, 81 exceptions, CALCULATED_WITH_EXCEPTIONS. Exceptions and 0 N sites not yet reviewed; numbers not yet hand-checked. |

#### Accuracy target: 90 % (owner, 2026-11-26)

Read as each support's vertical load within ~10 % of a stiffness-based reference. Independent check, `benchmarks/checks/route-b2-continuous-beam-check.mjs` (route S8811951/B2, EMPTY, continuous beam with uniform EI and rigid pinned supports):

| Support ch (mm) | V2 (N) | Continuous beam, lift-off released (N) | V2 vs beam |
| ---: | ---: | ---: | ---: |
| 1,493 | 3,792 | 3,726 | +1.8 % |
| 4,003 | 3,484 | 2,457 | +41.8 % |
| 5,837 | 7,014 | 8,748 | −19.8 % |
| 9,123 | 3,840 | 3,407 | +12.7 % |
| 11,259 | 1,859 | 0 (lifts off) | — |
| 14,900 | 5,673 | 7,323 | −22.5 % |

**Conclusion: V2 tributary cannot meet 90 %.** Needed, in order of effect: (1) continuity between spans with one-way (lift-off) supports; (2) real insulation thickness (0 mm sample under-weights insulated lines by roughly 10–20 %); (3) branch load transfer — done 2026-11-26. (Distributed pipe mass was already in place.) A reference result (e.g. CAESAR II) for 1885S is needed to measure the target.

**Owner decision (2026-11-26): no beam solver.** `src/core/vertical-beam-solver` and any whole-system stiffness solve are LFEA scope. Improve the empirical calculation instead. Empirical options tested on B2 (`benchmarks/checks/route-b2-empirical-methods.mjs`):

| Method | 1,493 | 4,003 | 5,837 | 9,123 | 11,259 | 14,900 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A: lever rule, overhang moment carried by the end span | +8.3 % | +31.9 % | −19.8 % | +12.7 % | 145 N (beam 0) | +0.9 % |
| B: three-moment hand calc (Clapeyron) + lift-off | +0.2 % | −0.8 % | +0.1 % | 0.0 % | 0 | 0.0 % |

Core code for both is in `src/core/empirical-continuous-span/`. Guide and line stop loads: [docs/guide-line-stop-load-plan.md](docs/guide-line-stop-load-plan.md), formulas in `src/core/empirical-restraint-loads/`. Full handover: [HANDOVER.md](HANDOVER.md).

#### Option B in the Run (owner-approved as empirical, 2026-11-26)

The Run now uses **`CONTINUOUS_SPAN_THREE_MOMENT_V1`** (Option B) by default: Project Data `gravityMethod = AUTO` selects it wherever V2 used to be selected. V2 stays selectable by setting `loadCalculation.gravityMethod` to `CHAINAGE_TRIBUTARY_SPAN_V2`. V3_COG is still chosen when every component has a qualified CoG, because B uses V2's midpoint application points.

How it works, per route and load case:
- **One solve.** All the route's loads (including branch loads handed over at an HREF fitting) go into one three-moment solve with lift-off; each load's share is then written to the contribution ledger. The shares add up to each load exactly.
- **Plan length.** Spans are measured along the route's horizontal (plan) length, not along the pipe. A vertical riser therefore has zero span length: its weight acts as a point load where it meets the horizontal run, and a support on a riser acts at that point. Horizontal elbows keep their arc length (the same assumption as the beam check).
- **Fallback.** A route with fewer than two bearing supports keeps the V2 bookkeeping (overhang force + cantilever moment demand).
- **Labels.** Weight results are ACCURATE (owner decision). Exceptions: `SUPPORT_LIFTOFF_RELEASED` per released support; `CONTINUOUS_SPAN_UNRESOLVED_TRIBUTARY_FALLBACK` if a multi-support route cannot be resolved (not seen on 1885S).
- **Known limits.** Uniform EI along a route (no per-span size change); the riser joint is treated as rigid (its own bending flexibility is ignored); torsion through horizontal elbows is ignored; nozzles carry nothing, so a riser at a nozzle loads the first support.

Checks: `tests/support-load-three-moment.test.mjs` (B2 within 1 % of the beam; textbook two-span cases with a riser, an end riser by statics, a branch load inside the host solve; V2 still selectable). A separate hand check (unit-load / virtual-work force method, written independently of the solver) agrees with B on B2 within 0.02 %.

**1885S browser Run with B (2026-11-26):** EMPTY / OPE / HYD applied 87.6 / 100.4 / 104.0 kN (unchanged), equilibrium PASSED, coverage 100 %, unallocated 0. Exceptions per case: 37 × OVERHANG_CANTILEVER_TRANSFER (single-support routes only, was 83), 2 × BRANCH_LOAD_TRANSFERRED_TO_HOST, 1 × SUPPORT_LIFTOFF_RELEASED (S8811951/B2 at 11,260 mm).

Route S8811951/B2 in the Run vs the independent beam (EMPTY):

| Support ch (mm) | 1,493 | 4,003 | 5,837 | 9,123 | 11,260 | 14,900 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Beam reference (N) | 3,726 | 2,457 | 8,748 | 3,407 | 0 | 7,323 |
| B in the Run (N) | 3,733 | 2,439 | 8,753 | 3,418 | 0 | 7,316 |
| B vs beam | +0.2 % | −0.7 % | +0.1 % | +0.3 % | 0 | −0.1 % |

Every bearing support, vertical force in N. "EMPTY V2" is V2 recomputed from the same Run's loads and supports (it reproduces the earlier V2 Run on B2 exactly). The 5 points that are not supports carry 0 N and are not listed. OPE = HYD on most lines because both use the 1000 kg/m³ fallback; S8811951 uses 67 kg/m³ for OPE.

| Route | Support ch (mm) | Tag | EMPTY V2 | EMPTY B | B vs V2 | OPE B | HYD B |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10″-S8810101/B1 | 2,721 | PS-12059 | 6,805 | 6,787 | −0.3 % | 8,234 | 8,234 |
| 10″-S8810101/B1 | 5,346 | PS-12060 | 5,552 | 5,570 | +0.3 % | 6,859 | 6,859 |
| 10″-S8810101/B4 | 100 | =1006649732/51478 | 329 | 329 | +0.0 % | 330 | 330 |
| 10″-S8810101/B6 | 850 | PS-12171 | 2,845 | 2,845 | +0.0 % | 3,623 | 3,623 |
| 10″-S8810101/B7 | 642 | PS-12166 | 3,384 | 3,384 | +0.0 % | 4,109 | 4,109 |
| 6″-S8810111/B1 | 1,628 | PS-12243 | 2,006 | 2,166 | +8.0 % | 2,705 | 2,705 |
| 6″-S8810111/B1 | 6,207 | PS-12263 | 1,948 | 1,754 | −10.0 % | 2,154 | 2,154 |
| 6″-S8810111/B1 | 9,234 | PS-12242 | 2,041 | 1,935 | −5.2 % | 2,503 | 2,503 |
| 6″-S8810111/B1 | 13,884 | PS-12240 | 2,501 | 2,871 | +14.8 % | 3,680 | 3,680 |
| 6″-S8810111/B1 | 18,640 | PS-12061 | 1,698 | 1,468 | −13.5 % | 1,883 | 1,883 |
| 6″-S8810111/B2 | 845 | PS-12297 * | 0 | 824 | new REST | 1,004 | 1,004 |
| 6″-S8810111/B2 | 2,891 | PS-12165 * | 2,726 | 1,616 | −40.7 % | 2,088 | 2,088 |
| 6″-S8810111/B2 | 7,505 | PS-12169 * | 2,978 | 3,306 | +11.0 % | 4,241 | 4,241 |
| 6″-S8810111/B2 | 14,091 | PS-12170 * | 2,512 | 2,647 | +5.4 % | 3,378 | 3,378 |
| 6″-S8810111/B2 | 17,098 | PS-12156 * | 1,835 | 1,658 | −9.6 % | 2,043 | 2,043 |
| 6″-S8810112/B6 | 2,530 | PS-12228 | 2,148 | 1,888 | −12.1 % | 2,465 | 2,465 |
| 6″-S8810112/B6 | 5,691 | PS-12034 | 2,303 | 2,563 | +11.3 % | 3,043 | 3,043 |
| 6″-S8811951/B2 | 1,493 | PS-12244 | 3,792 | 3,733 | −1.6 % | 3,756 | 4,063 |
| 6″-S8811951/B2 | 4,003 | PS-12246 | 3,484 | 2,439 | −30.0 % | 2,453 | 2,642 |
| 6″-S8811951/B2 | 5,837 | PS-12247 | 7,014 | 8,753 | +24.8 % | 8,772 | 9,031 |
| 6″-S8811951/B2 | 9,123 | PS-12248 | 3,840 | 3,418 | −11.0 % | 3,447 | 3,854 |
| 6″-S8811951/B2 | 11,260 | PS-12249 | 1,858 | 0 | lifts off | 0 | 0 |
| 6″-S8811951/B2 | 14,900 | PS-12250 | 5,673 | 7,316 | +29.0 % | 7,324 | 7,437 |
| 6″-S8811951/B7 | 754 | PS-12231 | 1,901 | 1,939 | +2.0 % | 1,960 | 2,249 |
| 6″-S8811951/B7 | 4,001 | PS-12311 | 1,590 | 1,449 | −8.9 % | 1,475 | 1,849 |
| 6″-S8811951/B7 | 6,281 | PS-12321 | 1,731 | 1,784 | +3.1 % | 1,816 | 2,262 |
| 6″-S8811951/B7 | 10,616 | PS-12295 | 1,996 | 2,284 | +14.4 % | 2,325 | 2,898 |
| 6″-S8811951/B7 | 13,824 | PS-12267 | 1,542 | 828 | −46.3 % | 851 | 1,159 |
| 6″-S8811951/B7 | 16,524 | PS-12268 | 2,027 | 2,502 | +23.4 % | 2,531 | 2,941 |
| 8″-S8810103/B1 | 2,825 | PS-12228 | 3,725 | 3,334 | −10.5 % | 4,237 | 4,237 |
| 8″-S8810103/B1 | 5,985 | PS-12034 | 3,837 | 4,228 | +10.2 % | 5,076 | 5,076 |

\* S8810111/B2 rows are after the owner's support-type decisions below (PS-12297 = REST); "EMPTY V2" there is the earlier V2 Run, without PS-12297. Route total is unchanged (10,051 N EMPTY).

Only B2 has an independent reference. The other routes' B numbers are not yet checked against a stiffness reference; a CAESAR II (or similar) run for 1885S is still needed to measure the 90 % target on every support. Insulation is still the 0 mm SAMPLE ASSUMPTION.

#### Support restraint table (guide / line stop plan, step 1, 2026-11-26)

`src/workspace/support-sites/support-restraint-table.js` builds one row per support site: type code (R, R+G, R+LS, R+G+LS, NONE), restrained directions (vertical up only with lift-off; axial and lateral relative to the pipe at the site), friction directions with μ, gap, pipe direction and chainage, and whether the type came from the source or an owner decision. A site with an unknown type is BLOCKED, never treated as a REST. Print it: `node benchmarks/checks/1885s-restraint-table.mjs` (`--json` for the full rows). Test: `tests/support-restraint-table.test.mjs`.

Owner decisions (2026-11-26), stored in Project Data with that evidence:
- **PS-12297 = REST** (`topology.supportTypeOverridesByTag`, a new optional field used only where the source type is blank). It only has a frame part (TYPE-108, FT17-7.6). It now carries 824 N EMPTY on S8810111/B2.
- **PS-12248 is one R+G+LS support.** Its line stop part sat 0.205 mm from its rest/guide parts, so it was a separate site at 0 N. The support grouping tolerance is now 1 mm (was 0.1 mm); the next-closest pair of separate supports is 571 mm apart, so nothing else merges. 1885S now has 36 support sites (was 37).
- **5 points are NONE (not supports):** bare ATTA-20 =1006649732/51465, bare ATTA-150 =1006649732/51422 and =1006649732/51254, PENE-150 floor openings =1006657924/39580 and =1006649732/51378.

1885S result: 19 R, 6 R+LS, 1 R+G, 5 R+G+LS, 5 NONE, 0 blocked; every support sits on horizontal pipe. μ is the 0.3 default everywhere (which supports have PTFE plates is still unknown); gaps are the 0 mm default. Browser Run after the decisions: equilibrium PASSED, coverage 100 % in EMPTY / OPE / HYD, same applied loads.

**Restraints review screen (2026-11-28):** the Load Calc **Restraints** tab now opens with the restraint table (`src/workspace/support-sites/support-restraint-review-view.js`).
- **What it shows**, one row per support site: tag, line, X/Y/Z, type code, what it holds (vertical / along / across), friction directions and μ, gap, pipe orientation, where the type came from (model or owner decision) and status. Blocked supports are named.
- **Editing:** a support whose parts all have a blank SUPPORT_TYPE in the model gets a type picker (REST / GUIDE / LINESTOP / NONE). "Save support types" writes `topology.supportTypeOverridesByTag` as an approved owner decision, adding the dated change to its evidence. Types from the model are shown, not edited.
- **Model rebuild:** `topology.supportTypeOverridesByTag` and `topology.supportTypeCapabilities` are now in the support-model rebuild basis (`engineering-model-basis.js`), so a saved type rebuilds the support-site model. As with any Project Data change, the sealed input and the Run go stale.
- **Blank count:** `blankTypePartCount` counts parts blank in the source model, including those typed since by an owner decision, so they stay editable.
- **Browser check, 1885S:** 36 sites (19 R, 6 R+LS, 1 R+G, 5 R+G+LS, 5 NONE) and 6 pickers (PS-12297 and the 5 ATTA / PENE points). Round trip PS-12297 REST → NONE → REST: Project Data, the evidence and the support model followed each time.
- Tests: `tests/support-restraint-review.test.mjs`, plus a rebuild test in `tests/engineering-model-controller-dataset-guard.test.mjs`.

#### Friction loads (guide / line stop plan, step 3, 2026-11-27)

`src/workspace/support-sites/support-friction-loads.js`: **design friction = μ × N_OPE** at each sliding support, in each horizontal direction the restraint table leaves free (R: along or across the pipe; R+G: along; R+LS: across; R+G+LS: none). It is the most friction can be in any one direction; along and across are alternatives (their vector sum is at most μN). Label ACCURATE (owner decision), so it is only as good as the vertical result and μ. Shown on the Results page in the OPE table (columns Type, Friction, Friction acts). Test: `tests/support-friction-loads.test.mjs`.

Movement-based friction (zero where the pipe does not move) is reported as 0 while every operating temperature equals installation (21 °C now); with real temperatures it needs leg growth and neutral points (steps 2 and 4) and shows as not built.

1885S OPE (browser Run 2026-11-27): 25 sliding supports, total design friction 24,073 N; equilibrium PASSED and coverage 100 % unchanged. Hand checks: PS-12059 R 0.3 × 8,234 = 2,470 N; PS-12242 R+G 751 N along the pipe; PS-12243 R+LS 811 N across; PS-12060 R+G+LS 0 N; lifted-off PS-12249 0 N. μ is the 0.3 default everywhere until PTFE plates are known.

#### Line stop axial loads, friction part (guide / line stop plan, steps 2 and 4, 2026-11-27)

- `src/workspace/routes/route-legs.js` splits each route into straight legs. A leg runs through flanges, valves, reducers and the run of a tee, and ends at an elbow, a bend or any change of direction (sloped offsets included). "On one line" means within `topology.portMatchToleranceMm` (1 mm for 1885S). 1885S: 47 legs, 33 straight.
- `src/workspace/support-sites/support-line-stop-loads.js`: for each line stop, the axial friction on each side along its own leg, from the stop to the leg end or the next axial stop. **Design axial = the larger side**, because one side may not slide (for example on start-up). The net value (|start − end|, only if both sides slide fully) is shown too. Label ACCURATE.
- Friction beyond an elbow acts along the next leg. It reaches the stop only by bending the elbow, which is the thermal push (SCREENING, not built).
- Two stops on one leg raise the design finding `TWO_AXIAL_STOPS_ON_ONE_LEG` (none in 1885S).
- An unknown support or a missing vertical result on a held side blocks that stop.
- Shown on the Results page under the OPE table. Test: `tests/support-line-stop-loads.test.mjs`.

1885S OPE (browser Run 2026-11-27), μ 0.3; equilibrium PASSED, coverage 100 %:

| Line stop | Type | Leg (mm) | Start side (N) | End side (N) | Design axial (N) |
| --- | --- | ---: | ---: | ---: | ---: |
| PS-12248 | R+G+LS | 15,732 (through two eccentric reducers) | 4,494 (3 rests) | 2,197 (PS-12250; PS-12249 lifted off) | 4,494 |
| PS-12060 | R+G+LS | 5,497 | 2,470 | 0 | 2,470 |
| PS-12240 | R+LS | 13,792 | 1,397 (incl. guide PS-12242) | 565 | 1,397 |
| PS-12034 (8″ S8810103) | R+LS | 5,573 | 1,271 | 0 | 1,271 |
| PS-12169 | R+G+LS | 14,642 | 928 | 1,013 | 1,013 |
| PS-12034 (6″ S8810112) | R+G+LS | 5,594 | 739 | 0 | 739 |
| PS-12295 | R+LS | 7,034 | 545 | 0 | 545 |
| PS-12231 | R+LS | 5,521 | 0 | 443 | 443 |
| PS-12268 | R+G+LS | 4,844 | 255 | 0 | 255 |
| PS-12243 | R+LS | 2,142 | 0 | 0 | 0 |
| PS-12166 | R+LS | 1,776 | 0 | 0 | 0 |

Hand checks: PS-12248 (8,772 + 2,453 + 3,756) × 0.3 = 4,494 N; PS-12240 (2,503 + 2,154) × 0.3 = 1,397 N and 1,883 × 0.3 = 565 N.

**Shallow offsets (owner decision 2026-11-27):** a sloped offset of at most `topology.legOffsetMaxAngleDeg` = 30° between two legs running the same way counts as straight pipe for line stop loads.
- `route-legs.js` gives these as `axialRuns`. An elbow counts at its turn angle (twice its chord), so a pair of 45° elbows is a 45° step and is not joined. An unset or unapproved angle joins nothing.
- 1885S: only S8811951/B2 joins. The two "steps" are **6″ × 3″ eccentric reducers** (146 mm long; centreline step (168.3 − 88.9)/2 = 40 mm, chord 15.8°) around a 3″ instrument run at 10,350–15,760 mm. (Corrected 2026-11-27: first described as sloped pipe.) Axial load passes straight through a reducer.
- Result: PS-12248's design load is unchanged at 4,494 N; its net value goes from 4,494 N to 2,297 N.
- Why it matters for thermal: stopping at the reducer would miss 84 % of the growth toward the far elbow (1,081 mm instead of 6,933 mm of pipe).
- Possible follow-up: treat any reducer as in-line whatever its eccentricity, independent of the angle setting.

#### Guide lateral loads (guide / line stop plan, step 7, 2026-11-27)

`src/workspace/support-sites/support-guide-lateral-loads.js`, label **SCREENING** (two bounds). Guided cantilever (Kellogg):
- At each end of a guide's straight run that turns at an elbow, the run past the elbow grows towards it: δ = α·ΔT·Lg. Lg runs from that run's nearest line stop to the elbow, or is the whole run when it has no stop (an upper value).
- Only the part of δ across the guided run counts (horizontal, perpendicular), Δ = δ·|cos|. A riser past the elbow grows vertically and loads the rests, not the guide.
- The FIRST guide from the elbow takes it, over L = guide to elbow corner (tangent point + R·tan(θ/2), taken from the elbow chord). Guides further away are shown as shielded.
- **Lower = 3·E·I·Δ/L³** (elbow free to rotate), **upper = 12·E·I·Δ/L³** (held).
- E and α come from `thermoMechanicalBasis.materialElasticProperties` (1885S: 203,000 MPa, 1.17×10⁻⁵ /°C); ΔT per line from `operatingTemperaturesC` (line key, else DEFAULT) minus installation.
- I comes from the pipe between the guide and the elbow: OD and wall from the sealed input (master data), else from the Run's ledger. With a reducer in that stretch, the lower bound uses the smaller I and the upper the larger.
- "Guide too close to the elbow": upper bound above `restraintPolicy.guideLateralCapacityN` (DEFAULT or per tag), with the minimum distance (12·E·I·Δ/F)^⅓ from the elbow corner. 1885S has no capacities yet, so no flag.
- Shown on the Results page under the line stop table. Test: `tests/support-guide-lateral-loads.test.mjs` (hand check: 6″ Sch 40 L-bend, 6,000 mm run past the elbow, ΔT 100 °C, L 3,229 mm: 1,487 / 5,950 N).

1885S (browser Run 2026-11-27): 6 guides, all **0 N**, because every line is at 21 °C. PS-12034, PS-12169 and PS-12060 have only risers past their elbows, so they would stay 0 when hot.

What-if, ΔT = 100 °C on every line (computed in the page, not saved):

| Guide | L to elbow (mm) | Run past elbow grows (mm) | Δ (mm) | Lower–upper (N) |
| --- | ---: | ---: | ---: | ---: |
| PS-12268 | 3,550 | 2,263 (from line stop PS-12295) | 2.65 | 745 – 2,978 |
| PS-12242 | 3,800 | 642 (whole run) | 0.75 | 172 – 689 |
| PS-12248 | 6,933 | 424 (45° piece, 0.71 across) | 0.35 | 1 – 53 (3″ and 6″ in the stretch) |
| PS-12034, PS-12169, PS-12060 | — | riser | 0 | 0 |

Hand check PS-12268: 6″ wall 14.27 mm, I = 2.066×10⁷ mm⁴, 3 × 203,000 × 2.066×10⁷ × 2.65 / 3,550³ = 745 N.

#### Line temperatures from the Line List (2026-11-27)

The app's Line List master already reads the client Line List .xlsx (kept out of git; excluded locally in `.git/info/exclude`). The auto-mapping keys on Service + Line number (e.g. S + 8811951 = S8811951, as in the model's branch names) and maps:
- T2 = AT WORKING CONDITIONS Temp. ºC (operating)
- T1 = DESIGN CONDITIONS Temp Max ºC
- insulation thickness, and the mixed / gas / liquid densities

The key needs the service letter, because W8810111 and W8810112 exist too.

- `src/workspace/support-sites/line-list-temperatures.js`: the thermal checks (friction movement state, guide bounds) use each model line's **T2 operating temperature** from the Line List, unless Project Data sets that line itself. Lines not in the Line List keep Project Data's DEFAULT.
- This follows Project Data's own evidence note ("line-list master takes precedence for hot lines"). It is a view for these checks only; Project Data is not changed.
- A line listed twice with different temperatures is not used.
- The Results page lists the temperatures used and where each came from. Test: `tests/line-list-temperatures.test.mjs`.

1885S Line List, all 5 steam lines (S, phase M):

| Line | NPS | Operating T2 | Design T1 max | Insulation (HC) | Mixed density |
| --- | ---: | ---: | ---: | ---: | ---: |
| S8810101 | 10″ | 309 °C | 325 °C | 120 mm | 67 kg/m³ |
| S8810103 | 8″ | 309 °C | 325 °C | 100 mm | 67 kg/m³ |
| S8810111, S8810112, S8811951 | 6″ | 309 °C | 325 °C | 80 mm | 67 kg/m³ |

Browser Run with the real Line List in place of the sample CSV (2026-11-27):
- **EMPTY / OPE / HYD:** 87.6 / **88.7** / 104.0 kN; equilibrium PASSED, coverage 100 %.
- **Why OPE dropped:** OPE falls from 100.4 kN because the sample CSV gave 67 kg/m³ only for S8811951, so the other 4 lines used the 1,000 kg/m³ fallback (a SAMPLE ASSUMPTION). The Line List gives 67 kg/m³ for all 5.
- **Insulation:** still 0 mm, because the 1885S Project Data default (SAMPLE ASSUMPTION) takes priority over the Line List thickness. Owner decision pending.
- **Friction:** total design friction is 21,336 N over 25 sliding supports.
- **Line stop design axial (friction part):** PS-12248 4,494 N; PS-12060 2,065; PS-12240 1,126; PS-12034 (8″) 1,018; PS-12169 809; PS-12034 (6″) 578; PS-12295 545; PS-12231 443; PS-12268 255; PS-12243 and PS-12166 0.
- **Guides (SCREENING) at ΔT = 309 − 21 = 288 °C:**

| Guide | Δ (mm) | Lower – upper (N) |
| --- | ---: | ---: |
| PS-12268 | 7.63 | 2,144 – 8,578 |
| PS-12242 | 2.16 | 496 – 1,984 |
| PS-12248 | 1.01 | 3 – 153 |
| PS-12034, PS-12169, PS-12060 | riser | 0 |

Hand check: PS-12268, Δ = 1.17×10⁻⁵ × 288 × 2,263 = 7.63 mm; lower = 745 N × 2.88 = 2,145 N.

#### Insulation from the Line List (owner decision 2026-11-27)

- `load-calc-master-candidates.js` now also proposes **INSULATION_THICKNESS** from the Line List row (`insThk`), as EXACT_APPROVED_MASTER from the Line List, like the operating fluid density.
- A blank or zero thickness is not proposed, so the 0 mm configured default (SAMPLE ASSUMPTION) applies only where the Line List gives no thickness.
- Insulation density stays the owner-approved 210 kg/m³ configured default.
- Test: `tests/load-calc-master-candidates.test.mjs`.

Hand check, kg/m at 210 kg/m³:
- 6″ / 80 mm: π/4 (328.3² − 168.3²) = 0.0624 m², 13.1 kg/m
- 8″ / 100 mm: 21.1 kg/m
- 10″ / 120 mm: 31.1 kg/m

The pipes the Run counts add 1,407 kg = **13.80 kN**, exactly the EMPTY increase. Three duplicate AUTO carrier pieces (18 kg) are correctly not counted.

**1885S, browser Run with the real Line List (2026-11-27):**
- EMPTY / OPE / HYD: **101.4 / 102.5 / 117.8 kN** (was 87.6 / 100.4 / 104.0 with the sample CSV). Equilibrium PASSED, coverage 100 %, same exceptions (37 overhang, 2 branch transfers, 1 lift-off).
- Design friction: 24,565 N over 25 sliding supports.
- Line stop design axial (friction part): PS-12248 4,690 N; PS-12060 2,405; PS-12240 1,374; PS-12034 (8″) 1,236; PS-12169 996; PS-12034 (6″) 726; PS-12295 667; PS-12231 545; PS-12268 340; PS-12243 and PS-12166 0.
- Guides: unchanged (they depend on temperature and stiffness, not weight). PS-12268 2,144–8,578 N; PS-12242 496–1,984 N; PS-12248 3–153 N.
- Sample assumptions left: the 5 placeholder fitting weights. The 1,000 kg/m³ fluid fallback and the 0 mm insulation no longer apply to any 1885S line.

#### Line stop thermal push (guide / line stop plan, step 6, 2026-11-28)

`src/workspace/support-sites/support-line-stop-thermal.js`, label **SCREENING**. The shared geometry and thermal ground used with the guide check is in `thermal-bending-context.js`. On each side of a stop, its run grows towards the elbow by δ = α·ΔT·L (L = stop to elbow corner), and the run past the elbow must move sideways by δ·sin(turn). The push on the stop depends on what is past the elbow:
- **A guide there** (first from the elbow, L_b = elbow corner to that guide): 3·E·I·δ/L_b³ to 12·E·I·δ/L_b³, plus the sideways friction of the rests between.
- **No guide there:** lower = the sideways friction of its rests. There is no upper bound from this hand method, because its far end decides it:
  - more legs beyond → "needs the following legs" (multi-leg flexibility, not modelled);
  - it runs to the line end → design finding SHORT_LEG_TO_LINE_END: the force if that end were fixed (e.g. a nozzle), capped at the fully blocked force E·A·α·ΔT of the stop's run when bending would need more.
- **A side running to the line end itself:** end condition unknown, so no push is estimated.
- **A side ending at another stop:** growth blocked, design finding E·A·α·ΔT, never a load.
- **Per side:** friction (ACCURATE) + push; design = the larger side. An upper bound is shown only when every side has one; otherwise it is "open", never understated.
- Results page: the last column of the line stop table. Tests: `tests/support-line-stop-thermal.test.mjs`. Hand check on a 6″ Sch 40 L-bend, ΔT 100 °C: δ = 3.78 mm; guide 2,229 mm past the corner gives 2,433 / 9,733 N; fully blocked 855 kN.

1885S (browser Run 2026-11-28, Line List temperatures 309 °C, α 1.17×10⁻⁵):
- **Lower bounds (friction + known push):** PS-12248 4,690 N; PS-12060 2,405; PS-12295 2,361; PS-12231 2,068; PS-12268 1,862; PS-12240 1,374; PS-12034 (8″) 1,236; PS-12169 996; PS-12034 (6″) 726; PS-12243 and PS-12166 0.
- **Upper bounds:** open for all 11. Every stop has a side running to a line end or past an unguided elbow into more legs.
- **Findings ("if the line end is fixed"):** PS-12060 ≈ 739 kN (1.8 m riser); PS-12034 (8″) ≈ 378 kN; PS-12034 (6″) ≈ 114 kN; PS-12295 ≈ 6 kN; PS-12248 and PS-12166 are too short to absorb the growth at all (up to the fully blocked force, about 4.7 and 11.6 MN). Whether those line ends are nozzles, tees or free ends decides whether these matter.
- **To close the upper bounds:** a multi-leg flexibility method (e.g. the existing reference solver in `src/core/empirical-piping-mechanics/thermal-restraint-compatibility.js`, owner decision), or a CAESAR II run.

#### Thermal expansion table (placeholder, 2026-11-27)

- **Project Data:** `thermoMechanicalBasis.thermalExpansionTable` holds the expansion coefficient by material and temperature.
  - Unit mm/mm/°C. Basis MEAN_FROM_INSTALLATION: growth = coefficient × (T − 21 °C) × L.
  - Columns −29, 0, 21, 50 … 400 °C in 25 °C steps; rows are the Line List material codes: CSS, SS316L, SA825.
  - 1885S has it as an **empty placeholder, not approved**, waiting for the owner's values.
- **Template:** `project-data/thermal-expansion-table-template.csv`. Converter: `node benchmarks/checks/expansion-table-from-csv.mjs <filled.csv>` prints the Project Data value and rejects non-numbers and values that are not about 1e-5.
- **`src/workspace/support-sites/thermal-expansion-table.js`:**
  - Each line's coefficient is interpolated linearly at its operating temperature, with the material taken from the Line List.
  - Only an approved table is used. A blank cell either side, a missing row or a temperature outside the columns gives no value, and Project Data `materialElasticProperties` applies.
  - The guide check uses the growing run's line for α and the guided run's line for E.
  - The Results page states which α was used.
- Tests: `tests/thermal-expansion-table.test.mjs` (test values 1.30/1.32×10⁻⁵ at 300/325 °C give 1.3072×10⁻⁵ at 309 °C); guide bounds scale by α.

**Open: α at temperature.** Project Data's α = 1.17×10⁻⁵ /°C is labelled "at 21 °C". The mean coefficient from 21 °C to 309 °C for carbon steel is higher (to be confirmed from ASME B31.3 Appendix C). Growth, and so the guide bounds, scale with it.

#### First benchmark results review (2026-11-26)

Run completes for EMPTY / OPE / HYD (87.6 / 100.4 / 104.0 kN). Force and moment equilibrium pass in all three cases (residual ≈ 1e-11 N). 37 support sites.

| Finding | Detail | Status |
| --- | --- | --- |
| Hand check | Site x 427515 (6" S8811951 B2): lever-rule between neighbouring supports gives 713.8 kg → 7,000 N vs 7,014 N reported (0.2 %, chainage-origin approximation). | Distribution arithmetic confirmed for one site. |
| 61 × OVERHANG_CANTILEVER_TRANSFER | Items beyond the last support of a route, carried as cantilever to the end support with a transfer moment. | Expected; informational. |
| 20 × UNALLOCATED_FORCE_NO_QUALIFIED_VERTICAL_SUPPORT (1,001 N) | All on 10" S8810101 branches B2 (406 N) and B3 (595 N): small branches with no bearing support. | **Fixed.** An unsupported branch gets a virtual support at its head; that reaction is applied to the host route at the BRANCH HREF fitting. Coverage now 100 % in EMPTY/OPE/HYD; equilibrium passes; 2 × BRANCH_LOAD_TRANSFERRED_TO_HOST recorded. Test: `tests/support-load-branch-transfer.test.mjs`. |
| 7 sites at 0 N | 1 LINESTOP (axial only — correct). 6 have no support type in the source (bare ATTA-150/ATTA-20 points, 2 × PENE-150 wall penetrations, and PS-12297 SREF catalogue FT17-7.6-PMP); treated as non-bearing. | Bare ATTA/PENE: acceptable. **PS-12297: needs a support-family mapping.** |
| Long pipes lumped at midpoint | Wrong finding (review read only the ledger's summary chainage). Pipes already use `allocateSupportUniformLoad` and split across supports (e.g. B2 8: 324 / 1,071 / 71 N). | No change needed. |
| Instrument =1006649732/51250 | 697 kg on a 6" line (from fitting-weight review). | Plausibility check with owner. |


**Done when:** a new user can get support loads for the benchmark within 3 clicks of opening the app, and CI guards that path.

### Phase 2 — Load Calc clarity (1 week) · fixes L4, L6, L7
- Make one source compute the step states (counts, NEXT/blocked/done), so the cards, panels and headings agree. Add a test for it.
- Plain-language pass: hide internal codes, hashes and receipts behind "Technical details".
- Replace error dumps with guidance. Example: "43 pipes have no Line List entry → Import Line List / derive from source".
- **Derive the Line List from the source:** `Sjson.json` already carries line IDs and spec codes. Offer this as a reviewed proposal, consistent with the app's "proposals, never silent writes" rule.
- Check the 0.00 mm CENTERLINE_CLASH findings at elbow joints, and fix the checker if they are false positives.

### Phase 3 — 3D Edit ↔ Load Calc round trip (1–2 weeks) · fixes E1–E4
- Add a test for the round trip: select a pipe, *Move +Z 100 mm*, Commit, then show that Load Calc's topology and results update and go stale correctly.
- Work out why the benchmark shows "Basis: incomplete", and fix it or explain it in the UI.
- Remove duplicate controls: one command bar, with context-sensitive actions. Target under 300 buttons in the DOM.
- Make the Engineering table a docked panel, not an overlay.
- Lift the elbow "read-only" limit, or say clearly in the UI which component types can be edited.

### Phase 4 — Engine consolidation (2–3 weeks) · fixes L8, L9, L10
- Pick one authoritative support-load engine for "Run". Keep the others only as checks and label them in the UI, or remove them.
- Move the DN→OD table and the inlined weight master into versioned master data that loads lazily (removes 606 kB from startup).
- Split `load-calc-consumer-controller.js` and the 1,000+ line engine files along their existing step boundaries.

### Phase 5 — Product polish and release (ongoing)
- GitHub Pages deploy of `main` as a live demo (the build already uses relative paths).
- Save and reopen a project: model, masters, Project Data, decisions and results in one file.
- Results export: a PDF/XLSX support-load report.
- Upstream sync: a script that diffs this app's files against a newer Advanced_Analysis and reports changed and new dependencies.

## Not verified in this audit

- Numerical correctness of any support load: no run reached Results.
- 3D Edit commit behaviour and its effect on Load Calc.
- Persistence across reloads (IndexedDB/localStorage stores exist but weren't exercised).
- Performance on models larger than the 279-entity benchmark.
