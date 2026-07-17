// 单一状态源（single source of truth）
// v3：多基地网络 —— state 重构为 { crew, activeSite, sites, history }，最多 MAX_BASES(3) 个基地，
//     每个基地独立持有六项决策；computeNetworkMetrics 计算基地间水/电/食物补给链路与网络评分；
//     自动迁移 v26 及更早的扁平单基地存档；node 环境（无 localStorage）下可安全 import。
// v2.5：引入 ReferenceMaterials 真实数据校准选址与规则表

export const STORAGE_KEY = 'moonBaseState_v27';
export const LEGACY_KEYS = ['moonBaseState_v26', 'moonBaseState_v25', 'moonBaseState_v2', 'moonBaseState_v1'];

// ===== 沙盘扩展参数 =====
export const CREW_OPTIONS = [4, 12, 50, 100]; // 常驻乘员档位
export const LAUNCH_BUDGET_T = 300; // 首年发射质量预算（吨）

// ===== 决策流程 =====
// 顺序即三阶段建设时间线：无人先遣(energy, communication) → 乘员前哨(water, radiation) → 永久基地(habitat, transport)
export const steps = [
  { key: 'energy', name: '能源系统', description: '能源选择决定月夜生存、工业产能与载荷质量。不同纬度日照窗口差异巨大。' },
  { key: 'communication', name: '通信网络', description: '高速低延迟链路对远程操控、科学数据传输和乘员心理健康至关重要。' },
  { key: 'water', name: '水源方案', description: '就地开采水冰可减少地球补给，但储量与开采难度因选址而异。' },
  { key: 'radiation', name: '辐射防护', description: '月壤、熔岩洞与厚舱壁是主要屏蔽手段，需平衡工程量与未知风险。' },
  { key: 'habitat', name: '生命维持与食品', description: '闭环生态决定长期自持能力，也直接影响补给成本与生活质量。' },
  { key: 'transport', name: '交通运输', description: '月面运输决定资源流通效率与基地扩张半径。' }
];

// ===== 三阶段建设时间线 =====
// 阶段预算是展示性约束（供 UI 警告用），不参与 viabilityScore 计算；
// 全部阶段状态从 decisions 派生，无存储迁移，STORAGE_KEY 不变。
export const PHASES = [
  { id: 1, key: 'precursor', name: '无人先遣', en: 'PHASE 1 · PRECURSOR', icon: '🤖', steps: ['energy', 'communication'], budget_t: 120, brief: '乘员抵达前，先建起能源与通信骨架。' },
  { id: 2, key: 'outpost',   name: '乘员前哨', en: 'PHASE 2 · OUTPOST',   icon: '🧑‍🚀', steps: ['water', 'radiation'], budget_t: 300, brief: '乘员进驻：解决水与辐射，让人先活下来。' },
  { id: 3, key: 'colony',    name: '永久基地', en: 'PHASE 3 · COLONY',    icon: '🏙️', steps: ['habitat', 'transport'], budget_t: 500, brief: '走向自持：闭环生态与月面交通网络。' },
];

// ===== 选项 =====
export const options = {
  energy: [
    { id: 'nuclear', label: '微型核反应堆（FSP 40 kWe）', hint: '稳定覆盖月夜，6 t 级质量，ISRU 与长期驻留的门槛技术', icon: '⚛️' },
    { id: 'storage', label: '太阳能 + 再生燃料电池', hint: '白天电解制氢、月夜燃料电池放电，质量随日照窗口变化大', icon: '🔋' },
    { id: 'solar', label: '薄膜太阳能阵列', hint: '重量轻，但月夜需停工或配合储能，高纬度收益受限', icon: '☀️' }
  ],
  water: [
    { id: 'isru', label: '就地采水冰（ISRU）', hint: '热升华法约 2.4 kWh/kg，高度依赖 PSR 水冰储量', icon: '❄️' },
    { id: 'earth_supply', label: '地球补给', hint: '技术成熟，但每公斤运价极高，长期难以支撑百人基地', icon: '🚀' },
    { id: 'recycling', label: '循环水回收（ECLSS）', hint: 'ISS 级约 93% 回收率，适合低冰区域 but 耗电', icon: '♻️' }
  ],
  radiation: [
    { id: 'regolith', label: '埋入 2–3 m 月壤', hint: '3 m 月壤可将年剂量降至 ~50 mSv，工程量大但材料现成', icon: '🏔️' },
    { id: 'cave', label: '利用熔岩洞/永久阴影坑缘', hint: '水平熔岩管内部可 <1 mSv/年，但选址与结构验证风险未知', icon: '🕳️' },
    { id: 'hull', label: '加厚舱壁 + 风暴掩体', hint: '快速部署，可防 SPE，但 GCR 长期剂量仍偏高', icon: '🛡️' }
  ],
  communication: [
    { id: 'laser', label: '激光通信', hint: '带宽极高、低延迟，但对指向精度要求苛刻', icon: '📡' },
    { id: 'relay', label: '中继卫星', hint: '覆盖盲区、稳定链路，需额外轨道基础设施', icon: '🛰️' },
    { id: 'direct', label: '直联地球', hint: '简单可靠，但受月背遮挡与带宽限制', icon: '📶' }
  ],
  habitat: [
    { id: 'closed_farm', label: '全封闭农场', hint: '最大程度食品自给，系统复杂、启动慢', icon: '🌱' },
    { id: 'earth_food', label: '地球补给食品', hint: '口味丰富、立即可用，但长期依赖补给', icon: '🍱' },
    { id: 'algae', label: '藻类蛋白管', hint: '快速产氧产蛋白，但饮食结构单一', icon: '🧪' }
  ],
  transport: [
    { id: 'hopper', label: '月面跳跃器', hint: '灵活点对点，适合复杂地形与早期探索', icon: '🚀' },
    { id: 'mass_driver', label: '质量投射器', hint: '高效率大宗货运，建设成本极高', icon: '🛤️' },
    { id: 'cable', label: '地表缆车', hint: '固定路线低能耗，受地形限制大', icon: '🚡' }
  ]
};

