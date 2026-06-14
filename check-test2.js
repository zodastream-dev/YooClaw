const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres.gshktfexvcyacyjtridi:Zodastream1!@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require' });
(async()=>{
  const r = await p.query("SELECT username,email,reset_token,reset_expires FROM users WHERE username='test2'");
  console.log(JSON.stringify(r.rows));
  await p.end();
})();
