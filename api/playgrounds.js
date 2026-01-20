import { get } from '@vercel/edge-config';

export default async function handler(req, res) {
  const { min_lat, max_lat, min_lng, max_lng } = req.query;
  
  try {
    // Get ALL playgrounds from Edge Config
    const allPlaygrounds = await get('all_playgrounds');
    
    if (!allPlaygrounds) {
      return res.status(404).json({ 
        error: 'Playgrounds not found in Edge Config. Please refresh the cache.' 
      });
    }
    
    // Filter for the requested bounds
    const filtered = allPlaygrounds.filter(pg => 
      pg.lat >= parseFloat(min_lat) &&
      pg.lat <= parseFloat(max_lat) &&
      pg.lng >= parseFloat(min_lng) &&
      pg.lng <= parseFloat(max_lng)
    );
    
    return res.status(200).json({
      data: filtered,
      source: 'edge-config',
      total: allPlaygrounds.length,
      filtered: filtered.length
    });
    
  } catch (error) {
    console.error('Edge Config error:', error);
    return res.status(500).json({ error: error.message });
  }
}