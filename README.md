# LOADCALC

Load Calc and 3D Edit, isolated from
[Advanced_Analysis](https://github.com/reallakshman19/Advanced_Analysis).

## Run

```
npm install
npm run dev       # http://localhost:5173
npm run build     # -> dist/
npm run preview
```

Use **3D Demo** in the Dataset Tree to load the bundled fixture. Then open
**Edit, Topo fix and Load Calc**. **Review findings in 3D** (or the viewport's
**3D Edit** tab) opens the 3D editor.

## What was kept

| Kept | Notes |
| --- | --- |
| Workspace view | Dataset tree, shared 3D/2D viewport, properties panel, sequential sketcher |
| Load Calc view | `load-calc-*`, engineering-loads, enrichment, master/project data, non-FEA pipeline |
| 3D Edit | `topology-edit*`, `viewport-interaction`, `viewport-productivity`, `viewport-presentation` |
| Common core | `src/core/*` contracts these depend on (shared-piping-model, piping-topology, support-*, model-loads, vertical-beam-solver, ...) |

## What was removed

The LAFEA, LFEA (linear piping pipeline, ACCDB/InputXML/StagedJSON intake),
Empirical workbench, Empirical V3 safety workbench, LFEA pre-flight, the tab
benchmark badge, and all QA/benchmark scripts, docs and e2e suites.

## Files changed from upstream

Upstream code is copied unchanged except for:

- `src/main.js` is a new entry that mounts only the workspace and the authorized-enrichment API.
- `src/workspace/bootstrap.js` no longer builds the LAFEA/LFEA/Empirical controllers or the tab benchmark.
- `src/workspace/workspace-layout.js` drops those view roots and their styles, and rebrands the header.
- `src/workspace/application-shell-controller.js` limits navigation to `WORKSPACE` and `LOAD_CALC`.

## Re-syncing from upstream

`scripts/trace-deps.mjs` follows every static import, dynamic `import()`,
`new URL(..., import.meta.url)` worker, and CSS `@import`, starting from
`src/main.js`. Files in this app override files of the same path in the
upstream checkout:

```
git clone --depth 1 https://github.com/reallakshman19/Advanced_Analysis _source
OUT_DIR=. node scripts/trace-deps.mjs . _source src/main.js   # writes trace.json
```

Copy any file listed in `trace.json` that is not yet in this app, but keep the
four files above. Then run `npm run build` and boot the app in a browser.
