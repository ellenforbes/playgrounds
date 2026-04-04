/**
 * api/gtfs-rt.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GTFS-RT positions proxy — returns JSON with resolved route_ids.
 *
 * ?feed=positions  Returns JSON array of vehicle objects (decoded server-side).
 * ?feed=updates    Returns raw protobuf (still used by ferry CityDog code).
 *
 * ?type=Bus | Ferry | Rail | Tram
 *
 * JSON vehicle object shape:
 *   { lat, lng, routeId, tripId, stopId, currentStatus, directionId,
 *     vehicleId, vehicleLabel }
 *
 * Trip→Route resolution:
 *   The TransLink GTFS-RT vehicle feed often omits route_id, providing only
 *   trip_id. We maintain a local trips.txt cache to resolve trip_id→route_id
 *   without needing the client to download a large lookup table.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const https = require('https');
const zlib  = require('zlib');

const GTFS_ZIP_URL = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';
const RT_BASE_URL  = 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ';
const CACHE_TTL    = 3600 * 1000; // 1 hour for static data

const VALID_FEEDS = ['positions', 'updates'];
const VALID_TYPES = ['Bus', 'Ferry', 'Rail', 'Tram'];

// ── Trip→Route cache (populated lazily from GTFS zip) ─────────────────────────
let tripToRoute    = null; // trip_id → route_id
let tripCachedAt   = 0;
let tripLoadPromise = null;

async function ensureTripCache() {
  if (tripToRoute && (Date.now() - tripCachedAt) < CACHE_TTL) return;
  if (tripLoadPromise) return tripLoadPromise;

  tripLoadPromise = (async () => {
    try {
      console.log('[gtfs-rt] Loading trips.txt for route resolution…');
      const zip  = await fetchBuffer(GTFS_ZIP_URL);
      const csv  = extractFromZip(zip, 'trips.txt');
      if (!csv) throw new Error('trips.txt not found');

      const map = {};
      const lines   = csv.split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const ri = headers.indexOf('route_id');
      const ti = headers.indexOf('trip_id');
      if (ri < 0 || ti < 0) throw new Error('trips.txt missing columns');

      for (let i = 1; i < lines.length; i++) {
        const cols    = lines[i].split(',');
        const routeId = cols[ri]?.trim().replace(/^"|"$/g, '');
        const tripId  = cols[ti]?.trim().replace(/^"|"$/g, '');
        if (routeId && tripId) map[tripId] = routeId;
      }

      tripToRoute   = map;
      tripCachedAt  = Date.now();
      tripLoadPromise = null;
      console.log(`[gtfs-rt] Loaded ${Object.keys(map).length} trip→route mappings`);
    } catch (e) {
      console.warn('[gtfs-rt] trips.txt load failed:', e.message);
      tripLoadPromise = null;
      tripToRoute = tripToRoute || {}; // keep stale or use empty
    }
  })();

  return tripLoadPromise;
}

// ── Minimal protobuf decoder ───────────────────────────────────────────────────
// Only handles wire types 0 (varint), 2 (len-delim), 5 (float/fixed32).
// Wire type 1 (fixed64) is skipped.

function readVarint(buf, pos) {
  let val = 0, shift = 0, b;
  while (pos < buf.length) {
    b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift >= 35) { // skip remaining bytes of huge varint (e.g. timestamp)
      while (pos < buf.length && buf[pos++] & 0x80) {}
      break;
    }
  }
  return [val >>> 0, pos];
}

function skipField(buf, pos, wireType) {
  if (wireType === 0) { // varint — read until msb clear
    while (pos < buf.length && buf[pos++] & 0x80) {}
  } else if (wireType === 1) { pos += 8; } // fixed64
  else if (wireType === 2) { const [len, p] = readVarint(buf, pos); pos = p + len; }
  else if (wireType === 5) { pos += 4; } // fixed32
  return pos;
}

function readBytes(buf, pos) {
  const [len, p] = readVarint(buf, pos);
  return [buf.slice(p, p + len), p + len];
}

function readStr(buf, pos) {
  const [bytes, p] = readBytes(buf, pos);
  return [bytes.toString('utf8'), p];
}

/** Decode a Position submessage → { lat, lng } */
function decodePosition(buf, start, end) {
  let lat = null, lng = null, pos = start;
  while (pos < end) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;
    if (wt === 5) {
      const val = buf.readFloatLE(pos); pos += 4;
      if (fn === 1) lat = val;
      else if (fn === 2) lng = val;
    } else { pos = skipField(buf, pos, wt); }
  }
  return { lat, lng };
}

/** Decode a TripDescriptor → { tripId, routeId, directionId } */
function decodeTrip(buf, start, end) {
  let tripId = '', routeId = '', directionId = null, pos = start;
  while (pos < end) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;
    if (wt === 2) {
      const [str, p2] = readStr(buf, pos); pos = p2;
      if (fn === 1) tripId  = str;
      else if (fn === 5) routeId = str;
    } else if (wt === 0) {
      const [val, p2] = readVarint(buf, pos); pos = p2;
      if (fn === 6) directionId = val;
    } else { pos = skipField(buf, pos, wt); }
  }
  return { tripId, routeId, directionId };
}

