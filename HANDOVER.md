# LOADCALC handover

Written 2026-11-26 for the next agent or engineer. Kickoff prompt for a new agent: [docs/new-agent-prompt.md](docs/new-agent-prompt.md). Read this first, then
[ROADMAP.md](ROADMAP.md) (audit, phases, results tables) and
[docs/guide-line-stop-load-plan.md](docs/guide-line-stop-load-plan.md).

## 0. Checkpoint 2026-11-28 (read this first when resuming)

**State:** guide / line stop plan steps 0–5 are built and on the Results page; an end-to-end suite guards the whole path; tests 329/329, lint 0 errors.

| Piece | Label | Where | 1885S now |
| --- | --- | --- | --- |
| Vertical loads, Option B three-moment + lift-off (AUTO) | ACCURATE | `support-load-distribution-v3.js` | EMPTY / OPE / HYD 101.4 / 102.5 / 117.8 kN, equilibrium PASSED, coverage 100 % |
| Restraint table + in-app review (Restraints tab) | data | `support-restraint-table.js`, `support-restraint-review-view.js` | 36 sites: 19 R, 6 R+LS, 1 R+G, 5 R+G+LS, 5 NONE |
| Design friction μ·N_OPE | ACCURATE | `support-friction-loads.js` | 24,565 N over 25 sliding supports |
| Legs, axial runs (offsets ≤ 30° joined) | data | `routes/route-legs.js` | only S8811951/B2 joins (two eccentric reducers) |
| Line stop axial, friction part | ACCURATE | `support-line-stop-loads.js` | largest PS-12248 4,690 N |
| Line stop thermal push | SCREENING | `support-line-stop-thermal.js` | lower bounds for all 11; upper bounds open; "if line end fixed" findings (PS-12060 ≈ 739 kN) |
| Guide lateral bounds | SCREENING | `support-guide-lateral-loads.js` | PS-12268 2,144–8,578 N; PS-12242 496–1,984 N; PS-12248 3–153 N |
| Line temperatures from the Line List (T2) | input | `line-list-temperatures.js` | 5 steam lines 309 °C (design 325 °C) |
| Insulation from the Line List | input | `load-calc-master-candidates.js` | 120 / 100 / 80 mm (10″ / 8″ / 6″), +13.80 kN |
| Expansion table by material × temperature | input | `thermal-expansion-table.js` | **empty placeholder**, α = 1.17×10⁻⁵ used |

**End-to-end suite (2026-11-28), no browser:** `npm run test:e2e` (also part of `npm test`). `tests/e2e/headless-1885s-run.mjs` drives the app's own controllers and stores in the browser benchmark's order: Sjson.json → bundled masters → Line List upload → proposals and clear-winner fitting weights → the 5 SAMPLE ASSUMPTION weights → Input Check READY → Run (Option B) → friction / line stops / guides via the Load Calc controller → Results pane markup. About 6 s per run. Two files:
- `tests/e2e-1885s-sample-line-list.test.mjs` — the sample Line List in the repo; always runs.
- `tests/e2e-1885s-real-line-list.test.mjs` — the client Line List; skipped when the file is not on the computer (or with `LOADCALC_E2E_SAMPLE_ONLY=1`).

Hand checks in `tests/e2e/checks-1885s.mjs` recompute each result from its inputs: every weight item = m·g; Σ reactions = applied; friction = μ·N_OPE per support (the lifted-off rest gives 0); each line stop side = Σ its supports' axial friction, design = larger side; guide bounds = 3EIΔ/L³ and 12EIΔ/L³ with Δ = α·ΔT·L·(sideways part); the pane shows the same values, current, with their ACCURATE / SCREENING labels. Expected numbers (totals and 5 golden supports in all three cases) are in `tests/e2e/expected-1885s.mjs`; change them only with a reason in ROADMAP. A deliberate bug (I_max in the guide lower bound) was caught by it.

