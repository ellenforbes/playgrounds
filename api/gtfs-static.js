/**
 * api/gtfs-static.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolidated static GTFS data endpoint. Replaces:
 *   ferry-stops.js
 *   transit-stops.js
 *   transit-routes.js
 *
 * The GTFS ZIP is downloaded once and cached in memory for CACHE_TTL ms.
 * Both "stops" and "routes" responses are served from the same parsed data,
 * so a warm function only parses the ZIP once regardless of which data is
 * requested.
 *
 * Query params:
 *   ?data=stops    → { "stop_id": "Stop Name", ... }
 *   ?data=routes   → [{ route_id, route_short_name, route_long_name,
 *                        route_type, is_high_frequency, trip_count }, ...]
 *
 *   ?type=Ferry    filter stops to ferry stops only       (stops only)
 *   ?type=Bus      filter stops to bus stops only         (stops only)
 *   ?type=Rail     filter stops to rail stops only        (stops only)
 *   ?type=Tram     filter stops to tram stops only        (stops only)
 *   ?type=all      no filter — return all stops (default) (stops only)
 *
 * Examples:
 *   /api/gtfs-static?data=stops&type=Ferry   ← was /api/ferry-stops
 *   /api/gtfs-static?data=stops&type=Ferry   ← was /api/transit-stops?type=Ferry
 *   /api/gtfs-static?data=stops&type=all     ← was /api/transit-stops (no type)
 *   /api/gtfs-static?data=routes             ← was /api/transit-routes
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https = require('https');
const zlib  = require('zlib');

// ── Config ────────────────────────────────────────────────────────────────────

const GTFS_ZIP_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const CACHE_TTL    = 3600 * 1000; // 1 hour

const HIGH_FREQ_HEADWAY_SECS   = 900; // 15 min

/** Maps ?type= param to GTFS route_type integers */
const ROUTE_TYPE_MAP = {
  Ferry: [4],
  Bus:   [3, 700, 702, 704],
  Rail:  [2, 100, 101, 102, 109],
  Tram:  [0, 5, 900, 901, 902],
};

// ── In-memory cache ───────────────────────────────────────────────────────────

// Parsed data (shared between stops and routes responses)
let cache = {
  // stops: Array<{ stop_id, stop_name, route_types: int[] }>
  stops:  null,
  // routes: Array<{ route_id, route_short_name, route_long_name, route_type, is_high_frequency, trip_count }>
  routes: null,
  // shapes: { route_id → { type: 'Bus'|'Ferry'|'Rail'|'Tram', points: [[lat,lng],...] } }
  shapes: null,
  // time of last successful parse
  parsedAt: 0,
};

// Per-type filtered stop lookups (avoids re-filtering on every warm request)
const stopLookupCache = {}; // "Ferry" | "Bus" | "Rail" | "all" → { stop_id: name }

// ── ZIP / CSV helpers ─────────────────────────────────────────────────────────

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

// ── Data loading ──────────────────────────────────────────────────────────────

