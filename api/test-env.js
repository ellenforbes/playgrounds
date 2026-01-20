module.exports = async (req, res) => {
  return res.status(200).json({
    nodeVersion: process.version,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_KEY,
    hasRefreshSecret: !!process.env.REFRESH_SECRET,
    hasEdgeConfigId: !!process.env.EDGE_CONFIG_ID,
    hasVercelToken: !!process.env.VERCEL_TOKEN,
    supabaseUrlLength: process.env.SUPABASE_URL?.length || 0,
    allEnvKeys: Object.keys(process.env).filter(k => 
      k.includes('SUPABASE') || k.includes('REFRESH') || k.includes('EDGE') || k.includes('VERCEL')
    )
  });
};