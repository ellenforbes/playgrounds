const https = require('https');
const zlib = require('zlib');

// Simple ZIP parser - extracts a named file from a ZIP buffer
function extractFileFromZip(zipBuffer, targetFile) {
  let offset = 0;
  const results = [];

  while (offset < zipBuffer.length - 4) {
    // Local file header signature: PK\x03\x04
    if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize   = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLength   = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);
    const fileName = zipBuffer.slice(offset + 30, offset + 30 + fileNameLength).toString('utf8');

    const dataStart = offset + 30 + fileNameLength + extraFieldLength;
    const dataEnd   = dataStart + compressedSize;

    if (fileName === targetFile || fileName.endsWith('/' + targetFile)) {
      const compressedData = zipBuffer.slice(dataStart, dataEnd);
      if (compressionMethod === 0) {
        // Stored (no compression)
        return compressedData.toString('utf8');
      } else if (compressionMethod === 8) {
        // Deflate
        return zlib.inflateRawSync(compressedData).toString('utf8');
      }
    }

    offset = dataEnd;
  }
  return null;
}

// Parse a CSV string into array of objects using the header row
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

// Fetch a URL and return a Buffer
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Simple in-memory cache (persists across warm Lambda invocations)
let cachedStops = null;
let cacheTime   = 0;
const CACHE_TTL = 3600 * 1000; // 1 hour

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const now = Date.now();
    if (cachedStops && (now - cacheTime) < CACHE_TTL) {
      return res.status(200).json(cachedStops);
    }

    const zipBuffer = await fetchBuffer(
      'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip'
    );

    const stopsCsv = extractFileFromZip(zipBuffer, 'stops.txt');
    if (!stopsCsv) throw new Error('stops.txt not found in GTFS zip');

    const rows = parseCsv(stopsCsv);

    // Build a flat id → name lookup
    const lookup = {};
    for (const row of rows) {
      if (row.stop_id && row.stop_name) {
        lookup[row.stop_id] = row.stop_name;
      }
    }

    cachedStops = lookup;
    cacheTime   = now;

    res.status(200).json(lookup);
  } catch (error) {
    console.error('Ferry stops proxy error:', error);
    res.status(500).json({ error: error.message });
  }
};
