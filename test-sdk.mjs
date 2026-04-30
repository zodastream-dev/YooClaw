import pkg from '@tencent-ai/agent-sdk';
const { query } = pkg;

async function test() {
  console.log('[TEST] Starting SDK test...');
  
  try {
    const q = query({
      prompt: '今天星期几？请简短回答',
      options: {
        env: {
          CODEBUDDY_API_KEY: 'ck_fkkxi3sh9atc.Oe_0aZuVJcnKiDfBt6zHZuNplV4BZ0wsGoU__br2TkA',
          CODEBUDDY_INTERNET_ENVIRONMENT: 'internal',
        },
        permissionMode: 'bypassPermissions',
        stderr: (text) => { process.stderr.write('[CLI STDERR] ' + text + '\n'); },
      },
    });

    console.log('[TEST] Query created, waiting for connection...');
    
    // Try to connect explicitly first
    try {
      await q.connect();
      console.log('[TEST] Connected successfully!');
    } catch (connErr) {
      console.error('[TEST] Connection failed:', connErr.message);
    }
    
    console.log('[TEST] Iterating messages...');
    
    for await (const message of q) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            process.stdout.write(block.text);
          }
        }
      } else if (message.type === 'result') {
        console.log('\n[RESULT]', message.subtype, 'duration:', message.duration_ms, 'ms');
      } else if (message.type === 'status') {
        console.log('[STATUS]', message.message);
      } else {
        console.log('[MSG]', message.type, JSON.stringify(message).slice(0, 200));
      }
    }
    
    console.log('\n[TEST] Done!');
  } catch (e) {
    console.error('[ERROR]', e.message);
    console.error('[STACK]', e.stack);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

test();