async function ensureDataLoaded() {
  const now = Date.now();
  if (cache.stops && cache.routes && (now - cache.parsedAt) < CACHE_TTL) return;

  console.log('[gtfs-static] Fetching GTFS zip…');
  const zip = await fetchBuffer(GTFS_ZIP_URL);

  // ── routes.txt ─────────────────────────────────────────────────────────────
  const routesCsv = extractFromZip(zip, 'routes.txt');
  if (!routesCsv) throw new Error('routes.txt not found in GTFS zip');
  const routeRows = parseCsv(routesCsv);

  // route_id → route_type int
  const routeTypeById = {};
  for (const r of routeRows) {
    if (r.route_id) routeTypeById[r.route_id] = Number(r.route_type) || 3;
  }

  // ── trips.txt ──────────────────────────────────────────────────────────────
  const tripsCsv = extractFromZip(zip, 'trips.txt');
  const tripCountByRoute = {}; // route_id → int
  const tripToRoute      = {}; // trip_id  → route_id
  if (tripsCsv) {
    for (const r of parseCsv(tripsCsv)) {
      if (!r.route_id || !r.trip_id) continue;
      tripCountByRoute[r.route_id] = (tripCountByRoute[r.route_id] || 0) + 1;
      tripToRoute[r.trip_id] = r.route_id;
    }
  }

  // ── frequencies.txt → explicit high-frequency routes ──────────────────────
  const highFreqRouteIds = new Set();
  const freqCsv = extractFromZip(zip, 'frequencies.txt');
  if (freqCsv) {
    for (const r of parseCsv(freqCsv)) {
      const headway = parseInt(r.headway_secs, 10);
      if (!isNaN(headway) && headway <= HIGH_FREQ_HEADWAY_SECS && r.trip_id) {
        const routeId = tripToRoute[r.trip_id];
        if (routeId) highFreqRouteIds.add(routeId);
      }
    }
  }

  // ── stops.txt ──────────────────────────────────────────────────────────────
  const stopsCsv = extractFromZip(zip, 'stops.txt');
  if (!stopsCsv) throw new Error('stops.txt not found in GTFS zip');
  const stopsRows = parseCsv(stopsCsv);

  // ── stop_times.txt → which route types serve each stop ────────────────────
  const routeTypesByStop = {}; // stop_id → Set<route_type int>
  const stopTimesCsv = extractFromZip(zip, 'stop_times.txt');
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
      const routeId   = tripToRoute[tripId];
      const routeType = routeId !== undefined ? routeTypeById[routeId] : undefined;
      if (routeType === undefined) continue;
      if (!routeTypesByStop[stopId]) routeTypesByStop[stopId] = new Set();
      routeTypesByStop[stopId].add(routeType);
    }
  }

  // ── Assemble cache ─────────────────────────────────────────────────────────
  cache.stops = stopsRows
    .filter(r => r.stop_id && r.stop_name)
    .map(r => ({
      stop_id:     r.stop_id,
      stop_name:   r.stop_name,
      route_types: routeTypesByStop[r.stop_id] ? [...routeTypesByStop[r.stop_id]] : [],
    }));

  cache.routes = routeRows
    .filter(r => r.route_id)
    .map(r => ({
      route_id:          r.route_id,
      route_short_name:  r.route_short_name || '',
      route_long_name:   r.route_long_name  || '',
      route_type:        Number(r.route_type) || 3,
      is_high_frequency: highFreqRouteIds.has(r.route_id),
      trip_count:        tripCountByRoute[r.route_id] || 0,
    }));

  // Invalidate per-type stop lookup cache and shapes when raw data refreshes
  Object.keys(stopLookupCache).forEach(k => delete stopLookupCache[k]);
  cache.shapes = null;

  cache.parsedAt = now;
  console.log(`[gtfs-static] Loaded ${cache.stops.length} stops, ${cache.routes.length} routes`);
}

// ── Stop lookup builder ───────────────────────────────────────────────────────

function buildStopLookup(typeParam) {
  const key = (typeParam || 'all').toLowerCase();
  if (stopLookupCache[key]) return stopLookupCache[key];

  const allowedTypes = ROUTE_TYPE_MAP[typeParam]; // undefined = no filter
  const lookup = {};
  for (const row of cache.stops) {
    if (allowedTypes) {
      if (!row.route_types.some(rt => allowedTypes.includes(rt))) continue;
    }
    lookup[row.stop_id] = row.stop_name;
  }

  stopLookupCache[key] = lookup;
  return lookup;
}

// ── Route shapes builder ──────────────────────────────────────────────────────

/** Reverse-map ROUTE_TYPE_MAP so we can label each route_type with a mode name */
const TYPE_TO_MODE = {};
for (const [mode, types] of Object.entries(ROUTE_TYPE_MAP)) {
  for (const t of types) TYPE_TO_MODE[t] = mode;
}

/**
 * Build { route_id → { type, points: [[lat,lng],...] } } from shapes.txt.
 * One representative shape per route (the shape with the most points).
 * Points are decimated — keep 1 in every DECIMATE — to keep response lean.
 */