// ===== 参考阈值（用于 UI 对比） =====
export const benchmarks = {
  earthBackground_mSv_y: 2.4,
  issDose_mSv_y: 210,
  nasaCareerLimit_mSv: 600,
  nasaAnnualLimit_mSv: 500,
  fspPower_kW: 40,
  fspMass_kg: 6000,
  fspLife_y: 10,
  thermalExtraction_kWh_kg: 2.45,
  lunarNight_h: 336, // 赤道约 14 个地球日
  lunarNightSouthPole_h: 112 // Connecting Ridge 最长连续阴影
};

// ===== 基地元数据（引入 ReferenceMaterials 真实数据） =====
export const siteMeta = {
  shackleton: {
    name: '沙克尔顿环形山',
    subtitle: '南极极地科研前哨',
    desc: '位于月球南极（89.67°S, 129.78°E）。坑缘几乎全年有光照，坑底永久阴影区是水冰冷阱。光照与水冰的“黄金组合”，但极端低温与险峻地形代价高昂。',
    lat: -89.67,
    lon: 129.78,
    baseTempC: -220,
    baseRadiation_mSv_y: 355,
    iceAvailable_t: 1784, // LAMP 表面霜总量 kg → t
    iceConcentration: '2.0% 表面霜 / 上部 1-2m 约 5-10 wt%',
    iceConfidence: '中',
    sunHoursRatio: 0.855,
    maxSunHoursRatio: 0.9255,
    longestShadow_h: 65,
    psrTemp_K: 29,
    slope_deg: 14.8,
    baseMass_t: 200,
    basePower_kW: 100,
    difficulty: 3,
    tags: ['永昼坑缘', 'PSR 水冰', '极低温', '光照率 85.5%'],
    reference: 'NASA LOLA / LAMP / Mini-RF'
  },
  connecting_ridge: {
    name: '连接岭 C1-0',
    subtitle: '南极综合最优选址',
    desc: '连接 Shackleton 与 de Gerlache 的山脊。2 m 高度平均光照率 88%，最长连续阴影仅 112 h，且距离最近 PSR 仅 100 m。太阳能阵列与水冰提取区可步行共存。',
    lat: -88.5,
    lon: 0,
    baseTempC: -150,
    baseRadiation_mSv_y: 340,
    iceAvailable_t: 50000, // 邻近 PSR，估算
    iceConcentration: '邻近 PSR，可采',
    iceConfidence: '中',
    sunHoursRatio: 0.88,
    maxSunHoursRatio: 0.921,
    longestShadow_h: 112,
    psrTemp_K: 50,
    slope_deg: 7.5,
    baseMass_t: 190,
    basePower_kW: 95,
    difficulty: 2,
    tags: ['88% 光照', 'PSR 100m', '坡度 <10°', '综合最优'],
    reference: 'Gläser et al. (2020)'
  },
  cabeus: {
    name: '卡比厄斯撞击坑',
    subtitle: '富冰永久阴影区',
    desc: '位于月球南极（85.3°S, 41.8°W）。2009 年 LCROSS 撞击实验直接测得羽流含水量 5.6±2.9 wt%，是月球水冰原位确认的最高置信度地点。',
    lat: -85.3,
    lon: -41.8,
    baseTempC: -250,
    baseRadiation_mSv_y: 360,
    iceAvailable_t: 163000000, // 1.63 亿吨
    iceConcentration: '5.6±2.9 wt%（LCROSS 实测）',
    iceConfidence: '高',
    sunHoursRatio: 0.0,
    maxSunHoursRatio: 0.0,
    longestShadow_h: 9999,
    psrTemp_K: 20,
    slope_deg: 5,
    baseMass_t: 210,
    basePower_kW: 105,
    difficulty: 3,
    tags: ['LCROSS 实测富冰', '永久阴影', '极低温', '无日照'],
    reference: 'Colaprete et al. (2010), Science'
  },
  marius_lava_tube: {
    name: '马里乌斯丘陵熔岩管',
    subtitle: '天然地下庇护所',
    desc: '位于月球正面北部（14.3°N, 303.5°E）。天窗直径约 58 m，GRAIL 估计下方存在长 60 km、宽 9 km 的空腔。天然辐射屏蔽与热稳定性使其成为改变游戏规则的选址。',
    lat: 14.3,
    lon: -56.5,
    baseTempC: -20,
    baseRadiation_mSv_y: 355,
    iceAvailable_t: 200,
    iceConcentration: '非极区，水冰稀缺',
    iceConfidence: '低',
    sunHoursRatio: 0.5,
    maxSunHoursRatio: 0.5,
    longestShadow_h: 336,
    psrTemp_K: null,
    slope_deg: 3,
    baseMass_t: 170,
    basePower_kW: 85,
    difficulty: 3,
    tags: ['天然辐射屏蔽', '温度稳定', '结构待验证', '水冰稀缺'],
    reference: 'Zhu et al. (2024), Icarus / JAXA PHITS'
  },
  tranquility: {
    name: '静海纪念站',
    subtitle: '赤道文化与交通枢纽',
    desc: '坐落在阿波罗 11 号首次登月点（0.7°N, 23.5°E）附近。日照充沛、地形平缓，是旅游与科普教育的理想节点，但水冰资源极度稀缺。',
    lat: 0.7,
    lon: 23.5,
    baseTempC: -50,
    baseRadiation_mSv_y: 280,
    iceAvailable_t: 80,
    iceConcentration: '<0.1 wt% 羟基',
    iceConfidence: '低',
    sunHoursRatio: 0.95,
    maxSunHoursRatio: 0.95,
    longestShadow_h: 336,
    psrTemp_K: null,
    slope_deg: 2,
    baseMass_t: 180,
    basePower_kW: 80,
    difficulty: 1,
    tags: ['日照充沛', '水冰稀缺', '地标意义', '地形平缓'],
    reference: 'Apollo 11 / LRO'
  },
  imbrium: {
    name: '雨海采矿区',
    subtitle: '中纬度工业基地',
    desc: '雨海盆地（32.8°N, -15.6°E）的玄武岩富含钛铁矿与氦-3 资源。这里部署自动化采矿与冶炼设施，是月球工业化的起点。',
    lat: 32.8,
    lon: -15.6,
    baseTempC: -120,
    baseRadiation_mSv_y: 320,
    iceAvailable_t: 400,
    iceConcentration: '痕量羟基',
    iceConfidence: '低',
    sunHoursRatio: 0.70,
    maxSunHoursRatio: 0.70,
    longestShadow_h: 336,
    psrTemp_K: null,
    slope_deg: 4,
    baseMass_t: 220,
    basePower_kW: 90,
    difficulty: 2,
    tags: ['矿产丰富', '工业需求', '月夜较长'],
    reference: 'Lunar Sourcebook / Apollo 15'
  },
  tycho: {
    name: '第谷观测台',
    subtitle: '高地深空观测平台',
    desc: '位于壮观的第谷环形山区域（43.3°S, -11.2°E）。高海拔、地质年轻、地貌崎岖，是天文观测与行星科学研究的理想场所。',
    lat: -43.3,
    lon: -11.2,
    baseTempC: -160,
    baseRadiation_mSv_y: 340,
    iceAvailable_t: 200,
    iceConcentration: '痕量',
    iceConfidence: '低',
    sunHoursRatio: 0.75,
    maxSunHoursRatio: 0.75,
    longestShadow_h: 320,
    psrTemp_K: null,
    slope_deg: 12,
    baseMass_t: 190,
    basePower_kW: 85,
    difficulty: 2,
    tags: ['高海拔', '观测窗口', '地形复杂'],
    reference: 'LROC / Apollo 17 喷射物'
  }
};

