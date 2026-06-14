const tls = require('tls');
const user = 'junlu@zodastream.com';
const pass = 'Zodastream1';
const to = 'junlu@yookeer.com';

console.log('Testing SMTP with user=', user, 'pass=', pass.replace(/./g, '*'), 'to=', to);
const auth = Buffer.from('\x00' + user + '\x00' + pass).toString('base64');

const sock = tls.connect(465, 'smtp.mxhichina.com', { rejectUnauthorized: false }, () => {
  let step = 0;
  sock.on('data', (d) => {
    const text = d.toString();
    console.log(step, '<-', text.substring(0,200));
    if (step === 0 && text.includes('220')) { sock.write('EHLO yooclaw\r\n'); step = 1; }
    else if (step === 1 && /AUTH/.test(text)) { sock.write('AUTH PLAIN\r\n'); step = 2; }
    else if (step === 2 && text.includes('334')) { sock.write(auth + '\r\n'); step = 3; }
    else if (step === 3 && text.includes('235')) { sock.write('MAIL FROM:<' + user + '>\r\n'); step = 4; }
    else if (step === 4 && /^2\d\d/.test(text)) { sock.write('RCPT TO:<' + to + '>\r\n'); step = 5; }
    else if (step === 5 && /^2\d\d/.test(text)) { sock.write('DATA\r\n'); step = 6; }
    else if (step === 6 && text.includes('354')) {
      sock.write('Subject: YooClaw Password Reset Test\r\nFrom: ' + user + '\r\nTo: ' + to + '\r\n\r\nTest email from yooclaw\r\n.\r\n'); step = 7;
    }
    else if (step === 7) { console.log('FINAL:', text.substring(0,200)); sock.write('QUIT\r\n'); sock.end(); }
    else if (step >= 3 && /^5\d\d/.test(text)) { console.log('SMTP ERROR at step', step); sock.destroy(); }
  });
  sock.on('error', (e) => console.log('SOCK_ERR:', e.message));
  sock.setTimeout(15000, () => { console.log('TIMEOUT'); sock.destroy(); });
});
