/**
 * api/gtfs-static.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolidated static GTFS data endpoint.
 *
 * Query params:
 *   ?data=routes   → [{ route_id, route_short_name, route_long_name,
 *                        route_type, is_high_frequency, trip_count }, ...]
 *   ?data=shapes   → { route_id: { type, points: [[lat,lng],...] }, ... }
 *   ?data=stops    → { "stop_id": "Stop Name", ... }
 *   ?type=Ferry|Bus|Rail|Tram|all  (stops only)
 *
 * Performance: stop_times.txt (~100 MB uncompressed) is ONLY parsed for
 * typed stop lookups (?data=stops&type=Ferry etc). Routes, shapes, and
 * all-stops use a fast path that skips it entirely.
 */

const https = require('https');
const zlib  = require('zlib');

const GTFS_ZIP_URL           = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const CACHE_TTL              = 3600 * 1000;
const HIGH_FREQ_HEADWAY_SECS = 900;
const HIGH_FREQ_TRIP_THRESHOLD = 3000;
const DECIMATE               = 4;

const ROUTE_TYPE_MAP = {
  Ferry: [4],
  Bus:   [3, 700, 702, 704],
  Rail:  [2, 100, 101, 102, 109],
  Tram:  [0, 5, 900, 901, 902],
};
const TYPE_TO_MODE = {};
for (const [mode, types] of Object.entries(ROUTE_TYPE_MAP)) {
  for (const t of types) TYPE_TO_MODE[t] = mode;
}

// ── Shared ZIP buffer ─────────────────────────────────────────────────────────
let _zipBuffer = null, _zipFetchedAt = 0;
async function getZipBuffer() {
  const now = Date.now();
  if (_zipBuffer && (now - _zipFetchedAt) < CACHE_TTL) return _zipBuffer;
  console.log('[gtfs-static] Downloading GTFS zip...');
  _zipBuffer    = await fetchBuffer(GTFS_ZIP_URL);
  _zipFetchedAt = now;
  return _zipBuffer;
}

// ── FAST cache: routes + trips (no stop_times.txt) ───────────────────────────
let fastCache = { routes: null, tripToRoute: null, tripCount: null, shapes: null, parsedAt: 0 };

async function ensureFastCache() {
  const now = Date.now();
  if (fastCache.routes && (now - fastCache.parsedAt) < CACHE_TTL) return;

  console.log('[gtfs-static] (fast) Parsing routes/trips/frequencies...');
  const zip = await getZipBuffer();

  const routesCsv = extractFromZip(zip, 'routes.txt');
  if (!routesCsv) throw new Error('routes.txt not found');
  const routeRows = parseCsv(routesCsv);

  const routeTypeById = {};
  for (const r of routeRows) {
    if (r.route_id) routeTypeById[r.route_id] = Number(r.route_type) || 3;
  }

  const tripToRoute = {}, tripCountByRoute = {};
  const tripsCsv = extractFromZip(zip, 'trips.txt');
  if (tripsCsv) {
    for (const r of parseCsv(tripsCsv)) {
      if (!r.route_id || !r.trip_id) continue;
      tripToRoute[r.trip_id] = r.route_id;
      tripCountByRoute[r.route_id] = (tripCountByRoute[r.route_id] || 0) + 1;
    }
  }

  const highFreqRouteIds = new Set();
  const freqCsv = extractFromZip(zip, 'frequencies.txt');
  if (freqCsv) {
    for (const r of parseCsv(freqCsv)) {
      const hw = parseInt(r.headway_secs, 10);
      if (!isNaN(hw) && hw <= HIGH_FREQ_HEADWAY_SECS && r.trip_id) {
        const rid = tripToRoute[r.trip_id];
        if (rid) highFreqRouteIds.add(rid);
      }
    }
  }

  fastCache.tripToRoute = tripToRoute;
  fastCache.tripCount   = tripCountByRoute;
  fastCache.routes = routeRows.filter(r => r.route_id).map(r => ({
    route_id:          r.route_id,
    route_short_name:  r.route_short_name || '',
    route_long_name:   r.route_long_name  || '',
    route_type:        Number(r.route_type) || 3,
    is_high_frequency: highFreqRouteIds.has(r.route_id)
                    || (tripCountByRoute[r.route_id] || 0) >= HIGH_FREQ_TRIP_THRESHOLD,
    trip_count:        tripCountByRoute[r.route_id] || 0,
  }));
  fastCache.shapes  = null;
  fastCache.parsedAt = now;
  console.log(`[gtfs-static] (fast) ${fastCache.routes.length} routes ready`);
}

// ── Fast all-stops (just stops.txt, no stop_times.txt) ───────────────────────
let _allStops = null, _allStopsCachedAt = 0;
async function getAllStops() {
  const now = Date.now();
  if (_allStops && (now - _allStopsCachedAt) < CACHE_TTL) return _allStops;
  console.log('[gtfs-static] (fast) Parsing stops.txt...');
  const zip = await getZipBuffer();
  const stopsCsv = extractFromZip(zip, 'stops.txt');
  if (!stopsCsv) throw new Error('stops.txt not found');
  const lookup = {};
  for (const r of parseCsv(stopsCsv)) {
    if (r.stop_id && r.stop_name) lookup[r.stop_id] = r.stop_name;
  }
  _allStops = lookup;
  _allStopsCachedAt = now;
  console.log(`[gtfs-static] (fast) ${Object.keys(lookup).length} stops ready`);
  return lookup;
}

