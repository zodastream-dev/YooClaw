const postgres = require('./node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL);

(async () => {
  const rows = await sql`SELECT id, slug, widgets FROM report_sites WHERE type='portal'`;
  let fixed = 0;
  for (const row of rows) {
    let widgets = row.widgets;
    if (typeof widgets === 'string') widgets = JSON.parse(widgets);
    if (!Array.isArray(widgets)) continue;
    let changed = false;
    for (const w of widgets) {
      if (w.type === 'intel-monitor' || w.type === 'monitor') {
        if (Array.isArray(w.sources)) {
          for (const s of w.sources) {
            if (s.aiModel === 'metaso-pro') { s.aiModel = 'deepseek-v4-flash'; changed = true; fixed++; }
          }
        }
        if (w.aiModel === 'metaso-pro') { w.aiModel = 'deepseek-v4-flash'; changed = true; fixed++; }
      }
    }
    if (changed) {
      await sql`UPDATE report_sites SET widgets = ${JSON.stringify(widgets)} WHERE id = ${row.id}`;
      console.log('Fixed:', row.slug || row.id);
    }
  }
  console.log('Total fixed:', fixed);
  await sql.end();
})().catch(e => { console.error(e.message); process.exit(1); });
