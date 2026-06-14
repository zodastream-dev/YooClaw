/**
 * SMTP Email Service — extracted from briefing.ts, enhanced with attachment support.
 * Env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */

import tls from 'tls';

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass };
}

function base64Encode(s: string): string {
  return Buffer.from(s).toString('base64');
}

/**
 * Send a single email via SMTP (PLAIN auth over TLS, port 465).
 * Returns true on success.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  attachments?: { filename: string; content: Buffer; contentType?: string }[],
): Promise<boolean> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    console.log('[Mailer] SMTP not configured, skipping send to:', to);
    return false;
  }

  const { host, port, user, pass } = cfg;
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const hasAttachments = attachments && attachments.length > 0;

  const headers = [
    `From: =?UTF-8?B?${base64Encode('YooClaw')}?= <${user}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64Encode(subject)}?=`,
    'MIME-Version: 1.0',
  ];

  let body: string;
  if (hasAttachments) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    body = `--${boundary}\r\n`
      + 'Content-Type: text/html; charset=UTF-8\r\n\r\n'
      + htmlBody + '\r\n';
    for (const att of attachments!) {
      body += `--${boundary}\r\n`
        + `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"\r\n`
        + 'Content-Disposition: attachment; '
        + `filename="${att.filename}"\r\n`
        + `Content-Transfer-Encoding: base64\r\n\r\n`
        + att.content.toString('base64') + '\r\n';
    }
    body += `--${boundary}--\r\n`;
  } else {
    headers.push('Content-Type: text/html; charset=UTF-8');
    body = htmlBody;
  }

  const message = [...headers, '', body, '.'].join('\r\n');
  const auth = Buffer.from(`\x00${user}\x00${pass}`).toString('base64');

  console.log('[Mailer] Sending to:', to, 'via', host);
  try {
    return new Promise((resolve) => {
      const socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {
        let step = 0;
        socket.on('data', (d: Buffer) => {
          const text = d.toString();
          if (step === 0 && text.includes('220')) { socket.write('EHLO yooclaw\r\n'); step = 1; }
          else if (step === 1 && text.includes('AUTH')) { socket.write('AUTH PLAIN\r\n'); step = 2; }
          else if (step === 2 && text.includes('334')) { socket.write(auth + '\r\n'); step = 3; }
          else if (step === 3 && text.includes('235')) { socket.write(`MAIL FROM:<${user}>\r\n`); step = 4; }
          else if (step === 4 && text.match(/^2\d\d/)) { socket.write(`RCPT TO:<${to}>\r\n`); step = 5; }
          else if (step === 5 && text.match(/^2\d\d/)) { socket.write('DATA\r\n'); step = 6; }
          else if (step === 6 && text.includes('354')) { socket.write(message + '\r\n'); step = 7; }
          else if (step === 7 && text.match(/2\d\d.*queued/)) { socket.write('QUIT\r\n'); socket.end(); console.log('[Mailer] Sent OK to:', to); resolve(true); }
          else if (step >= 3 && text.match(/^5\d\d/)) { console.error('[Mailer] SMTP error:', text.substring(0, 200)); socket.destroy(); resolve(false); }
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(15000, () => { socket.destroy(); resolve(false); });
      });
    });
  } catch (e: any) {
    console.error('[Mailer] Failed:', e.message);
    return false;
  }
}

/** Build a styled HTML email body for invoice delivery */
export function buildInvoiceEmailHtml(params: {
  userName: string;
  orderId: string;
  productName: string;
  amountYuan: number;
  invoiceDate: string;
}): string {
  const { userName, orderId, productName, amountYuan, invoiceDate } = params;
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5">
<div style="background:#fff;border-radius:12px;padding:24px 32px;box-shadow:0 1px 6px rgba(0,0,0,0.06)">
  <h2 style="color:#1a1a2e;font-size:20px;font-weight:500;margin:0 0 8px">电子发票</h2>
  <p style="color:#666;font-size:14px;margin:0 0 24px">${userName} 您好，以下是您的电子发票信息：</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#999;width:80px">订单号</td><td style="padding:8px 0;color:#333">${orderId}</td></tr>
    <tr><td style="padding:8px 0;color:#999">商品</td><td style="padding:8px 0;color:#333">${productName}</td></tr>
    <tr><td style="padding:8px 0;color:#999">金额</td><td style="padding:8px 0;color:#333;font-weight:500">¥${amountYuan.toFixed(2)}</td></tr>
    <tr><td style="padding:8px 0;color:#999">开票日期</td><td style="padding:8px 0;color:#333">${invoiceDate}</td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #e8e8e8;margin:20px 0">
  <p style="font-size:13px;color:#888;margin:0">电子发票 PDF 版式文件见附件。您也可以在微信「我 → 卡包」中查看此发票。</p>
  <p style="font-size:12px;color:#aaa;margin:8px 0 0">YooClaw 团队</p>
</div></div>`;
}

/** Build password reset email HTML */
export function buildResetEmailHtml(params: { username: string; token: string }): string {
  const resetUrl = `https://yooclaw.yookeer.com/#/reset-password?token=${params.token}`;
  return `<div style="background:#f8f9fb;padding:40px 0"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
  <div style="background:#4f46e5;padding:20px;text-align:center">
    <h1 style="color:#fff;font-size:18px;margin:0">YooClaw 密码重置</h1>
  </div>
  <div style="padding:24px">
    <p style="font-size:14px;color:#333;margin:0 0 12px">您好 <b>${params.username}</b>，</p>
    <p style="font-size:14px;color:#555;margin:0 0 16px;line-height:1.6">您正在重置 YooClaw 账号密码。点击下方按钮完成重置（24小时内有效）：</p>
    <div style="text-align:center;margin:20px 0">
      <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 32px;border-radius:6px;text-decoration:none;font-size:14px">重置密码</a>
    </div>
    <p style="font-size:12px;color:#888;margin:16px 0 0;line-height:1.5">如果按钮无法点击，请复制以下链接到浏览器打开：<br><a href="${resetUrl}" style="color:#4f46e5">${resetUrl}</a></p>
    <hr style="border:none;border-top:1px solid #e8e8e8;margin:20px 0">
    <p style="font-size:12px;color:#aaa;margin:0">如非本人操作，请忽略此邮件。</p>
  </div>
</div></div>`;
}
