// ============================================================
// 视频风格定义 — 控制光影、渲染、氛围、色调
// ============================================================

export interface VideoStyle {
  id: string
  label: string
  /** 光影描述 */
  lighting: string
  /** 渲染引擎/画质 */
  render: string
  /** 环境氛围 */
  atmosphere: string
  /** 色彩调色 */
  colorGrade: string
}

export const STYLES: Record<string, VideoStyle> = {
  cinematic: {
    id: 'cinematic',
    label: '🎬 电影感',
    lighting: '柔光加逆光，浅景深，体积光效',
    render: '虚幻引擎5渲染，超写实画质',
    atmosphere: '史诗感氛围，空气中漂浮微尘粒子',
    colorGrade: '暖金加暗蓝色调，电影级调色',
  },
  cyberpunk: {
    id: 'cyberpunk',
    label: '🌃 赛博朋克',
    lighting: '霓虹灯多彩灯光，高对比度暗部',
    render: '光线追踪全局光照，UE5夜间模式',
    atmosphere: '潮湿街道，全息投影，雨雾弥漫',
    colorGrade: '青橙色调，蓝紫霓虹，暗部偏青',
  },
  warm_daily: {
    id: 'warm_daily',
    label: '🏠 温暖日常',
    lighting: '自然窗光加柔光箱，低反差柔光',
    render: '相机直出质感，轻度后期',
    atmosphere: '温馨舒适，生活气息，家的感觉',
    colorGrade: '暖黄加奶白色调，轻微胶片感',
  },
  studio_premium: {
    id: 'studio_premium',
    label: '💎 高级影棚',
    lighting: '三点布光，顶光加强侧逆光，边缘光',
    render: 'Octane Render光追材质渲染',
    atmosphere: '极简纯色背景，超干净无干扰',
    colorGrade: '高饱和度中性色调，色彩精准还原',
  },
  golden_hour: {
    id: 'golden_hour',
    label: '🌅 金色时刻',
    lighting: '黄昏暖阳强烈逆光，发丝光/边缘光',
    render: '电影级浅景深，大面积焦外光斑',
    atmosphere: '温暖柔软，梦幻光粒子，金色尘雾',
    colorGrade: '金黄加暖橙色，暗部提亮偏暖',
  },
  japanese_fresh: {
    id: 'japanese_fresh',
    label: '🍃 日系清新',
    lighting: '柔和漫射光，极低反差，阴影提亮',
    render: '日系胶片模拟，轻度颗粒感',
    atmosphere: '干净透明，空气感，留白美学',
    colorGrade: '淡蓝加粉白色调，低饱和高明度',
  },
  tech_blue: {
    id: 'tech_blue',
    label: '🔷 科技蓝',
    lighting: '冷蓝色背光加发光线条，暗部深邃',
    render: '3D渲染加HDR广色域',
    atmosphere: '未来科技感，数字界面叠加，数据流',
    colorGrade: '深蓝加霓虹白，冷色调高对比',
  },
  vintage_film: {
    id: 'vintage_film',
    label: '📷 复古胶片',
    lighting: '自然光加轻微过曝，眩光保留',
    render: 'Kodak Portra 400胶片模拟',
    atmosphere: '怀旧感，80年代气息，阳光记忆',
    colorGrade: '暖黄加褪色绿，高光偏暖阴影偏青',
  },
  bw_art: {
    id: 'bw_art',
    label: '🖤 黑白质感',
    lighting: '戏剧性强侧光，极深阴影，高光炸亮',
    render: 'Leica Monochrom黑白专业',
    atmosphere: '极简高级，永恒感，无色彩干扰',
    colorGrade: '纯黑白高反差，安塞尔亚当斯风格',
  },
  minimal: {
    id: 'minimal',
    label: '⬜ 极简纯色',
    lighting: '极度均匀柔光，几乎无阴影',
    render: '产品级渲染，完美无瑕疵',
    atmosphere: '纯净无干扰，日系侘寂美学',
    colorGrade: '莫兰迪低饱和色系，柔和高级灰',
  },
  neon_city: {
    id: 'neon_city',
    label: '🌆 霓虹都市',
    lighting: '霓虹招牌加车灯拖影，七彩点光源',
    render: 'UE5夜间城市，实时光追',
    atmosphere: '繁华不夜城，雨后地面倒映霓虹',
    colorGrade: '粉紫加青蓝，多色温混合照明',
  },
  natural_light: {
    id: 'natural_light',
    label: '☀️ 自然光',
    lighting: '户外自然光直射，无人工补光',
    render: '真实摄影质感，零后期感',
    atmosphere: '真实环境原生态，无修饰',
    colorGrade: '中性自然色调，所见即所得',
  },
}

/** 兜底风格 */
export const FALLBACK_STYLE: VideoStyle = {
  id: 'fallback',
  label: '默认风格',
  lighting: '自然柔光',
  render: '电影级画质',
  atmosphere: '简洁环境',
  colorGrade: '自然色调',
}

export function getStyle(id: string): VideoStyle {
  return STYLES[id] || FALLBACK_STYLE
}

export const DEFAULT_STYLE_ID = 'cinematic'
export const DEFAULT_STYLE = STYLES[DEFAULT_STYLE_ID]

// ============================================================
// 背景音乐选项
// ============================================================
export interface BgmOption {
  id: string
  label: string
  /** 拼接到提示词中的描述 */
  promptText: string
  /** 可选：试听用的音频文件路径（/audio/xxx.m4a） */
  audioUrl?: string
}

export const BGM_OPTIONS: BgmOption[] = [
  { id: 'interstellar', label: '🌌 星际穿越 · 管风琴', promptText: '背景音乐：电影《星际穿越》主题曲，宏伟的管风琴旋律，震撼心灵', audioUrl: '/audio/interstellar.m4a' },
  { id: 'light_piano', label: '🎹 轻快钢琴', promptText: '背景音乐：轻快流动的钢琴曲，温暖治愈，节奏明快' },
  { id: 'electronic_beat', label: '🎛️ 电子节拍', promptText: '背景音乐：时尚电子节拍，低音脉动，现代感十足' },
  { id: 'string_quartet', label: '🎻 弦乐四重奏', promptText: '背景音乐：优雅的弦乐四重奏，舒缓悠扬，高级感' },
  { id: 'ambient_pad', label: '🎵 氛围合成器', promptText: '背景音乐：空灵的氛围合成器铺垫，梦幻飘渺，沉浸感' },
  { id: 'custom', label: '🎼 自有选择', promptText: '背景音乐：选择合适的背景音乐' },
  { id: 'none', label: '🔇 无背景音乐', promptText: '' },
]

export const DEFAULT_BGM_ID = 'none'
