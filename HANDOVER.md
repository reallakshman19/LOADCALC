# LOADCALC handover

Written 2026-11-26 for the next agent or engineer. Kickoff prompt for a new agent: [docs/new-agent-prompt.md](docs/new-agent-prompt.md). Read this first, then
[ROADMAP.md](ROADMAP.md) (audit, phases, results tables) and
[docs/guide-line-stop-load-plan.md](docs/guide-line-stop-load-plan.md).

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
| 2026-11-26 | **Option B approved as empirical** (three-moment hand calc with lift-off). Wired into the Run as `CONTINUOUS_SPAN_THREE_MOMENT_V1`, the AUTO default; V2 stays selectable. Weight and friction results are labelled ACCURATE; guide / line stop thermal results are SCREENING bounds only. |

**Never commit** client documents. The client Line List `.xlsx` lives outside the repo; only the derived sample CSV is committed. Never commit secrets either. Keep the owner's personal details out of commits and external requests.

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
1. restraint table: **done 2026-11-26** (`src/workspace/support-sites/support-restraint-table.js`, `node benchmarks/checks/1885s-restraint-table.mjs`); an in-app review screen is still to do
2. legs and free growth (reuse `createNonFeaThermalFreeMovementBasis` in `src/core/non-fea-engineering-foundation/thermal-free-movement.js`)
3. friction (ACCURATE): **design friction μ × N_OPE done 2026-11-27** (`src/workspace/support-sites/support-friction-loads.js`, shown in the Results OPE table via `currentFrictionLoads()` in `load-calc-consumer-controller.js`); movement-based friction needs steps 2 and 4
4. line stop axial
5. guide lateral (SCREENING bounds)
6. optional wind/seismic
7. tests and cross-check against `src/core/empirical-piping-mechanics/thermal-restraint-compatibility.js` on simple L and Z cases

The repo also registers `EMPIRICAL_RESTRAINT_NETWORK_V1/V2` (guide/line stop thermal screening), but has only topology eligibility for them in `src/core/non-fea-analysis-plan/topology-eligibility.js`, no runtime.

### Other Phase 1 items still open
- "Load sample project" button (one click: Sjson + Line List + placeholder weights).
- Gate Run on Input Check, with a plain-language message.
- End-to-end golden-number test (ROADMAP L11). A headless harness, without the browser, would be high value.
- Map PS-12297 (SREF FT17-7.6-PMP) to a support family.
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
