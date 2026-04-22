/**
 * stats.js — Playground Statistics page
 *
 * Data sources (both at SA2 level):
 *   GET /api/playground-stats?level=sa2[&lga=X]  — playground counts + features per SA2
 *   GET /api/playground-stats?level=lga[&lga=X]  — LGA rollup for KPI cards
 *   GET /api/population[?lga=X]                  — ABS 2021 children 0–14 per SA2
 *
 * Merge key: sa2_code
 *
 * Age toggle buttons control which age bands feed into:
 *   - "Children" column in the table
 *   - Playgrounds per 1,000 children ratio
 *   - Population chart series visibility
 */

'use strict';

/* ── State ─────────────────────────────────────────────────── */
const state = {
  pgSA2:      [],   // playground stats at SA2 level
  pgLGA:      [],   // playground stats at LGA level (for KPI cards)
  population: [],   // ABS population at SA2 level
  merged:     [],   // joined on sa2_code
  activeAges: new Set(['0_4', '5_9', '10_14']),
  selectedLGA:'all',
  searchTerm: '',
  charts:     {},
  lastFetched: null,
};

/* ── Helpers ─────────────────────────────────────────────────*/
const $   = id => document.getElementById(id);
const fmt = n  => n == null ? '—' : Number(n).toLocaleString('en-AU');
const fmtR = n => n == null || isNaN(n) ? '—' : Number(n).toFixed(2);

function computeKids(row) {
  let n = 0;
  if (state.activeAges.has('0_4'))   n += row.age_0_4   ?? 0;
  if (state.activeAges.has('5_9'))   n += row.age_5_9   ?? 0;
  if (state.activeAges.has('10_14')) n += row.age_10_14 ?? 0;
  return n;
}

function ratio(pg, kids) {
  return kids > 0 ? (pg / kids) * 1000 : null;
}

function ageLabel() {
  const a = state.activeAges;
  if (a.size === 3) return '0–14';
  const parts = [];
  if (a.has('0_4'))   parts.push('0–4');
  if (a.has('5_9'))   parts.push('5–9');
  if (a.has('10_14')) parts.push('10–14');
  return parts.join(', ');
}

/* ── Chart defaults ─────────────────────────────────────────*/
Chart.defaults.color       = '#637fa0';
Chart.defaults.font.family = "'Outfit', sans-serif";
Chart.defaults.font.size   = 12;
Chart.defaults.plugins.legend.labels.boxWidth = 12;

const BASE_SCALE_OPTS = {
  x: { grid: { color: 'rgba(29,52,80,.5)' }, ticks: { maxRotation: 40, minRotation: 30, font: { size: 11 } } },
  y: { grid: { color: 'rgba(29,52,80,.5)' }, beginAtZero: true },
};

const PALETTE = {
  teal:  '#00c9a7', tealA:  'rgba(0,201,167,.18)',
  amber: '#ffb347', amberA: 'rgba(255,179,71,.18)',
  blue:  '#4d8af0', blueA:  'rgba(77,138,240,.18)',
  rose:  '#f06292', roseA:  'rgba(240,98,146,.18)',
  purple:'#b07fff', purpleA:'rgba(176,127,255,.18)',
};

/* ── Data fetching ──────────────────────────────────────────*/
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

async function loadData() {
  const qs = state.selectedLGA === 'all'
    ? ''
    : `&lga=${encodeURIComponent(state.selectedLGA)}`;

  const [pgSA2Res, pgLGARes, popRes] = await Promise.all([
    fetchJSON(`/api/playground-stats?level=sa2${qs}`),
    fetchJSON(`/api/playground-stats?level=lga${qs}`),
    fetchJSON(`/api/population${qs.replace('&', '?')}`),
  ]);

  state.pgSA2      = pgSA2Res.data  ?? [];
  state.pgLGA      = pgLGARes.data  ?? [];
  state.population = popRes.data    ?? [];
  state.lastFetched = new Date();

  mergeSA2();
}

