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

Not built yet: a review screen for the table in the app (today it is a script and a data module).

#### Friction loads (guide / line stop plan, step 3, 2026-11-27)

`src/workspace/support-sites/support-friction-loads.js`: **design friction = μ × N_OPE** at each sliding support, in each horizontal direction the restraint table leaves free (R: along or across the pipe; R+G: along; R+LS: across; R+G+LS: none). It is the most friction can be in any one direction; along and across are alternatives (their vector sum is at most μN). Label ACCURATE (owner decision), so it is only as good as the vertical result and μ. Shown on the Results page in the OPE table (columns Type, Friction, Friction acts). Test: `tests/support-friction-loads.test.mjs`.

Movement-based friction (zero where the pipe does not move) is reported as 0 while every operating temperature equals installation (21 °C now); with real temperatures it needs leg growth and neutral points (steps 2 and 4) and shows as not built.

1885S OPE (browser Run 2026-11-27): 25 sliding supports, total design friction 24,073 N; equilibrium PASSED and coverage 100 % unchanged. Hand checks: PS-12059 R 0.3 × 8,234 = 2,470 N; PS-12242 R+G 751 N along the pipe; PS-12243 R+LS 811 N across; PS-12060 R+G+LS 0 N; lifted-off PS-12249 0 N. μ is the 0.3 default everywhere until PTFE plates are known.

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
