'use strict';

/* ── State ─────────────────────────────────────────────────── */
const state = {
  pgSA2:        [],
  pgLGA:        [],
  population:   [],
  merged:       [],
  activeAges:   new Set(['0_4', '5_9', '10_14']),
  selectedLGA:  'all',
  selectedSA2s: new Set(),   // empty = show all
  searchTerm:   '',
  sortCol:      null,
  sortDir:      'asc',
  charts:       {},
  lastFetched:  null,
};

/* ── Helpers ─────────────────────────────────────────────────*/
const $    = id => document.getElementById(id);
const fmt  = n  => n == null ? '—' : Number(n).toLocaleString('en-AU');
const fmtR = n  => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2);

function computeKids(row) {
  let n = 0;
  if (state.activeAges.has('0_4'))   n += row.age_0_4   ?? 0;
  if (state.activeAges.has('5_9'))   n += row.age_5_9   ?? 0;
  if (state.activeAges.has('10_14')) n += row.age_10_14 ?? 0;
  return n;
}

function calcRatio(pg, kids) {
  return kids > 0 ? (pg / kids) * 1000 : null;
}

function ageLabel() {
  const a = state.activeAges;
  if (a.size === 3) return '0–14';
  return [...['0_4','5_9','10_14']]
    .filter(x => a.has(x))
    .map(x => x.replace('_','–'))
    .join(', ');
}

/* ── Chart.js defaults ──────────────────────────────────────*/
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.color       = '#6b7280';
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const SCALE_OPTS = {
  x: { grid: { color: '#f3f0ff' }, ticks: { maxRotation: 40, minRotation: 25, font: { size: 11 } } },
  y: { grid: { color: '#f3f0ff' }, beginAtZero: true },
};

const C = {
  purple:  '#7b2cbf', purpleA: 'rgba(123,44,191,.18)',
  teal:    '#388697', tealA:   'rgba(56,134,151,.18)',
  green:   '#5aad7f', greenA:  'rgba(90,173,127,.18)',
  mint:    '#a9dbb8', mintA:   'rgba(169,219,184,.25)',
};

/* ── Data fetching ───────────────────────────────────────────*/
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || `HTTP ${r.status}`); }
  return r.json();
}

async function loadData() {
  const qs  = state.selectedLGA === 'all' ? '' : `&lga=${encodeURIComponent(state.selectedLGA)}`;
  const pqs = state.selectedLGA === 'all' ? '' : `?lga=${encodeURIComponent(state.selectedLGA)}`;

  const [pgSA2Res, pgLGARes, popRes] = await Promise.all([
    fetchJSON(`/api/playground-stats?level=sa2${qs}`),
    fetchJSON(`/api/playground-stats?level=lga${qs}`),
    fetchJSON(`/api/population${pqs}`),
  ]);

  state.pgSA2      = pgSA2Res.data  ?? [];
  state.pgLGA      = pgLGARes.data  ?? [];
  state.population = popRes.data    ?? [];
  state.lastFetched = new Date();

  mergeSA2();
  rebuildSA2Dropdown();
}

function mergeSA2() {
  const popMap = Object.fromEntries(state.population.map(r => [r.sa2_code, r]));
  state.merged = state.pgSA2.map(pg => {
    const pop  = popMap[pg.sa2_code] ?? {};
    const row  = { ...pg, age_0_4: pop.age_0_4 ?? null, age_5_9: pop.age_5_9 ?? null, age_10_14: pop.age_10_14 ?? null };
    row.kids   = computeKids(row);
    row.ratio  = calcRatio(pg.total_playgrounds, row.kids);
    return row;
  }).sort((a, b) => a.lga.localeCompare(b.lga) || a.sa2_name.localeCompare(b.sa2_name));
}

function recomputeRatios() {
  state.merged.forEach(r => {
    r.kids  = computeKids(r);
    r.ratio = calcRatio(r.total_playgrounds, r.kids);
  });
}

