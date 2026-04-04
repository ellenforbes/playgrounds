/**
 * api/transit-positions.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxies GTFS-RT VehiclePositions for any TransLink SEQ mode.
 *
 * Query param:
 *   ?type=Bus      (default)
 *   ?type=Ferry
 *   ?type=Rail
 *   ?type=Tram
 *
 * Returns raw protobuf bytes (application/octet-stream), identical in shape
 * to the existing ferry-positions.js endpoint so the client can decode with
 * the same protobufjs schema.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const VALID_TYPES = ['Bus', 'Ferry', 'Rail', 'Tram'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rawType = req.query?.type || 'Bus';
  // Normalise capitalisation: "bus" → "Bus"
  const type = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Use one of: ${VALID_TYPES.join(', ')}` });
  }

  try {
    const response = await fetch(
      `https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions/${type}`
    );

    if (!response.ok) throw new Error(`TransLink returned HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error(`[transit-positions] Error (type=${type}):`, error.message);
    res.status(500).json({ error: error.message });
  }
};