// ── Slow typed-stops (needs stop_times.txt) ───────────────────────────────────
let _typedStops = {}, _typedStopsCachedAt = 0;
async function getTypedStops(typeKey) {
  const now = Date.now();
  if (_typedStops[typeKey] && (now - _typedStopsCachedAt) < CACHE_TTL) return _typedStops[typeKey];
  console.log(`[gtfs-static] (slow) Building typed stops for ${typeKey}...`);

  await ensureFastCache();
  const zip = await getZipBuffer();
  const { tripToRoute } = fastCache;

  const routeTypeById = {};
  for (const r of fastCache.routes) routeTypeById[r.route_id] = r.route_type;

  const stopsCsv = extractFromZip(zip, 'stops.txt');
  if (!stopsCsv) throw new Error('stops.txt not found');
  const stopsRows = parseCsv(stopsCsv);

  const routeTypesByStop = {};
  const stopTimesCsv = extractFromZip(zip, 'stop_times.txt');
  if (stopTimesCsv) {
    const lines = stopTimesCsv.split(/\r?\n/);
    const h = lines[0].split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    const siStop = h.indexOf('stop_id'), siTrip = h.indexOf('trip_id');
    for (let i = 1; i < lines.length; i++) {
      const cols   = lines[i].split(',');
      const stopId = cols[siStop]?.trim().replace(/^"|"$/g, '');
      const tripId = cols[siTrip]?.trim().replace(/^"|"$/g, '');
      if (!stopId || !tripId) continue;
      const rid  = tripToRoute[tripId];
      const rtyp = rid !== undefined ? routeTypeById[rid] : undefined;
      if (rtyp === undefined) continue;
      if (!routeTypesByStop[stopId]) routeTypesByStop[stopId] = new Set();
      routeTypesByStop[stopId].add(rtyp);
    }
  }

  const allowedTypes = ROUTE_TYPE_MAP[typeKey];
  const lookup = {};
  for (const r of stopsRows) {
    if (!r.stop_id || !r.stop_name) continue;
    const types = routeTypesByStop[r.stop_id];
    if (!types || (allowedTypes && !allowedTypes.some(t => types.has(t)))) continue;
    lookup[r.stop_id] = r.stop_name;
  }
  _typedStops[typeKey] = lookup;
  _typedStopsCachedAt  = now;
  console.log(`[gtfs-static] (slow) ${Object.keys(lookup).length} stops for ${typeKey}`);
  return lookup;
}

// ── Shapes (fast — routes.txt + trips.txt + shapes.txt only) ─────────────────
async function buildRouteShapes() {
  if (fastCache.shapes) return fastCache.shapes;
  await ensureFastCache();
  const zip = await getZipBuffer();

  const routeShapeCandidates = {};
  const tripsCsv = extractFromZip(zip, 'trips.txt');
  if (tripsCsv) {
    for (const r of parseCsv(tripsCsv)) {
      if (!r.route_id || !r.shape_id) continue;
      if (!routeShapeCandidates[r.route_id]) routeShapeCandidates[r.route_id] = new Set();
      routeShapeCandidates[r.route_id].add(r.shape_id);
    }
  }

  const rawShapes = {};
  const shapesCsv = extractFromZip(zip, 'shapes.txt');
  if (shapesCsv) {
    const lines = shapesCsv.split(/\r?\n/);
    const h = lines[0].split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    const siId = h.indexOf('shape_id'), siLat = h.indexOf('shape_pt_lat');
    const siLon = h.indexOf('shape_pt_lon'), siSeq = h.indexOf('shape_pt_sequence');
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
      for (const id of Object.keys(rawShapes)) rawShapes[id].sort((a, b) => a[0] - b[0]);
    }
  }

  const routeTypeById = {};
  for (const r of fastCache.routes) routeTypeById[r.route_id] = r.route_type;

  const result = {};
  for (const [routeId, shapeIds] of Object.entries(routeShapeCandidates)) {
    let bestId = null, bestLen = 0;
    for (const sid of shapeIds) {
      const len = rawShapes[sid]?.length || 0;
      if (len > bestLen) { bestId = sid; bestLen = len; }
    }
    if (!bestId) continue;
    const raw = rawShapes[bestId];
    const pts = [];
    for (let i = 0; i < raw.length; i++) {
      if (i % DECIMATE === 0 || i === raw.length - 1) pts.push([raw[i][1], raw[i][2]]);
    }
    if (pts.length < 2) continue;
    result[routeId] = { type: TYPE_TO_MODE[routeTypeById[routeId]] || 'Bus', points: pts };
  }

  fastCache.shapes = result;
  console.log(`[gtfs-static] ${Object.keys(result).length} route shapes built`);
  return result;
}

// ── ZIP / CSV helpers ─────────────────────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
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

// ── Request handler ───────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const rawData = (req.query?.data || 'stops').toLowerCase();
  if (!['stops', 'routes', 'shapes'].includes(rawData)) {
    return res.status(400).json({ error: 'Invalid data param. Use: stops, routes or shapes' });
  }

  try {
    if (rawData === 'shapes') {
      const shapes = await buildRouteShapes();
      return res.status(200).json(shapes);
    }

    if (rawData === 'routes') {
      await ensureFastCache();
      return res.status(200).json(fastCache.routes);
    }

    // stops
    const rawType = req.query?.type || 'all';
    const typeKey = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
    if (!ROUTE_TYPE_MAP[typeKey]) {
      // type=all or unrecognised — fast path
      return res.status(200).json(await getAllStops());
    }
    return res.status(200).json(await getTypedStops(typeKey));

  } catch (error) {
    console.error('[gtfs-static] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
