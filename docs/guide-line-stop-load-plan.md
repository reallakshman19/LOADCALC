# Guide and line stop loads: empirical method plan

Status: plan, 2026-11-26. Not built yet. Scope is empirical (non-FEA): no whole-system stiffness model.

## 1. What loads a guide or line stop carries

| Load | Guide (lateral) | Line stop (axial) | How accurate empirically |
| --- | --- | --- | --- |
| Weight (vertical) | yes, a guide usually also rests the pipe | yes | Good: Option B (three-moment + lift-off) |
| Friction from sliding supports | friction at the guide itself, along the pipe | sum of friction on the leg it holds | Good, if the vertical loads are good and μ is right |
| Thermal growth of a perpendicular leg | leg bending pushes the guide sideways | adjacent legs push or pull the stop | Screening only: bounded estimate |
| Thermal growth of its own leg | n/a (a guide does not stop axial growth) | stop holds the leg's growth | Friction part good; the flexibility part is screening |
| Occasional (wind or seismic, if the project asks) | g-factor × tributary weight | g-factor × axial tributary weight | Good as an empirical design load |

Every result is labelled **ACCURATE** (weight, friction, occasional) or **SCREENING** (thermal flexibility). Only ACCURATE results count toward the 90 % target.

## 2. Method, step by step

### Step 1: Restraint table (data, no maths)
For each support site, list the restrained directions, gap and μ, taken from SUPPORT_TYPE and the SPRE catalogue family:

| Function | Restrains | Friction acts in |
| --- | --- | --- |
| REST | +vertical (one way, lift-off allowed) | both horizontal directions |
| GUIDE | +vertical, ±lateral (horizontal ⟂ pipe) | axial |
| LINESTOP / directional anchor | +vertical, ±axial | lateral |
| ANCHOR | all 6 | none |

The user reviews it as a proposal, as with Master Data. A support with an unknown function blocks its own result and does not silently become a REST.

### Step 2: Leg decomposition
Split each route into straight **legs** between direction changes (elbows, bends, tees). Each leg records its axis, length, end fittings and the restraints on it. Tees join legs into a small graph.

### Step 3: Free thermal growth
For each leg: δ = α · ΔT · L, with ΔT = T_operating − T_installation for the line. The repo already has `createNonFeaThermalFreeMovementBasis` (`src/core/non-fea-engineering-foundation/thermal-free-movement.js`).

### Step 4: Fixed points and neutral points
- An axial line stop or anchor on a leg is that leg's fixed point.
- A leg with no axial stop grows from its **neutral point**, the chainage where friction on the two sides balances: Σ μ·Nᵢ (left) = Σ μ·Nᵢ (right).
- Two axial stops on one straight leg with no loop between them are reported as a **design finding**: the axial force tends to E·A·α·ΔT. It is never shown as a normal load.

### Step 5: Friction loads (ACCURATE)
- At each sliding support: F = μ · N_OPE, directed against that support's movement (from steps 3 and 4).
- Report two values. **Movement-based** is zero where the movement is zero, for example at the neutral point. **Design** is μ·N regardless of movement, which is the usual conservative practice.
- N_OPE comes from Option B, so friction accuracy follows the vertical accuracy.

### Step 6: Line stop axial load
F_stop = friction on the held side (Σ μ·Nᵢ from the stop to the leg's free end or the next stop)
       + push from the adjacent legs (step 7 forces acting along this leg's axis)
       + occasional axial (g × weight held, if the project defines it).
Report a **lower bound** (friction only) and an **upper bound** (friction + flexibility push). The friction part is ACCURATE; the push is SCREENING.

### Step 7: Guide lateral load (guided cantilever, Kellogg)
A perpendicular leg's growth Δ deflects the guided leg between the elbow and its first guide, over length L:
- Upper bound (guided cantilever, rotation held): F = 12·E·I·Δ / L³
- Lower bound (elbow free to rotate): F = 3·E·I·Δ / L³
- Elbow flexibility (flexibility factor k from `circular-elbow-flexibility.js`) moves the result between the two bounds.
- If the force exceeds friction plus the guide's design capacity, flag "guide too close to the elbow", the same check a stress engineer makes.

Lateral friction at a line stop and occasional lateral (g × tributary weight) are added as in steps 5 and 6.

### Step 8: Combine and report
For each support and each case (EMPTY / OPE / HYD / optional OCC), report vertical, axial and lateral forces, with sign, bound, label (ACCURATE / SCREENING) and the leg and assumption that drove the number. Equilibrium is checked per leg (axial friction and stop forces) as well as globally.

## 3. Validation
1. **Hand-calc tests**: textbook guided-cantilever L-bend and Z-bend cases, friction neutral point on a straight leg, and a two-stop leg that must raise the design finding.
2. **Cross-check**: the repo's rooted-tree flexibility solver (`src/core/empirical-piping-mechanics/thermal-restraint-compatibility.js`), used on simple L and Z cases only as a reference, not in production. It checks that the SCREENING bounds contain the reference.
3. **1885S**: a CAESAR II run (or similar) gives the real accuracy figure for each label.

## 4. 1885S data gaps (blockers)
- **Operating temperatures**: Project Data has `operatingTemperaturesC = { DEFAULT: 21 }`, which equals the installation temperature, so ΔT = 0 and every thermal and movement-based friction load is zero. The source calls 11 supports "Directional Anchor On Shoe for **Hot Insulated** Pipe", so real temperatures per line are needed.
- **Support functions**: 91 REST, 11 LINESTOP (the ST06 directional anchors), 6 GUIDE (GT01 family) and 31 parts with a blank SUPPORT_TYPE. **Resolved 2026-11-26:** 25 of the 31 are frame parts on supports that already have a typed part; the owner set PS-12297 = REST and the other 5 to NONE, and PS-12248's line stop part was merged into its support.
- **Friction**: μ 0.3 (steel) and 0.1 (PTFE) are approved defaults; which supports have PTFE slide plates is not known.
- **Occasional loads**: wind or seismic g-factors, only if the project wants them.

## 5. Build order
| # | Work | Depends on | Output label |
| --- | --- | --- | --- |
| 0 | Option B (three-moment with lift-off) for vertical loads. **Done 2026-11-26**, in the Run as CONTINUOUS_SPAN_THREE_MOMENT_V1 | — | ACCURATE |
| 1 | Restraint table proposal and support-function mapping. **Done 2026-11-26** as data + script (`support-restraint-table.js`); an in-app review screen is still to do | — | data |
| 2 | Leg decomposition and free growth (reuse thermal-free-movement) | 1, temperatures | data |
| 3 | Friction loads, movement-based and design | 0, 2 | ACCURATE |
| 4 | Line stop axial: friction part, then the flexibility upper bound | 3 | ACCURATE + SCREENING |
| 5 | Guide lateral: guided-cantilever bounds and the too-close-to-elbow flag | 2 | SCREENING |
| 6 | Optional occasional g-factor loads | 0, 1 | ACCURATE |
| 7 | Hand-calc test suite, cross-check, 1885S results table in ROADMAP | each step | — |
