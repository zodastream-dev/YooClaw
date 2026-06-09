import postgres from './node_modules/postgres/index.js';

const sql = postgres(process.env.DATABASE_URL);

const VALID_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

async function main() {
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
            if (s.aiModel === 'metaso-pro' || !VALID_MODELS.includes(s.aiModel)) {
              s.aiModel = 'deepseek-v4-flash';
              changed = true;
              fixed++;
            }
          }
        }
        if (!VALID_MODELS.includes(w.aiModel)) {
          w.aiModel = 'deepseek-v4-flash';
          changed = true;
          fixed++;
        }
      }
    }
    if (changed) {
      await sql`UPDATE report_sites SET widgets = ${JSON.stringify(widgets)} WHERE id = ${row.id}`;
      console.log('Fixed:', row.slug || row.id);
    }
  }
  console.log('Total fixed:', fixed);
  await sql.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