/* ── SA2 multi-select dropdown ───────────────────────────────*/
function rebuildSA2Dropdown() {
  const list = $('sa2-options-list');
  const term = ($('sa2-search')?.value ?? '').toLowerCase();

  // Filter options: match search term AND current LGA filter
  const options = state.merged.filter(r =>
    (!term || r.sa2_name.toLowerCase().includes(term) || r.lga.toLowerCase().includes(term))
  );

  if (!options.length) {
    list.innerHTML = '<div class="sa2-no-results">No SA2 areas found</div>';
    return;
  }

  list.innerHTML = options.map(r => {
    const checked = state.selectedSA2s.size === 0 || state.selectedSA2s.has(r.sa2_code);
    const sel = state.selectedSA2s.has(r.sa2_code) ? ' selected' : '';
    return `<label class="sa2-option${sel}" data-code="${r.sa2_code}">
      <input type="checkbox" ${state.selectedSA2s.has(r.sa2_code) ? 'checked' : ''} data-code="${r.sa2_code}" />
      <span class="sa2-option-name">${r.sa2_name}</span>
      <span class="sa2-option-lga">${r.lga}</span>
    </label>`;
  }).join('');

  // Checkbox listeners
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const code = cb.dataset.code;
      if (cb.checked) state.selectedSA2s.add(code);
      else            state.selectedSA2s.delete(code);
      cb.closest('.sa2-option').classList.toggle('selected', cb.checked);
      updateSA2Trigger();
      renderTable();
    });
  });

  updateSA2Trigger();
}

function updateSA2Trigger() {
  const trigger = $('sa2-trigger');
  const placeholder = $('sa2-placeholder');

  // Remove old tags
  trigger.querySelectorAll('.sa2-tag, .sa2-tag-count').forEach(el => el.remove());

  const sel = state.selectedSA2s;
  if (sel.size === 0) {
    placeholder.style.display = '';
    placeholder.textContent = 'All SA2 areas';
    return;
  }

  placeholder.style.display = 'none';

  // Show up to 2 tags then "+N more"
  const codes   = [...sel];
  const byCode  = Object.fromEntries(state.merged.map(r => [r.sa2_code, r.sa2_name]));
  const maxShow = 2;
  const shown   = codes.slice(0, maxShow);
  const rest    = codes.length - maxShow;

  shown.forEach(code => {
    const tag = document.createElement('span');
    tag.className = 'sa2-tag';
    tag.innerHTML = `<span>${byCode[code] ?? code}</span>
      <button class="sa2-tag-remove" data-code="${code}" title="Remove">×</button>`;
    tag.querySelector('.sa2-tag-remove').addEventListener('click', e => {
      e.stopPropagation();
      state.selectedSA2s.delete(code);
      rebuildSA2Dropdown();
      renderTable();
    });
    trigger.insertBefore(tag, trigger.querySelector('.chevron'));
  });

  if (rest > 0) {
    const more = document.createElement('span');
    more.className = 'sa2-tag-count';
    more.textContent = `+${rest} more`;
    trigger.insertBefore(more, trigger.querySelector('.chevron'));
  }
}

function initSA2Dropdown() {
  const trigger  = $('sa2-trigger');
  const dropdown = $('sa2-dropdown');

  trigger.addEventListener('click', () => {
    const open = dropdown.classList.toggle('open');
    trigger.classList.toggle('open', open);
    if (open) $('sa2-search')?.focus();
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!$('sa2-multiselect-wrap').contains(e.target)) {
      dropdown.classList.remove('open');
      trigger.classList.remove('open');
    }
  });

  $('sa2-search').addEventListener('input', () => rebuildSA2Dropdown());

  $('sa2-select-all').addEventListener('click', () => {
    const term = ($('sa2-search')?.value ?? '').toLowerCase();
    const visible = state.merged.filter(r =>
      !term || r.sa2_name.toLowerCase().includes(term) || r.lga.toLowerCase().includes(term)
    );
    visible.forEach(r => state.selectedSA2s.add(r.sa2_code));
    rebuildSA2Dropdown();
    renderTable();
  });

  $('sa2-clear-all').addEventListener('click', () => {
    state.selectedSA2s.clear();
    rebuildSA2Dropdown();
    renderTable();
  });
}

