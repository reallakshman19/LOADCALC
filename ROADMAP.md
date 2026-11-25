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
| R1 | P0 | **The public repo has no LICENSE**, and upstream has none either. Legally that means all rights reserved. Choose a license, or make the repo private. |
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

### Phase 1 — Load Calc golden path (1–2 weeks) · fixes L1, L2, L3, L5, L11
1. Ship a **sample master set** for the 1885S benchmark under `public/master-data/`: a Line List (line → piping class, material), plus the piping-class mapping and Project Data values the Input Check asks for.
2. Add a **"Load sample project"** button that loads `Sjson.json` and those masters in one step.
3. Write down which Load Calc pipeline "Run" executes, and which engine it uses (L9).
4. **Gate Run on Input Check.** Show "Blocked: N issues — open Input Check" instead of ONE-CLICK, and turn the internal error into a sentence a user can act on.
5. Add an **end-to-end test**: sample project → masters → auto-enrichment → Input Check READY → Run → Results package with support loads. Include golden numbers for at least 5 supports, checked against the upstream 1885S benchmark evidence.

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