function mergeSA2() {
  // Build population map keyed by sa2_code
  const popMap = Object.fromEntries(
    state.population.map(r => [r.sa2_code, r])
  );

  state.merged = state.pgSA2.map(pg => {
    const pop  = popMap[pg.sa2_code] ?? {};
    const kids = computeKids({ ...pg, ...pop });
    return {
      ...pg,
      age_0_4:    pop.age_0_4   ?? null,
      age_5_9:    pop.age_5_9   ?? null,
      age_10_14:  pop.age_10_14 ?? null,
      kids,
      ratio: ratio(pg.total_playgrounds, kids),
    };
  }).sort((a, b) => a.lga.localeCompare(b.lga) || a.sa2_name.localeCompare(b.sa2_name));
}

function recomputeRatios() {
  state.merged.forEach(r => {
    r.kids  = computeKids(r);
    r.ratio = ratio(r.total_playgrounds, r.kids);
  });
}

/* ── KPI cards ──────────────────────────────────────────────*/
function renderKPIs() {
  const el = $('kpi-row');

  // Use LGA-level rollup for totals (clean numbers)
  const lgaData   = state.pgLGA;
  const totalPG   = lgaData.reduce((s, r) => s + (r.total_playgrounds ?? 0), 0);
  const totalSA2s = state.merged.length;

  // Population totals from merged SA2 data
  const totalKids = state.merged.reduce((s, r) => s + (r.kids ?? 0), 0);
  const overallRatio = ratio(totalPG, totalKids);

  // Best SA2 by ratio
  const bestSA2 = [...state.merged]
    .filter(r => r.ratio != null && r.kids > 50) // ignore SA2s with tiny populations
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];

  // Feature totals across LGA rollup
  const totalShade  = lgaData.reduce((s, r) => s + (r.with_shade ?? 0), 0);
  const totalToilet = lgaData.reduce((s, r) => s + (r.with_toilet ?? 0), 0);
  const totalFenced = lgaData.reduce((s, r) => s + (r.fenced ?? 0), 0);
  const totalAccess = lgaData.reduce((s, r) => s + (r.accessible ?? 0), 0);

  el.innerHTML = `
    <div class="kpi-card teal">
      <div class="kpi-label">Total playgrounds</div>
      <div class="kpi-value">${fmt(totalPG)}</div>
      <div class="kpi-sub">across ${totalSA2s} SA2 areas</div>
    </div>
    <div class="kpi-card amber">
      <div class="kpi-label">Children aged ${ageLabel()}</div>
      <div class="kpi-value">${totalKids >= 1000 ? (totalKids/1000).toFixed(1)+'k' : fmt(totalKids)}</div>
      <div class="kpi-sub">ABS Census 2021 usual residents</div>
    </div>
    <div class="kpi-card blue">
      <div class="kpi-label">Playgrounds per 1,000 children</div>
      <div class="kpi-value">${fmtR(overallRatio)}</div>
      <div class="kpi-sub">ages ${ageLabel()} · best SA2: ${bestSA2?.sa2_name ?? '—'}</div>
    </div>
    <div class="kpi-card rose">
      <div class="kpi-label">Feature coverage</div>
      <div class="kpi-value">${totalPG ? Math.round(totalShade/totalPG*100) : 0}%</div>
      <div class="kpi-sub">
        shaded · ${totalPG ? Math.round(totalToilet/totalPG*100) : 0}% toilet ·
        ${totalPG ? Math.round(totalFenced/totalPG*100) : 0}% fenced ·
        ${totalPG ? Math.round(totalAccess/totalPG*100) : 0}% accessible
      </div>
    </div>
  `;
}

