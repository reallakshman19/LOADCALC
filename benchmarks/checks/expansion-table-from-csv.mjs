// Converts a filled thermal expansion table CSV (layout of
// project-data/thermal-expansion-table-template.csv: Material, then one
// column per temperature in °C; values in mm/mm/°C, mean from installation)
// into the Project Data value for thermoMechanicalBasis.thermalExpansionTable.
// Blank cells stay null. Prints JSON; nothing is written.
// Run: node benchmarks/checks/expansion-table-from-csv.mjs <filled.csv>
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node benchmarks/checks/expansion-table-from-csv.mjs <filled.csv>');
  process.exit(1);
}
const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.trim());
const header = lines[0].split(',').map((cell) => cell.trim());
const temperaturesC = header.slice(1).map(Number);
if (temperaturesC.some((t) => !Number.isFinite(t))) throw new Error(`Header temperatures must be numbers: ${header.join(',')}`);
for (let i = 1; i < temperaturesC.length; i += 1) {
  if (!(temperaturesC[i] > temperaturesC[i - 1])) throw new Error('Temperature columns must increase left to right.');
}
const materials = {};
lines.slice(1).forEach((line, index) => {
  const cells = line.split(',').map((cell) => cell.trim());
  const material = cells[0];
  if (!material) throw new Error(`Row ${index + 2} has no material code.`);
  materials[material] = temperaturesC.map((_, i) => {
    const cell = cells[i + 1] ?? '';
    if (cell === '') return null;
    const value = Number(cell);
    if (!Number.isFinite(value) || value <= 0 || value > 1e-4) {
      throw new Error(`Row ${index + 2} (${material}), ${temperaturesC[i]} °C: "${cell}" is not a coefficient in mm/mm/°C (expected about 1e-5).`);
    }
    return value;
  });
});
console.log(JSON.stringify({
  schema: 'thermal-expansion-table/v1',
  unit: 'mm/mm/°C',
  basis: 'MEAN_FROM_INSTALLATION',
  basisNote: 'Mean coefficient between the installation temperature (21 °C) and T, so growth = coefficient x (T - 21) x length',
  temperaturesC,
  materials,
}, null, 2));
