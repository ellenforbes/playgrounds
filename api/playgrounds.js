import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { min_lat, max_lat, min_lng, max_lng } = req.query;
  
  // Create cache key based on bounds
  const cacheKey = `playgrounds:${min_lat}:${max_lat}:${min_lng}:${max_lng}`;
  
  try {
    // Try cache first
    const cached = await kv.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        data: cached,
        source: 'cache'
      });
    }
    
    // Cache miss - fetch from Supabase
    const { data, error } = await supabase
      .rpc('get_playgrounds_in_bounds', {
        min_lat: parseFloat(min_lat),
        max_lat: parseFloat(max_lat),
        min_lng: parseFloat(min_lng),
        max_lng: parseFloat(max_lng)
      });
    
    if (error) throw error;
    
    // Cache for 6 hours
    await kv.set(cacheKey, data, { ex: 21600 });
    
    return res.status(200).json({
      data,
      source: 'database'
    });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
