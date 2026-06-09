import p from 'postgres';
const db = p('postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require', { ssl: 'require' });

(async () => {
  const rows = await db`SELECT html_content FROM report_sites WHERE slug = 'site-4ca7fa'`;
  const html = rows[0]?.html_content || '';
  const m = html.match(/var WIDGETS=(\[[\s\S]*?\]);/);
  if (!m) { console.log('No WIDGETS'); process.exit(1); }
  const w = JSON.parse(m[1]);
  
  // Check 行业信号 (index 0)
  const ind = w[0];
  const iSrc = (ind.sources||ind.config?.sources||[])[0];
  console.log('行业信号.aiProvider:', iSrc?.aiProvider);
  console.log('行业信号.keywords:', JSON.stringify(iSrc?.keywords||[]));
  console.log('行业信号.objects:', JSON.stringify(iSrc?.objects||[]));
  
  // Check 自身舆情 (index 3)
  const self = w[3];
  const sSrc = (self.sources||self.config?.sources||[])[0];
  console.log('自身舆情.aiProvider:', sSrc?.aiProvider);
  console.log('自身舆情.keywords count:', (sSrc?.keywords||[]).length);
  console.log('自身舆情.objects:', JSON.stringify(sSrc?.objects||[]));
  
  // Check widget structure
  console.log('自身舆情 has top-level sources:', !!self.sources);
  console.log('自身舆情 has config.sources:', !!(self.config?.sources));
  
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
