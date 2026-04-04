/**
 * api/transit-routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns a JSON array of all routes in the TransLink SEQ GTFS static feed,
 * enriched with a high-frequency flag.
 *
 * Response shape (array):
 *   [{
 *     route_id:          "130-3291",
 *     route_short_name:  "130",
 *     route_long_name:   "City - Sunnybank via Annerley",
 *     route_type:        3,          // GTFS route_type int
 *     is_high_frequency: true,
 *     trip_count:        87          // total trips in feed (diagnostic)
 *   }, ...]
 *
 * High-frequency logic (applied in order):
 *   1. If the route has trips in frequencies.txt with headway_secs ≤ 900 → HF
 *   2. Else if the route has ≥ HIGH_FREQ_TRIP_THRESHOLD trips in trips.txt → HF
 *      (proxy: many scheduled runs ≈ frequent service)
 *
 * Results are cached server-side for CACHE_TTL ms.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https = require('https');
const zlib  = require('zlib');

const GTFS_ZIP_URL           = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const CACHE_TTL              = 3600 * 1000; // 1 hour
const HIGH_FREQ_TRIP_THRESHOLD = 50;        // trips in feed ≥ this → high frequency
const HIGH_FREQ_HEADWAY_SECS   = 900;       // 15 minutes

let cachedRoutes = null;
let cacheTime    = 0;

// ── Helpers (same pattern as transit-stops.js) ────────────────────────────────

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractFromZip(zipBuffer, targetFile) {
  let offset = 0;
  while (offset < zipBuffer.length - 4) {
    if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compression    = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen    = zipBuffer.readUInt16LE(offset + 26);
    const extraLen       = zipBuffer.readUInt16LE(offset + 28);
    const fileName       = zipBuffer.slice(offset + 30, offset + 30 + fileNameLen).toString('utf8');
    const dataStart      = offset + 30 + fileNameLen + extraLen;
    const dataEnd        = dataStart + compressedSize;
    if (fileName === targetFile || fileName.endsWith('/' + targetFile)) {
      const raw = zipBuffer.slice(dataStart, dataEnd);
      return compression === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    }
    offset = dataEnd;
  }
  return null;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const now = Date.now();
    if (cachedRoutes && (now - cacheTime) < CACHE_TTL) {
      return res.status(200).json(cachedRoutes);
    }

    console.log('[transit-routes] Fetching GTFS zip…');
    const zip = await fetchBuffer(GTFS_ZIP_URL);

    // ── routes.txt ────────────────────────────────────────────────────────────
    const routesCsv = extractFromZip(zip, 'routes.txt');
    if (!routesCsv) throw new Error('routes.txt not found in GTFS zip');
    const routeRows = parseCsv(routesCsv);

    // ── trips.txt  → trip count per route ─────────────────────────────────────
    const tripsCsv = extractFromZip(zip, 'trips.txt');
    const tripCountByRoute = {};   // route_id → int
    const tripToRoute      = {};   // trip_id  → route_id  (for frequency lookup)
    if (tripsCsv) {
      for (const row of parseCsv(tripsCsv)) {
        if (!row.route_id || !row.trip_id) continue;
        tripCountByRoute[row.route_id] = (tripCountByRoute[row.route_id] || 0) + 1;
        tripToRoute[row.trip_id] = row.route_id;
      }
    }

    // ── frequencies.txt → explicitly scheduled high-frequency routes ──────────
    const highFreqRouteIds = new Set();
    const freqCsv = extractFromZip(zip, 'frequencies.txt');
    if (freqCsv) {
      for (const row of parseCsv(freqCsv)) {
        const headway = parseInt(row.headway_secs, 10);
        if (!isNaN(headway) && headway <= HIGH_FREQ_HEADWAY_SECS && row.trip_id) {
          const routeId = tripToRoute[row.trip_id];
          if (routeId) highFreqRouteIds.add(routeId);
        }
      }
    }

    // ── Build result ──────────────────────────────────────────────────────────
    const routes = routeRows
      .filter(r => r.route_id)
      .map(r => {
        const tripCount   = tripCountByRoute[r.route_id] || 0;
        const isHighFreq  = highFreqRouteIds.has(r.route_id)
                          || tripCount >= HIGH_FREQ_TRIP_THRESHOLD;
        return {
          route_id:          r.route_id,
          route_short_name:  r.route_short_name || '',
          route_long_name:   r.route_long_name  || '',
          route_type:        Number(r.route_type) || 3,
          is_high_frequency: isHighFreq,
          trip_count:        tripCount,
        };
      });

    cachedRoutes = routes;
    cacheTime    = now;
    console.log(`[transit-routes] Loaded ${routes.length} routes`);
    res.status(200).json(routes);

  } catch (err) {
    console.error('[transit-routes] Error:', err);
    res.status(500).json({ error: err.message });
  }
};