/** Decode a VehicleDescriptor → { id, label } */
function decodeVehicleDescriptor(buf, start, end) {
  let id = '', label = '', pos = start;
  while (pos < end) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;
    if (wt === 2) {
      const [str, p2] = readStr(buf, pos); pos = p2;
      if (fn === 1) id    = str;
      else if (fn === 2) label = str;
    } else { pos = skipField(buf, pos, wt); }
  }
  return { id, label };
}

/** Decode a VehiclePosition → vehicle object or null */
function decodeVehiclePosition(buf, start, end) {
  let trip = null, lat = null, lng = null;
  let stopId = '', currentStatus = 2, vehicleId = '', vehicleLabel = '';
  let pos = start;

  while (pos < end) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;

    if (wt === 2) {
      const [bytes, p2] = readBytes(buf, pos); pos = p2;
      const s = p2 - bytes.length, e = p2;
      if (fn === 1) trip = decodeTrip(buf, s, e);
      else if (fn === 2) { const pos_ = decodePosition(buf, s, e); lat = pos_.lat; lng = pos_.lng; }
      else if (fn === 7) stopId = bytes.toString('utf8');
      else if (fn === 8) { const vd = decodeVehicleDescriptor(buf, s, e); vehicleId = vd.id; vehicleLabel = vd.label; }
    } else if (wt === 0) {
      const [val, p2] = readVarint(buf, pos); pos = p2;
      if (fn === 4) currentStatus = val;
    } else { pos = skipField(buf, pos, wt); }
  }

  if (lat === null || lng === null || !isFinite(lat) || !isFinite(lng)) return null;
  return { trip, lat, lng, stopId, currentStatus, vehicleId, vehicleLabel };
}

/** Decode a FeedEntity — return vehicle or null */
function decodeEntity(buf, start, end) {
  let pos = start, vehicle = null;
  while (pos < end) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;
    if (wt === 2) {
      const [bytes, p2] = readBytes(buf, pos); pos = p2;
      if (fn === 4) vehicle = decodeVehiclePosition(buf, p2 - bytes.length, p2);
    } else { pos = skipField(buf, pos, wt); }
  }
  return vehicle;
}

/** Decode entire FeedMessage (VehiclePositions) → array of raw vehicles */
function decodeFeed(buf) {
  const vehicles = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p] = readVarint(buf, pos); pos = p;
    const fn = tag >> 3, wt = tag & 7;
    if (wt === 2) {
      const [bytes, p2] = readBytes(buf, pos); pos = p2;
      if (fn === 2) { // repeated FeedEntity
        const v = decodeEntity(buf, p2 - bytes.length, p2);
        if (v) vehicles.push(v);
      }
    } else { pos = skipField(buf, pos, wt); }
  }
  return vehicles;
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

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

function extractFromZip(zipBuf, target) {
  let offset = 0;
  while (offset < zipBuf.length - 4) {
    if (zipBuf.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compression    = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const fileNameLen    = zipBuf.readUInt16LE(offset + 26);
    const extraLen       = zipBuf.readUInt16LE(offset + 28);
    const fileName       = zipBuf.slice(offset + 30, offset + 30 + fileNameLen).toString();
    const dataStart      = offset + 30 + fileNameLen + extraLen;
    const dataEnd        = dataStart + compressedSize;
    if (fileName === target || fileName.endsWith('/' + target)) {
      const raw = zipBuf.slice(dataStart, dataEnd);
      return compression === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    }
    offset = dataEnd;
  }
  return null;
}

// ── Request handler ───────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawFeed = (req.query?.feed || 'positions').toLowerCase();
  const rawType = req.query?.type || 'Bus';
  const type    = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();

  if (!VALID_FEEDS.includes(rawFeed)) {
    return res.status(400).json({ error: `Invalid feed. Use: ${VALID_FEEDS.join(', ')}` });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Use: ${VALID_TYPES.join(', ')}` });
  }

  const feedPath = rawFeed === 'positions' ? 'VehiclePositions' : 'TripUpdates';
  const url = `${RT_BASE_URL}/${feedPath}/${type}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`TransLink returned HTTP ${upstream.status}`);
    const rawBuf = Buffer.from(await upstream.arrayBuffer());

    // Raw protobuf passthrough for trip updates (used by ferry CityDog)
    if (rawFeed === 'updates') {
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(rawBuf);
    }

    // Positions: decode server-side, resolve trip→route, return JSON
    await ensureTripCache();

    const rawVehicles = decodeFeed(rawBuf);
    const vehicles = [];

    for (const v of rawVehicles) {
      const rtRouteId = v.trip?.routeId || v.trip?.route_id || '';
      const tripId    = v.trip?.tripId  || v.trip?.trip_id  || '';
      const routeId   = rtRouteId || (tripToRoute && tripToRoute[tripId]) || '';

      vehicles.push({
        lat:           v.lat,
        lng:           v.lng,
        routeId,
        tripId,
        stopId:        v.stopId,
        currentStatus: v.currentStatus,
        directionId:   v.trip?.directionId ?? null,
        vehicleId:     v.vehicleId,
        vehicleLabel:  v.vehicleLabel,
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(vehicles);

  } catch (error) {
    console.error(`[gtfs-rt] Error (feed=${rawFeed}, type=${type}):`, error.message);
    res.status(500).json({ error: error.message });
  }
};
