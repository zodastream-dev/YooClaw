/**
 * Alipay Page Payment (电脑网站支付)
 *
 * Env vars required:
 *   ALIPAY_APP_ID             - 支付宝应用ID
 *   ALIPAY_PRIVATE_KEY_PATH   - 商户私钥 PEM 文件路径
 *   ALIPAY_PUBLIC_KEY_PATH    - 支付宝公钥 PEM 文件路径
 *   ALIPAY_NOTIFY_URL         - 异步通知地址
 *   ALIPAY_RETURN_URL         - 同步跳转地址（支付完成后返回）
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ENV = {
  appId: process.env.ALIPAY_APP_ID || '',
  privateKeyPath: process.env.ALIPAY_PRIVATE_KEY_PATH || '/etc/yooclaw/certs/alipay_private_key.pem',
  publicKeyPath: process.env.ALIPAY_PUBLIC_KEY_PATH || '/etc/yooclaw/certs/alipay_public_key.pem',
  notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
  returnUrl: process.env.ALIPAY_RETURN_URL || '',
};

function getPrivateKey(): string {
  return fs.readFileSync(ENV.privateKeyPath, 'utf-8');
}

function getPublicKey(): string {
  return fs.readFileSync(ENV.publicKeyPath, 'utf-8');
}

function isConfigured(): boolean {
  return !!(ENV.appId && fs.existsSync(ENV.privateKeyPath) && fs.existsSync(ENV.publicKeyPath));
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
    .filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== undefined)
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
  return signer.sign(getPrivateKey(), 'base64');
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
  return verifier.verify(getPublicKey(), sign, 'base64');
}

const ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do';

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

  // Alipay requires format: yyyy-MM-dd HH:mm:ss (local time, space-separated)
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const alipayTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const params: Record<string, string> = {
    app_id: ENV.appId,
    method: 'alipay.trade.page.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: alipayTimestamp,
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
