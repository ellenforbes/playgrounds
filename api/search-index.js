import { get } from '@vercel/edge-config';

export default async function handler(req, res) {
  try {
    const data = await get('search_index');
    
    if (data) {
      return res.status(200).json({
        data,
        source: 'edge-config',
        count: data.length
      });
    }
    
    return res.status(404).json({ 
      error: 'Search index not found. Please refresh the cache.',
      hint: 'Call /api/refresh-edge-config?secret=YOUR_SECRET'
    });
    
  } catch (error) {
    console.error('Edge Config error:', error);
    return res.status(500).json({ error: error.message });
  }
}