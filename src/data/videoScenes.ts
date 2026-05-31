// ============================================================
// 场景模板定义 — 控制主体、动作、镜头运动
// ============================================================

export interface SceneTemplate {
  id: string
  label: string
  category: string
  /** 画面主体 — 权重最高，放在提示词最前端 */
  subject: string
  /** 动作/情节描述 */
  action: string
  /** 镜头运动描述 */
  motion: string
  /** 默认时长（秒） */
  duration: number
  /** 用户无输入时的兜底场景描述 */
  defaultUserPlaceholder: string
}

export const SCENES: Record<string, SceneTemplate> = {
  // === 网红探店 ===
  foodie_restaurant: {
    id: 'foodie_restaurant',
    label: '🍽️ 网红探店·餐厅',
    category: '网红探店',
    subject: '一位时尚的美食博主',
    action: '坐在精致的餐桌前，用筷子夹起菜品，对镜头露出满足的表情',
    motion: '中景过肩镜头，缓慢推近到菜品特写再拉回人物表情',
    duration: 15,
    defaultUserPlaceholder: '高档餐厅包间，暖色灯光，桌上摆满精致菜肴',
  },
  foodie_cafe: {
    id: 'foodie_cafe',
    label: '☕ 网红探店·咖啡厅',
    category: '网红探店',
    subject: '一位文艺范的生活博主',
    action: '坐在咖啡厅窗边，端起拿铁轻轻啜饮，翻阅杂志',
    motion: '侧45度中景，自然窗光，轻微手持呼吸感',
    duration: 10,
    defaultUserPlaceholder: 'ins风咖啡厅，窗边位置，绿色植物点缀',
  },
  foodie_street: {
    id: 'foodie_street',
    label: '🍢 网红探店·街头小吃',
    category: '网红探店',
    subject: '一位活泼的街头美食博主',
    action: '站在夜市摊位前，接过刚出炉的小吃，对着镜头兴奋展示',
    motion: '手持跟拍，轻微晃动，推近食物特写后拉回全景',
    duration: 12,
    defaultUserPlaceholder: '热闹的夜市，霓虹招牌，蒸汽升腾的摊位',
  },

  // === 电商卖货 ===
  ecom_digital: {
    id: 'ecom_digital',
    label: '📱 电商·数码产品',
    category: '电商卖货',
    subject: '一款科技感数码产品',
    action: '在纯色背景下缓缓旋转展示，光带从机身滑过',
    motion: '360°慢速环绕轨道镜头，焦点锁定产品中心',
    duration: 8,
    defaultUserPlaceholder: '极简白色背景，产品悬浮于空中，光影流动',
  },
  ecom_beauty: {
    id: 'ecom_beauty',
    label: '💄 电商·美妆护肤',
    category: '电商卖货',
    subject: '一瓶高端护肤品',
    action: '置于大理石台面上，镜头从远推近到瓶身质感特写',
    motion: '线性推轨镜头，从环境全景推进到微距特写',
    duration: 8,
    defaultUserPlaceholder: '白色大理石台面，几朵鲜花点缀，柔和光线',
  },
  ecom_fashion: {
    id: 'ecom_fashion',
    label: '👗 电商·服饰穿搭',
    category: '电商卖货',
    subject: '一位高挑模特',
    action: '穿着当季服装自信走秀，自然转身展示全身穿搭',
    motion: '正面跟拍推轨，半身→全身→半身切换，流畅跟焦',
    duration: 10,
    defaultUserPlaceholder: '极简时尚秀场背景，聚光灯追随',
  },

  // === 通用展示 ===
  product_spin: {
    id: 'product_spin',
    label: '🔄 产品3D旋转',
    category: '产品展示',
    subject: '一件精致设计的商品',
    action: '360°均匀旋转，全方位展示产品形态和细节',
    motion: '恒速环绕轨道镜头，微距切换展示logo和纹理',
    duration: 8,
    defaultUserPlaceholder: '深色背景，产品悬浮旋转，金属质感',
  },
  unboxing: {
    id: 'unboxing',
    label: '📦 开箱体验',
    category: '产品展示',
    subject: '一双干净的手',
    action: '缓缓拆开精美包装盒，取出产品，惊喜展示',
    motion: '俯拍+正面双机位切换，特写包装质感',
    duration: 12,
    defaultUserPlaceholder: '精美礼盒包装，丝带和品牌logo，白色桌面',
  },
  tech_showcase: {
    id: 'tech_showcase',
    label: '⚡ 科技感展示',
    category: '产品展示',
    subject: '一款未来科技设备',
    action: '通电激活，灯光亮起，粒子流过机身表面',
    motion: '环绕运动+镜头微距切换，光影流动跟随',
    duration: 10,
    defaultUserPlaceholder: '暗色背景，蓝色光粒子环绕，科技HUD界面',
  },

  // === 人物 ===
  talking_head: {
    id: 'talking_head',
    label: '🎤 人物口播',
    category: '人物',
    subject: '一位自信的主播',
    action: '正对镜头用生动的表情进行讲解',
    motion: '固定机位半身景，微表情捕捉，轻微推近',
    duration: 10,
    defaultUserPlaceholder: '干净的虚拟演播室背景，柔和面光',
  },
  runway: {
    id: 'runway',
    label: '🚶 走秀展示',
    category: '人物',
    subject: '一位冷艳的超模',
    action: '沿T台款款走来，定点转身，展示全身造型',
    motion: '正面跟拍推轨+侧面流轨双机位，纵深构图',
    duration: 10,
    defaultUserPlaceholder: '高级时尚秀场，聚光灯打在身上',
  },
  fitness: {
    id: 'fitness',
    label: '🏋️ 运动健身',
    category: '人物',
    subject: '一位健美的运动员',
    action: '完成一组力量训练动作，肌肉线条清晰可见',
    motion: '低角度动态跟拍，汗水甩动时升格慢动作',
    duration: 10,
    defaultUserPlaceholder: '专业健身房，铁片和哑铃，硬朗灯光',
  },

  // === 空间场景 ===
  real_estate: {
    id: 'real_estate',
    label: '🏠 房产空间',
    category: '空间',
    subject: '一个精致的室内空间',
    action: '从玄关缓慢穿行至客厅、卧室，展现全屋布局',
    motion: '一镜到底滑轨穿行，平滑匀速，广角镜头',
    duration: 15,
    defaultUserPlaceholder: '现代简约装修，大落地窗采光，温馨家居',
  },
  office_tour: {
    id: 'office_tour',
    label: '🏢 办公空间',
    category: '空间',
    subject: '一个未来感办公室',
    action: '从入口推进穿过开放工位、会议室到休息区',
    motion: '斯坦尼康平稳一镜到底，广角+中景切换',
    duration: 15,
    defaultUserPlaceholder: '开放式办公室，落地窗，绿植墙，创意装修',
  },

  // === 自然&户外 ===
  drone_aerial: {
    id: 'drone_aerial',
    label: '🚁 航拍风光',
    category: '自然',
    subject: '一片壮丽的自然风景',
    action: '高空俯瞰全貌，缓缓下降至近景细节',
    motion: '无人机俯瞰→缓慢下降→平行推进，超广角',
    duration: 15,
    defaultUserPlaceholder: '高山湖泊，晨雾飘渺，蓝天白云',
  },
  macro_nature: {
    id: 'macro_nature',
    label: '🔬 微距自然',
    category: '自然',
    subject: '一朵精致的花或昆虫',
    action: '微距捕捉花瓣纹理或昆虫复眼细节',
    motion: '极浅景深微距推轨，焦点缓慢移动展现不同层次',
    duration: 8,
    defaultUserPlaceholder: '清晨露珠挂在花瓣上，阳光穿透水滴',
  },
  city_street: {
    id: 'city_street',
    label: '🏙️ 城市街拍',
    category: '自然',
    subject: '繁华的城市街道',
    action: '在人群中穿梭，捕捉城市生活的精彩瞬间',
    motion: '手持跟拍，浅景深聚焦主体，背景虚化流动',
    duration: 12,
    defaultUserPlaceholder: '霓虹都市，下班人流，傍晚 golden hour',
  },

  // === 特化场景 ===
  cooking: {
    id: 'cooking',
    label: '🍳 美食制作',
    category: '生活',
    subject: '一双灵巧的手',
    action: '在厨房操作台上切菜、翻炒、摆盘，一气呵成',
    motion: '俯拍为主，穿插侧面特写，油花溅起升格慢动作',
    duration: 15,
    defaultUserPlaceholder: '专业厨房操作台，新鲜食材，铸铁锅滋滋作响',
  },
  car_showcase: {
    id: 'car_showcase',
    label: '🚗 汽车展示',
    category: '生活',
    subject: '一辆流线型豪华汽车',
    action: '从车头灯亮起，镜头环绕展示车身线条和内饰',
    motion: '慢速环绕+推门特写，光影在漆面上流动',
    duration: 12,
    defaultUserPlaceholder: '山顶日出公路，晨光照亮车身，背景虚化',
  },
  pet_daily: {
    id: 'pet_daily',
    label: '🐕 宠物日常',
    category: '生活',
    subject: '一只可爱的宠物',
    action: '在草地上奔跑、跳跃、扑向镜头撒娇',
    motion: '低角度跟拍，宠物主观视角切换，升格慢动作',
    duration: 10,
    defaultUserPlaceholder: '阳光草坪，宠物开心玩耍，慢动作特写',
  },
}

/** 兜底模板 — 当 sceneId 不存在时使用 */
const FALLBACK_SCENE: SceneTemplate = {
  id: 'fallback',
  label: '通用展示',
  category: '通用',
  subject: '画面主体',
  action: '自然展示',
  motion: '平滑镜头运动',
  duration: 10,
  defaultUserPlaceholder: '干净简洁的背景',
}

/** 安全获取场景，带兜底 */
export function getScene(id: string): SceneTemplate {
  return SCENES[id] || FALLBACK_SCENE
}

export const DEFAULT_SCENE_ID = 'foodie_restaurant'
export const DEFAULT_SCENE = SCENES[DEFAULT_SCENE_ID]
