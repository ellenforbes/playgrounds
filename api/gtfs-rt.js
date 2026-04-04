/**
 * api/gtfs-rt.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolidated GTFS-RT proxy. Replaces:
 *   ferry-positions.js
 *   ferry-trip-updates.js
 *   transit-positions.js
 *
 * Query params:
 *   ?feed=positions   VehiclePositions feed  (default)
 *   ?feed=updates     TripUpdates feed
 *
 *   ?type=Ferry       (default)
 *   ?type=Bus
 *   ?type=Rail
 *   ?type=Tram
 *
 * Returns raw protobuf bytes (application/octet-stream).
 *
 * Examples:
 *   /api/gtfs-rt?feed=positions&type=Ferry   ← was /api/ferry-positions
 *   /api/gtfs-rt?feed=updates&type=Ferry     ← was /api/ferry-trip-updates
 *   /api/gtfs-rt?feed=positions&type=Bus     ← was /api/transit-positions?type=Bus
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VALID_FEEDS = ['positions', 'updates'];
const VALID_TYPES = ['Bus', 'Ferry', 'Rail', 'Tram'];

const FEED_PATH = {
  positions: 'VehiclePositions',
  updates:   'TripUpdates',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Normalise params
  const rawFeed = (req.query?.feed || 'positions').toLowerCase();
  const rawType = req.query?.type  || 'Ferry';
  const type    = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();

  if (!VALID_FEEDS.includes(rawFeed)) {
    return res.status(400).json({ error: `Invalid feed. Use: ${VALID_FEEDS.join(', ')}` });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Use: ${VALID_TYPES.join(', ')}` });
  }

  const url = `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/${FEED_PATH[rawFeed]}/${type}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TransLink returned HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from(buffer));

  } catch (error) {
    console.error(`[gtfs-rt] Error (feed=${rawFeed}, type=${type}):`, error.message);
    res.status(500).json({ error: error.message });
  }
};
