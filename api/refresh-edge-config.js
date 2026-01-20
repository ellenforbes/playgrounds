const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  console.log('Environment check:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseKey,
    url: supabaseUrl?.substring(0, 30) + '...'
  });
  
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ 
      error: 'Missing Supabase environment variables',
      debug: {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey
      }
    });
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Authentication
  const { secret } = req.query;
  
  if (secret !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    console.log('Fetching data from Supabase...');
    
    // Fetch search index
    const { data: searchIndex, error: searchError } = await supabase
      .from('playgrounds_search_mv')
      .select('*');
    
    if (searchError) {
      console.error('Full Supabase error:', {
        message: searchError.message,
        details: searchError.details,
        hint: searchError.hint,
        code: searchError.code
      });
      throw new Error(`Search index error: ${searchError.message} (${searchError.code})`);
    }
    // Fetch all playgrounds
    const { data: allPlaygrounds, error: playgroundsError } = await supabase
      .from('playgrounds_main')
      .select('*');
    
    if (playgroundsError) throw new Error(`Playgrounds error: ${playgroundsError.message}`);
    
    // Fetch events
    const { data: events, error: eventsError } = await supabase
      .rpc('get_brisbane_events_with_coords');
    
    if (eventsError) throw new Error(`Events error: ${eventsError.message}`);
    
    // Fetch libraries
    const { data: libraries, error: librariesError } = await supabase
      .from('libraries')
      .select('*');
    
    if (librariesError) throw new Error(`Libraries error: ${librariesError.message}`);
    
    console.log('Data fetched successfully:', {
      searchIndex: searchIndex.length,
      playgrounds: allPlaygrounds.length,
      events: events.length,
      libraries: libraries.length
    });
    
    // Update Edge Config via Vercel API
    const edgeConfigId = process.env.EDGE_CONFIG_ID;
    const token = process.env.VERCEL_TOKEN;
    
    if (!edgeConfigId || !token) {
      throw new Error('Missing EDGE_CONFIG_ID or VERCEL_TOKEN environment variables');
    }
    
    console.log('Updating Edge Config...');
    
    const response = await fetch(
      `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            { operation: 'upsert', key: 'search_index', value: searchIndex },
            { operation: 'upsert', key: 'all_playgrounds', value: allPlaygrounds },
            { operation: 'upsert', key: 'events', value: events },
            { operation: 'upsert', key: 'libraries', value: libraries },
          ],
        }),
      }
    );
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Edge Config update failed: ${JSON.stringify(result)}`);
    }
    
    console.log('Edge Config updated successfully');
    
    return res.status(200).json({ 
      success: true,
      message: 'Edge Config updated successfully',
      updated: new Date().toISOString(),
      counts: {
        searchIndex: searchIndex.length,
        playgrounds: allPlaygrounds.length,
        events: events.length,
        libraries: libraries.length
      }
    });
    
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};