/* ── Main SA2 table ─────────────────────────────────────────*/
function renderTable() {
  const wrap = $('table-wrap');

  // Apply search filter
  const term = state.searchTerm.toLowerCase();
  const data = term
    ? state.merged.filter(r =>
        r.sa2_name.toLowerCase().includes(term) ||
        r.lga.toLowerCase().includes(term) ||
        (r.sa3_name ?? '').toLowerCase().includes(term)
      )
    : state.merged;

  if (!data.length) {
    wrap.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:14px">
      No SA2 areas match "${state.searchTerm}"</div>`;
    return;
  }

  const maxRatio = Math.max(...data.map(r => r.ratio ?? 0), 0.01);

  const rows = data.map(r => {
    const rat    = r.ratio ?? 0;
    const barPct = Math.min(Math.round((rat / maxRatio) * 100), 100);
    const cls    = rat >= maxRatio * 0.66 ? 'ratio-good'
                 : rat >= maxRatio * 0.33 ? 'ratio-mid' : 'ratio-low';
    const popNull = r.age_0_4 == null;

    return `<tr>
      <td class="sa2-name">${r.sa2_name}</td>
      <td class="lga-cell">${r.lga}</td>
      <td class="num">${fmt(r.total_playgrounds)}</td>
      ${state.activeAges.has('0_4')   ? `<td class="num pop-col">${popNull ? '<span class="no-data">—</span>' : fmt(r.age_0_4)}</td>`   : ''}
      ${state.activeAges.has('5_9')   ? `<td class="num pop-col">${popNull ? '<span class="no-data">—</span>' : fmt(r.age_5_9)}</td>`   : ''}
      ${state.activeAges.has('10_14') ? `<td class="num pop-col">${popNull ? '<span class="no-data">—</span>' : fmt(r.age_10_14)}</td>` : ''}
      <td class="num">${popNull ? '<span class="no-data">—</span>' : fmt(r.kids)}</td>
      <td class="num">
        <div class="ratio-cell ${cls}">
          <span>${popNull ? '—' : fmtR(rat)}</span>
          <div class="ratio-bar-wrap"><div class="ratio-bar" style="width:${barPct}%"></div></div>
        </div>
      </td>
      <td class="num">${r.pct_shade ?? 0}%</td>
      <td class="num">${r.pct_water ?? 0}%</td>
      <td class="num">${r.pct_toilet ?? 0}%</td>
      <td class="num">${r.pct_fenced ?? 0}%</td>
      <td class="num">${r.pct_accessible ?? 0}%</td>
    </tr>`;
  }).join('');

  // Dynamic age-group column headers
  const ageHeaders = [
    state.activeAges.has('0_4')   ? '<th class="num pop-header" title="ABS Census 2021">Pop 0–4</th>'   : '',
    state.activeAges.has('5_9')   ? '<th class="num pop-header" title="ABS Census 2021">Pop 5–9</th>'   : '',
    state.activeAges.has('10_14') ? '<th class="num pop-header" title="ABS Census 2021">Pop 10–14</th>' : '',
  ].join('');

  wrap.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>SA2 Area</th>
          <th>Council</th>
          <th class="num">Playgrounds</th>
          ${ageHeaders}
          <th class="num">Children (${ageLabel()})</th>
          <th class="num">Per 1k children</th>
          <th class="num">Shade</th>
          <th class="num">Water</th>
          <th class="num">Toilet</th>
          <th class="num">Fenced</th>
          <th class="num">Access</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="table-footer">
      Showing ${data.length} of ${state.merged.length} SA2 areas
      ${term ? `· filtered by "<strong>${term}</strong>"` : ''}
    </div>
  `;
}

/* ── Charts ─────────────────────────────────────────────────*/
function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

// Aggregate merged SA2 data up to LGA level for charts
function aggregateToLGA() {
  const byLGA = {};
  for (const r of state.merged) {
    if (!byLGA[r.lga]) byLGA[r.lga] = {
      lga: r.lga, total_pg: 0, kids: 0,
      age_0_4: 0, age_5_9: 0, age_10_14: 0,
      shade: 0, water: 0, toilet: 0, fenced: 0, accessible: 0,
    };
    const b = byLGA[r.lga];
    b.total_pg    += r.total_playgrounds ?? 0;
    b.kids        += r.kids ?? 0;
    b.age_0_4     += r.age_0_4   ?? 0;
    b.age_5_9     += r.age_5_9   ?? 0;
    b.age_10_14   += r.age_10_14 ?? 0;
    b.shade       += r.with_shade      ?? 0;
    b.water       += r.with_water_play ?? 0;
    b.toilet      += r.with_toilet     ?? 0;
    b.fenced      += r.fenced          ?? 0;
    b.accessible  += r.accessible      ?? 0;
  }
  return Object.values(byLGA).sort((a, b) => a.lga.localeCompare(b.lga));
}

function renderRatioChart() {
  destroyChart('ratio');
  // Top 30 SA2s by ratio (excluding tiny populations)
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
        backgroundColor: PALETTE.tealA,
        borderColor:     PALETTE.teal,
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y.toFixed(2)} per 1,000 children` } },
      },
      scales: BASE_SCALE_OPTS,
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
        {
          label: 'Ages 0–4',
          data:  lgas.map(r => r.age_0_4),
          backgroundColor: PALETTE.tealA, borderColor: PALETTE.teal,
          borderWidth: 1.5, borderRadius: 4,
          hidden: !state.activeAges.has('0_4'),
        },
        {
          label: 'Ages 5–9',
          data:  lgas.map(r => r.age_5_9),
          backgroundColor: PALETTE.amberA, borderColor: PALETTE.amber,
          borderWidth: 1.5, borderRadius: 4,
          hidden: !state.activeAges.has('5_9'),
        },
        {
          label: 'Ages 10–14',
          data:  lgas.map(r => r.age_10_14),
          backgroundColor: PALETTE.blueA, borderColor: PALETTE.blue,
          borderWidth: 1.5, borderRadius: 4,
          hidden: !state.activeAges.has('10_14'),
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true }, tooltip: { mode: 'index', intersect: false } },
      scales: BASE_SCALE_OPTS,
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
        label: 'Playgrounds per 1,000 children',
        data:  lgas.map(r => ratio(r.total_pg, r.kids)),
        backgroundColor: PALETTE.amberA,
        borderColor:     PALETTE.amber,
        borderWidth: 1.5, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${(c.parsed.y ?? 0).toFixed(2)} per 1,000 children` } },
      },
      scales: BASE_SCALE_OPTS,
    },
  });
}

