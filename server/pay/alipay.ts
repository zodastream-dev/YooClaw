/**
 * Alipay Page Payment (电脑网站支付)
 *
 * Env vars required:
 *   ALIPAY_APP_ID        - 支付宝应用ID
 *   ALIPAY_PRIVATE_KEY   - 商户私钥 PEM
 *   ALIPAY_PUBLIC_KEY    - 支付宝公钥 PEM
 *   ALIPAY_NOTIFY_URL    - 异步通知地址
 *   ALIPAY_RETURN_URL    - 同步跳转地址（支付完成后返回）
 */

import crypto from 'crypto';

const ENV = {
  appId: process.env.ALIPAY_APP_ID || '',
  privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
  publicKey: process.env.ALIPAY_PUBLIC_KEY || '',
  notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
  returnUrl: process.env.ALIPAY_RETURN_URL || '',
};

const ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do';

function isConfigured(): boolean {
  return !!(ENV.appId && ENV.privateKey && ENV.publicKey);
}

interface BizContent {
  out_trade_no: string;
  total_amount: number;
  subject: string;
  product_code: 'FAST_INSTANT_TRADE_PAY';
}

/**
 * Build request params string for signing
 */
function buildParamsToSign(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '' && params[k] !== undefined)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return sorted;
}

/**
 * Sign with RSA-SHA256
 */
function sign(params: Record<string, string>): string {
  const content = buildParamsToSign(params);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(content);
  signer.end();
  return signer.sign(ENV.privateKey, 'base64');
}

/**
 * Verify Alipay callback signature
 */
export function verifyCallback(params: Record<string, string>): boolean {
  const sign = params['sign'];
  const signType = params['sign_type'] || 'RSA2';
  if (!sign) return false;

  const content = buildParamsToSign(params);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(content);
  verifier.end();
  return verifier.verify(ENV.publicKey, sign, 'base64');
}

/**
 * Create page payment (returns Alipay redirect URL)
 */
export function createPagePayment(
  orderId: string,
  subject: string,
  amountYuan: number
): { success: boolean; paymentUrl?: string; error?: string } {
  if (!isConfigured()) {
    return { success: false, error: 'ALIPAY_* environment variables not configured' };
  }

  const bizContent: BizContent = {
    out_trade_no: orderId,
    total_amount: amountYuan,
    subject: subject.slice(0, 256),
    product_code: 'FAST_INSTANT_TRADE_PAY',
  };

  const params: Record<string, string> = {
    app_id: ENV.appId,
    method: 'alipay.trade.page.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '+08:00'),
    version: '1.0',
    notify_url: ENV.notifyUrl,
    return_url: ENV.returnUrl,
    biz_content: JSON.stringify(bizContent),
  };

  params.sign = sign(params);

  // Build URL
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return {
    success: true,
    paymentUrl: `${ALIPAY_GATEWAY}?${query}`,
  };
}

export { isConfigured as isAlipayConfigured };
