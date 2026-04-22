/**
 * api/population.js
 *
 * Fetches children's population (ages 0–14) from ABS Census 2021 DataAPI
 * at SA2 level, using SA2 codes pulled directly from abs_sa_playground_lookup.
 *
 * No fuzzy matching. No lookup table to maintain.
 * SA2 codes come straight from the spatial join you already did.
 *
 * Query params:
 *   ?lga=Newcastle     — single LGA
 *   (none)             — all target LGAs
 */

const https  = require('https');
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

// ── ABS fetch ─────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('ABS request timed out')); });
  });
}

/**
 * Fetch ABS Census B04 (Age by Sex) at SA2 level for a batch of SA2 codes.
 * Returns { sa2_code: { age_0_4, age_5_9, age_10_14 } }
 *
 * ABS DataAPI key format:
 *   Measure . Age . Sex . RegionType . Region
 *   1 . 0_4+5_9+10_14 . 3 . SA2 . CODE1+CODE2+...
 */
async function fetchPopulationBatch(sa2Codes) {
  const regionParam = sa2Codes.join('+');
  const url =
    `https://api.data.abs.gov.au/data/ABS_CENSUS2021_B04/` +
    `1.0_4+5_9+10_14.3.SA2.${regionParam}` +
    `?format=jsondata&dimensionAtObservation=AllDimensions`;

  const { status, body } = await httpsGet(url);

  if (status !== 200) {
    throw new Error(`ABS API returned HTTP ${status}`);
  }

  const sdmx    = JSON.parse(body);
  const dataset = sdmx?.data?.dataSets?.[0];
  const dims    = sdmx?.data?.structure?.dimensions?.observation ?? [];

  if (!dataset) throw new Error('No dataset in ABS response');

  const ageIdx = dims.findIndex(d => d.id === 'AGE');
  const regIdx = dims.findIndex(d => d.id === 'REGION');
  if (ageIdx === -1 || regIdx === -1) throw new Error('Cannot find AGE/REGION dimensions in ABS response');

  const ageDim = dims[ageIdx];
  const regDim = dims[regIdx];
  const result = {};

  for (const [key, values] of Object.entries(dataset.observations ?? {})) {
    const idx        = key.split(':').map(Number);
    const ageCode    = ageDim.values[idx[ageIdx]]?.id;
    const regionCode = regDim.values[idx[regIdx]]?.id;
    if (!ageCode || !regionCode) continue;
    if (!result[regionCode]) result[regionCode] = {};
    result[regionCode][`age_${ageCode}`] = values[0] ?? 0;
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { lga }  = req.query;

    const targetLGAs = lga && TARGET_LGAS.includes(lga)
      ? [lga]
      : TARGET_LGAS;

    // ── 1. Get SA2 codes from the playground spatial join ────
    const { data: sa2Rows, error: sa2Err } = await supabase
      .rpc('get_sa2_codes_for_lgas', { p_lgas: targetLGAs });

    if (sa2Err) throw new Error(`get_sa2_codes_for_lgas: ${sa2Err.message}`);
    if (!sa2Rows?.length) throw new Error('No SA2 codes found for target LGAs. Check abs_sa_playground_lookup has data.');

    // Build lookup: sa2_code → { lga, sa2_name, sa3_name }
    const sa2Meta = {};
    for (const row of sa2Rows) {
      sa2Meta[row.sa2_code] = {
        lga:      row.lga,
        sa2_name: row.sa2_name,
        sa3_name: row.sa3_name,
        state:    LGA_STATE[row.lga] ?? '',
      };
    }

    const allCodes = Object.keys(sa2Meta);

    // ── 2. Fetch population from ABS in batches of 100 ──────
    // ABS URLs have a length limit — batch to be safe
    const BATCH = 100;
    const popData = {};

    for (let i = 0; i < allCodes.length; i += BATCH) {
      const batch = allCodes.slice(i, i + BATCH);
      const batchResult = await fetchPopulationBatch(batch);
      Object.assign(popData, batchResult);
    }

    // ── 3. Merge population + metadata ──────────────────────
    const data = allCodes.map(code => {
      const meta  = sa2Meta[code];
      const pop   = popData[code] ?? {};
      const a04   = pop.age_0_4   ?? 0;
      const a59   = pop.age_5_9   ?? 0;
      const a1014 = pop.age_10_14 ?? 0;

      return {
        lga:        meta.lga,
        state:      meta.state,
        sa2_code:   code,
        sa2_name:   meta.sa2_name,
        sa3_name:   meta.sa3_name,
        age_0_4:    a04,
        age_5_9:    a59,
        age_10_14:  a1014,
        total_0_14: a04 + a59 + a1014,
      };
    }).sort((a, b) => a.lga.localeCompare(b.lga) || a.sa2_name.localeCompare(b.sa2_name));

    return res.status(200).json({
      data,
      count:   data.length,
      source:  'ABS Census 2021 B04 (SA2 level)',
      fetched: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[population.js]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