// ===== 规则表：每个选项对基地指标的增量影响 =====
export const ruleTable = {
  energy: {
    nuclear: {
      powerBalance_kW: 45, mass_t: 60, riskScore: 2, costLevel: 3, sustainability: 5,
      note: 'NASA FSP 40 kWe / ~6 t / 10 年：核裂变是月夜连续运行与 ISRU 的门槛技术，质量效率约为太阳能+储能的 2 倍以上。'
    },
    storage: {
      powerBalance_kW: -10, mass_t: 55, riskScore: 1, costLevel: 2, sustainability: 3,
      siteModifier: {
        shackleton: { powerBalance_kW: 30, mass_t: 10 }, // 永昼窗口长，储能需求小
        connecting_ridge: { powerBalance_kW: 25, mass_t: 15 },
        cabeus: { powerBalance_kW: -25, mass_t: 30 }, // 永久阴影，几乎无法充电
        marius_lava_tube: { powerBalance_kW: 0, mass_t: 10 },
        tranquility: { powerBalance_kW: 35, mass_t: 5 },
        imbrium: { powerBalance_kW: 10, mass_t: 10 },
        tycho: { powerBalance_kW: 15, mass_t: 10 }
      },
      note: '太阳能+RFC：40 kWe 连续功率约需 14.5 t 储能（按 550 Wh/kg 目标），收益高度依赖日照窗口。'
    },
    solar: {
      powerBalance_kW: 20, mass_t: 25, riskScore: 1, costLevel: 1, sustainability: 2,
      siteModifier: {
        shackleton: { powerBalance_kW: 25 },
        connecting_ridge: { powerBalance_kW: 30 },
        cabeus: { powerBalance_kW: -40 }, // 无日照
        marius_lava_tube: { powerBalance_kW: 5 },
        tranquility: { powerBalance_kW: 40 },
        imbrium: { powerBalance_kW: 10 },
        tycho: { powerBalance_kW: 15 }
      },
      note: '薄膜太阳能轻量，但月夜与阴影区需停工或配合储能；月面年均衰减约 2.5%，单次大 SPE 可永久损失 5–10%。'
    }
  },
  water: {
    isru: {
      waterSupply_t_y: 400, mass_t: 50, powerConsumption_kW: 15, riskScore: 2, costLevel: 2, sustainability: 5,
      siteModifier: {
        shackleton: { waterSupply_t_y: 600 },
        connecting_ridge: { waterSupply_t_y: 550 },
        cabeus: { waterSupply_t_y: 900 }, // 富冰
        marius_lava_tube: { waterSupply_t_y: -200 }, // 非极区
        tranquility: { waterSupply_t_y: -300 }, // 水冰稀缺
        imbrium: { waterSupply_t_y: 50 },
        tycho: { waterSupply_t_y: 50 }
      },
      note: '热升华法约 2.4 kWh/kg 水。Cabeus 与 Shackleton/Connecting Ridge 最具优势；静海/熔岩管几乎不可行。'
    },
    earth_supply: {
      waterSupply_t_y: 120, mass_t: 15, powerConsumption_kW: 2, riskScore: 1, costLevel: 3, sustainability: 1,
      note: '地球运输代价极高（每公斤 $30 万–120 万），长期难以支撑百人级基地。'
    },
    recycling: {
      waterSupply_t_y: 350, mass_t: 30, powerConsumption_kW: 12, riskScore: 1, costLevel: 2, sustainability: 4,
      note: 'ISS 级 ECLSS 水回收率约 93%，中国空间站达 95%；适合冰储量有限但电力充足的基地（如静海）。'
    }
  },
  radiation: {
    regolith: {
      radiationDelta_mSv_y: -250, mass_t: 60, riskScore: 2, costLevel: 2, sustainability: 5,
      note: '2–3 m 月壤可将年剂量降至 ~50 mSv（辐射工作者限值）；7 m 可接近地球背景 5 mSv/年。'
    },
    cave: {
      radiationDelta_mSv_y: -300, mass_t: 10, riskScore: 3, costLevel: 1, sustainability: 5,
      note: '水平熔岩管内部 GCR 年剂量可 <1 mSv，接近地球背景；但结构稳定性与原位验证风险高。'
    },
    hull: {
      radiationDelta_mSv_y: -150, mass_t: 30, riskScore: 1, costLevel: 2, sustainability: 3,
      note: '加厚舱壁 + 风暴掩体可防百年一遇 SPE，但 GCR 年剂量仍高于长期安全阈值。'
    }
  },
  communication: {
    laser: {
      commScore: 95, mass_t: 8, powerConsumption_kW: 5, riskScore: 2, costLevel: 2, sustainability: 4,
      note: '激光通信带宽极高，但需精确跟踪地球，受月尘与振动影响。'
    },
    relay: {
      commScore: 80, mass_t: 15, powerConsumption_kW: 6, riskScore: 1, costLevel: 2, sustainability: 4,
      note: '中继卫星覆盖月背与盲区，是多点联网的最优解。'
    },
    direct: {
      commScore: 55, mass_t: 5, powerConsumption_kW: 3, riskScore: 1, costLevel: 1, sustainability: 2,
      note: '直联地球简单可靠，但月背不可用且带宽受限。'
    }
  },
  habitat: {
    closed_farm: {
      foodSelfSufficiency: 80, mass_t: 45, powerConsumption_kW: 20, riskScore: 2, costLevel: 3, sustainability: 5,
      note: '全封闭农场提供最高食品自给率，但系统复杂、启动周期长（参考 Yuegong-1 370 天闭合实验）。'
    },
    earth_food: {
      foodSelfSufficiency: 10, mass_t: 10, powerConsumption_kW: 2, riskScore: 1, costLevel: 3, sustainability: 1,
      note: '地球食品口味丰富，但长期依赖补给线。'
    },
    algae: {
      foodSelfSufficiency: 55, mass_t: 20, powerConsumption_kW: 8, riskScore: 1, costLevel: 1, sustainability: 4,
      note: '藻类管可快速产氧与蛋白，但饮食结构单一。'
    }
  },
  transport: {
    hopper: {
      transportCapacity: 60, mass_t: 18, powerConsumption_kW: 4, riskScore: 2, costLevel: 2, sustainability: 3,
      note: '跳跃器灵活机动，适合早期探索与复杂地形。'
    },
    mass_driver: {
      transportCapacity: 95, mass_t: 70, powerConsumption_kW: 35, riskScore: 3, costLevel: 3, sustainability: 5,
      note: '质量投射器适合大宗货运，但建设成本与电力需求极高。'
    },
    cable: {
      transportCapacity: 40, mass_t: 25, powerConsumption_kW: 2, riskScore: 1, costLevel: 1, sustainability: 4,
      note: '地表缆车固定路线低能耗，但受崎岖地形限制。'
    }
  }
};

