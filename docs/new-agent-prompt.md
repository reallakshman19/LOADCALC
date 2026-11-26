# Kickoff prompt for the next agent

Copy everything inside the box into a new agent session that is opened in a fresh clone of the repo. Before you send it, fill in the one line marked **OWNER**.

```text
You are taking over LOADCALC, a Vite + vanilla JS app for empirical (non-FEA)
pipe support load calculation, plus a 3D editor.
Repo: https://github.com/reallakshman19/LOADCALC (public, branch main).

SET UP
1. git clone https://github.com/reallakshman19/LOADCALC.git && cd LOADCALC
2. npm install
3. npm test         -> expect 317/317 pass
   npm run lint     -> expect 0 errors (about 41 known warnings)
4. node benchmarks/checks/route-b2-empirical-methods.mjs   -> prints V2 / A / B vs beam table

READ FIRST, in this order (do not skip):
- HANDOVER.md: decisions, pipeline map, code framework, next steps, gotchas
- docs/guide-line-stop-load-plan.md: guide and line stop method
- ROADMAP.md: the "Accuracy target: 90 %" section, then the Phase 1 tables

FIXED OWNER DECISIONS. Do not re-ask or reverse these.
- Load Calc stays EMPIRICAL. No beam solver, no FE or stiffness solve of the
  whole system (that is LFEA scope). Do not wire src/core/vertical-beam-solver.
- Target: each support's vertical load within ~10 % of a stiffness-based
  reference (90 % accuracy).
- Weight and friction results are labelled ACCURATE. Thermal restraint
  (guide / line stop bending) results are SCREENING bounds only.
- SAMPLE ASSUMPTIONS stay labelled as such:
  - 0 mm insulation
  - 5 placeholder fitting weights
  - 1000 kg/m³ fluid density fallback
- Never commit client documents (e.g. the client Line List .xlsx) or secrets.
  Keep the owner's personal details out of commits and external requests.
- Repo stays public with no LICENSE.

OWNER: Option B (three-moment hand calc with lift-off) approved as empirical? -> [YES / NO, A only]

YOUR FIRST TASK: HANDOVER.md section 7, "Step 0"
- If B is approved: wire src/core/empirical-continuous-span into the Run.
  - Where: calculateRoute() in src/workspace/engineering-loads/support-load-distribution-v3.js.
  - How: two passes. Collect the route's loads, call solveContinuousSpan once,
    then feed each load's contributions into recordContribution.
  - Register the method in empirical-method-registry.js and keep V2 selectable.
  - Handle risers: legs that are mostly vertical are not bending spans.
- If only A: do the same, but with method LEVER_OVERHANG_MOMENT_V1.
- Done when ALL of these hold:
  - npm test and npm run lint are clean.
  - A new test shows route S8811951/B2 within 1 % (B) of
    benchmarks/checks/route-b2-data.mjs beamLiftoffReleased.
  - The browser benchmark (benchmarks/browser/1885s-run-steps.js, steps 1-6,
    dev server on 5173) still shows equilibrium PASSED and 100 % coverage for
    EMPTY / OPE / HYD.
  - ROADMAP.md records the new per-support numbers.
- Then: the guide and line stop work, steps 1-7 of
  docs/guide-line-stop-load-plan.md, starting with the restraint table.

HOW TO WORK WITH THE OWNER
- The owner is a piping engineer who often works over Remote Control, on a
  phone. Write plain, short language and avoid internal codes.
- End every turn with what you did, anything that failed or is unverified,
  and ONE question with its choices written out as text.
- Before you build, check numbers by hand on a small case: compare with a
  textbook or an independent check.
- Report test failures honestly, with the output.
- Commit in small, clearly described steps, and push when the owner asks.
- Open questions to raise when relevant (HANDOVER.md section 8):
  - real operating temperatures per line (currently 21 °C = installation,
    so thermal loads are zero)
  - real insulation thickness
  - PTFE plates and blank support types
  - wind/seismic g-factors
  - a CAESAR II reference for 1885S
  - the 697 kg instrument
```
