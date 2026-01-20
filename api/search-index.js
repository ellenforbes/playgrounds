import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const CACHE_KEY = 'search_index';
  
  try {
    // Try cache first
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      return res.status(200).json({
        data: cached,
        source: 'cache'
      });
    }
    
    // Cache miss - fetch from Supabase
    const { data, error } = await supabase
      .from('playgrounds_search_mv')
      .select('*');
    
    if (error) throw error;
    
    // Cache for 6 hours
    await kv.set(CACHE_KEY, data, { ex: 21600 });
    
    return res.status(200).json({
      data,
      source: 'database'
    });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
