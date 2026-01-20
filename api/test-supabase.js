const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  console.log('Testing Supabase connection...');
  console.log('URL:', supabaseUrl);
  console.log('Key length:', supabaseKey?.length);
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Try a very simple query
    const { data, error } = await supabase
      .from('playgrounds_main')
      .select('id')
      .limit(1);
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({
        error: 'Supabase query failed',
        details: error.message,
        code: error.code,
        hint: error.hint
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Supabase connection works!',
      rowCount: data?.length || 0
    });
    
  } catch (err) {
    console.error('Catch block error:', err);
    return res.status(500).json({
      error: err.message,
      name: err.name,
      cause: err.cause?.message,
      stack: err.stack
    });
  }
};
