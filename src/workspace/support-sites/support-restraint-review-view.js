import { SUPPORT_TYPE_OVERRIDE_VALUES } from './support-site-model.js';

// Restraints review (guide / line stop plan, step 1): the restraint table in
// the app, one row per support site, for the owner to check. A support whose
// parts all have a blank SUPPORT_TYPE gets a type picker; the choice is saved
// to Project Data topology.supportTypeOverridesByTag (by tag). Types that come
// from the source model are shown, not edited here.

const SHORT = Object.freeze({ UP_ONLY_LIFT_OFF_ALLOWED: 'up only', BOTH: 'held', FREE: 'free', NONE: 'none', ALL: 'all' });
const PICK_LABEL = Object.freeze({ '': '— not set —', REST: 'REST (R)', GUIDE: 'GUIDE (G)', LINESTOP: 'LINESTOP (LS)', NONE: 'NONE (not a support)' });

/** Rows for the review, with what can be edited and the current choice. */
export function restraintReviewRows(restraintTable, overrides = {}) {
  return (restraintTable?.rows || []).map((row) => {
    const tag = row.tags?.find((t) => t.startsWith('PS-')) || row.tags?.[0] || row.siteId;
    const editable = row.partCount > 0 && row.blankTypePartCount === row.partCount;
    const choice = editable ? (row.tags || []).map((t) => overrides?.[t]).find(Boolean) || '' : null;
    return {
      siteId: row.siteId,
      tag,
      tags: row.tags || [],
      line: (row.lineKeys || []).join(', '),
      positionMm: row.positionMm,
      code: row.code,
      status: row.status,
      typeFrom: row.typeAuthority === 'SOURCE' ? 'model' : (row.typeAuthority ? 'owner decision' : '—'),
      restrains: row.restrains,
      friction: row.friction,
      gapMm: row.gapMm,
      pipe: row.pipe,
      partCount: row.partCount,
      blankTypePartCount: row.blankTypePartCount,
      unknownTypes: row.unknownTypes || [],
      editable,
      choice,
    };
  });
}

/**
 * New override map after the owner's picks. picks: { siteId: value | '' };
 * a pick applies to every tag of that site; '' removes it.
 */
export function applyRestraintReviewPicks(overrides, rows, picks) {
  const next = { ...(overrides || {}) };
  const changes = [];
  rows.filter((row) => row.editable && Object.hasOwn(picks, row.siteId)).forEach((row) => {
    const value = String(picks[row.siteId] || '').toUpperCase();
    if (value && !SUPPORT_TYPE_OVERRIDE_VALUES.includes(value)) throw new RangeError(`Unknown support type ${value}.`);
    if (value === (row.choice || '')) return;
    row.tags.forEach((tag) => { if (value) next[tag] = value; else delete next[tag]; });
    changes.push(`${row.tag}: ${row.choice || 'not set'} → ${value || 'not set'}`);
  });
  return { overrides: next, changes };
}

/**
 * @param {HTMLElement} container
 * @param {object} input
 * @param {object|null} input.restraintTable
 * @param {object} input.overrides current topology.supportTypeOverridesByTag value
 * @param {string|null} input.message why there is no table (no model yet)
 * @param {(picks: object) => void} input.onSave
 */
