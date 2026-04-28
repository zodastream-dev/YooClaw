const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ws = path.resolve('C:/Users/陆峻/WorkBuddy/20260428161026/codebuddy-web');
const outFile = path.join(ws, '_git_ops_result.txt');
const git = 'C:/Program Files/Git/cmd/git.exe';

const results = [];

function run(cmd) {
  try {
    const out = execSync(`"${git}" ${cmd}`, { cwd: ws, encoding: 'utf8' }).trim();
    results.push(`OK: ${cmd}\n  ${out.substring(0, 200)}`);
    return out;
  } catch (e) {
    const err = (e.stderr || e.message).substring(0, 200);
    results.push(`FAIL: ${cmd}\n  ${err}`);
    return null;
  }
}

// Add all files
run('add -A');

// Check what's staged
const status = run('status --short');
results.push('\n=== Staged files preview ===');

// Commit
run('commit -m "feat: YooClaw initial commit - multi-user AI chat with PostgreSQL"');

// Verify
run('log --oneline -1');

fs.writeFileSync(outFile, results.join('\n\n'), 'utf8');