// ===== 状态（v3：多基地网络） =====
export const MAX_BASES = 3; // 最多可同时规划的基地数量

const DECISION_KEYS = steps.map(s => s.key);

function emptyDecisions() {
  return {
    energy: null,
    water: null,
    radiation: null,
    communication: null,
    habitat: null,
    transport: null
  };
}

const defaultState = {
  crew: 12,
  activeSite: null,
  sites: {},
  history: []
};

function normalizeDecisions(raw) {
  const decisions = emptyDecisions();
  if (!raw || typeof raw !== 'object') return decisions;
  DECISION_KEYS.forEach(key => {
    decisions[key] = typeof raw[key] === 'string' ? raw[key] : null;
  });
  return decisions;
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const sites = {};
  if (parsed.sites && typeof parsed.sites === 'object') {
    for (const [siteId, raw] of Object.entries(parsed.sites)) {
      if (!siteMeta[siteId]) continue; // 丢弃未知选址
      sites[siteId] = normalizeDecisions(raw);
    }
  }
  let activeSite = typeof parsed.activeSite === 'string' ? parsed.activeSite : null;
  if (activeSite && !siteMeta[activeSite]) activeSite = null;
  if (activeSite && !sites[activeSite]) sites[activeSite] = emptyDecisions();
  return {
    crew: CREW_OPTIONS.includes(parsed.crew) ? parsed.crew : defaultState.crew,
    activeSite,
    sites,
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

// v26 及更早版本：扁平单基地结构 { site, energy..transport, crew, history }
function migrateFlatState(old) {
  if (!old || typeof old !== 'object') return null;
  const siteId = old.site ?? null;
  return {
    crew: old.crew ?? 12,
    activeSite: siteId,
    sites: siteId ? { [siteId]: normalizeDecisions(old) } : {},
    history: Array.isArray(old.history) ? old.history : []
  };
}

function migrateLegacy(raw) {
  if (!raw) return null;
  try {
    return normalizeState(migrateFlatState(JSON.parse(raw)));
  } catch (e) {
    return null;
  }
}

// localStorage 统一走 try/catch + typeof 守卫，node 环境（无 localStorage）下可安全 import
function storageGet(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null; // 隐私模式可能无法读取
  }
}

function storageSet(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch (e) {
    // 隐私模式可能无法写入
  }
}

function loadFromStorage() {
  const raw = storageGet(STORAGE_KEY);
  if (raw) {
    try {
      const normalized = normalizeState(JSON.parse(raw));
      if (normalized) return normalized;
    } catch (e) {
      // 存档损坏，继续尝试旧版本
    }
  }
  for (const key of LEGACY_KEYS) {
    const legacy = storageGet(key);
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      if (migrated) return migrated;
    }
  }
  return null;
}