**One-click sample project (2026-11-28):** the **Sample 1885S** button at the top of the Dataset Tree toolbar loads the model, the bundled masters and the sample Line List, accepts the 172 master proposals and the 26 clear-winner fitting weights, adds the 5 SAMPLE ASSUMPTION placeholder weights (`public/master-data/sample-1885s-placeholder-weights.json`) and opens Load Calc at the Run step (READY). One more click, Run, gives 87.6 / 100.4 / 104.0 kN. Code: `src/workspace/sample-project/load-sample-project.js`; the end-to-end suite calls the same function, so it tests what the button does. The Results page starts with a "SAMPLE ASSUMPTION inputs in this Run" box (`sample-assumption-notice.js`): the placeholder weights, lines on the 1000 kg/m³ density fallback, and the 0 mm insulation default. Click-through of all 8 steps after the Run found two things (details in ROADMAP Phase 1): opening Calculation Defaults the first time wrote product defaults and made the Run HISTORICAL (fixed for the sample, still open for other models), and Check Topology still asks about `=1006649732/51465` although Project Data sets it to NONE.

**Results table (2026-11-28):** every support's EMPTY / OPE / HYD, friction, line stop and guide values are in ROADMAP ("1885S results table"). Rebuild it with `node benchmarks/checks/1885s-results-table.mjs` (client Line List if present, `--sample` for the repo one); it fails if a column does not add up to the Run.

**Benchmark now runs with the real client Line List** (local only, `public/fixtures/AML-*.xlsx`, excluded in `.git/info/exclude`, never commit). Upload it in Master Data in place of the sample CSV in `benchmarks/browser/1885s-run-steps.js` step 3; the rest of the steps are unchanged. The browser pane is slow: run each step as its own call and check the page before the next one.

**Waiting on the owner:**
- the filled expansion table (template `project-data/thermal-expansion-table-template.csv`, converter `benchmarks/checks/expansion-table-from-csv.mjs`);
- what the 1885S line ends are (nozzle, tee or free end) — decides the line stop findings;
- guide lateral capacities (for the too-close-to-elbow flag), only if wanted;
- a CAESAR II run for the accuracy figure, if available.

**Not built:** wind / seismic g-factor loads (plan step 6); multi-leg flexibility for open upper bounds (would need an owner decision; no whole-system stiffness solve, per the owner); movement-based friction (neutral points).

**Pushing:** push only when the owner says yes. If plain `git push` asks for a password, use the signed-in GitHub CLI as the credential helper for that push (`git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`, with the full path to `gh` if it is not on PATH). The repo's local git identity is reallakshman19 (owner decision 2026-11-27).

## 1. What this is

