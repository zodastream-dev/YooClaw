import { sql, initDatabase, verifyPassword, hashPassword } from './db.js';
await initDatabase();
const users = await sql`SELECT username, role, password_hash FROM users WHERE username = 'admin'`;
console.log('Admin users:', JSON.stringify(users, null, 2));
if (users.length > 0) {
  console.log('Verify admin0000:', verifyPassword('admin0000', users[0].password_hash));
  // Reset password to admin0000
  const newHash = hashPassword('admin0000');
  await sql`UPDATE users SET password_hash = ${newHash} WHERE username = 'admin'`;
  console.log('Password reset to admin0000');
} else {
  console.log('No admin user found');
  const newHash = hashPassword('admin0000');
  await sql`INSERT INTO users (username, password_hash, role, status) VALUES ('admin', ${newHash}, 'admin', 'active')`;
  console.log('Admin created with admin0000');
}
process.exit(0);
