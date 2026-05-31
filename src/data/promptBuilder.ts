// ============================================================
// 提示词合成引擎 — 组合场景 + 风格 + 用户输入
//
// 权重优先级（从高到低）：
//   subject > action > motion > userInput > style(lighting+atmosphere+render+colorGrade)
//
// 冲突处理：
//   场景的主体词保留不变，用户输入中与场景重叠的词自动去重
// ============================================================

import { getScene, type SceneTemplate } from './videoScenes'
import { getStyle } from './videoStyles'

/** 统一的高画质负面提示词 */
export const HIGH_QUALITY_NEGATIVE = [
  '低画质', '模糊', '失真', '变形', '畸形手指', '多余肢体', '坏手',
  '文字水印', 'logo', '字幕', '黑边', '抖动', '跳帧',
  '低多边形', '卡通渲染', '素描', '油画风格', '像素化',
  '曝光过度', '噪点', '压缩伪影', '花屏',
].join(', ')

/** 场景关键词提取（用于与用户输入做冲突检测） */
function extractKeywords(text: string): string[] {
  // 中文分词的轻量实现：按标点和空格切分，取长度≥2的片段
  return text
    .replace(/[，。，、；：！？\s]+/g, '|')
    .split('|')
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !['的', '了', '着', '在', '和', '与', '对'].includes(w))
}

/** 计算两个词的重叠度（简化 Jaccard，字符级） */
function wordOverlap(a: string, b: string): number {
  const setA = new Set([...a])
  const setB = new Set([...b])
  let intersect = 0
  setA.forEach(ch => { if (setB.has(ch)) intersect++ })
  return intersect / Math.max(setA.size, setB.size)
}

/**
 * 冲突解决：用户输入中与场景主体/动作重叠超过 60% 的词会被去除
 * 保证场景的语义不被用户稀释，同时保留用户独有的信息
 */
function resolveConflict(scene: SceneTemplate, userInput: string): string {
  const sceneKeyWords = extractKeywords(scene.subject + ' ' + scene.action)
  const userWords = userInput.split(/[,，、]/).map(w => w.trim()).filter(Boolean)

  const filtered = userWords.filter(userWord => {
    const keep = !sceneKeyWords.some(sceneWord => wordOverlap(userWord, sceneWord) > 0.6)
    return keep
  })

  return filtered.join('，')
}

/** 生成最终提示词的输出结构 */
export interface VideoPayload {
  prompt: string
  negativePrompt: string
  duration: number
  guidanceScale: number
  sceneLabel: string
  styleLabel: string
}

/**
 * 核心合成函数
 *
 * @param sceneId  场景模板 ID
 * @param styleId  视频风格 ID
 * @param userInput 用户补充描述（可选，空字符串表示用默认兜底）
 * @returns VideoPayload 包含完整的 prompt 和元数据
 */
export function generateVideoPayload(
  sceneId: string,
  styleId: string,
  userInput: string = ''
): VideoPayload {
  // 获取模板，带兜底
  const scene = getScene(sceneId)
  const style = getStyle(styleId)

  // 1. 处理用户输入
  const dedupedInput = userInput.trim()
    ? resolveConflict(scene, userInput.trim())
    : scene.defaultUserPlaceholder

  // 2. 按权重组合提示词
  //   结构：[主体 + 动作] → [镜头运动] → [用户描述] → [风格渲染]
  const prompt = [
    `${scene.subject}，${scene.action}`,        // 权重最高：主体+动作
    scene.motion,                                // 镜头运动
    dedupedInput,                                // 用户场景描述（去重后）
    `${style.lighting}，${style.atmosphere}`,    // 光影+氛围
    style.render,                                // 渲染引擎
    `${style.colorGrade}调色`,                   // 色彩调性
  ].join('，')

  return {
    prompt,
    negativePrompt: HIGH_QUALITY_NEGATIVE,
    duration: scene.duration,
    guidanceScale: 7.5,
    sceneLabel: scene.label,
    styleLabel: style.label,
  }
}
