const { execSync } = require('child_process');
const git = 'C:/Program Files/Git/cmd/git.exe';
const cwd = 'C:/Users/陆峻/WorkBuddy/20260428161026/codebuddy-web';

try {
  console.log('Staging...');
  execSync(`${git} add -A`, { cwd, encoding: 'utf8' });
  console.log('Staged.');
  
  console.log('Status:');
  const status = execSync(`${git} status --short`, { cwd, encoding: 'utf8' });
  console.log(status || '(clean)');
  
  console.log('Committing...');
  execSync(`${git} commit -m "fix: health check path + auto-install CodeBuddy CLI on Railway"`, { cwd, encoding: 'utf8' });
  console.log('Committed.');
  
  console.log('Pushing to origin (Gitee)...');
  execSync(`${git} push origin main`, { cwd, encoding: 'utf8' });
  console.log('Pushed to Gitee.');
} catch (e) {
  console.error('Error:', e.message);
  if (e.stdout) console.log('stdout:', e.stdout);
  if (e.stderr) console.log('stderr:', e.stderr);
}
