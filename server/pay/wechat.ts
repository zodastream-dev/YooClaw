/**
 * WeChat Pay v3 Native Payment (QR Code)
 *
 * Env vars required:
 *   WECHAT_PAY_APP_ID       - 公众号/小程序 AppID
 *   WECHAT_PAY_MCH_ID       - 商户号
 *   WECHAT_PAY_API_V3_KEY   - APIv3 密钥 (32 chars)
 *   WECHAT_PAY_PRIVATE_KEY  - 商户私钥 PEM 内容 (base64)
 *   WECHAT_PAY_CERT_SERIAL  - 证书序列号
 *   WECHAT_PAY_NOTIFY_URL   - 回调地址
 */

import crypto from 'crypto';

const ENV = {
  appId: process.env.WECHAT_PAY_APP_ID || '',
  mchId: process.env.WECHAT_PAY_MCH_ID || '',
  apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
  privateKeyPem: process.env.WECHAT_PAY_PRIVATE_KEY || '',
  certSerial: process.env.WECHAT_PAY_CERT_SERIAL || '',
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '',
};

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
 * Verify WeChat callback signature
 */
export function verifyCallback(
  body: string,
  wechatTimestamp: string,
  wechatNonce: string,
  wechatSignature: string
): boolean {
  if (!isConfigured()) return false;
  const message = `${wechatTimestamp}\n${wechatNonce}\n${body}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  return verifier.verify(ENV.privateKeyPem, wechatSignature, 'base64');
}

/**
 * Decrypt WeChat callback resource
 */
export function decryptResource(
  associatedData: string,
  nonce: string,
  ciphertext: string
): string {
  const key = ENV.apiV3Key;
  const authTag = Buffer.from(ciphertext, 'base64').slice(-16);
  const encrypted = Buffer.from(ciphertext, 'base64').slice(0, -16);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key),
    Buffer.from(nonce)
  );
  decipher.setAuthTag(authTag);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData));
  }
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

export { isConfigured as isWechatConfigured };
