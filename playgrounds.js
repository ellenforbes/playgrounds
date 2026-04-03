const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    const { min_lat, max_lat, min_lng, max_lng } = req.query;

    if (min_lat && max_lat && min_lng && max_lng) {
      // Viewport-bounded fetch — only returns playgrounds in the visible area
      const { data, error } = await supabase.rpc('get_playgrounds_in_bounds', {
        p_min_lat: parseFloat(min_lat),
        p_max_lat: parseFloat(max_lat),
        p_min_lng: parseFloat(min_lng),
        p_max_lng: parseFloat(max_lng)
      });

      if (error) throw new Error(error.message);
      return res.status(200).json({ data, count: data.length, source: 'viewport' });
    }

    // Fallback: no bounds provided, return everything (kept for backward compat)
    const { data, error } = await supabase.rpc('get_playgrounds_with_coords');
    if (error) throw new Error(error.message);
    return res.status(200).json({ data, count: data.length, source: 'all' });

  } catch (error) {
    console.error('Playgrounds error:', error);
    return res.status(500).json({ error: error.message });
  }
};
