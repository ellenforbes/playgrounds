/**
 * api/playground-stats.js
 *
 * Returns playground counts + feature breakdowns joined to SA2 areas
 * via abs_sa_playground_lookup.
 *
 * Two endpoints in one:
 *   ?level=sa2  (default) — one row per SA2 area
 *   ?level=lga            — rolled up to council level (for KPI cards)
 *   ?lga=Newcastle        — filter to one council (works with both levels)
 */

const { createClient } = require('@supabase/supabase-js');

const TARGET_LGAS = [
  'Brisbane', 'Newcastle', 'Lake Macquarie', 'Singleton',
  'Cessnock', 'Port Stephens', 'Maitland', 'Dungog',
  'Mid-Coast', 'Muswellbrook', 'Upper Hunter',
];

const LGA_STATE = {
  'Brisbane': 'QLD',      'Newcastle': 'NSW',
  'Lake Macquarie': 'NSW','Singleton': 'NSW',
  'Cessnock': 'NSW',      'Port Stephens': 'NSW',
  'Maitland': 'NSW',      'Dungog': 'NSW',
  'Mid-Coast': 'NSW',     'Muswellbrook': 'NSW',
  'Upper Hunter': 'NSW',
};

function pct(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function enrichLGA(row) {
  const total = row.total_playgrounds ?? 0;
  return {
    lga:               row.lga,
    state:             LGA_STATE[row.lga] ?? '',
    total_playgrounds: total,
    total_sa2s:        row.total_sa2s ?? 0,
    with_shade:        row.with_shade      ?? 0,
    with_water_play:   row.with_water_play ?? 0,
    accessible:        row.accessible      ?? 0,
    with_toilet:       row.with_toilet     ?? 0,
    fenced:            row.fenced          ?? 0,
    pct_shade:         pct(row.with_shade,      total),
    pct_water:         pct(row.with_water_play, total),
    pct_accessible:    pct(row.accessible,      total),
    pct_toilet:        pct(row.with_toilet,     total),
    pct_fenced:        pct(row.fenced,          total),
  };
}

function enrichSA2(row) {
  const total = row.total_playgrounds ?? 0;
  return {
    lga:               row.lga,
    state:             LGA_STATE[row.lga] ?? '',
    sa2_code:          row.sa2_code,
    sa2_name:          row.sa2_name,
    sa3_name:          row.sa3_name,
    total_playgrounds: total,
    with_shade:        row.with_shade      ?? 0,
    with_water_play:   row.with_water_play ?? 0,
    accessible:        row.accessible      ?? 0,
    with_toilet:       row.with_toilet     ?? 0,
    fenced:            row.fenced          ?? 0,
    pct_shade:         pct(row.with_shade,      total),
    pct_water:         pct(row.with_water_play, total),
    pct_accessible:    pct(row.accessible,      total),
    pct_toilet:        pct(row.with_toilet,     total),
    pct_fenced:        pct(row.fenced,          total),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { lga, level = 'sa2' } = req.query;

    const lgas = lga && TARGET_LGAS.includes(lga)
      ? [lga]
      : TARGET_LGAS;

    if (level === 'lga') {
      const { data, error } = await supabase
        .rpc('get_playground_stats_by_lga', { p_lgas: lgas });
      if (error) throw new Error(error.message);

      // Ensure all requested LGAs appear even with zero playgrounds
      const byLGA = Object.fromEntries((data ?? []).map(r => [r.lga, r]));
      const result = lgas.map(name => enrichLGA(byLGA[name] ?? { lga: name }));

      return res.status(200).json({ level: 'lga', data: result, count: result.length });
    }

    // Default: SA2 level
    const { data, error } = await supabase
      .rpc('get_playground_stats_by_sa2', { p_lgas: lgas });
    if (error) throw new Error(error.message);

    const result = (data ?? []).map(enrichSA2);
    return res.status(200).json({ level: 'sa2', data: result, count: result.length });

  } catch (err) {
    console.error('[playground-stats.js]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