function renderFeatureBars(containerId, key, color) {
  const lgas   = aggregateToLGA();
  const sorted = lgas.map(r => ({
    label: r.lga,
    pct:   r.total_pg > 0 ? Math.round((r[key] / r.total_pg) * 100) : 0,
  })).sort((a, b) => b.pct - a.pct);

  $(containerId).innerHTML = sorted.map(r => `
    <div class="feature-row">
      <span class="feature-label">${r.label}</span>
      <div class="feature-track">
        <div class="feature-fill" style="width:${r.pct}%;background:${color}"></div>
      </div>
      <span class="feature-pct">${r.pct}%</span>
    </div>`).join('');
}

function renderAllCharts() {
  renderRatioChart();
  renderPopulationChart();
  renderLGARatioChart();
  renderFeatureBars('feature-shade-bars',  'shade',      PALETTE.teal);
  renderFeatureBars('feature-water-bars',  'water',      PALETTE.blue);
  renderFeatureBars('feature-toilet-bars', 'toilet',     PALETTE.purple);
  renderFeatureBars('feature-fenced-bars', 'fenced',     PALETTE.amber);
  renderFeatureBars('feature-access-bars', 'accessible', PALETTE.rose);
}

/* ── Full render ────────────────────────────────────────────*/
function render() {
  renderKPIs();
  renderTable();
  renderAllCharts();
  if (state.lastFetched) {
    $('last-updated').textContent =
      `Data: ABS Census 2021 · Loaded ${state.lastFetched.toLocaleTimeString('en-AU')}`;
  }
}

/* ── Init ───────────────────────────────────────────────────*/
async function init() {
  $('kpi-row').innerHTML    = '<div class="loading-state" style="grid-column:1/-1"><div class="spinner"></div><span>Loading…</span></div>';
  $('table-wrap').innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    await loadData();
    render();
  } catch (err) {
    console.error('[stats.js]', err);
    $('kpi-row').innerHTML = `<div class="error-state" style="grid-column:1/-1">Failed to load: ${err.message}</div>`;
  }
}

/* ── Event listeners ────────────────────────────────────────*/
$('lga-select').addEventListener('change', e => {
  state.selectedLGA = e.target.value;
  init();
});

$('refresh-btn').addEventListener('click', init);

$('table-search').addEventListener('input', e => {
  state.searchTerm = e.target.value.trim();
  renderTable();
});

document.querySelectorAll('.age-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const age = btn.dataset.age;
    if (state.activeAges.has(age)) {
      if (state.activeAges.size === 1) return; // at least one must be active
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

init();