export const baseState = loadFromStorage() || {
  crew: defaultState.crew,
  activeSite: null,
  sites: {},
  history: []
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

function persist() {
  storageSet(STORAGE_KEY, JSON.stringify(baseState));
}

function notify() {
  persist();
  const snapshot = getState();
  listeners.forEach(fn => fn(snapshot));
}

export function getState() {
  const sites = {};
  for (const [siteId, decisions] of Object.entries(baseState.sites)) {
    sites[siteId] = { ...decisions };
  }
  return {
    crew: baseState.crew,
    activeSite: baseState.activeSite,
    sites,
    history: [...baseState.history]
  };
}

// 读取某基地的 decisions 对象；无记录时返回六项全 null 的新对象
export function getSiteDecisions(state, siteId) {
  const decisions = state?.sites?.[siteId];
  return decisions ? { ...decisions } : emptyDecisions();
}

// 已规划基地的 siteId 数组（按加入顺序）
export function getPlannedSites(state) {
  return Object.keys(state?.sites || {});
}

export function setActiveSite(siteId) {
  if (!siteMeta[siteId]) return; // siteMeta 中不存在则忽略
  if (baseState.activeSite === siteId) return;
  if (!baseState.sites[siteId]) {
    if (Object.keys(baseState.sites).length >= MAX_BASES) return; // 达到基地数量上限
    baseState.sites[siteId] = emptyDecisions();
  }
  baseState.activeSite = siteId;
  notify();
}

// 向后兼容：setSite 保留为 setActiveSite 的别名
export function setSite(siteId) {
  setActiveSite(siteId);
}

export function removeSite(siteId) {
  if (!baseState.sites[siteId]) return;
  delete baseState.sites[siteId];
  if (baseState.activeSite === siteId) {
    baseState.activeSite = Object.keys(baseState.sites)[0] || null;
  }
  notify();
}

export function setDecision(stepKey, optionId) {
  if (!baseState.activeSite) return; // 无 activeSite 时 no-op
  if (!options[stepKey]) return;
  const decisions = baseState.sites[baseState.activeSite];
  if (!decisions) return;
  if (decisions[stepKey] === optionId) return;
  decisions[stepKey] = optionId;
  const opt = options[stepKey].find(o => o.id === optionId);
  baseState.history = baseState.history.filter(h => !(h.step === stepKey && h.siteId === baseState.activeSite));
  baseState.history.push({
    step: stepKey,
    choice: optionId,
    label: opt?.label || optionId,
    siteId: baseState.activeSite,
    time: Date.now()
  });
  notify();
}

export function setCrew(n) {
  if (!CREW_OPTIONS.includes(n) || baseState.crew === n) return;
  baseState.crew = n;
  notify();
}

export function resetGame() {
  // crew 是全局任务参数，重置时保留
  baseState.activeSite = null;
  baseState.sites = {};
  baseState.history = [];
  notify();
}

// ===== 指标计算 =====
// 返回合并 siteModifier 后的规则对象（原内部函数，现导出）
export function getRule(stepKey, choiceId, siteId) {
  const baseRule = ruleTable[stepKey]?.[choiceId];
  if (!baseRule) return null;
  const modifier = baseRule.siteModifier?.[siteId] || {};
  return { ...baseRule, ...modifier };
}

// 单基地指标：与 v26 computeMetrics 完全相同的计算逻辑，参数来源改为 (siteId, decisions, crew)
export function computeSiteMetrics(siteId, decisions, crew) {
  const site = siteMeta[siteId];
  if (!site) return null;
  const d = decisions || {};

  const deltas = {
    powerBalance_kW: 0,
    mass_t: site.baseMass_t,
    waterSupply_t_y: 0,
    powerConsumption_kW: 0,
    riskScore: 0,
    costLevel: 0,
    sustainability: 0,
    commScore: 0,
    foodSelfSufficiency: 0,
    transportCapacity: 0,
    notes: []
  };

  steps.forEach(step => {
    const choice = d[step.key];
    if (!choice) return;
    const rule = getRule(step.key, choice, siteId);
    if (!rule) return;

    if (typeof rule.powerBalance_kW === 'number') deltas.powerBalance_kW += rule.powerBalance_kW;
    if (typeof rule.mass_t === 'number') deltas.mass_t += rule.mass_t;
    if (typeof rule.waterSupply_t_y === 'number') deltas.waterSupply_t_y += rule.waterSupply_t_y;
    if (typeof rule.powerConsumption_kW === 'number') deltas.powerConsumption_kW += rule.powerConsumption_kW;
    if (typeof rule.riskScore === 'number') deltas.riskScore += rule.riskScore;
    if (typeof rule.costLevel === 'number') deltas.costLevel += rule.costLevel;
    if (typeof rule.sustainability === 'number') deltas.sustainability += rule.sustainability;
    if (typeof rule.commScore === 'number') deltas.commScore += rule.commScore;
    if (typeof rule.foodSelfSufficiency === 'number') deltas.foodSelfSufficiency += rule.foodSelfSufficiency;
    if (typeof rule.transportCapacity === 'number') deltas.transportCapacity += rule.transportCapacity;
    if (rule.note) deltas.notes.push(rule.note);
  });

  // ===== 乘员需求模型 =====
  const crewCount = CREW_OPTIONS.includes(crew) ? crew : 12;
  const waterDemand_t_y = crewCount * 1.2;
  const powerDemand_kW = crewCount * 0.8;
  const waterBalance_t_y = deltas.waterSupply_t_y - waterDemand_t_y;
  const foodSupportRatio = Math.min(1, deltas.foodSelfSufficiency / (crewCount * 0.9));

  // 乘员生活用电计入总耗电
  const powerSurplus_kW = site.basePower_kW + deltas.powerBalance_kW - deltas.powerConsumption_kW - powerDemand_kW;
  const radiation_mSv_y = Math.max(5, site.baseRadiation_mSv_y + (ruleTable.radiation[d.radiation]?.radiationDelta_mSv_y || 0));

  // ===== 发射质量预算 =====
  const totalMass_t = Math.round(deltas.mass_t);
  const launchBudget_t = LAUNCH_BUDGET_T;
  const budgetOver_t = Math.max(0, totalMass_t - launchBudget_t);
  const budgetUsage = totalMass_t / launchBudget_t;
  const budgetPenalty = Math.min(12, Math.floor(budgetOver_t / 10) * 2);

  // 综合可行性评分（0-100）
  const powerScore = Math.min(25, Math.max(0, (powerSurplus_kW + 30) / 100 * 25));
  const radiationScore = Math.min(20, Math.max(0, (400 - radiation_mSv_y) / 395 * 20));
  const waterScore = waterBalance_t_y < 0 ? 0 : Math.min(20, 8 + Math.min(1, waterBalance_t_y / 500) * 12);
  const sustainScore = Math.min(20, Math.max(0, deltas.sustainability / 28 * 20));
  const riskPenalty = Math.min(15, Math.max(0, deltas.riskScore / 18 * 15));
  const viabilityScore = Math.max(0, Math.round(powerScore + radiationScore + waterScore + sustainScore - riskPenalty - budgetPenalty));

  return {
    siteId,
    siteName: site.name,
    siteMeta: site,
    powerSurplus_kW: Math.round(powerSurplus_kW),
    totalMass_t,
    waterSupply_t_y: Math.round(deltas.waterSupply_t_y),
    radiation_mSv_y: Math.round(radiation_mSv_y),
    riskScore: deltas.riskScore,
    costLevel: deltas.costLevel,
    sustainability: deltas.sustainability,
    commScore: deltas.commScore,
    foodSelfSufficiency: deltas.foodSelfSufficiency,
    transportCapacity: deltas.transportCapacity,
    viabilityScore,
    crewCount,
    waterDemand_t_y: Math.round(waterDemand_t_y * 10) / 10,
    powerDemand_kW: Math.round(powerDemand_kW * 10) / 10,
    waterBalance_t_y: Math.round(waterBalance_t_y),
    foodSupportRatio: Math.round(foodSupportRatio * 1000) / 1000,
    launchBudget_t,
    budgetOver_t,
    budgetUsage: Math.round(budgetUsage * 1000) / 1000,
    notes: deltas.notes,
    benchmarks
  };
}

// 当前激活基地的指标；无 activeSite（或选址无效）时返回 null
export function computeMetrics(state) {
  if (!state || !state.activeSite) return null;
  return computeSiteMetrics(state.activeSite, getSiteDecisions(state, state.activeSite), state.crew);
}

// ===== 网络级指标：多基地补给链路 =====
export function computeNetworkMetrics(state) {
  const bases = getPlannedSites(state).map(siteId => {
    const decisions = getSiteDecisions(state, siteId);
    return {
      siteId,
      name: siteMeta[siteId]?.name || siteId,
      completed: getCompletedSteps(decisions),
      metrics: computeSiteMetrics(siteId, decisions, state?.crew)
    };
  });

  const planned = bases.filter(b => b.completed >= 1); // 有 ≥1 项决策的基地
  const operational = planned.filter(b => b.completed >= 4); // 完成 ≥4 项决策的基地

  const avgTransportCapacity = operational.length
    ? operational.reduce((sum, b) => sum + (b.metrics?.transportCapacity ?? 0), 0) / operational.length
    : 0;
  const sharingEnabled = planned.length >= 2 && operational.length >= 2 && avgTransportCapacity >= 40;

  const links = [];
  let waterShared_t = 0;
  let powerShared_kW = 0;
  let foodShared_ratio = 0;

  // 贪心匹配：盈余从大到小 → 赤字从大到小；每对 (from, to, resource) 至多一条 link
  function matchResource({ donors, receivers, lossRate, resource, unit, amountScale = 1, onLink }) {
    donors.sort((a, b) => b.avail - a.avail);
    receivers.sort((a, b) => b.need - a.need);
    for (const donor of donors) {
      for (const receiver of receivers) {
        if (donor.avail <= 0) break;
        if (receiver.need <= 0) continue;
        const shipped = Math.min(donor.avail, receiver.need);
        const arrived = Math.round(shipped * (1 - lossRate) * amountScale);
        if (arrived <= 0) continue;
        links.push({ from: donor.siteId, to: receiver.siteId, resource, amount: arrived, unit });
        donor.avail -= shipped;
        receiver.need -= shipped * (1 - lossRate); // 赤字按实际到账抵扣
        onLink(arrived);
      }
    }
  }

  if (sharingEnabled) {
    // 水：donor waterBalance_t_y > 0 → receiver < 0，传输损耗 20%
    matchResource({
      donors: planned.filter(b => (b.metrics?.waterBalance_t_y ?? 0) > 0)
        .map(b => ({ siteId: b.siteId, avail: b.metrics.waterBalance_t_y })),
      receivers: planned.filter(b => (b.metrics?.waterBalance_t_y ?? 0) < 0)
        .map(b => ({ siteId: b.siteId, need: -b.metrics.waterBalance_t_y })),
      lossRate: 0.2,
      resource: 'water',
      unit: 't/年',
      onLink: arrived => { waterShared_t += arrived; }
    });
    // 电：donor 保留 20 kW 自用（surplus > 20）→ receiver 补到 20 kW（surplus < 20），损耗 15%
    matchResource({
      donors: planned.filter(b => (b.metrics?.powerSurplus_kW ?? 0) > 20)
        .map(b => ({ siteId: b.siteId, avail: b.metrics.powerSurplus_kW - 20 })),
      receivers: planned.filter(b => (b.metrics?.powerSurplus_kW ?? 0) < 20)
        .map(b => ({ siteId: b.siteId, need: 20 - b.metrics.powerSurplus_kW })),
      lossRate: 0.15,
      resource: 'power',
      unit: 'kW',
      onLink: arrived => { powerShared_kW += arrived; }
    });
    // 食物：无损耗；donor foodSupportRatio >= 1（按未封顶自给率计算可输出富余）→ receiver < 1
    const uncappedFoodRatio = b => {
      const m = b.metrics;
      if (!m) return 0;
      const demand = (m.crewCount ?? 12) * 0.9;
      return demand > 0 ? m.foodSelfSufficiency / demand : 0;
    };
    matchResource({
      donors: planned.filter(b => (b.metrics?.foodSupportRatio ?? 0) >= 1)
        .map(b => ({ siteId: b.siteId, avail: Math.max(0, uncappedFoodRatio(b) - 1) })),
      receivers: planned.filter(b => (b.metrics?.foodSupportRatio ?? 0) < 1)
        .map(b => ({ siteId: b.siteId, need: 1 - b.metrics.foodSupportRatio })),
      lossRate: 0,
      resource: 'food',
      unit: '%',
      amountScale: 100, // 比例 → 需求百分比整数
      onLink: arrived => { foodShared_ratio += arrived; }
    });
  }

  let networkScore = null;
  if (planned.length >= 2) {
    const avgViability = planned.reduce((sum, b) => sum + (b.metrics?.viabilityScore ?? 0), 0) / planned.length;
    const allComplete = planned.every(b => isDecisionComplete(getSiteDecisions(state, b.siteId)));
    networkScore = Math.min(100, Math.max(0, Math.round(
      avgViability +
      Math.min(8, waterShared_t / 40) +
      Math.min(6, powerShared_kW / 10) +
      (allComplete ? 4 : 0)
    )));
  }

  return { bases, links, sharingEnabled, waterShared_t, powerShared_kW, foodShared_ratio, networkScore };
}

// ===== 辅助函数 =====
export function getSiteDifficulty(siteId) {
  const d = siteMeta[siteId]?.difficulty || 2;
  return ['简单', '中等', '困难'][d - 1] || '中等';
}

// 参数为单个基地的 decisions 对象（非完整 state）
export function isDecisionComplete(decisions) {
  return steps.every(s => !!decisions?.[s.key]);
}

export function getCompletedSteps(decisions) {
  return steps.filter(s => !!decisions?.[s.key]).length;
}

// ===== 阶段工具函数（全部从 decisions 派生，不落存储） =====
// 返回某决策步骤所属的阶段对象；未知 stepKey 返回 null
export function getPhaseForStep(stepKey) {
  return PHASES.find(p => p.steps.includes(stepKey)) || null;
}

// 该阶段的 steps 是否全部已选
export function isPhaseComplete(decisions, phaseId) {
  const phase = PHASES.find(p => p.id === phaseId);
  if (!phase) return false;
  return phase.steps.every(key => !!decisions?.[key]);
}

// 第一个未完成阶段的 id（1|2|3）；全部完成返回 3
export function getCurrentPhase(decisions) {
  const pending = PHASES.find(p => !isPhaseComplete(decisions, p.id));
  return pending ? pending.id : 3;
}

// 阶段完成进度 { done, total }
export function getPhaseProgress(decisions, phaseId) {
  const phase = PHASES.find(p => p.id === phaseId);
  if (!phase) return { done: 0, total: 0 };
  return {
    done: phase.steps.filter(key => !!decisions?.[key]).length,
    total: phase.steps.length
  };
}

// 该阶段已选决策的发射质量合计（吨，整数；合并 siteModifier 后取 mass_t）
export function computePhaseMass(siteId, decisions, phaseId) {
  const phase = PHASES.find(p => p.id === phaseId);
  if (!phase) return 0;
  let mass = 0;
  phase.steps.forEach(key => {
    const choice = decisions?.[key];
    if (!choice) return;
    const rule = getRule(key, choice, siteId);
    if (rule && typeof rule.mass_t === 'number') mass += rule.mass_t;
  });
  return Math.round(mass);
}

// 阶段预算状态 { used_t, budget_t, over_t, usage }；usage = used/budget，可 >1
export function getPhaseBudgetStatus(siteId, decisions, phaseId) {
  const phase = PHASES.find(p => p.id === phaseId);
  if (!phase) return { used_t: 0, budget_t: 0, over_t: 0, usage: 0 };
  const used_t = computePhaseMass(siteId, decisions, phaseId);
  const budget_t = phase.budget_t;
  return {
    used_t,
    budget_t,
    over_t: Math.max(0, used_t - budget_t),
    usage: budget_t > 0 ? used_t / budget_t : 0
  };
}
