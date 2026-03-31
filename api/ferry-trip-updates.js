module.exports = async (req, res) => {
  try {
    const response = await fetch(
      'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates/Ferry'
    );

    if (!response.ok) throw new Error(`TransLink returned HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));

  } catch (error) {
    console.error('Ferry trip-updates proxy error:', error);
    res.status(500).json({ error: error.message });
  }
};
