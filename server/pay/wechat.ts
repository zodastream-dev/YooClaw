/**
 * WeChat Pay v3 Native Payment (QR Code)
 *
 * Env vars required:
 *   WECHAT_PAY_APP_ID          - 公众号/小程序 AppID
 *   WECHAT_PAY_MCH_ID          - 商户号
 *   WECHAT_PAY_API_V3_KEY      - APIv3 密钥 (32 chars)
 *   WECHAT_PAY_PRIVATE_KEY     - 商户私钥 PEM 内容 (or set WECHAT_PAY_PRIVATE_KEY_PATH)
 *   WECHAT_PAY_PRIVATE_KEY_PATH - 商户私钥文件路径 (优先于 WECHAT_PAY_PRIVATE_KEY)
 *   WECHAT_PAY_CERT_SERIAL     - 证书序列号
 *   WECHAT_PAY_NOTIFY_URL      - 回调地址
 */

import crypto from 'crypto';
import fs from 'fs';
import https from 'https';

function loadPrivateKey(): string {
  const path = process.env.WECHAT_PAY_PRIVATE_KEY_PATH;
  if (path && fs.existsSync(path)) {
    return fs.readFileSync(path, 'utf-8');
  }
  return process.env.WECHAT_PAY_PRIVATE_KEY || '';
}

const ENV = {
  appId: process.env.WECHAT_PAY_APP_ID || '',
  mchId: process.env.WECHAT_PAY_MCH_ID || '',
  apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
  certSerial: process.env.WECHAT_PAY_CERT_SERIAL || '',
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '',
  get privateKeyPem() { return loadPrivateKey(); },
};

// WeChat platform certificates cache (for callback verification)
const platformCerts: Map<string, string> = new Map();

function isConfigured(): boolean {
  return !!(ENV.appId && ENV.mchId && ENV.apiV3Key && ENV.privateKeyPem && ENV.certSerial);
}

/**
 * Generate WeChat Pay v3 signature
 */
function sign(method: string, url: string, body: string, timestamp: string, nonce: string): string {
  const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const sig = signer.sign(ENV.privateKeyPem, 'base64');
  return sig;
}

/**
 * WeChat response type
 */
interface WechatResponse {
  code_url?: string;
  prepay_id?: string;
  message?: string;
}

/**
 * Create Native payment order (returns QR code URL)
 */
export async function createNativeOrder(
  orderId: string,
  description: string,
  amountYuan: number
): Promise<{ success: boolean; codeUrl?: string; prepayId?: string; error?: string }> {
  if (!isConfigured()) {
    return { success: false, error: 'WECHAT_PAY_* environment variables not configured' };
  }

  const url = '/v3/pay/transactions/native';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const amountFen = amountYuan * 100; // WeChat uses fen (分)

  const body = JSON.stringify({
    appid: ENV.appId,
    mchid: ENV.mchId,
    description: description.slice(0, 127),
    out_trade_no: orderId,
    notify_url: ENV.notifyUrl,
    amount: {
      total: amountFen,
      currency: 'CNY',
    },
  });

  const signature = sign('POST', url, body, timestamp, nonce);

  try {
    const resp = await fetch('https://api.mch.weixin.qq.com' + url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'YooClaw/1.0',
        'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${ENV.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${ENV.certSerial}"`,
      },
      body,
    });

    const data = await resp.json() as WechatResponse;

    if (!resp.ok) {
      return { success: false, error: data.message || `WECHAT_ERROR_${resp.status}` };
    }

    return {
      success: true,
      codeUrl: data.code_url,
      prepayId: data.prepay_id,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'WeChat API call failed' };
  }
}

/**
 * Fetch WeChat Pay platform certificates for callback verification
 * Called at startup and periodically refreshed
 */
export async function fetchPlatformCertificates(): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const url = '/v3/certificates';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = '';
    const signature = sign('GET', url, body, timestamp, nonce);

    const respData = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request('https://api.mch.weixin.qq.com' + url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'YooClaw/1.0',
          'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${ENV.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${ENV.certSerial}"`,
        },
      }, (res) => {
        let b = '';
        res.on('data', (chunk: string) => b += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: b }));
      });
      req.on('error', reject);
      req.end();
    });

    if (respData.status !== 200) {
      console.error('[WechatPay] Failed to fetch platform certs:', respData.status, respData.body.substring(0, 200));
      return false;
    }

    const data = JSON.parse(respData.body) as { data: Array<{ serial_no: string; encrypt_certificate: { algorithm: string; nonce: string; associated_data: string; ciphertext: string } }> };
    if (!data.data) return false;

    for (const cert of data.data) {
      // Decrypt the certificate
      const certText = decryptResource(
        cert.encrypt_certificate.associated_data || '',
        cert.encrypt_certificate.nonce,
        cert.encrypt_certificate.ciphertext
      );
      platformCerts.set(cert.serial_no, certText);
    }

    console.log('[WechatPay] Platform certs loaded:', platformCerts.size, 'certs');
    return true;
  } catch (err: any) {
    console.error('[WechatPay] Platform certs fetch error:', err.message);
    return false;
  }
}

/**
 * Verify WeChat callback signature using platform certificate
 */
export function verifyCallback(
  body: string,
  wechatTimestamp: string,
  wechatNonce: string,
  wechatSignature: string,
  wechatSerial?: string
): boolean {
  if (!wechatSignature || !wechatTimestamp || !wechatNonce) return false;

  const message = `${wechatTimestamp}\n${wechatNonce}\n${body}\n`;

  // Try the specified serial first, then fall back to all cached certs
  if (wechatSerial && platformCerts.has(wechatSerial)) {
    const cert = platformCerts.get(wechatSerial)!;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    return verifier.verify(cert, wechatSignature, 'base64');
  }

  // Fallback: try all cached certs
  for (const [serial, cert] of platformCerts) {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    if (verifier.verify(cert, wechatSignature, 'base64')) {
      return true;
    }
  }

  return false;
}

/**
 * Decrypt WeChat callback resource
 */
export function decryptResource(
  associatedData: string,
  nonce: string,
  ciphertext: string
): string {
  // Docs: https://pay.weixin.qq.com/docs/merchant/development/interface-rules/certificate-callback-decryption.html
  // WeChat uses DIFFERENT nonce formats for different callbacks:
  //   - Payment callback: UTF-8 string (e.g. "GoiPLVcZrQm5" → 12 bytes)
  //   - Certificate download: hex string (e.g. "7e71361c8aeb" → 6 bytes)
  // associated_data is always plain UTF-8 (e.g. "transaction", "certificate").
  // Auth tag is last 16 bytes of ciphertext (which IS base64-encoded).
  const keys = [ENV.apiV3Key];

  const rawBytes = Buffer.from(ciphertext, 'base64');
  const authTag = rawBytes.slice(-16);
  const encrypted = rawBytes.slice(0, -16);
  const aad = associatedData ? Buffer.from(associatedData, 'utf-8') : null;

  // Try multiple nonce encodings: utf-8 first (payment callback), then hex (cert download)
  const nonceEncodings: BufferEncoding[] = ['utf-8', 'hex'];

  for (const key of keys) {
    for (const enc of nonceEncodings) {
      try {
        const nonceBytes = Buffer.from(nonce, enc);
        if (nonceBytes.length === 0) continue; // skip invalid encodings
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), nonceBytes);
        decipher.setAuthTag(authTag);
        if (aad && aad.length > 0) decipher.setAAD(aad);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf-8');
      } catch (e) {
        // try next encoding
      }
    }
  }
  throw new Error('Decryption failed with all keys');
}

export { isConfigured as isWechatConfigured };