export function renderSupportRestraintReview(container, { restraintTable = null, overrides = {}, message = null, onSave = null } = {}) {
  if (!container) return;
  if (!restraintTable) {
    container.innerHTML = `<section class="engineering-card" data-restraint-review><h3>Restraints review</h3><p class="panel-empty">${escapeHtml(message || 'Load a model to review its supports.')}</p></section>`;
    return;
  }
  const rows = restraintReviewRows(restraintTable, overrides);
  const counts = restraintTable.summary?.countsByCode || {};
  const blocked = rows.filter((row) => row.status === 'BLOCKED_UNKNOWN_FUNCTION');
  const editable = rows.filter((row) => row.editable);
  const n = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
  const restrains = (r) => (r ? `${SHORT[r.vertical] || r.vertical} / ${SHORT[r.axial] || r.axial} / ${SHORT[r.lateral] || r.lateral}` : '—');
  const friction = (f) => (f?.directions?.length ? `${f.directions.map((d) => (d === 'AXIAL' ? 'along' : 'across')).join(' or ')} (μ ${f.mu})` : '—');
  const picker = (row) => `<select name="supportType" data-restraint-pick="${escapeHtml(row.siteId)}">${['', ...SUPPORT_TYPE_OVERRIDE_VALUES]
    .map((value) => `<option value="${value}"${value === (row.choice || '') ? ' selected' : ''}>${escapeHtml(PICK_LABEL[value] || value)}</option>`).join('')}</select>`;
  const body = [...rows]
    .sort((a, b) => a.line.localeCompare(b.line) || a.tag.localeCompare(b.tag))
    .map((row) => `<tr data-restraint-site-id="${escapeHtml(row.siteId)}" data-restraint-status="${escapeHtml(row.status)}">
      <td>${escapeHtml(row.tag)}</td><td>${escapeHtml(row.line)}</td>
      <td>${n(row.positionMm?.x)}</td><td>${n(row.positionMm?.y)}</td><td>${n(row.positionMm?.z)}</td>
      <td><strong>${escapeHtml(row.code)}</strong></td>
      <td>${escapeHtml(restrains(row.restrains))}</td>
      <td>${escapeHtml(friction(row.friction))}</td>
      <td>${Number.isFinite(row.gapMm) ? `${row.gapMm} mm` : '—'}</td>
      <td>${escapeHtml(row.pipe?.orientation?.toLowerCase() || '—')}</td>
      <td>${row.editable ? picker(row) : escapeHtml(row.typeFrom)}</td>
      <td>${escapeHtml(row.status === 'READY' ? 'ok' : row.status === 'NOT_A_SUPPORT' ? 'not a support' : `blocked${row.unknownTypes.length ? `: ${row.unknownTypes.join(', ')}` : ': type not set'}`)}</td>
    </tr>`).join('');
  container.innerHTML = `
    <section class="engineering-card" data-restraint-review>
      <div class="engineering-card__header">
        <div><p class="eyebrow">Guide / line stop step 1</p><h3>Restraints review</h3></div>
        <span class="status-badge" data-restraint-review-status="${escapeHtml(restraintTable.status)}">${escapeHtml(restraintTable.status === 'PROPOSAL_READY' ? 'ready' : `${blocked.length} blocked`)}</span>
      </div>
      <p>${rows.length} support sites: ${Object.entries(counts).map(([code, count]) => `${count} ${escapeHtml(code)}`).join(', ')}.
        Columns: vertical / along the pipe / across the pipe. A support with an unknown type is blocked and never treated as a rest.
        ${editable.length ? `${editable.length} supports have no type in the model: pick one and save (saved to Project Data as your decision).` : ''}</p>
      <div class="table-scroll">
        <table class="engineering-table" data-restraint-review-table>
          <thead><tr><th>Support</th><th>Line</th><th>X</th><th>Y</th><th>Z</th><th>Type</th><th>Holds (vert / along / across)</th><th>Friction</th><th>Gap</th><th>Pipe</th><th>Type from</th><th>Status</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${editable.length ? '<p><button type="button" data-restraint-review-save>Save support types</button> <span data-restraint-review-note></span></p>' : ''}
    </section>`;
  const save = container.querySelector('[data-restraint-review-save]');
  if (save && onSave) {
    save.addEventListener('click', () => {
      const picks = Object.fromEntries([...container.querySelectorAll('[data-restraint-pick]')]
        .map((select) => [select.dataset.restraintPick, select.value]));
      try {
        const result = onSave(picks);
        const note = container.querySelector('[data-restraint-review-note]');
        if (note) note.textContent = result?.changes?.length ? `Saved: ${result.changes.join('; ')}. Re-seal the input and run again.` : 'No changes.';
      } catch (error) {
        const note = container.querySelector('[data-restraint-review-note]');
        if (note) note.textContent = `Not saved: ${error.message}`;
      }
    });
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}