/* ── KPI cards ───────────────────────────────────────────────*/
function renderKPIs() {
  const el     = $('kpi-row');
  const active = filteredRows();   // respect current SA2 selection for KPIs
  const lgaData = state.pgLGA;

  const totalPG   = active.reduce((s, r) => s + (r.total_playgrounds ?? 0), 0);
  const totalKids = active.reduce((s, r) => s + (r.kids ?? 0), 0);
  const ratio     = calcRatio(totalPG, totalKids);
  const bestSA2   = [...active].filter(r => r.ratio != null && r.kids > 50)
                               .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];

  const totShade  = lgaData.reduce((s, r) => s + (r.with_shade ?? 0), 0);
  const totToilet = lgaData.reduce((s, r) => s + (r.with_toilet ?? 0), 0);
  const totFenced = lgaData.reduce((s, r) => s + (r.fenced ?? 0), 0);
  const totAccess = lgaData.reduce((s, r) => s + (r.accessible ?? 0), 0);
  const totPGAll  = lgaData.reduce((s, r) => s + (r.total_playgrounds ?? 0), 0);

  el.innerHTML = `
    <div class="stats-kpi-card purple">
      <div class="stats-kpi-label">Total playgrounds</div>
      <div class="stats-kpi-value">${fmt(totalPG)}</div>
      <div class="stats-kpi-sub">across ${active.length} SA2 area${active.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="stats-kpi-card teal">
      <div class="stats-kpi-label">Children aged ${ageLabel()}</div>
      <div class="stats-kpi-value">${totalKids >= 1000 ? (totalKids/1000).toFixed(1)+'k' : fmt(totalKids)}</div>
      <div class="stats-kpi-sub">ABS Census 2021 usual residents</div>
    </div>
    <div class="stats-kpi-card purple">
      <div class="stats-kpi-label">Playgrounds per 1,000 children</div>
      <div class="stats-kpi-value">${fmtR(ratio)}</div>
      <div class="stats-kpi-sub">ages ${ageLabel()} · best: ${bestSA2?.sa2_name ?? '—'}</div>
    </div>
    <div class="stats-kpi-card teal">
      <div class="stats-kpi-label">Feature coverage</div>
      <div class="stats-kpi-value">${totPGAll ? Math.round(totShade/totPGAll*100) : 0}%</div>
      <div class="stats-kpi-sub">
        shaded &nbsp;·&nbsp; ${totPGAll ? Math.round(totToilet/totPGAll*100) : 0}% toilet
        &nbsp;·&nbsp; ${totPGAll ? Math.round(totFenced/totPGAll*100) : 0}% fenced
        &nbsp;·&nbsp; ${totPGAll ? Math.round(totAccess/totPGAll*100) : 0}% accessible
      </div>
    </div>
  `;
}

/* ── Table ───────────────────────────────────────────────────*/

