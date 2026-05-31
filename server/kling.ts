import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

// ===== JWT Auth =====
const KLING_AK = process.env.KLING_AK || '';
const KLING_SK = process.env.KLING_SK || '';
const KLING_BASE = 'https://api-beijing.klingai.com';

let cachedToken = '';
let tokenExpiry = 0;

function generateToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: KLING_AK, exp: now + 1800, nbf: now - 5 },
    KLING_SK,
    { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
  );
}

function getToken(): string {
  if (Date.now() < tokenExpiry) return cachedToken;
  cachedToken = generateToken();
  tokenExpiry = Date.now() + 25 * 60 * 1000; // 25 min refresh (token valid 30 min)
  console.log('[Kling] Token refreshed');
  return cachedToken;
}

// ===== Kling API Client =====

export interface KlingVideoParams {
  model_name?: string;
  prompt?: string;
  negative_prompt?: string;
  duration?: string;
  mode?: 'std' | 'pro';
  aspect_ratio?: string;
  sound?: 'on' | 'off';
  camera_control?: { type: string; config?: { strength: number } };
  image?: string;        // URL for image2video
  image_tail?: string;   // URL for last-frame in image2video
  image_list?: { image: string }[];  // for multi-image2video
  callback_url?: string;
  external_task_id?: string;
}

export interface KlingCreateResult {
  task_id: string;
}

export interface KlingQueryResult {
  code: number;
  message?: string;
  data?: {
    task_id: string;
    task_status: string;       // "submitted" | "processing" | "succeed" | "failed"
    task_result?: {
      videos?: { url: string; duration?: string }[];
      images?: { url: string }[];
    };
    task_status_msg?: string;
  };
}

export async function klingCreate(
  endpoint: string,
  params: KlingVideoParams
): Promise<KlingCreateResult> {
  const token = getToken();
  const url = endpoint
    ? `${KLING_BASE}/v1/videos/${endpoint}`
    : `${KLING_BASE}/v1/videos`;

  console.log(`[Kling] POST ${endpoint}`, JSON.stringify(params).slice(0, 200));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const j = await res.json() as KlingQueryResult;

  if (j.code !== 0) {
    const msg = j.message || j.data?.task_status_msg || 'Unknown error';
    console.error(`[Kling] Create failed (${j.code}): ${msg}`);
    throw new Error(`Kling API error: ${msg}`);
  }

  if (!j.data?.task_id) {
    throw new Error('Kling API: no task_id in response');
  }

  console.log(`[Kling] Task created: ${j.data.task_id.slice(0, 16)}...`);
  return { task_id: j.data.task_id };
}

export async function klingQuery(
  endpoint: string,
  taskId: string
): Promise<KlingQueryResult> {
  const token = getToken();
  const url = endpoint
    ? `${KLING_BASE}/v1/videos/${endpoint}/${taskId}`
    : `${KLING_BASE}/v1/videos/${taskId}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  return res.json() as Promise<KlingQueryResult>;
}

/**
 * Wait for a Kling task to complete, then return the video URL.
 * Polls every `interval` ms, up to `maxPolls` times.
 */
export async function klingWaitForVideo(
  endpoint: string,
  taskId: string,
  interval: number = 10000,
  maxPolls: number = 60
): Promise<string | null> {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, interval));
    const result = await klingQuery(endpoint, taskId);

    const status = result.data?.task_status;
    if (status === 'succeed') {
      const videos = result.data?.task_result?.videos || [];
      if (videos.length > 0 && videos[0].url) {
        console.log(`[Kling] Task ${taskId.slice(0, 12)}... done (poll ${i + 1}/${maxPolls})`);
        return videos[0].url;
      }
      console.warn(`[Kling] Task succeeded but no video URL`);
      return null;
    }
    if (status === 'failed') {
      console.error(`[Kling] Task ${taskId.slice(0, 12)}... failed: ${result.data?.task_status_msg}`);
      return null;
    }
    // "submitted" | "processing" → keep polling
  }
  console.warn(`[Kling] Task ${taskId.slice(0, 12)}... timed out after ${maxPolls} polls`);
  return null;
}

/**
 * Download a video from URL to a local file path.
 */
export async function klingDownloadVideo(url: string, localPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    console.log(`[Kling] Downloaded: ${path.basename(localPath)} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err: any) {
    console.warn(`[Kling] Download failed: ${err.message}`);
    return false;
  }
}

// ===== Image upload helper =====

const KLING_IMG_DIR = process.env.KLING_IMG_DIR || path.join(
  (process.env.VIDEO_DIR && path.dirname(process.env.VIDEO_DIR)) || '/opt/YooClaw/public',
  'kling-imgs'
);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yooclaw.yookeer.com';

/**
 * Save a base64 image to kling-imgs directory and return its public URL.
 * @returns { url, localPath } or null on failure
 */
export function saveKlingImage(base64Str: string, prefix: string = 'kling'): { url: string; localPath: string } | null {
  try {
    const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '');
    const ext = (base64Str.match(/^data:image\/(\w+);base64,/) || [])[1] || 'png';
    const fn = `${prefix}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    if (!fs.existsSync(KLING_IMG_DIR)) fs.mkdirSync(KLING_IMG_DIR, { recursive: true });
    const localPath = path.join(KLING_IMG_DIR, fn);
    fs.writeFileSync(localPath, Buffer.from(base64Data, 'base64'));
    console.log(`[Kling] Saved image: ${fn}`);
    return { url: `${FRONTEND_URL}/kling-imgs/${fn}`, localPath };
  } catch (err: any) {
    console.error('[Kling] Save image failed:', err.message);
    return null;
  }
}

// ===== Model-duration mapping =====

export const KLING_MODEL_DURATIONS: Record<string, string[]> = {
  'kling-v1': ['5', '10'],
  'kling-v1-5': ['5', '10'],
  'kling-v1-6': ['5', '10', '20'],
  'kling-v2-5-turbo': ['5', '10'],
  'kling-v3': ['5', '10', '15'],
  'kling-v3-omni': ['5', '10', '15'],
};

export const KLING_ENDPOINT_MAP: Record<string, string> = {
  text: 'text2video',
  image: 'image2video',
  multi_image: 'multi-image2video',
};

// Models that support multi-image2video endpoint
export const KLING_MULTI_IMAGE_MODELS = ['kling-v1', 'kling-v1-5', 'kling-v1-6'];
// Models that support sound
export const KLING_SOUND_MODELS = ['kling-v2-5-turbo', 'kling-v3', 'kling-v3-omni'];
