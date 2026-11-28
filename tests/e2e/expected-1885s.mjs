// Expected 1885S end-to-end results (Option B, AUTO). Change these only with a
// reason recorded in ROADMAP.md: a new number here is a change in a result.
//
// Sample Line List (repo): 0 mm insulation and the 1000 kg/m3 fluid density
// fallback (SAMPLE ASSUMPTIONS), no line temperatures, so thermal results are 0.
// Real Line List (local only): insulation, densities and T2 = 309 degC per line.

export const SAMPLE_EXPECTED = Object.freeze({
  proposals: 172,
  appliedN: { EMPTY: 87618.5, OPE: 100365.6, HYD: 104040.9 },
  // Golden vertical loads, N: [EMPTY, OPE, HYD]. With the sample's 1000 kg/m3
  // fluid fallback, OPE = HYD on the 10" S8810101 line (PS-12059).
  supportVerticalN: {
    'PS-12244': [3733.5, 3755.6, 4063.5],
    'PS-12247': [8752.9, 8771.5, 9031.0],
    'PS-12250': [7316.4, 7324.4, 7436.7],
    'PS-12059': [6787.4, 8234.3, 8234.3],
    'PS-12268': [2502.0, 2531.4, 2940.7],
  },
  frictionTotalN: 24073.3,
  lineStopDesignN: { 'PS-12248': 4494, 'PS-12060': 2470 },
});

export const REAL_EXPECTED = Object.freeze({
  proposals: 215,
  appliedN: { EMPTY: 101421.0, OPE: 102521.3, HYD: 117843.5 },
  supportVerticalN: {
    'PS-12244': [4012.6, 4034.8, 4342.7],
    'PS-12247': [8928.8, 8947.5, 9207.0],
    'PS-12250': [7572.2, 7580.2, 7692.5],
    'PS-12059': [7920.4, 8017.3, 9367.3],
    'PS-12268': [2876.8, 2906.2, 3315.6],
  },
  // EMPTY difference from the sample run: Line List insulation, 1,407 kg
  // (hand check 2026-11-27: 120 / 100 / 80 mm on 10" / 8" / 6").
  insulationN: 13802.5,
  operatingC: 309,
  frictionTotalN: 24565.0,
  lineStopDesignN: { 'PS-12248': 4690, 'PS-12060': 2405, 'PS-12240': 1374 },
  guideBoundsN: { 'PS-12268': [2144.4, 8577.8], 'PS-12242': [496.0, 1984.1], 'PS-12248': [3.0, 152.6] },
  lineStopThermal: { bounded: 0, lineEndUnknown: 9, findings: 7, ps12060FindingKN: 738.7 },
});

// Shared by both runs: model, supports and the vertical exception ledger.
export const COMMON_EXPECTED = Object.freeze({
  method: 'CONTINUOUS_SPAN_THREE_MOMENT_V1',
  supportSites: 36,
  restraintCodes: { R: 19, NONE: 5, 'R+G+LS': 5, 'R+LS': 6, 'R+G': 1 },
  exceptionCounts: { OVERHANG_CANTILEVER_TRANSFER: 37, BRANCH_LOAD_TRANSFERRED_TO_HOST: 2, SUPPORT_LIFTOFF_RELEASED: 1 },
  fittingClearWinners: 26,
  fittingReviewRows: 31,
  sampleFittingWeights: 5,
  slidingSupports: 25,
  lineStops: 11,
  guides: 6,
});

// The SAMPLE ASSUMPTION notice at the top of the Results page (owner rule:
// sample assumptions stay labelled), with the sample Line List. The client
// Line List gives every line a density, so its notice has no density line.
export const SAMPLE_ASSUMPTION_NOTICE = Object.freeze([
  '5 fitting weights are placeholders (408 kg, 15 kg, 4 kg, 4 kg, 3 kg), not project data.',
  'Operating fluid density 1000 kg/m³ fallback on 4 line(s) with no density in the Line List: S8810101, S8810103, S8810111, S8810112.',
  'Insulation thickness 0 mm wherever the Line List gives none (Project Data default 1885S_INSULATION_THICKNESS_SAMPLE_ZERO).',
]);
