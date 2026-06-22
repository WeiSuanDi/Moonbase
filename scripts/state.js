// 单一状态源（single source of truth）
// v2：四大基地全可交互 + 六大决策维度

const STORAGE_KEY = 'moonBaseState_v2';
const LEGACY_STORAGE_KEY = 'moonBaseState_v1';

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
    { id: 'nuclear', label: '微型核反应堆', hint: '稳定大功率，载荷重，安全冗余高', icon: '⚛️' },
    { id: 'storage', label: '大规模储能', hint: '白天充电、月夜放电，依赖日照窗口', icon: '🔋' },
    { id: 'solar', label: '薄膜太阳能', hint: '重量轻、成本低，受月夜与阴影限制', icon: '☀️' }
  ],
  water: [
    { id: 'isru', label: '就地采水冰（ISRU）', hint: '利用阴影区水冰，减少地球补给', icon: '❄️' },
    { id: 'earth_supply', label: '地球补给', hint: '技术成熟，但运费昂贵且供应线脆弱', icon: '🚀' },
    { id: 'recycling', label: '循环水回收', hint: '高回收率但依赖电力，适合低冰区域', icon: '♻️' }
  ],
  radiation: [
    { id: 'regolith', label: '埋入月壤', hint: '覆盖 2–3 米月壤，防护效果最佳但工程量大', icon: '🏔️' },
    { id: 'cave', label: '利用熔岩洞', hint: '天然厚岩层屏蔽，但空间受限、探测不足', icon: '🕳️' },
    { id: 'hull', label: '加厚舱壁', hint: '现有舱体技术，快速部署但质量大、屏蔽有限', icon: '🛡️' }
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

// ===== 基地元数据 =====
export const siteMeta = {
  shackleton: {
    name: '沙克尔顿环形山',
    subtitle: '南极极地科研前哨',
    desc: '位于月球南极，坑口近乎永昼，永久阴影区富含水冰。能源与水资源的“黄金组合”，但极端低温与险峻地形是主要代价。',
    baseTempC: -220,
    baseRadiation_mSv_y: 350,
    iceAvailable_t: 1500,
    sunHoursRatio: 0.82,
    baseMass_t: 200,
    basePower_kW: 100,
    difficulty: 3,
    tags: ['永昼', '水冰丰富', '极低温']
  },
  tranquility: {
    name: '静海纪念站',
    subtitle: '赤道文化与交通枢纽',
    desc: '坐落在阿波罗 11 号首次登月点附近，日照充沛、地形平缓，是旅游与科普教育的理想节点，但水冰资源极度稀缺。',
    baseTempC: -50,
    baseRadiation_mSv_y: 280,
    iceAvailable_t: 80,
    sunHoursRatio: 0.95,
    baseMass_t: 180,
    basePower_kW: 80,
    difficulty: 1,
    tags: ['日照充沛', '水冰稀缺', '地标意义']
  },
  imbrium: {
    name: '雨海采矿区',
    subtitle: '中纬度工业基地',
    desc: '雨海盆地的玄武岩富含钛铁矿与氦-3 资源。这里部署了自动化采矿与冶炼设施，是月球工业化的起点。',
    baseTempC: -120,
    baseRadiation_mSv_y: 320,
    iceAvailable_t: 400,
    sunHoursRatio: 0.70,
    baseMass_t: 220,
    basePower_kW: 90,
    difficulty: 2,
    tags: ['矿产丰富', '工业需求', '月夜较长']
  },
  tycho: {
    name: '第谷观测台',
    subtitle: '高地深空观测平台',
    desc: '位于壮观的第谷环形山区域，高海拔、地质年轻、地貌崎岖，是天文观测与行星科学研究的理想场所。',
    baseTempC: -160,
    baseRadiation_mSv_y: 340,
    iceAvailable_t: 200,
    sunHoursRatio: 0.75,
    baseMass_t: 190,
    basePower_kW: 85,
    difficulty: 2,
    tags: ['高海拔', '观测窗口', '地形复杂']
  }
};

// ===== 规则表：每个选项对基地指标的增量影响 =====
// 新增 siteModifier：针对特定基地的额外修正
export const ruleTable = {
  energy: {
    nuclear: {
      powerBalance_kW: 60, mass_t: 80, riskScore: 2, costLevel: 3, sustainability: 4,
      note: '核能稳定覆盖月夜，但 Shackleton 的极低温对热管理提出最高要求。'
    },
    storage: {
      powerBalance_kW: -10, mass_t: 60, riskScore: 1, costLevel: 2, sustainability: 3,
      siteModifier: {
        shackleton: { powerBalance_kW: 25 }, // 永昼充电窗口长
        tranquility: { powerBalance_kW: 35 },
        imbrium: { powerBalance_kW: 5 },
        tycho: { powerBalance_kW: 10 }
      },
      note: '储能系统收益高度依赖日照窗口，赤道最高、高纬最低。'
    },
    solar: {
      powerBalance_kW: 20, mass_t: 25, riskScore: 1, costLevel: 1, sustainability: 2,
      siteModifier: {
        shackleton: { powerBalance_kW: 25 },
        tranquility: { powerBalance_kW: 40 },
        imbrium: { powerBalance_kW: 5 },
        tycho: { powerBalance_kW: 15 }
      },
      note: '太阳能重量轻，但月夜与阴影区作业需要配合储能或停工。'
    }
  },
  water: {
    isru: {
      waterSupply_t_y: 600, mass_t: 50, powerConsumption_kW: 15, riskScore: 2, costLevel: 2, sustainability: 5,
      siteModifier: {
        shackleton: { waterSupply_t_y: 600 }, // 总 1200
        tranquility: { waterSupply_t_y: -250 }, // 水冰稀缺
        imbrium: { waterSupply_t_y: 100 },
        tycho: { waterSupply_t_y: 50 }
      },
      note: '就地采水高度依赖冰储量，Shackleton 优势巨大，静海几乎不可行。'
    },
    earth_supply: {
      waterSupply_t_y: 120, mass_t: 15, powerConsumption_kW: 2, riskScore: 1, costLevel: 3, sustainability: 1,
      note: '地球运输代价极高，长期难以支撑百人级基地。'
    },
    recycling: {
      waterSupply_t_y: 350, mass_t: 30, powerConsumption_kW: 12, riskScore: 1, costLevel: 2, sustainability: 4,
      note: '循环水回收适合冰储量有限但电力充足的基地。'
    }
  },
  radiation: {
    regolith: {
      radiationDelta_mSv_y: -250, mass_t: 60, riskScore: 2, costLevel: 2, sustainability: 5,
      note: '2–3 米月壤可将辐射降至近地球背景水平。'
    },
    cave: {
      radiationDelta_mSv_y: -300, mass_t: 10, riskScore: 3, costLevel: 1, sustainability: 5,
      note: '熔岩洞天然屏蔽优异，但选址与内部改造风险未知。'
    },
    hull: {
      radiationDelta_mSv_y: -150, mass_t: 30, riskScore: 1, costLevel: 2, sustainability: 3,
      note: '舱壁加厚是最快部署方案，但仍高于长期安全阈值。'
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
      note: '全封闭农场提供最高食品自给率，但系统复杂、启动周期长。'
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
  history: []
};

function migrateLegacy(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed, history: parsed.history || [] };
  } catch (e) {
    return null;
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultState, ...parsed, history: parsed.history || [] };
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return migrateLegacy(legacy);
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

  const powerSurplus_kW = site.basePower_kW + deltas.powerBalance_kW - deltas.powerConsumption_kW;
  const radiation_mSv_y = Math.max(20, site.baseRadiation_mSv_y + (ruleTable.radiation[state.radiation]?.radiationDelta_mSv_y || 0));

  // 综合可行性评分（0-100）
  const powerScore = Math.min(25, Math.max(0, (powerSurplus_kW + 20) / 80 * 25));
  const radiationScore = Math.min(20, Math.max(0, (400 - radiation_mSv_y) / 380 * 20));
  const waterScore = Math.min(20, Math.max(0, deltas.waterSupply_t_y / 1200 * 20));
  const sustainScore = Math.min(20, Math.max(0, deltas.sustainability / 28 * 20)); // 6步×5=30 取 28 为基准
  const riskPenalty = Math.min(15, Math.max(0, deltas.riskScore / 18 * 15));
  const viabilityScore = Math.round(powerScore + radiationScore + waterScore + sustainScore - riskPenalty);

  return {
    siteName: site.name,
    powerSurplus_kW: Math.round(powerSurplus_kW),
    totalMass_t: Math.round(deltas.mass_t),
    waterSupply_t_y: Math.round(deltas.waterSupply_t_y),
    radiation_mSv_y: Math.round(radiation_mSv_y),
    riskScore: deltas.riskScore,
    costLevel: deltas.costLevel,
    sustainability: deltas.sustainability,
    commScore: deltas.commScore,
    foodSelfSufficiency: deltas.foodSelfSufficiency,
    transportCapacity: deltas.transportCapacity,
    viabilityScore,
    notes: deltas.notes
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
