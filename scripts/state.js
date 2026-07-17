// 单一状态源（single source of truth）
// v2.5：引入 ReferenceMaterials 真实数据校准选址与规则表

const STORAGE_KEY = 'moonBaseState_v26';
const LEGACY_KEYS = ['moonBaseState_v25', 'moonBaseState_v2', 'moonBaseState_v1'];

// ===== 沙盘扩展参数 =====
export const CREW_OPTIONS = [4, 12, 50, 100]; // 常驻乘员档位
export const LAUNCH_BUDGET_T = 300; // 首年发射质量预算（吨）

// ===== 决策流程 =====
export const steps = [
  { key: 'energy', name: '能源系统', description: '能源选择决定月夜生存、工业产能与载荷质量。不同纬度日照窗口差异巨大。' },
  { key: 'water', name: '水源方案', description: '就地开采水冰可减少地球补给，但储量与开采难度因选址而异。' },
  { key: 'radiation', name: '辐射防护', description: '月壤、熔岩洞与厚舱壁是主要屏蔽手段，需平衡工程量与未知风险。' },
  { key: 'communication', name: '通信网络', description: '高速低延迟链路对远程操控、科学数据传输和乘员心理健康至关重要。' },
  { key: 'habitat', name: '生命维持与食品', description: '闭环生态决定长期自持能力，也直接影响补给成本与生活质量。' },
  { key: 'transport', name: '交通运输', description: '月面运输决定资源流通效率与基地扩张半径。' }
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

// ===== 状态 =====
const defaultState = {
  site: null,
  energy: null,
  water: null,
  radiation: null,
  communication: null,
  habitat: null,
  transport: null,
  crew: 12,
  history: []
};

function normalizeState(parsed) {
  if (!parsed) return null;
  return {
    ...defaultState,
    ...parsed,
    crew: CREW_OPTIONS.includes(parsed.crew) ? parsed.crew : defaultState.crew,
    history: parsed.history || []
  };
}

function migrateLegacy(raw) {
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeState(JSON.parse(raw));
    }
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return migrateLegacy(legacy);
    }
  } catch (e) {
    // 隐私模式可能无法读取
  }
  return null;
}

export const baseState = loadFromStorage() || { ...defaultState };

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(baseState));
  } catch (e) {
    // 隐私模式可能无法写入
  }
}

export function setSite(siteId) {
  if (baseState.site === siteId) return;
  baseState.site = siteId;
  steps.forEach(s => { baseState[s.key] = null; });
  baseState.history = [{ step: 'site', choice: siteId, label: siteMeta[siteId]?.name || siteId, time: Date.now() }];
  notify();
}

export function setDecision(stepKey, optionId) {
  if (baseState[stepKey] === optionId) return;
  baseState[stepKey] = optionId;
  const opt = options[stepKey].find(o => o.id === optionId);
  baseState.history = baseState.history.filter(h => h.step !== stepKey);
  baseState.history.push({ step: stepKey, choice: optionId, label: opt?.label || optionId, time: Date.now() });
  notify();
}

export function setCrew(n) {
  if (!CREW_OPTIONS.includes(n) || baseState.crew === n) return;
  baseState.crew = n;
  notify();
}

export function resetGame() {
  baseState.site = null;
  steps.forEach(s => { baseState[s.key] = null; });
  baseState.history = [];
  notify();
}

function notify() {
  persist();
  const snapshot = getState();
  listeners.forEach(fn => fn(snapshot));
}

export function getState() {
  return {
    site: baseState.site,
    energy: baseState.energy,
    water: baseState.water,
    radiation: baseState.radiation,
    communication: baseState.communication,
    habitat: baseState.habitat,
    transport: baseState.transport,
    crew: baseState.crew,
    history: [...baseState.history]
  };
}

// ===== 指标计算 =====
function getRule(step, choice, siteId) {
  const baseRule = ruleTable[step]?.[choice];
  if (!baseRule) return null;
  const modifier = baseRule.siteModifier?.[siteId] || {};
  return { ...baseRule, ...modifier };
}

export function computeMetrics(state) {
  const site = state.site ? siteMeta[state.site] : null;
  if (!site) return null;

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
    const choice = state[step.key];
    if (!choice) return;
    const rule = getRule(step.key, choice, state.site);
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
  const crew = CREW_OPTIONS.includes(state.crew) ? state.crew : 12;
  const waterDemand_t_y = crew * 1.2;
  const powerDemand_kW = crew * 0.8;
  const waterBalance_t_y = deltas.waterSupply_t_y - waterDemand_t_y;
  const foodSupportRatio = Math.min(1, deltas.foodSelfSufficiency / (crew * 0.9));

  // 乘员生活用电计入总耗电
  const powerSurplus_kW = site.basePower_kW + deltas.powerBalance_kW - deltas.powerConsumption_kW - powerDemand_kW;
  const radiation_mSv_y = Math.max(5, site.baseRadiation_mSv_y + (ruleTable.radiation[state.radiation]?.radiationDelta_mSv_y || 0));

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
    crewCount: crew,
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

// ===== 辅助函数 =====
export function getSiteDifficulty(siteId) {
  const d = siteMeta[siteId]?.difficulty || 2;
  return ['简单', '中等', '困难'][d - 1] || '中等';
}

export function isDecisionComplete(state) {
  return steps.every(s => !!state[s.key]);
}

export function getCompletedSteps(state) {
  return steps.filter(s => !!state[s.key]).length;
}