// Column definitions — used for both header rendering and sort logic
const COLUMNS = [
  { key: 'sa2_name',          label: 'SA2 Area',          cls: 'sa2-name-cell', num: false },
  { key: 'lga',               label: 'Council',            cls: 'lga-cell',      num: false },
  { key: 'total_playgrounds', label: 'Playgrounds',        cls: 'num',           num: true  },
  { key: '_age_0_4',          label: 'Pop 0–4',           cls: 'num pop-cell',  num: true, ageGate: '0_4'   },
  { key: '_age_5_9',          label: 'Pop 5–9',           cls: 'num pop-cell',  num: true, ageGate: '5_9'   },
  { key: '_age_10_14',        label: 'Pop 10–14',         cls: 'num pop-cell',  num: true, ageGate: '10_14' },
  { key: 'kids',              label: `Children`,           cls: 'num',           num: true  },
  { key: 'ratio',             label: 'Per 1k children',   cls: 'num',           num: true, special: 'ratio' },
  { key: 'pct_shade',         label: 'Shade',              cls: 'num',           num: true  },
  { key: 'pct_water',         label: 'Water',              cls: 'num',           num: true  },
  { key: 'pct_toilet',        label: 'Toilet',             cls: 'num',           num: true  },
  { key: 'pct_fenced',        label: 'Fenced',             cls: 'num',           num: true  },
  { key: 'pct_accessible',    label: 'Access',             cls: 'num',           num: true  },
];

function visibleColumns() {
  return COLUMNS.filter(c => !c.ageGate || state.activeAges.has(c.ageGate));
}

function filteredRows() {
  let rows = state.merged;

  // Council filter (LGA select)
  if (state.selectedLGA !== 'all') {
    rows = rows.filter(r => r.lga === state.selectedLGA);
  }

  // SA2 multi-select filter (only if specific SA2s chosen)
  if (state.selectedSA2s.size > 0) {
    rows = rows.filter(r => state.selectedSA2s.has(r.sa2_code));
  }

  // Text search
  const term = state.searchTerm.toLowerCase();
  if (term) {
    rows = rows.filter(r =>
      r.sa2_name.toLowerCase().includes(term) ||
      r.lga.toLowerCase().includes(term) ||
      (r.sa3_name ?? '').toLowerCase().includes(term)
    );
  }

  return rows;
}

function sortedRows(rows) {
  if (!state.sortCol) return rows;
  const col = state.sortCol;
  const dir = state.sortDir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    let av = col.startsWith('_age') ? a[col.slice(1)] : a[col];
    let bv = col.startsWith('_age') ? b[col.slice(1)] : b[col];
    if (av == null) av = -Infinity;
    if (bv == null) bv = -Infinity;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });
}

