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
    
    if (searchError) throw new Error(`Search index error: ${searchError.message}`);
    
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
    
    // Check data sizes
    const dataSize = JSON.stringify({
      search_index: searchIndex,
      all_playgrounds: allPlaygrounds,
      events: events,
      libraries: libraries
    }).length;
    
    console.log('Total data size:', (dataSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('Individual sizes:', {
      searchIndex: (JSON.stringify(searchIndex).length / 1024).toFixed(2) + 'KB',
      playgrounds: (JSON.stringify(allPlaygrounds).length / 1024).toFixed(2) + 'KB',
      events: (JSON.stringify(events).length / 1024).toFixed(2) + 'KB',
      libraries: (JSON.stringify(libraries).length / 1024).toFixed(2) + 'KB'
    });
    
    // Update Edge Config via Vercel API
    const edgeConfigId = process.env.EDGE_CONFIG_ID;
    const token = process.env.VERCEL_TOKEN;
    
    if (!edgeConfigId || !token) {
      throw new Error('Missing EDGE_CONFIG_ID or VERCEL_TOKEN environment variables');
    }
    
    console.log('Updating Edge Config...');
    
    // Use smaller chunk size since playgrounds data is huge
    const chunkSize = 20;
    
    // Chunk search index
    const searchChunks = [];
    for (let i = 0; i < searchIndex.length; i += chunkSize) {
      searchChunks.push(searchIndex.slice(i, i + chunkSize));
    }
    
    // Chunk playgrounds
    const playgroundChunks = [];
    for (let i = 0; i < allPlaygrounds.length; i += chunkSize) {
      playgroundChunks.push(allPlaygrounds.slice(i, i + chunkSize));
    }
    
    // Chunk events
    const eventChunks = [];
    for (let i = 0; i < events.length; i += chunkSize) {
      eventChunks.push(events.slice(i, i + chunkSize));
    }
    
    // Build items array
    const items = [
      { operation: 'upsert', key: 'libraries', value: libraries },
      { operation: 'upsert', key: 'search_total', value: searchIndex.length },
      { operation: 'upsert', key: 'playgrounds_total', value: allPlaygrounds.length },
      { operation: 'upsert', key: 'events_total', value: events.length }
    ];
    
    // Add all chunks
    searchChunks.forEach((chunk, index) => {
      items.push({ operation: 'upsert', key: `search_chunk_${index}`, value: chunk });
    });
    
    playgroundChunks.forEach((chunk, index) => {
      items.push({ operation: 'upsert', key: `playgrounds_chunk_${index}`, value: chunk });
    });
    
    eventChunks.forEach((chunk, index) => {
      items.push({ operation: 'upsert', key: `events_chunk_${index}`, value: chunk });
    });
    
    console.log('Total items to upload:', items.length);
    console.log('Chunks created:', {
      search: searchChunks.length,
      playgrounds: playgroundChunks.length,
      events: eventChunks.length
    });
    
    // Upload in batches of 5 items to stay well under 2MB
    const batchSize = 5;
    const batches = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    console.log(`Uploading in ${batches.length} batches...`);
    
    // Upload each batch
    for (let i = 0; i < batches.length; i++) {
      console.log(`Uploading batch ${i + 1}/${batches.length}...`);
      
      const response = await fetch(
        `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items: batches[i] }),
        }
      );
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(`Batch ${i + 1} failed: ${JSON.stringify(result)}`);
      }
      
      console.log(`Batch ${i + 1}/${batches.length} uploaded successfully`);
    }
    
    console.log('Edge Config updated successfully');
    
    return res.status(200).json({ 
      success: true,
      message: 'Edge Config updated successfully',
      updated: new Date().toISOString(),
      batches: batches.length,
      counts: {
        searchChunks: searchChunks.length,
        playgroundChunks: playgroundChunks.length,
        eventChunks: eventChunks.length,
        libraries: libraries.length
      },
      totals: {
        searchIndex: searchIndex.length,
        playgrounds: allPlaygrounds.length,
        events: events.length,
        libraries: libraries.length
      },
      dataSizeMB: (dataSize / 1024 / 1024).toFixed(2)
    });
    
  } catch (error) {
    console.error('Refresh error:', error);
    return res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};