import p from 'postgres';
const db = p('postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require', { ssl: 'require' });

(async () => {
  const rows = await db`SELECT slug, title, html_content, is_published FROM report_sites WHERE type = 'portal'`;
  for (const s of rows) {
    const m = (s.html_content || '').match(/var WIDGETS=(\[[\s\S]*?\]);/);
    if (!m) { console.log(s.slug, '| NO WIDGETS | published:', s.is_published); continue; }
    const w = JSON.parse(m[1]);
    const providers = [...new Set(w.flatMap(wid => (wid.sources || wid.config?.sources || []).map(src => src.aiProvider || '?')))];
    console.log(s.slug, '|', providers, '| published:', s.is_published, '|', s.title);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
