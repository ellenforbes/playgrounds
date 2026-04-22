/**
 * api/population.js
 *
 * Queries population data directly from Supabase — no external ABS API call.
 *
 * Joins:
 *   abs_population_sa2  (SA2_CODE_2021, Age_yr_0_4_P, Age_yr_5_9_P, Age_yr_10_14_P)
 *   abs_sa_playground_lookup  (SA2_CODE21 → lga, SA2_NAME21, SA3_NAME21)
 *
 * Returns one row per SA2 that has playgrounds in the target LGAs.
 */

const { createClient } = require('@supabase/supabase-js');

const TARGET_LGAS = [
  'Brisbane', 'Newcastle', 'Lake Macquarie', 'Singleton',
  'Cessnock', 'Port Stephens', 'Maitland', 'Dungog',
  'Mid-Coast', 'Muswellbrook', 'Upper Hunter',
];

const LGA_STATE = {
  'Brisbane': 'QLD',       'Newcastle': 'NSW',
  'Lake Macquarie': 'NSW', 'Singleton': 'NSW',
  'Cessnock': 'NSW',       'Port Stephens': 'NSW',
  'Maitland': 'NSW',       'Dungog': 'NSW',
  'Mid-Coast': 'NSW',      'Muswellbrook': 'NSW',
  'Upper Hunter': 'NSW',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { lga }  = req.query;

    const targetLGAs = lga && TARGET_LGAS.includes(lga) ? [lga] : TARGET_LGAS;

    // Step 1: get distinct SA2 codes + names for target LGAs from the playground lookup
    const { data: sa2Rows, error: sa2Err } = await supabase
      .rpc('get_sa2_codes_for_lgas', { p_lgas: targetLGAs });

    if (sa2Err) throw new Error(`get_sa2_codes_for_lgas: ${sa2Err.message}`);
    if (!sa2Rows?.length) throw new Error('No SA2 codes found for target LGAs.');

    // Build a map: sa2_code (string) → { lga, sa2_name, sa3_name }
    const sa2Meta = {};
    for (const row of sa2Rows) {
      sa2Meta[String(row.sa2_code)] = {
        lga:      row.lga,
        sa2_name: row.sa2_name,
        sa3_name: row.sa3_name,
        state:    LGA_STATE[row.lga] ?? '',
      };
    }

    // SA2 codes as numbers for the Supabase query (column is bigint)
    const sa2Codes = Object.keys(sa2Meta).map(Number);

    // Step 2: fetch population for those SA2 codes from abs_population_sa2
    const { data: popRows, error: popErr } = await supabase
      .from('abs_population_sa2')
      .select('SA2_CODE_2021, Age_yr_0_4_P, Age_yr_5_9_P, Age_yr_10_14_P')
      .in('SA2_CODE_2021', sa2Codes);

    if (popErr) throw new Error(`abs_population_sa2 query: ${popErr.message}`);

    // Build population map: sa2_code (string) → pop data
    const popMap = {};
    for (const row of (popRows ?? [])) {
      popMap[String(row.SA2_CODE_2021)] = {
        age_0_4:   row.Age_yr_0_4_P   ?? 0,
        age_5_9:   row.Age_yr_5_9_P   ?? 0,
        age_10_14: row.Age_yr_10_14_P ?? 0,
      };
    }

    // Step 3: merge and return
    const data = Object.entries(sa2Meta).map(([code, meta]) => {
      const pop   = popMap[code] ?? { age_0_4: null, age_5_9: null, age_10_14: null };
      const total = pop.age_0_4 != null
        ? (pop.age_0_4 + pop.age_5_9 + pop.age_10_14)
        : null;
      return {
        lga:        meta.lga,
        state:      meta.state,
        sa2_code:   code,
        sa2_name:   meta.sa2_name,
        sa3_name:   meta.sa3_name,
        age_0_4:    pop.age_0_4,
        age_5_9:    pop.age_5_9,
        age_10_14:  pop.age_10_14,
        total_0_14: total,
      };
    }).sort((a, b) => a.lga.localeCompare(b.lga) || a.sa2_name.localeCompare(b.sa2_name));

    return res.status(200).json({
      data,
      count:   data.length,
      source:  'ABS Census 2021 G04 (SA2, via Supabase)',
      fetched: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[population.js]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
