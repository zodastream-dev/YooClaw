// V3.6 DB Patch: Apply UI refinements to policy signal portal
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function main() {
  const SUPABASE_URL = 'https://wamdpqeunfawkdntjztb.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_KEY not set');
    process.exit(1);
  }

  const newHtml = fs.readFileSync('/tmp/v36-portal.html', 'utf-8');
  console.log('New HTML length:', newHtml.length);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Get current record
  const { data, error } = await supabase
    .from('report_sites')
    .select('id, html_content')
    .eq('slug', 'site-cec6c0')
    .single();

  if (error) {
    console.error('ERROR fetching record:', error);
    process.exit(1);
  }

  console.log('Record ID:', data.id);
  console.log('Old HTML length:', data.html_content.length);

  // Update
  const { error: updateError } = await supabase
    .from('report_sites')
    .update({ html_content: newHtml })
    .eq('id', data.id);

  if (updateError) {
    console.error('ERROR updating:', updateError);
    process.exit(1);
  }

  console.log('DB updated successfully');

  // Verify
  const { data: verifyData } = await supabase
    .from('report_sites')
    .select('html_content')
    .eq('slug', 'site-cec6c0')
    .single();

  console.log('Verified HTML length:', verifyData.html_content.length);
  if (verifyData.html_content.length === newHtml.length) {
    console.log('PASS: Length matches');
  } else {
    console.log('WARN: Length mismatch');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
