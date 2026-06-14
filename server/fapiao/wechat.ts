/**
 * WeChat Pay v3 Electronic Invoice API (新税控 - v3/new-tax-control-fapiao)
 *
 * API endpoints (from official docs):
 *   POST /v3/new-tax-control-fapiao/fapiao-applications          — Issue invoice
 *   GET  /v3/new-tax-control-fapiao/fapiao-applications/{applyId} — Query status
 *   GET  /v3/new-tax-control-fapiao/fapiao-applications/{applyId}/fapiao-files — Get download URL
 *
 * Env vars required:
 *   WECHAT_PAY_APP_ID, WECHAT_PAY_MCH_ID, WECHAT_PAY_API_V3_KEY,
 *   WECHAT_PAY_PRIVATE_KEY_PATH, WECHAT_PAY_CERT_SERIAL,
 *   FAPAIO_ENABLED=true
 */

import crypto from 'crypto';
import fs from 'fs';

function loadPrivateKey(): string {
  const path = process.env.WECHAT_PAY_PRIVATE_KEY_PATH;
  if (path && fs.existsSync(path)) return fs.readFileSync(path, 'utf-8');
  return process.env.WECHAT_PAY_PRIVATE_KEY || '';
}

const ENV = {
  appId: process.env.WECHAT_PAY_APP_ID || '',
  mchId: process.env.WECHAT_PAY_MCH_ID || '',
  apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
  certSerial: process.env.WECHAT_PAY_CERT_SERIAL || '',
  get privateKeyPem() { return loadPrivateKey(); },
};

export function isFapiaoConfigured(): boolean {
  return process.env.FAPAIO_ENABLED === 'true'
    && !!(ENV.appId && ENV.mchId && ENV.apiV3Key && ENV.privateKeyPem && ENV.certSerial);
}

function sign(method: string, url: string, body: string, timestamp: string, nonce: string): string {
  const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  return signer.sign(ENV.privateKeyPem, 'base64');
}

const BASE = '/v3/new-tax-control-fapiao/fapiao-applications';

async function fapiaoRequest(method: string, url: string, body?: object): Promise<{ ok: boolean; status: number; data: any }> {
  if (!isFapiaoConfigured()) return { ok: false, status: 0, data: { message: 'Invoice service not configured' } };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyStr = body ? JSON.stringify(body) : '';
  const signature = sign(method, url, bodyStr, timestamp, nonce);

  try {
    const resp = await fetch('https://api.mch.weixin.qq.com' + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'YooClaw/1.0',
        'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${ENV.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${ENV.certSerial}"`,
      },
      body: bodyStr || undefined,
    });
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      return { ok: resp.ok, status: resp.status, data };
    } catch {
      return { ok: false, status: resp.status, data: { message: text.substring(0, 500) } };
    }
  } catch (err: any) {
    return { ok: false, status: 0, data: { message: err.message } };
  }
}

// --- Public Types ---

export interface FapiaoIssueParams {
  fapiaoApplyId: string;   // 发票申请单号（可用订单ID）
  buyerTitle: string;      // 购买方名称
  buyerTaxId?: string;     // 企业税号
  buyerEmail?: string;     // 购买方邮箱（存储用，不传微信API）
  totalAmountFen: number;  // 价税合计（分）
  items: {                 // 商品行
    taxCode: string;       // 税收分类编码
    goodsName: string;     // 货物/服务名称
    quantity: number;      // 数量（普通整数，内部自动转 10^-8 单位）
    totalAmountFen: number;// 行金额（分）
  }[];
  remark?: string;
}

// --- API Functions ---

/** Issue electronic invoice */
export async function issueInvoice(params: FapiaoIssueParams): Promise<{ ok: boolean; fapiaoApplyId?: string; error?: string }> {
  const isEnterprise = !!(params.buyerTaxId && params.buyerTaxId.trim().length > 0);

  const fapiaoId = params.fapiaoApplyId;

  const body = {
    scene: 'WITH_WECHATPAY',
    fapiao_apply_id: params.fapiaoApplyId,
    buyer_information: {
      type: isEnterprise ? 'ORGANIZATION' : 'INDIVIDUAL',
      name: params.buyerTitle,
      taxpayer_id: isEnterprise ? params.buyerTaxId : undefined,
    },
    fapiao_information: [{
      fapiao_id: fapiaoId,
      total_amount: params.totalAmountFen,
      remark: params.remark || '',
      items: params.items.map(item => ({
        tax_code: item.taxCode,
        goods_name: item.goodsName,
        quantity: item.quantity * 100000000, // convert to 10^-8 unit
        total_amount: item.totalAmountFen,
        discount: false,
      })),
    }],
  };

  const r = await fapiaoRequest('POST', BASE, body);

  if (!r.ok) {
    return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  }
  // API returns 202 Accepted with no body
  return { ok: true, fapiaoApplyId: params.fapiaoApplyId };
}

/** Query invoice status */
export async function queryInvoice(fapiaoApplyId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const r = await fapiaoRequest('GET', `${BASE}/${fapiaoApplyId}`);
  if (!r.ok) {
    if (r.status === 404) return { ok: true, status: 'NOT_FOUND' };
    return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  }
  // Response: { fapiao_apply_id, fapiao_state, fapiao_information: [{ fapiao_state, ... }] }
  const state = r.data?.fapiao_information?.[0]?.fapiao_state || r.data?.fapiao_state;
  return { ok: true, status: state };
}

/** Get invoice download URL */
export async function getInvoiceDownloadInfo(fapiaoApplyId: string, fapiaoId?: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  let url = `${BASE}/${fapiaoApplyId}/fapiao-files`;
  if (fapiaoId) url += `?fapiao_id=${fapiaoId}`;
  const r = await fapiaoRequest('GET', url);
  if (!r.ok) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  const file = r.data?.fapiao_files?.[0];
  return { ok: true, url: file?.download_url };
}

/** Download invoice PDF file as Buffer */
export async function downloadInvoicePdf(invoiceUrl: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(invoiceUrl);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}