function renderTable() {
  const wrap = $('table-wrap');
  const cols = visibleColumns();
  const rows = sortedRows(filteredRows());
  const maxRatio = Math.max(...rows.map(r => r.ratio ?? 0), 0.01);

  if (!rows.length) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:var(--font-size-sm)">
      No SA2 areas match your current filters.</div>`;
    return;
  }

  // Build header
  const thHtml = cols.map(c => {
    const sortCls = state.sortCol === c.key
      ? (state.sortDir === 'asc' ? ' sort-asc' : ' sort-desc') : '';
    const numCls  = c.num ? ' num' : '';
    const popCls  = c.ageGate ? ' pop-header' : '';
    return `<th class="sortable${numCls}${popCls}${sortCls}" data-col="${c.key}">
      ${c.key === 'kids' ? `Children (${ageLabel()})` : c.label}
      <span class="sort-icon"><span class="up"></span><span class="down"></span></span>
    </th>`;
  }).join('');

  // Build rows
  const tbodyHtml = rows.map(r => {
    const tds = cols.map(c => {
      if (c.special === 'ratio') {
        const rat    = r.ratio ?? 0;
        const barPct = Math.min(Math.round((rat / maxRatio) * 100), 100);
        const cls    = rat >= maxRatio * 0.66 ? 'ratio-high' : rat >= maxRatio * 0.33 ? 'ratio-mid' : 'ratio-low';
        const val    = r.age_0_4 == null ? '<span class="stats-no-data">—</span>' : fmtR(rat);
        return `<td class="num"><div class="ratio-cell-wrap ${cls}">
          <span>${val}</span>
          <div class="ratio-bar-bg"><div class="ratio-bar-fill" style="width:${barPct}%"></div></div>
        </div></td>`;
      }
      if (c.ageGate) {
        const val = r[c.key.slice(1)]; // strip leading _
        return `<td class="num pop-cell">${val == null ? '<span class="stats-no-data">—</span>' : fmt(val)}</td>`;
      }
      if (c.key === 'kids') {
        return `<td class="num">${r.age_0_4 == null ? '<span class="stats-no-data">—</span>' : fmt(r.kids)}</td>`;
      }
      // Percentage columns
      if (c.key.startsWith('pct_')) {
        return `<td class="num">${r[c.key] ?? 0}%</td>`;
      }
      return `<td class="${c.cls}">${r[c.key] ?? '—'}</td>`;
    }).join('');

    return `<tr>${tds}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="stats-table-scroll">
      <table class="stats-table">
        <thead><tr>${thHtml}</tr></thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>
    <div class="stats-table-footer">
      Showing ${rows.length} of ${state.merged.length} SA2 areas
      ${state.selectedLGA !== 'all' ? ` · ${state.selectedLGA}` : ''}
      ${state.selectedSA2s.size > 0 ? ` · ${state.selectedSA2s.size} SA2 selected` : ''}
      ${state.searchTerm ? ` · filtered by "${state.searchTerm}"` : ''}
    </div>
  `;

  // Sort listeners on headers
  wrap.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = 'desc'; // default: highest first for numeric cols
      }
      renderTable();
    });
  });
}

/* ── Charts ──────────────────────────────────────────────────*/
function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function aggregateToLGA() {
  const byLGA = {};
  for (const r of state.merged) {
    if (!byLGA[r.lga]) byLGA[r.lga] = { lga: r.lga, total_pg:0, kids:0, age_0_4:0, age_5_9:0, age_10_14:0, shade:0, water:0, toilet:0, fenced:0, accessible:0 };
    const b = byLGA[r.lga];
    b.total_pg   += r.total_playgrounds ?? 0;
    b.kids       += r.kids ?? 0;
    b.age_0_4    += r.age_0_4   ?? 0;
    b.age_5_9    += r.age_5_9   ?? 0;
    b.age_10_14  += r.age_10_14 ?? 0;
    b.shade      += r.with_shade      ?? 0;
    b.water      += r.with_water_play ?? 0;
    b.toilet     += r.with_toilet     ?? 0;
    b.fenced     += r.fenced          ?? 0;
    b.accessible += r.accessible      ?? 0;
  }
  return Object.values(byLGA).sort((a, b) => a.lga.localeCompare(b.lga));
}

function renderRatioChart() {
  destroyChart('ratio');
  const data = [...state.merged]
    .filter(r => r.kids > 50 && r.ratio != null)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, 30);

  state.charts.ratio = new Chart($('chart-ratio').getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.map(r => r.sa2_name),
      datasets: [{
        label: `Playgrounds per 1,000 children (${ageLabel()})`,
        data:  data.map(r => r.ratio),
        backgroundColor: C.purpleA,
        borderColor:     C.purple,
        borderWidth: 1.5, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(2)} per 1,000 children` } },
      },
      scales: SCALE_OPTS,
    },
  });
}

function renderPopulationChart() {
  destroyChart('population');
  const lgas = aggregateToLGA();
  state.charts.population = new Chart($('chart-population').getContext('2d'), {
    type: 'bar',
    data: {
      labels: lgas.map(r => r.lga),
      datasets: [
        { label: '0–4',   data: lgas.map(r => r.age_0_4),   backgroundColor: C.purpleA, borderColor: C.purple, borderWidth:1.5, borderRadius:4, hidden: !state.activeAges.has('0_4')   },
        { label: '5–9',   data: lgas.map(r => r.age_5_9),   backgroundColor: C.tealA,   borderColor: C.teal,   borderWidth:1.5, borderRadius:4, hidden: !state.activeAges.has('5_9')   },
        { label: '10–14', data: lgas.map(r => r.age_10_14), backgroundColor: C.greenA,  borderColor: C.green,  borderWidth:1.5, borderRadius:4, hidden: !state.activeAges.has('10_14') },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true }, tooltip: { mode: 'index', intersect: false } },
      scales: SCALE_OPTS,
    },
  });
}

