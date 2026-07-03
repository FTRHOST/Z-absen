const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const config = fs.readFileSync('config.js', 'utf8');
const urlMatch = config.match(/const supabaseUrl = ['"]([^'"]+)['"]/);
const keyMatch = config.match(/const supabaseKey = ['"]([^'"]+)['"]/);

if (urlMatch && keyMatch) {
  const supabase = createClient(urlMatch[1], keyMatch[1]);
  supabase.from('cuti').select('*').limit(1).then(({ data, error }) => {
    if (error) console.error(error);
    else if (data && data.length > 0) {
      console.log(Object.keys(data[0]));
    } else {
      console.log("No data found in cuti table.");
    }
  });
}