- **App:** a Vite + vanilla JS app. It holds Load Calc (empirical, non-FEA pipe support loads) and 3D Edit, extracted from [Advanced_Analysis](https://github.com/reallakshman19/Advanced_Analysis).
- **Repo:** public, https://github.com/reallakshman19/LOADCALC, branch `main`. There is no LICENSE, and that is the owner's decision.
- **Benchmark:** 1885S, `benchmarks/Sjson.json`, also served as `public/fixtures/Sjson.json`.
  - 279 entities, 43 pipes, 139 support attachments, 36 support sites (37 before PS-12248 was merged).
  - 5 lines: 8810101, 8810103, 8810111, 8810112, 8811951.

## 2. Owner decisions (do not re-ask)

| Date | Decision |
| --- | --- |
| 2026-11-25 | Repo stays public, no LICENSE. |
| 2026-11-25 | Operating fluid density fallback 1000 kg/m³ (S8811951 keeps 67 kg/m³ from the Line List). |
| 2026-11-26 | 5 fitting weights are placeholders, labelled SAMPLE ASSUMPTION (`public/master-data/sample-1885s-placeholder-weights.json`). |
| 2026-11-26 | Zero-length branches attach to their host pipe. |
| 2026-11-26 | Insulation thickness 0 mm, as a SAMPLE ASSUMPTION (`1885S_INSULATION_THICKNESS_SAMPLE_ZERO` in `project-data/1885s-project-data-profile.json`). |
| 2026-11-26 | **Accuracy target 90 %:** each support's vertical load within about 10 % of a stiffness-based reference. |
| 2026-11-26 | **No beam solver / FE.** A whole-system stiffness solve is LFEA scope. Improve the *empirical* calculation instead. |
| 2026-11-26 | **Support types:** PS-12297 = REST; 5 bare ATTA / PENE floor-opening points = NONE (not supports); PS-12248 is one R+G+LS support (grouping tolerance 1 mm). In `project-data/1885s-project-data-profile.json`. |
| 2026-11-27 | **Real Line List is the source** for 1885S, keyed Service + Line number: operating temperature (T2) for the thermal checks, fluid density, and **insulation thickness** (now proposed from the Line List; the 0 mm and 1,000 kg/m³ sample fallbacks apply only where it gives no value). Shallow offsets of 30° or less count as straight for line stops (`topology.legOffsetMaxAngleDeg`). |
| 2026-11-26 | **Option B approved as empirical** (three-moment hand calc with lift-off). Wired into the Run as `CONTINUOUS_SPAN_THREE_MOMENT_V1`, the AUTO default; V2 stays selectable. Weight and friction results are labelled ACCURATE; guide / line stop thermal results are SCREENING bounds only. |

**Never commit** client documents. The client Line List `.xlsx` is used locally from `public/fixtures/` (excluded in `.git/info/exclude`, never committed); only the derived sample CSV is committed. Never commit secrets either. Keep the owner's personal details out of commits and external requests.

## 3. How to run

```
npm install
npm run dev        # http://localhost:5173  (use this for readable stack traces)
npm test           # node:test files + scripts/check-manifest.json checks (317 pass on 2026-11-26)
npm run lint       # must report 0 errors (warnings are known: no-unused-vars)
npm run build && npm run preview   # http://localhost:4173
```
`.claude/launch.json` defines `loadcalc-dev` (5173) and `loadcalc-preview` (4173) for the Claude browser pane.

**Re-run the benchmark in the browser:** paste the steps in [benchmarks/browser/1885s-run-steps.js](benchmarks/browser/1885s-run-steps.js), one step at a time; step 1 reloads the page. Expected results are written at the end of step 6.

**Headless checks:**
```
node benchmarks/checks/route-b2-continuous-beam-check.mjs 4   # independent FE beam, support index 4 released
node benchmarks/checks/route-b2-empirical-methods.mjs         # V2 vs A vs B against that beam
```

## 4. Where things stand

The Phase 1 goal was the 1885S Run reaching Results. **That is done.**
- EMPTY / OPE / HYD applied loads are 87.6 / 100.4 / 104.0 kN.
- Force and moment equilibrium pass, coverage is 100 % and nothing is unallocated.
- Exceptions: 83 × OVERHANG_CANTILEVER_TRANSFER and 2 × BRANCH_LOAD_TRANSFERRED_TO_HOST.
- A hand check of one site matches within 0.2 %.

**Accuracy against the 90 % target, route S8811951/B2, EMPTY case, compared with an independent continuous beam:**

| Support ch (mm) | 1,493 | 4,003 | 5,837 | 9,123 | 11,259 | 14,900 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Beam reference (N) | 3,726 | 2,457 | 8,748 | 3,407 | 0 (lifts off) | 7,323 |
| V2 tributary (what the Run uses now) | +1.8 % | +41.8 % | −19.8 % | +12.7 % | 1,859 N | −22.5 % |
| **A** lever + overhang moment | +8.3 % | +31.9 % | −19.8 % | +12.7 % | 145 N | +0.9 % |
| **B** three-moment + lift-off | +0.2 % | −0.8 % | +0.1 % | 0.0 % | 0 | 0.0 % |
| **B in the Run** (since step 0) | +0.2 % | −0.7 % | +0.1 % | +0.3 % | 0 | −0.1 % |

The large V2 errors come from two heavy items: the 697 kg instrument at about 6.7 m and the 408 kg end valve at about 16.3 m. Their effect reaches across several spans, so a correction that only looks at neighbouring spans cannot fix it.

**Step 0 is done (2026-11-26):** the Run uses B. The browser benchmark still passes equilibrium with 100 % coverage in EMPTY / OPE / HYD. Per-support numbers for all 1885S routes, V2 vs B, are in ROADMAP.md ("Option B in the Run").

## 5. Load Calc pipeline map (what Run executes)

The steps below are the 8-step UI process: Dataset, Topology review, Master Data, Enrichment & Overrides, Project Data, Input Check, Run, Results.

1. **Dataset:** `src/workspace/dataset-adapter.js` → `src/core/shared-piping-model/adapters/workspace-dataset-to-shared.js`. The length unit is read from the POSI text when the package declares none.
2. **Topology:** `src/core/piping-topology/`.
3. **Supports:** `src/core/support-restraints/`.
   - `attachment-resolver.js`, `attachment-resolution-helpers.js` (source order plus exact containment)
   - `attachment-geometry.js` (projects onto the centreline of straight components)
4. **Routes:** `src/workspace/routes/route-partition-model.js`. Routes are branch-scoped with chainage; `attachPointOnlyRoutes` attaches zero-length branches to their host.
5. **Masters → proposals → accept:** `src/workspace/load-calc-master-candidates.js` and the enrichment views. Project Data is in `project-data/1885s-project-data-profile.json`; configured defaults are under `qualificationPolicy.configuredDefaults.defaults`.
6. **Input Check / Seal:** `src/core/non-fea-common-checker/`, `src/workspace/non-fea-input-check-view.js`.
7. **Run:** `src/workspace/engineering-model-controller.js` (`calculateCurrentCommonInput`) → `src/workspace/engineering-loads/current-common-input-empirical-mass-projection.js` (mass and CoG fallback) → **`src/workspace/engineering-loads/support-load-distribution-v3.js`** (method CONTINUOUS_SPAN_THREE_MOMENT_V1 by default; V2 and V3_COG selectable).
   - Every caller dispatches through `calculateSupportLoadDistributionForMethod` / `...FromQualifiedCaseMassesForMethod`; the method list is `EMPIRICAL_SUPPORT_LOAD_METHODS`.
   - `calculateRoute()` pass 1 collects each entity's load. V2 / V3_COG then allocate each one with `allocateSupportUniformLoad` / `allocateSupportPointLoad` (`support-load-static-accounting.js`). B calls `calculateRouteContinuousSpan()`: one `solveContinuousSpan` per route and case along plan length (`routePlanLengthMap`), then each load's share goes to the ledger.
   - `recordContribution()` writes the per-entity audit ledger. With B, first moments are taken along plan length (route check `momentReference: ROUTE_PLAN_LENGTH_ORIGIN`).
   - Branch transfer: `attachBranchTransfers` / `releaseBranchTransfer`. With B, branch routes are solved first and their load joins the host route's solve; V2 keeps `applyBranchTransfer` after the host.
   - `equilibriumCheck` / `completenessAudit` net out `transferForceN`.
8. **Method registry:** `src/workspace/engineering-loads/empirical-method-registry.js`. Adding a vertical method also needs: `IMPLEMENTATION_BINDINGS` (`src/core/non-fea-method-consumption`), `IMPLEMENTATION_FOUNDATION_CAPABILITIES` (`src/core/non-fea-engineering-foundation/handoff.js`), `EMPIRICAL_ANALYSIS_METHODS` (contracts), `NON_FEA_GRAVITY_METHOD_REQUEST_IDS` (Project Data) and the choice rules in `empirical-gravity-method-selection.js`.
9. **Browser API (for checks):**
   - `AnalysisWorkspace.getEngineeringSupportLoadDistribution()`
   - `AnalysisWorkspace.getRoutePartitionModel()`
   - `AnalysisWorkspace.getSnapshot()`

**Not used by Run, and do not wire in** (LFEA scope, per the owner): `src/core/vertical-beam-solver` (it is also blocked on 1885S).

## 6. Code framework ready to take over

| File | What it gives you | Status |
| --- | --- | --- |
| `src/core/empirical-continuous-span/index.js` | `solveContinuousSpan({ supports, loads, method, liftOff })`. Methods `LEVER_OVERHANG_MOMENT_V1` (A) and `THREE_MOMENT_LIFTOFF_V1` (B). Exact uniform-load integration, an active set for lift-off and re-contact, coincident supports merged into one station (reaction split equally; `stationChainageBySiteId`), and **per-load contributions** that sum to the total. | Tested (`tests/empirical-continuous-span.test.mjs`). **B wired into the Run** (`tests/support-load-three-moment.test.mjs`). |
| `src/core/empirical-restraint-loads/index.js` | Pipe I and A, free growth α·ΔT·L, guided-cantilever bounds (3 and 12·EIΔ/L³), fully restrained E·A·α·ΔT, design friction μN, friction neutral point, line stop held friction. | Tested (`tests/empirical-restraint-loads.test.mjs`). Not wired. |
| `benchmarks/checks/route-b2-data.mjs` | B2 loads, supports, V2 results and the beam reference. | Data. |
| `benchmarks/checks/route-b2-empirical-methods.mjs` | Comparison table: V2 vs A vs B. | Runs. |
| `benchmarks/browser/1885s-run-steps.js` | Browser steps for the full benchmark Run, plus an **untested** route-export helper (step 7). | Steps 1–6 were used on 2026-11-26. |

## 7. Next work, in order

### Step 0: wire B into the Run (DONE 2026-11-26)
Built as planned below, with these choices:
- Risers: spans are measured along plan length (running horizontal distance) instead of splitting the route. A vertical leg has zero span length, so its weight lands at the joint and a support on it acts there. No threshold is needed; sloped lines scale by cos(slope).
- A route with fewer than two bearing supports keeps the V2 bookkeeping. A route that cannot be resolved falls back to V2 with `CONTINUOUS_SPAN_UNRESOLVED_TRIBUTARY_FALLBACK`.
- AUTO now picks B wherever it used to pick V2. Option A was not wired (it misses 90 %).

The original plan, for reference:
In `support-load-distribution-v3.js`, `calculateRoute()`:
1. **Pass 1:** collect each qualified entity's load. A pipe becomes `{ startMm, endMm, forceN }` from its chainage row; everything else becomes `{ chainageMm: application.chainageMm, forceN }`. Keep `entity`, `mass` and `application` with each load.
2. **Solve** once per route and case: `solveContinuousSpan({ supports: routeExecution.supports, loads, method })`.
3. **Pass 2:** for each load, turn `result.contributions[i].reactionsBySiteId` into an `accounting` object of the same shape `recordContribution` expects:
   - `allocations[{ siteId, chainageMm, verticalForceN }]`
   - `boundaryTransfers: []`: with B, overhang moments are resolved by the spans
   - `unallocated`: only when a route has no support
   - `disposition`, e.g. `'CONTINUOUS_SPAN_RESOLVED'`
4. Lift-off: record an exception per released site (e.g. `SUPPORT_LIFTOFF_RELEASED`). A route left with one active support (`SINGLE_SUPPORT_MOMENT_UNRESOLVED`) falls back to today's V2 boundary-transfer path.
5. Branch transfer: unchanged. A virtual support is just another support, and the host gets the point load.
6. Register the method in `empirical-method-registry.js`, e.g. `CONTINUOUS_SPAN_THREE_MOMENT_V1`, `VERTICAL_SCREENING_RESULT`. Select it via `configuration` next to V2/V3_COG, keeping V2 selectable for comparison.
7. **Known limitation to handle:** chainage is unfolded along the route.
   - Horizontal elbows are fine for vertical bending, which is the same assumption as the beam check.
   - Vertical risers are not bending spans. A riser's weight goes axially to the support below it. Detect legs whose axis is mostly vertical (edge start/end Δz) and split the route into horizontal groups there. Treat a riser as a point load at its base, or the support on it takes its weight.
   - Different pipe sizes on one route are treated as uniform EI. Per-span EI is a possible extension (three-moment with L/I terms).
8. **Tests:**
   - Update `tests/support-load-branch-transfer.test.mjs` expectations if needed (a 2-support host is unchanged).
   - Add an end-to-end golden test on B2 numbers.
   - Re-run the browser benchmark: equilibrium must still pass and coverage stay at 100 %.

### Steps 1–7: guide and line stop loads
These follow [docs/guide-line-stop-load-plan.md](docs/guide-line-stop-load-plan.md):
1. restraint table: **done 2026-11-26** (`src/workspace/support-sites/support-restraint-table.js`, `node benchmarks/checks/1885s-restraint-table.mjs`); **in-app review screen done 2026-11-28** (Load Calc → Restraints tab; type picker for blank-type supports saves `topology.supportTypeOverridesByTag`)
2. legs and free growth: **legs done 2026-11-27** (`src/workspace/routes/route-legs.js`); free growth waits for real temperatures (reuse `createNonFeaThermalFreeMovementBasis` in `src/core/non-fea-engineering-foundation/thermal-free-movement.js`)
3. friction (ACCURATE): **design friction μ × N_OPE done 2026-11-27** (`src/workspace/support-sites/support-friction-loads.js`, shown in the Results OPE table via `currentFrictionLoads()` in `load-calc-consumer-controller.js`); movement-based friction needs free growth and neutral points
4. line stop axial: **friction part done 2026-11-27** (`src/workspace/support-sites/support-line-stop-loads.js`, Results page under the OPE table; design = larger side). **Thermal push done 2026-11-28** (`support-line-stop-thermal.js`, SCREENING; shared ground `thermal-bending-context.js`): lower bounds for every 1885S stop; upper bounds open where a side runs to a line end or past an unguided elbow into more legs; "if the line end is fixed" findings
Expansion coefficient: **placeholder table by material and temperature** (`thermoMechanicalBasis.thermalExpansionTable`, template `project-data/thermal-expansion-table-template.csv`, converter `benchmarks/checks/expansion-table-from-csv.mjs`); empty and unapproved until the owner sends values, so `materialElasticProperties` (1.17×10⁻⁵) applies.
Line temperatures: **from the Line List master since 2026-11-27** (`src/workspace/support-sites/line-list-temperatures.js`; T2 operating, per Service + Line number; Project Data per-line values win). 1885S steam lines: 309 °C operating, 325 °C design.
5. guide lateral (SCREENING bounds): **done 2026-11-27** (`src/workspace/support-sites/support-guide-lateral-loads.js`, Results page). 0 on 1885S until line temperatures are given; the too-close flag needs guide capacities (`restraintPolicy.guideLateralCapacityN`)
6. optional wind/seismic
7. tests and cross-check against `src/core/empirical-piping-mechanics/thermal-restraint-compatibility.js` on simple L and Z cases

The repo also registers `EMPIRICAL_RESTRAINT_NETWORK_V1/V2` (guide/line stop thermal screening), but has only topology eligibility for them in `src/core/non-fea-analysis-plan/topology-eligibility.js`, no runtime.

### Other Phase 1 items still open
- ~~"Load sample project" button~~ Done 2026-11-28 ("Sample 1885S", see section 0).
- Gate Run on Input Check, with a plain-language message.
- ~~End-to-end golden-number test (ROADMAP L11)~~ Done 2026-11-28 (`npm run test:e2e`).
- ~~Map PS-12297 (SREF FT17-7.6-PMP) to a support family.~~ Owner set it to REST, 2026-11-26.
- Confirm the 697 kg instrument `=1006649732/51250` with the owner.

## 8. Open questions for the owner
1. ~~Approve Option B as empirical?~~ Approved 2026-11-26.
2. Operating temperatures per line. Project Data has `DEFAULT: 21 °C` = installation, so every thermal load would be zero, yet 11 supports are "Directional Anchor … Hot Insulated Pipe".
3. Real insulation thickness per line (it is 0 mm now).
4. Which supports have PTFE slide plates (μ 0.1, versus 0.3 default)? (Blank support types: resolved 2026-11-26.)
5. Wind/seismic g-factors, if wanted.
6. A CAESAR II (or other) result for 1885S, to measure the 90 % target for real.

## 9. Gotchas
- **Agent tooling:**
  - Agent browser JS tools time out at about 45 s. Split the flow; the Run itself takes about 38 s.
  - On Windows, bash heredocs mangle `\b` and apostrophes. Write scripts to a file and run them.
  - Windows PowerShell 5 `Set-Content -Encoding utf8` writes a byte-order mark; use the editor or Node to write source files.
  - The browser JS steps run in the dev server, so a page can `await import('/src/...')` an app module (used to recompute V2 next to B in one Run).
- **Benchmark data:**
  - `Sjson.json` must stay LF. CRLF changes its hash and makes Project Data look stale.
  - Project Data writes `kg/m³` but fields use `kg/m3`; `canonicalUnit()` in the configured-default overlay reconciles them.
- **Code behaviour:**
  - The `w10.3` attachment contract expects `AMBIGUOUS` when there is no order evidence. Keep that when touching `attachment-resolution-helpers.js`.
  - Pipes were already spread along their length in V2. The earlier "lumped at midpoint" finding was wrong.
- **Owner preference:** the owner works over Remote Control. End each turn with a plain question and its choices written as text, using plain language and few internal codes.
