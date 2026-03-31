/**
 * transit-stops.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic GTFS stop-name lookup for Translink SEQ.
 *
 * Returns a flat JSON object:  { "stop_id": "Stop Name", ... }
 *
 * Query params:
 *   ?type=Ferry          → filters to ferry stops only  (default: all stops)
 *   ?type=Bus            → bus stops only
 *   ?type=Rail           → rail stops only
 *   ?type=Tram           → tram / light rail stops only
 *   (omit ?type or use ?type=all for every stop in the feed)
 *
 * The full ZIP is cached server-side for CACHE_TTL ms to avoid re-downloading
 * on every request. Each filtered result set is cached separately.
 *
 * Usage from client:
 *   const res  = await fetch('/api/transit-stops?type=Ferry');
 *   const stops = await res.json();   // { "319665": "Hamilton Northshore", … }
 *   const name  = stops[stopId] ?? stopId;   // graceful fallback to raw ID
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https = require('https');
const zlib  = require('zlib');

// ── Config ────────────────────────────────────────────────────────────────────

const GTFS_ZIP_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const CACHE_TTL    = 3600 * 1000; // 1 hour in ms

/**
 * GTFS route_type values that map to each ?type= filter.
 * https://gtfs.org/documentation/schedule/reference/#routestxt
 * Translink also uses extended route types (700-series for bus etc.)
 * — add more here as needed.
 */
const ROUTE_TYPE_MAP = {
  Ferry:  [4],
  Bus:    [3, 700, 702, 704],
  Rail:   [2, 100, 101, 102, 109],
  Tram:   [0, 5, 900, 901, 902],
};

// ── In-memory cache ───────────────────────────────────────────────────────────

// Raw parsed stops: Array<{ stop_id, stop_name, route_types[] }>
// We store enriched rows so we can filter without re-parsing the ZIP.
let cachedRows  = null;
let cacheTime   = 0;

// Filtered result cache: { "Ferry": {...}, "Bus": {...}, "all": {...} }
const filteredCache = {};

// ── ZIP helpers ───────────────────────────────────────────────────────────────

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchBuffer(response.headers.location).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
      }
      const chunks = [];
      response.on('data',  chunk => chunks.push(chunk));
      response.on('end',   ()    => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
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
      return compression === 8
        ? zlib.inflateRawSync(raw).toString('utf8')
        : raw.toString('utf8');
    }
    offset = dataEnd;
  }
  return null;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

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

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadStopData() {
  const now = Date.now();
  if (cachedRows && (now - cacheTime) < CACHE_TTL) return; // still fresh

  console.log('[transit-stops] Fetching GTFS zip…');
  const zip = await fetchBuffer(GTFS_ZIP_URL);

  // Parse stops.txt → stop_id, stop_name
  const stopsCsv = extractFromZip(zip, 'stops.txt');
  if (!stopsCsv) throw new Error('stops.txt not found in GTFS zip');
  const stopsRows = parseCsv(stopsCsv);

  // Parse routes.txt → route_id, route_type
  const routesCsv = extractFromZip(zip, 'routes.txt');
  const routeTypeById = {};
  if (routesCsv) {
    for (const r of parseCsv(routesCsv)) {
      if (r.route_id) routeTypeById[r.route_id] = Number(r.route_type);
    }
  }

  // Parse trips.txt → trip_id → route_id
  const tripsCsv = extractFromZip(zip, 'trips.txt');
  const routeByTrip = {};
  if (tripsCsv) {
    for (const t of parseCsv(tripsCsv)) {
      if (t.trip_id && t.route_id) routeByTrip[t.trip_id] = t.route_id;
    }
  }

  // Parse stop_times.txt → stop_id → Set<route_type>
  // (large file — stream through line by line using split)
  const stopTimesCsv = extractFromZip(zip, 'stop_times.txt');
  const routeTypesByStop = {};
  if (stopTimesCsv) {
    const lines   = stopTimesCsv.split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const siStop  = headers.indexOf('stop_id');
    const siTrip  = headers.indexOf('trip_id');
    for (let i = 1; i < lines.length; i++) {
      const cols   = lines[i].split(',');
      const stopId = cols[siStop]?.trim().replace(/^"|"$/g, '');
      const tripId = cols[siTrip]?.trim().replace(/^"|"$/g, '');
      if (!stopId || !tripId) continue;
      const routeId   = routeByTrip[tripId];
      const routeType = routeId !== undefined ? routeTypeById[routeId] : undefined;
      if (routeType === undefined) continue;
      if (!routeTypesByStop[stopId]) routeTypesByStop[stopId] = new Set();
      routeTypesByStop[stopId].add(routeType);
    }
  }

  // Build enriched rows
  cachedRows = stopsRows
    .filter(r => r.stop_id && r.stop_name)
    .map(r => ({
      stop_id:     r.stop_id,
      stop_name:   r.stop_name,
      route_types: routeTypesByStop[r.stop_id]
        ? [...routeTypesByStop[r.stop_id]]
        : [],
    }));

  // Invalidate filtered cache when raw data refreshes
  Object.keys(filteredCache).forEach(k => delete filteredCache[k]);
  cacheTime = now;
  console.log(`[transit-stops] Loaded ${cachedRows.length} stops`);
}

// ── Build lookup for a given type ─────────────────────────────────────────────

function buildLookup(typeParam) {
  const key = (typeParam || 'all').toLowerCase();
  if (filteredCache[key]) return filteredCache[key];

  const allowedTypes = ROUTE_TYPE_MAP[typeParam]; // undefined = no filter

  const lookup = {};
  for (const row of cachedRows) {
    if (allowedTypes) {
      // Include stop only if it serves at least one matching route type
      const matches = row.route_types.some(rt => allowedTypes.includes(rt));
      if (!matches) continue;
    }
    lookup[row.stop_id] = row.stop_name;
  }

  filteredCache[key] = lookup;
  return lookup;
}

// ── Request handler ───────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Normalise type param: "Ferry" / "Bus" / "Rail" / "Tram" / "all" / undefined
  const rawType  = req.query?.type || 'all';
  const typeKey  = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
  const typeParam = ROUTE_TYPE_MAP[typeKey] ? typeKey : null; // null = all stops

  try {
    await loadStopData();
    const lookup = buildLookup(typeParam);
    console.log(`[transit-stops] Serving ${Object.keys(lookup).length} stops (type=${typeKey})`);
    res.status(200).json(lookup);
  } catch (error) {
    console.error('[transit-stops] Error:', error);
    res.status(500).json({ error: error.message });
  }
};