async function buildRouteShapes() {
  if (cache.shapes) return cache.shapes;

  const DECIMATE = 4; // keep every 4th shape point

  console.log('[gtfs-static] Building route shapes…');

  // We need a fresh ZIP (ensureDataLoaded already fetched it, but we don't
  // cache the raw ZIP bytes — re-fetch it here for shapes only).
  const zip = await fetchBuffer(GTFS_ZIP_URL);

  // trips.txt: route_id → shape_id (collect all, pick the one with most points later)
  const routeShapeCandidates = {}; // route_id → Set<shape_id>
  const tripsCsv = extractFromZip(zip, 'trips.txt');
  if (tripsCsv) {
    for (const r of parseCsv(tripsCsv)) {
      if (!r.route_id || !r.shape_id) continue;
      if (!routeShapeCandidates[r.route_id]) routeShapeCandidates[r.route_id] = new Set();
      routeShapeCandidates[r.route_id].add(r.shape_id);
    }
  }

  // shapes.txt: shape_id → [[lat,lng],...]
  const rawShapes  = {}; // shape_id → ordered array of [lat,lng]
  const shapesCsv  = extractFromZip(zip, 'shapes.txt');
  if (shapesCsv) {
    const lines   = shapesCsv.split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const siId  = headers.indexOf('shape_id');
    const siLat = headers.indexOf('shape_pt_lat');
    const siLon = headers.indexOf('shape_pt_lon');
    const siSeq = headers.indexOf('shape_pt_sequence');
    if (siId >= 0 && siLat >= 0 && siLon >= 0) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const id   = cols[siId]?.trim().replace(/^"|"$/g, '');
        const lat  = parseFloat(cols[siLat]);
        const lon  = parseFloat(cols[siLon]);
        const seq  = parseInt(cols[siSeq], 10) || 0;
        if (!id || isNaN(lat) || isNaN(lon)) continue;
        if (!rawShapes[id]) rawShapes[id] = [];
        rawShapes[id].push([seq, lat, lon]);
      }
      // Sort each shape by sequence
      for (const id of Object.keys(rawShapes)) {
        rawShapes[id].sort((a, b) => a[0] - b[0]);
      }
    }
  }

  // Route type lookup from already-parsed cache.routes
  const routeTypeById = {};
  for (const r of (cache.routes || [])) routeTypeById[r.route_id] = r.route_type;

  // Assemble: pick the shape with the most points for each route, then decimate
  const result = {};
  for (const [routeId, shapeIds] of Object.entries(routeShapeCandidates)) {
    let bestId = null, bestLen = 0;
    for (const sid of shapeIds) {
      const len = rawShapes[sid]?.length || 0;
      if (len > bestLen) { bestId = sid; bestLen = len; }
    }
    if (!bestId) continue;

    const raw   = rawShapes[bestId];
    const pts   = [];
    for (let i = 0; i < raw.length; i++) {
      if (i % DECIMATE === 0 || i === raw.length - 1) pts.push([raw[i][1], raw[i][2]]);
    }
    if (pts.length < 2) continue;

    const routeType = routeTypeById[routeId];
    const mode      = TYPE_TO_MODE[routeType] || 'Bus';
    result[routeId] = { type: mode, points: pts };
  }

  cache.shapes = result;
  console.log(`[gtfs-static] Built ${Object.keys(result).length} route shapes`);
  return result;
}

// ── Request handler ───────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const rawData = (req.query?.data || 'stops').toLowerCase();
  if (!['stops', 'routes', 'shapes'].includes(rawData)) {
    return res.status(400).json({ error: 'Invalid data param. Use: stops, routes or shapes' });
  }

  try {
    await ensureDataLoaded();

    if (rawData === 'shapes') {
      const shapes = await buildRouteShapes();
      console.log(`[gtfs-static] Serving ${Object.keys(shapes).length} route shapes`);
      return res.status(200).json(shapes);
    }

    if (rawData === 'routes') {
      console.log(`[gtfs-static] Serving ${cache.routes.length} routes`);
      return res.status(200).json(cache.routes);
    }

    // stops — apply optional type filter
    const rawType  = req.query?.type || 'all';
    const typeKey  = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    const typeParam = ROUTE_TYPE_MAP[typeKey] ? typeKey : null; // null = all

    const lookup = buildStopLookup(typeParam);
    console.log(`[gtfs-static] Serving ${Object.keys(lookup).length} stops (type=${typeKey})`);
    return res.status(200).json(lookup);

  } catch (error) {
    console.error('[gtfs-static] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
