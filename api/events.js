import { get } from '@vercel/edge-config';

export default async function handler(req, res) {
  try {
    const data = await get('events');
    
    if (data) {
      return res.status(200).json({
        data,
        source: 'edge-config',
        count: data.length
      });
    }
    
    return res.status(404).json({ 
      error: 'Events not found in Edge Config. Please refresh the cache.' 
    });
    
  } catch (error) {
    console.error('Edge Config error:', error);
    return res.status(500).json({ error: error.message });
  }
}