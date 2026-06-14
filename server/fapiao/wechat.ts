/**
 * WeChat Pay v3 Electronic Invoice API (Blockchain Mode)
 *
 * Env vars required (same as WeChat Pay):
 *   WECHAT_PAY_APP_ID, WECHAT_PAY_MCH_ID, WECHAT_PAY_API_V3_KEY,
 *   WECHAT_PAY_PRIVATE_KEY_PATH, WECHAT_PAY_CERT_SERIAL
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
  callbackUrl: process.env.FAPIAO_CALLBACK_URL || (process.env.WECHAT_PAY_NOTIFY_URL || '').replace(/\/pay\/notify\/wechat$/, '/fapiao/callback'),
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

async function fapiaoRequest(method: string, url: string, body?: object): Promise<{ ok: boolean; status: number; data: any }> {
  if (!isFapiaoConfigured()) return { ok: false, status: 0, data: { message: 'WECHAT_PAY_* not configured' } };

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
      return { ok: false, status: resp.status, data: { message: `WeChat returned non-JSON: ${text.substring(0, 200)}` } };
    }
  } catch (err: any) {
    return { ok: false, status: 0, data: { message: err.message } };
  }
}

// --- Invoice Types ---

export interface FapiaoItem {
  tax_code: string;       // 税收分类编码
  goods_name: string;     // 货物/服务名称
  specification?: string; // 规格型号
  unit?: string;          // 计量单位
  quantity: number;       // 数量
  total_amount: number;   // 金额（元，精确到分）
}

export interface FapiaoIssueParams {
  fpqqlsh: string;        // 发票请求流水号（商户侧唯一，建议用订单ID）
  buyer_title: string;    // 购买方抬头（个人姓名或企业名称）
  buyer_tax_id?: string;  // 购买方税号（企业必填）
  buyer_email?: string;   // 购买方邮箱
  total_amount: number;   // 价税合计（元，精确到分）
  tax_amount?: number;    // 税额
  items: FapiaoItem[];    // 商品行项目（至少1条）
  remark?: string;        // 备注
}

// --- API Functions ---

/** Create electronic invoice card template (call once during setup) */
export async function createCardTemplate(templateName: string): Promise<{ ok: boolean; templateId?: string; error?: string }> {
  const r = await fapiaoRequest('POST', '/v3/fapiao/card-template', {
    card_template_information: {
      payee: 'YooClaw',
      type: 'NORMAL',
      custom_cell: {
        words: '感谢使用 YooClaw',
        description: '如有疑问请联系客服',
      },
    },
    appid: ENV.appId,
  });
  if (!r.ok) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  return { ok: true, templateId: r.data?.card_template_appid };
}

/** Issue a blockchain electronic invoice */
export async function issueInvoice(params: FapiaoIssueParams): Promise<{ ok: boolean; fpqqlsh?: string; error?: string }> {
  const r = await fapiaoRequest('POST', '/v3/fapiao', {
    sub_mchid: ENV.mchId,
    fpqqlsh: params.fpqqlsh,
    buyer_information: {
      type: params.buyer_tax_id ? 'ENTERPRISE' : 'PERSON',
      name: params.buyer_title,
      taxpayer_id: params.buyer_tax_id || '',
    },
    invoice_items: params.items.map(item => ({
      tax_code: item.tax_code,
      goods_name: item.goods_name,
      specification: item.specification || '',
      unit: item.unit || '份',
      quantity: item.quantity,
      total_amount: Math.round(item.total_amount * 100), // yuan → fen
    })),
    total_amount: Math.round(params.total_amount * 100),
    tax_amount: Math.round((params.tax_amount || 0) * 100),
    remark: params.remark || '',
    scene: 'BLOCKCHAIN',
  });

  if (!r.ok) {
    const errMsg = r.data?.message || `HTTP ${r.status}`;
    return { ok: false, error: errMsg };
  }
  return { ok: true, fpqqlsh: params.fpqqlsh };
}

/** Query invoice status by fpqqlsh */
export async function queryInvoice(fpqqlsh: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const r = await fapiaoRequest('GET', `/v3/fapiao/${fpqqlsh}`);
  if (!r.ok) {
    if (r.status === 404) return { ok: true, status: 'NOT_FOUND' };
    return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  }
  return { ok: true, status: r.data?.fapiao_state };
}

/** Get invoice download parameters (returns file info for downloading) */
export async function getInvoiceDownloadInfo(fpqqlsh: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await fapiaoRequest('GET', `/v3/fapiao/files/${fpqqlsh}`);
  if (!r.ok) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  return { ok: true, url: r.data?.invoice_url };
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

/** Revoke (red) an invoice */
export async function revokeInvoice(fpqqlsh: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fapiaoRequest('POST', '/v3/fapiao/reverse', {
    fpqqlsh,
    reverse_reason: reason,
  });
  if (!r.ok) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  return { ok: true };
}

/** Get tax category list (for autocomplete in UI) */
export async function getTaxCategoryList(): Promise<{ ok: boolean; categories?: { tax_code: string; goods_name: string }[]; error?: string }> {
  const r = await fapiaoRequest('GET', '/v3/fapiao/tax-category');
  if (!r.ok) return { ok: false, error: r.data?.message || `HTTP ${r.status}` };
  const items = r.data?.tax_category_list || [];
  return { ok: true, categories: items.map((i: any) => ({ tax_code: i.tax_code, goods_name: i.goods_name })) };
}
