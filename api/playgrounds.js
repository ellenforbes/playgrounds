const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const { data, error } = await supabase.from('playgrounds_main').select('*');

    if (error) throw new Error(error.message);

    return res.status(200).json({ data, count: data.length });

  } catch (error) {
    console.error('Playgrounds error:', error);
    return res.status(500).json({ error: error.message });
  }
};
