// clean_aimodel.cjs - Clean metaso-pro aiModel values from report_sites
const postgres = require('postgres');
const VALID_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function main() {
  const rows = await sql`SELECT id, slug, widgets FROM report_sites WHERE type='portal'`;
  console.log('Found', rows.length, 'portals');

  let fixed = 0;
  for (const row of rows) {
    let widgets = row.widgets;
    if (typeof widgets === 'string') widgets = JSON.parse(widgets);
    if (!Array.isArray(widgets)) continue;

    let changed = false;
    for (const w of widgets) {
      if (w.type === 'intel-monitor' || w.type === 'monitor') {
        const sources = (w.sources || []).concat((w.config || {}).sources || []);
        for (const s of sources) {
          if (s.aiModel && !VALID_MODELS.includes(s.aiModel)) {
            s.aiModel = 'deepseek-v4-flash';
            changed = true;
            fixed++;
          }
        }
        if (w.aiModel && !VALID_MODELS.includes(w.aiModel)) {
          w.aiModel = 'deepseek-v4-flash';
          changed = true;
          fixed++;
        }
      }
    }

    if (changed) {
      await sql`UPDATE report_sites SET widgets = ${JSON.stringify(widgets)} WHERE id = ${row.id}`;
      console.log('  Fixed:', row.slug || row.id);
    }
  }

  console.log('Total fixed:', fixed);
  await sql.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