function renderLGARatioChart() {
  destroyChart('lgaRatio');
  const lgas = aggregateToLGA();
  state.charts.lgaRatio = new Chart($('chart-lga-ratio').getContext('2d'), {
    type: 'bar',
    data: {
      labels: lgas.map(r => r.lga),
      datasets: [{
        label: `Playgrounds per 1,000 children (${ageLabel()})`,
        data:  lgas.map(r => calcRatio(r.total_pg, r.kids)),
        backgroundColor: C.tealA,
        borderColor:     C.teal,
        borderWidth: 1.5, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${(c.parsed.y ?? 0).toFixed(2)} per 1,000 children` } },
      },
      scales: SCALE_OPTS,
    },
  });
}

function renderFeatureBars(containerId, key, color) {
  const lgas   = aggregateToLGA();
  const sorted = lgas.map(r => ({
    label: r.lga,
    pct: r.total_pg > 0 ? Math.round((r[key] / r.total_pg) * 100) : 0,
  })).sort((a, b) => b.pct - a.pct);

  $(containerId).innerHTML = sorted.map(r => `
    <div class="feat-row">
      <span class="feat-label" title="${r.label}">${r.label}</span>
      <div class="feat-track">
        <div class="feat-fill" style="width:${r.pct}%;background:${color}"></div>
      </div>
      <span class="feat-pct">${r.pct}%</span>
    </div>`).join('');
}

function renderAllCharts() {
  renderRatioChart();
  renderPopulationChart();
  renderLGARatioChart();
  renderFeatureBars('feature-shade-bars',  'shade',      C.purple);
  renderFeatureBars('feature-water-bars',  'water',      C.teal);
  renderFeatureBars('feature-toilet-bars', 'toilet',     C.teal);
  renderFeatureBars('feature-fenced-bars', 'fenced',     C.green);
  renderFeatureBars('feature-access-bars', 'accessible', C.green);
}

/* ── Full render ─────────────────────────────────────────────*/
function render() {
  renderKPIs();
  renderTable();
  renderAllCharts();
  if (state.lastFetched) {
    $('last-updated').textContent =
      `Data: ABS Census 2021 · Loaded ${state.lastFetched.toLocaleTimeString('en-AU')}`;
  }
}

/* ── Init ────────────────────────────────────────────────────*/
async function init() {
  $('kpi-row').innerHTML    = '<div class="stats-loading" style="grid-column:1/-1"><div class="stats-spinner"></div><span>Loading…</span></div>';
  $('table-wrap').innerHTML = '<div class="stats-loading"><div class="stats-spinner"></div></div>';
  try {
    await loadData();
    render();
  } catch (err) {
    console.error('[stats.js]', err);
    $('kpi-row').innerHTML = `<div class="stats-error" style="grid-column:1/-1">Failed to load: ${err.message}</div>`;
  }
}

/* ── Event listeners ─────────────────────────────────────────*/
$('lga-select').addEventListener('change', e => {
  state.selectedLGA = e.target.value;
  state.selectedSA2s.clear();   // clear SA2 selection when council changes
  // Reload data filtered to new LGA (faster API call)
  init();
});

$('refresh-btn').addEventListener('click', init);

$('table-search').addEventListener('input', e => {
  state.searchTerm = e.target.value.trim();
  renderTable();
});

document.querySelectorAll('.stats-age-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const age = btn.dataset.age;
    if (state.activeAges.has(age)) {
      if (state.activeAges.size === 1) return;
      state.activeAges.delete(age);
      btn.classList.remove('active');
    } else {
      state.activeAges.add(age);
      btn.classList.add('active');
    }
    recomputeRatios();
    render();
  });
});

/* ── Boot ────────────────────────────────────────────────────*/
initSA2Dropdown();
init();
