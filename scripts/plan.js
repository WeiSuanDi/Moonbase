import {
  subscribe,
  getState,
  getSiteDecisions,
  getPlannedSites,
  setActiveSite,
  removeSite,
  setDecision,
  setCrew,
  resetGame,
  MAX_BASES,
  getRule,
  computeMetrics,
  computeSiteMetrics,
  computeNetworkMetrics,
  steps,
  options,
  siteMeta,
  getSiteDifficulty,
  isDecisionComplete,
  getCompletedSteps,
  CREW_OPTIONS
} from './state.js';
import { bases, highlightSite, updateDecisionOverlays } from './moon-render.js';
import { askAgent, generateSummary, compareBases, generateStory, generatePoster, suggestNext } from './agent-client.js';

// DOM refs（每次 init 时重新查询）
let planTopBar, topbarSite, progressPipeline, topbarStats, missionConsole;
let planStage, completedSummary, decisionCardWrapper;
let resultPanel, resultTitle, resultBody, resultClose, resultReset;
let agentFab, agentChat, chatClose, chatMessages, chatInput, chatSend, chatChips;
let stageInner, assemblyEl, networkEl; // 装配带 / 补给链路面板（init 时注入 stage-inner）

let isGenerating = false;
let unsubscribe = null;
let currentCardStepKey = null;
let currentCardSiteId = null;   // 当前决策卡所属基地（切换基地时强制重建卡片）
let isAnimating = false;
let pendingSwitch = null;
let commitLock = false;         // 选项确认脉冲（250ms）期间的提交锁
let prevTopbarMetrics = null;   // 上一次渲染的 topbar 数值（countUp 的 from）
let wasOverBudget = false;      // 预算「内 → 超」跳变检测
let completionSoundPlayed = false; // 完成音效只在首次构建时播放
let prevCompletionScore = 0;    // 完成卡片总分的滚动起点
let prevCompletionNetScore = 0; // 完成卡片网络评分的滚动起点
let sitePickerOpen = false;     // 「添加基地」选择器展开状态
let assemblyMemory = { siteId: null, filled: {} }; // 装配带已填入插槽（只对新插槽播动画）
let currentNetwork = null;      // 最近一次 computeNetworkMetrics 结果
let prevNetworkScore = 0;       // 补给链路面板网络评分的滚动起点
let networkRafId = null;        // 补给链路流动虚线 RAF
let networkDashOffset = 0;      // 流动虚线相位（跨渲染保持连续）
let networkCanvas = null;
let networkState = null;
let networkData = null;

// —— __moonFx 安全包装（worker 可能不存在，全部可选链 + 降级） ——
function fxSound(name) {
  try { window.__moonFx?.sound?.(name); } catch (e) { /* 忽略音效异常 */ }
}

function fxTilt(el, opts) {
  try { window.__moonFx?.tilt?.(el, opts); } catch (e) { /* 忽略动效异常 */ }
}

function countUpOrSet(el, to, opts = {}) {
  if (!el) return;
  const fx = window.__moonFx;
  if (fx && typeof fx.countUp === 'function') {
    try {
      fx.countUp(el, to, opts);
      return;
    } catch (e) { /* 降级为直接赋值 */ }
  }
  el.textContent = typeof opts.format === 'function' ? opts.format(to) : String(to);
}

// plan.html 只引 main.css，本模块的新样式由这里按需注入
function ensureSystemsCss() {
  if (document.querySelector('link[data-ps-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'styles/plan-systems.css';
  link.dataset.psCss = '1';
  document.head.appendChild(link);
}

const MISSION_KEY = 'moonBaseMissionDirective_v1';
const missionDirectives = {
  survival: { icon: '🫧', name: '生存优先', target: '辐射 ≤ 100 mSv / 年', test: m => m.radiation_mSv_y <= 100, brief: '优先保护首批常驻乘员。' },
  autonomy: { icon: '♻️', name: '自持优先', target: '供水 ≥ 500 t / 年', test: m => m.waterSupply_t_y >= 500, brief: '尽量减少来自地球的补给依赖。' },
  expansion: { icon: '⚡', name: '扩张优先', target: '功率余量 ≥ 30 kW', test: m => m.powerSurplus_kW >= 30, brief: '为科研与工业扩张保留能源窗口。' }
};

function getMissionDirective() {
  try { return localStorage.getItem(MISSION_KEY) || 'survival'; } catch (e) { return 'survival'; }
}

function setMissionDirective(id) {
  try { localStorage.setItem(MISSION_KEY, id); } catch (e) { /* 私密模式下仅保留本次体验 */ }
  renderMissionConsole(getState());
}

// —— 常量 ——
const STEP_ICONS = { energy: '⚡', water: '💧', radiation: '🛡️', communication: '📡', habitat: '🌱', transport: '🚀' };
const STEP_SHORT = { energy: '能源', water: '水源', radiation: '防护', communication: '通信', habitat: '生命', transport: '运输' };
const SITE_TONES = {
  shackleton: '#00d4ff',
  connecting_ridge: '#00ffaa',
  cabeus: '#44aaff',
  marius_lava_tube: '#ff66cc',
  tranquility: '#e0e0e0',
  imbrium: '#ffaa55',
  tycho: '#c9a0ff'
};
const LINK_COLORS = { water: '#44aaff', power: '#ffaa55', food: '#7ee787' };

// —— state.js 新契约的安全访问封装（全部按契约导出消费，异常时降级） ——

function getActiveDecisions(state) {
  try { return getSiteDecisions(state, state?.activeSite) || {}; } catch (e) { return {}; }
}

function getPlannedList(state) {
  try { return getPlannedSites(state) || []; } catch (e) { return state?.activeSite ? [state.activeSite] : []; }
}

function safeComputeMetrics(state) {
  try { return computeMetrics(state); } catch (e) { return null; }
}

// 任意基地的指标（契约：computeSiteMetrics(siteId, decisions, crew)）
function siteMetrics(state, siteId) {
  try {
    const decisions = getSiteDecisions(state, siteId) || {};
    return computeSiteMetrics(siteId, decisions, state.crew);
  } catch (e) { return null; }
}

function safeRule(stepKey, choiceId, siteId) {
  try { return getRule(stepKey, choiceId, siteId); } catch (e) { return null; }
}

function safeNetworkMetrics(state) {
  try { return computeNetworkMetrics(state); } catch (e) { return null; }
}

// 后端 / moon-render 只认旧扁平形状：{ site, energy..transport, crew, metrics, history }
function buildLegacyState(state) {
  const d = getActiveDecisions(state);
  return {
    site: state?.activeSite ?? null,
    energy: d.energy ?? null,
    water: d.water ?? null,
    radiation: d.radiation ?? null,
    communication: d.communication ?? null,
    habitat: d.habitat ?? null,
    transport: d.transport ?? null,
    crew: state?.crew,
    metrics: safeComputeMetrics(state),
    history: state?.history || []
  };
}

// 多基地对比：遍历 getPlannedSites 全部基地，各自组装 legacy payload
function buildPlannedSiteStates(state) {
  return getPlannedList(state).map(siteId => {
    const d = getSiteDecisions(state, siteId) || {};
    return {
      site: siteId,
      energy: d.energy ?? null,
      water: d.water ?? null,
      radiation: d.radiation ?? null,
      communication: d.communication ?? null,
      habitat: d.habitat ?? null,
      transport: d.transport ?? null,
      crew: state.crew,
      metrics: siteMetrics(state, siteId),
      history: state.history || []
    };
  });
}

function siteTone(siteId) {
  const base = bases.find(b => b.id === siteId);
  if (base && base.tone != null) return '#' + base.tone.toString(16).padStart(6, '0');
  return SITE_TONES[siteId] || '#8ccaff';
}

function shortLabel(label) {
  return String(label || '').split('（')[0];
}

function queryDom() {
  planTopBar = document.getElementById('plan-top-bar');
  topbarSite = document.getElementById('topbar-site');
  progressPipeline = document.getElementById('progress-pipeline');
  topbarStats = document.getElementById('topbar-stats');
  missionConsole = document.getElementById('mission-console');

  planStage = document.getElementById('plan-stage');
  completedSummary = document.getElementById('completed-summary');
  decisionCardWrapper = document.getElementById('decision-card-wrapper');

  resultPanel = document.getElementById('result-panel');
  resultTitle = document.getElementById('result-title');
  resultBody = document.getElementById('result-body');
  resultClose = document.getElementById('result-close');
  resultReset = document.getElementById('result-reset');

  agentFab = document.getElementById('agent-fab');
  agentChat = document.getElementById('agent-chat');
  chatClose = document.getElementById('chat-close');
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  chatSend = document.getElementById('chat-send');
  chatChips = document.getElementById('chat-chips');
}

// 在 stage-inner 注入「补给链路」与「基地装配带」容器（plan.html 不可改，DOM 变更全部在这里做）
// 幂等：先查已有节点，避免 cleanup → init 重入时重复插入
function ensureStagePanels() {
  stageInner = planStage ? planStage.querySelector('.stage-inner') : null;
  if (!stageInner || !decisionCardWrapper) return;
  assemblyEl = stageInner.querySelector('.ps-assembly');
  if (!assemblyEl) {
    assemblyEl = document.createElement('div');
    assemblyEl.className = 'ps-assembly';
    assemblyEl.style.display = 'none';
    stageInner.insertBefore(assemblyEl, decisionCardWrapper);
  }
  networkEl = stageInner.querySelector('.ps-network');
  if (!networkEl) {
    networkEl = document.createElement('div');
    networkEl.className = 'ps-network';
    networkEl.style.display = 'none';
    stageInner.insertBefore(networkEl, assemblyEl);
  }
}

// —— 事件处理（具名函数，便于绑定和解绑） ——

function onResultReset() {
  hideResult();
  resetGame();
}

function onRunAgentSummary() { runAgentOutput('summary'); }

function onAgentFabClick() {
  if (agentChat) agentChat.classList.toggle('visible');
}

function onChatCloseClick() {
  if (agentChat) agentChat.classList.remove('visible');
}

function onChatSendClick() { sendChat(); }

function onChatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

function onAgentActionsClick(e) {
  const btn = e.target.closest('[data-output]');
  if (!btn) return;
  const type = btn.dataset.output;
  if (type) runAgentOutput(type);
}

function onChatChipsClick(e) {
  const chip = e.target.closest('.chat-chip');
  if (!chip) return;
  if (chatInput) chatInput.value = chip.dataset.question || chip.textContent;
  sendChat();
}

function onSuggestNextClick() { onSuggestNext(); }

function bindEvents() {
  if (resultClose) resultClose.addEventListener('click', hideResult);
  if (resultReset) resultReset.addEventListener('click', onResultReset);
  if (agentFab) agentFab.addEventListener('click', onAgentFabClick);
  if (chatClose) chatClose.addEventListener('click', onChatCloseClick);
  if (chatSend) chatSend.addEventListener('click', onChatSendClick);
  if (chatInput) chatInput.addEventListener('keydown', onChatInputKeydown);
  if (chatChips) chatChips.addEventListener('click', onChatChipsClick);
}

function unbindEvents() {
  if (resultClose) resultClose.removeEventListener('click', hideResult);
  if (resultReset) resultReset.removeEventListener('click', onResultReset);
  if (agentFab) agentFab.removeEventListener('click', onAgentFabClick);
  if (chatClose) chatClose.removeEventListener('click', onChatCloseClick);
  if (chatSend) chatSend.removeEventListener('click', onChatSendClick);
  if (chatInput) chatInput.removeEventListener('keydown', onChatInputKeydown);
  if (chatChips) chatChips.removeEventListener('click', onChatChipsClick);
}

// —— 核心逻辑 ——

function init() {
  ensureSystemsCss();
  queryDom();
  ensureStagePanels();
  resolveSiteFromUrl();
  bindEvents();
  unsubscribe = subscribe(render);
  const state = getState();
  render(state);
  if (state.activeSite) {
    if (highlightSite) highlightSite(state.activeSite);
    if (updateDecisionOverlays) updateDecisionOverlays(state);
  }
}

function cleanup() {
  unbindEvents();
  stopNetworkLoop();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  isGenerating = false;
  currentCardStepKey = null;
  currentCardSiteId = null;
  isAnimating = false;
  pendingSwitch = null;
  commitLock = false;
  sitePickerOpen = false;
  assemblyMemory = { siteId: null, filled: {} };
  currentNetwork = null;
  prevNetworkScore = 0;
  networkDashOffset = 0;
  if (assemblyEl) { assemblyEl.remove(); assemblyEl = null; }
  if (networkEl) { networkEl.remove(); networkEl = null; }
  stageInner = null;
}

// 注册页面生命周期（由 navigator.js 通过 window.__pageModules 调用）
window.__pageModules = window.__pageModules || {};
window.__pageModules["plan"] = { init: init, cleanup: cleanup };

function resolveSiteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const siteFromUrl = params.get('site');
  if (siteFromUrl && siteMeta[siteFromUrl]) {
    setActiveSite(siteFromUrl);
  }
}

function getActiveStepIndex(decisions) {
  return steps.findIndex(s => !decisions[s.key]);
}

function getStepStatus(decisions, step, index) {
  const prev = steps[index - 1];
  const isUnlocked = !prev || !!decisions[prev.key];
  const isDone = !!decisions[step.key];
  const isActive = isUnlocked && !isDone;
  return { isUnlocked, isDone, isActive };
}

function render(state) {
  currentNetwork = safeNetworkMetrics(state);
  renderTopBar(state);
  renderMissionConsole(state);
  renderAssembly(state);
  renderNetworkPanel(state);
  renderStage(state);
  if (updateDecisionOverlays) updateDecisionOverlays(state);
  if (highlightSite) highlightSite(state.activeSite || null);
  checkBudgetTransition(state);
  const decisions = getActiveDecisions(state);
  if (!(state.activeSite && isDecisionComplete(decisions))) {
    completionSoundPlayed = false;
    prevCompletionScore = 0;
    prevCompletionNetScore = 0;
  }
}

// 首次从预算内变为超预算时播放错误音
function checkBudgetTransition(state) {
  const metrics = state.activeSite ? safeComputeMetrics(state) : null;
  const over = !!(metrics && metrics.budgetOver_t > 0);
  if (over && !wasOverBudget) fxSound('error');
  wasOverBudget = over;
}

// —— Mission Console（含基地网络行 + 添加基地选择器） ——

function renderMissionConsole(state) {
  if (!missionConsole) return;
  const activeId = getMissionDirective();
  const active = missionDirectives[activeId];
  const hasSite = !!state.activeSite;
  const metrics = hasSite ? safeComputeMetrics(state) : null;
  const decisions = getActiveDecisions(state);
  const completed = getCompletedSteps(decisions);
  const isPassing = metrics && active.test(metrics);
  const alert = (hasSite && completed >= 2) ? buildMissionAlert(decisions, metrics) : null;
  const crew = CREW_OPTIONS.includes(state.crew) ? state.crew : 12;

  missionConsole.innerHTML = `
    <div class="mission-console-inner">
      ${buildBaseNetworkRow(state)}
      <div class="mission-console-title"><span class="signal-dot"></span><span>MISSION CONTROL</span><small>选择本轮推演的首要任务</small></div>
      <div class="mission-directives">
        ${Object.entries(missionDirectives).map(([id, item]) => `
          <button class="mission-directive ${id === activeId ? 'selected' : ''}" data-directive="${id}">
            <span>${item.icon}</span><strong>${item.name}</strong><em>${item.target}</em>
          </button>`).join('')}
      </div>
      <div class="mission-status ${hasSite ? (isPassing ? 'on-track' : 'at-risk') : ''}">
        <span>${hasSite ? (isPassing ? '● 任务指标已达成' : '◌ 任务指标待校准') : '◌ 选择基地后启动任务'}</span>
        <small>${hasSite ? `${completed} / ${steps.length} 系统已部署 · ${active.brief}` : '三种指令会给出不同的成功判定。'}</small>
      </div>
      ${alert ? `<div class="mission-alert"><span>⚠ ${alert.title}</span><small>${alert.detail}</small></div>` : ''}
      <div class="ps-console-row">
        <div class="ps-crew">
          <span class="ps-crew-label">常驻乘员</span>
          <div class="ps-seg" role="group" aria-label="常驻乘员规模">
            ${CREW_OPTIONS.map(n => `<button class="ps-seg-btn ${n === crew ? 'active' : ''}" data-crew="${n}">${n} 人</button>`).join('')}
          </div>
          <small class="ps-crew-hint">规模直接推高水 / 电 / 食品需求，越大越难养</small>
        </div>
        ${metrics ? `
        <div class="ps-budget ${metrics.budgetOver_t > 0 ? 'over' : ''}">
          <div class="ps-budget-head"><span>首年发射质量预算</span><span>${metrics.totalMass_t} / ${metrics.launchBudget_t} t${metrics.budgetOver_t > 0 ? ` · 超 ${metrics.budgetOver_t} t` : ''}</span></div>
          <div class="ps-budget-track"><div class="ps-budget-fill" style="width:${Math.min(100, Math.round(metrics.budgetUsage * 100))}%"></div></div>
        </div>` : ''}
      </div>
      ${sitePickerOpen ? buildSitePicker(state) : ''}
    </div>`;

  missionConsole.querySelectorAll('[data-directive]').forEach(btn => btn.addEventListener('click', () => setMissionDirective(btn.dataset.directive)));
  missionConsole.querySelectorAll('[data-crew]').forEach(btn => btn.addEventListener('click', () => setCrew(Number(btn.dataset.crew))));

  // 基地网络行：切换 / 移除 / 添加
  missionConsole.querySelectorAll('.ps-base-chip[data-site]').forEach(chip => {
    chip.addEventListener('click', () => {
      const siteId = chip.dataset.site;
      if (!siteId || siteId === getState().activeSite) return;
      fxSound('select');
      setActiveSite(siteId);
    });
  });
  missionConsole.querySelectorAll('[data-remove]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const siteId = el.dataset.remove;
      if (!siteId) return;
      const stateNow = getState();
      let hasDecisions = false;
      try {
        const d = getSiteDecisions(stateNow, siteId) || {};
        hasDecisions = steps.some(s => !!d[s.key]);
      } catch (err) { hasDecisions = false; }
      const name = siteMeta[siteId]?.name || siteId;
      if (hasDecisions && !window.confirm(`移除基地「${name}」？该基地的全部决策将丢失。`)) return;
      fxSound('select');
      removeSite(siteId);
    });
  });
  const addBtn = missionConsole.querySelector('[data-add-base]');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      sitePickerOpen = !sitePickerOpen;
      fxSound('select');
      renderMissionConsole(getState());
    });
  }
  const pickerClose = missionConsole.querySelector('[data-picker-close]');
  if (pickerClose) {
    pickerClose.addEventListener('click', () => {
      sitePickerOpen = false;
      renderMissionConsole(getState());
    });
  }
  missionConsole.querySelectorAll('[data-pick-site]').forEach(card => {
    card.addEventListener('click', () => {
      const siteId = card.dataset.pickSite;
      if (!siteId) return;
      sitePickerOpen = false;
      fxSound('confirm');
      setActiveSite(siteId); // 契约：自动创建空条目并设为当前基地
    });
    fxTilt(card, { max: 3 });
  });
}

// 基地网络行：每个已规划基地一个 chip + 末尾「+ 添加基地」
function buildBaseNetworkRow(state) {
  const planned = getPlannedList(state);
  const chips = planned.map(siteId => {
    const meta = siteMeta[siteId];
    let d = {};
    try { d = getSiteDecisions(state, siteId) || {}; } catch (e) { d = {}; }
    const doneCount = getCompletedSteps(d);
    const m = siteMetrics(state, siteId);
    const isActive = siteId === state.activeSite;
    const dots = steps.map(s => `<i class="ps-base-dot ${d[s.key] ? 'on' : ''}"></i>`).join('');
    const score = doneCount > 0 && m ? m.viabilityScore : '—';
    return `
      <button class="ps-base-chip ${isActive ? 'active' : ''}" data-site="${siteId}" style="--tone:${siteTone(siteId)}" title="${meta?.name || siteId} · ${doneCount}/${steps.length} 系统已部署">
        <span class="ps-base-chip-name">${meta?.name || siteId}</span>
        <span class="ps-base-dots">${dots}</span>
        <span class="ps-base-score">${score}</span>
        <span class="ps-base-remove" data-remove="${siteId}" title="移除该基地">×</span>
      </button>`;
  }).join('');

  const full = planned.length >= MAX_BASES;
  const addChip = full
    ? `<button class="ps-base-chip ps-add-chip disabled" disabled title="最多同时规划 ${MAX_BASES} 个基地，移除一个后再添加">已达上限 ${planned.length}/${MAX_BASES}</button>`
    : `<button class="ps-base-chip ps-add-chip ${sitePickerOpen ? 'open' : ''}" data-add-base title="添加一个基地（最多 ${MAX_BASES} 个）">＋ 添加基地</button>`;

  return `<div class="ps-bases-row">
    <span class="ps-bases-label">基地网络</span>
    <div class="ps-bases-chips">${chips}${addChip}</div>
  </div>`;
}

// 添加基地选择器：尚未规划的 siteMeta 基地卡片列表
function buildSitePicker(state) {
  const planned = getPlannedList(state);
  const available = Object.keys(siteMeta).filter(id => !planned.includes(id));
  if (!available.length) {
    return `<div class="ps-site-picker"><div class="ps-picker-empty">全部选址都已加入基地网络。</div></div>`;
  }
  return `<div class="ps-site-picker">
    <div class="ps-picker-head">
      <span>选择新基地选址</span>
      <small>加入后立即切换为该基地进行推演</small>
      <button class="ps-picker-close" data-picker-close title="收起">×</button>
    </div>
    <div class="ps-picker-grid">
      ${available.map(id => {
        const meta = siteMeta[id];
        const tags = (meta.tags || []).slice(0, 3).map(t => `<span class="ps-picker-tag">${t}</span>`).join('');
        const diff = meta.difficulty || 2;
        return `<button class="ps-picker-card" data-pick-site="${id}" style="--tone:${siteTone(id)}">
          <span class="ps-picker-name">${meta.name}</span>
          <span class="ps-picker-sub">${meta.subtitle || ''}</span>
          <span class="ps-picker-tags">${tags}</span>
          <span class="ps-picker-diff diff-${diff}">难度 · ${getSiteDifficulty(id)}</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function buildMissionAlert(decisions, metrics) {
  if (!metrics) return null;
  if (decisions.energy === 'solar' && metrics.powerSurplus_kW < 20) return { title: '月夜储能窗口偏窄', detail: '当前能源方案缺少冗余；后续交通与生命维持会继续占用功率。' };
  if (decisions.water === 'earth_supply') return { title: '补给线压力上升', detail: '当前水源依赖地球运输，建议用生命维持方案提高闭环能力。' };
  if (decisions.radiation === 'hull') return { title: '银河宇宙线暴露偏高', detail: '加厚舱壁能快速部署，但长驻任务仍需要额外屏蔽策略。' };
  return { title: '系统耦合开始生效', detail: '每项新决策都会重新平衡基地的能源、质量与长期自持能力。' };
}

// —— Top Bar ——

function renderTopBar(state) {
  renderTopBarSite(state);
  renderProgressPipeline(state);
  renderTopBarStats(state);
}

function renderTopBarSite(state) {
  if (!topbarSite) return;
  if (!state.activeSite) {
    topbarSite.innerHTML = `<div class="topbar-site-placeholder">尚未选择基地</div>`;
    return;
  }

  const base = bases.find(b => b.id === state.activeSite);
  const meta = siteMeta[state.activeSite];
  if (!base) return;

  const iceDisplay = meta?.iceAvailable_t >= 1000000
    ? (meta.iceAvailable_t / 1000000).toFixed(2) + 'M'
    : meta?.iceAvailable_t >= 1000
      ? (meta.iceAvailable_t / 1000).toFixed(1) + 'k'
      : meta?.iceAvailable_t || '—';

  topbarSite.innerHTML = `
    <div class="topbar-site-name">${base.name}</div>
    <div class="topbar-site-sub">${base.subtitle}</div>
    <div class="topbar-site-tags">
      ${meta?.tags?.map(t => `<span class="topbar-site-tag">${t}</span>`).join('') || ''}
    </div>
    <div class="topbar-site-mini">
      <div class="mini-stat"><span>${meta?.sunHoursRatio ? Math.round(meta.sunHoursRatio * 100) + '%' : '—'}</span><span>日照</span></div>
      <div class="mini-stat"><span>${meta?.longestShadow_h === 9999 ? '永久' : meta?.longestShadow_h + 'h'}</span><span>阴影</span></div>
      <div class="mini-stat"><span>${iceDisplay}t</span><span>水冰</span></div>
    </div>
  `;
}

function renderTopBarStats(state) {
  if (!topbarStats) return;
  const metrics = state.activeSite ? safeComputeMetrics(state) : null;
  if (!metrics || !state.activeSite) {
    topbarStats.innerHTML = `<div class="topbar-stats-placeholder">选择基地后开始推演</div>`;
    prevTopbarMetrics = null;
    return;
  }

  const viabilityClass = metrics.viabilityScore >= 70 ? 'good' : metrics.viabilityScore >= 45 ? 'warn' : 'bad';
  const powerClass = metrics.powerSurplus_kW >= 30 ? 'good' : metrics.powerSurplus_kW >= 0 ? 'warn' : 'bad';
  const radiationClass = metrics.radiation_mSv_y <= 100 ? 'good' : metrics.radiation_mSv_y <= 200 ? 'warn' : 'bad';
  // 水源改为「供水/需求」展示，赤字（waterBalance < 0）标红
  const waterClass = metrics.waterBalance_t_y >= 300 ? 'good' : metrics.waterBalance_t_y >= 0 ? 'warn' : 'bad';

  topbarStats.innerHTML = `
    <div class="topbar-stats-main">
      <div class="topbar-viability ${viabilityClass}">
        <span class="topbar-viability-value" data-count="viability">${metrics.viabilityScore}</span>
        <span class="topbar-viability-label">可行性</span>
      </div>
      <div class="topbar-mini-metrics">
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">能源</span>
          <span class="mini-metric-value ${powerClass}" data-count="power"></span>
        </div>
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">水源</span>
          <span class="mini-metric-value ${waterClass}" data-count="water"></span>
        </div>
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">辐射</span>
          <span class="mini-metric-value ${radiationClass}" data-count="radiation"></span>
        </div>
      </div>
    </div>
  `;

  // 数字滚动：from 取上一次渲染的值，避免每次从 0 开始
  const prev = prevTopbarMetrics || { viability: 0, power: 0, water: 0, radiation: 0 };
  const demand = Math.round(metrics.waterDemand_t_y);
  countUpOrSet(topbarStats.querySelector('[data-count="viability"]'), metrics.viabilityScore, { from: prev.viability, duration: 600, format: v => String(Math.round(v)) });
  countUpOrSet(topbarStats.querySelector('[data-count="power"]'), metrics.powerSurplus_kW, { from: prev.power, duration: 600, format: v => `${v > 0 ? '+' : ''}${Math.round(v)} kW` });
  countUpOrSet(topbarStats.querySelector('[data-count="water"]'), metrics.waterSupply_t_y, { from: prev.water, duration: 600, format: v => `${Math.round(v)}/${demand} t/年` });
  countUpOrSet(topbarStats.querySelector('[data-count="radiation"]'), metrics.radiation_mSv_y, { from: prev.radiation, duration: 600, format: v => `${Math.round(v)} mSv` });

  prevTopbarMetrics = {
    viability: metrics.viabilityScore,
    power: metrics.powerSurplus_kW,
    water: metrics.waterSupply_t_y,
    radiation: metrics.radiation_mSv_y
  };
}

// —— Progress Pipeline ——

function renderProgressPipeline(state) {
  if (!progressPipeline) return;
  const decisions = getActiveDecisions(state);

  let html = '';
  steps.forEach((step, i) => {
    const { isDone, isActive } = getStepStatus(decisions, step, i);

    let statusClass = 'locked';
    if (isDone) statusClass = 'done';
    else if (isActive) statusClass = 'active';

    const icon = STEP_ICONS[step.key] || '●';
    const label = STEP_SHORT[step.key] || step.name;

    html += `<div class="pipeline-node ${statusClass}" data-step="${step.key}">
      <div class="pipeline-dot">${isDone ? '✓' : icon}</div>
      <span class="pipeline-label">${label}</span>
    </div>`;

    if (i < steps.length - 1) {
      let connClass = '';
      if (isDone) connClass = 'done';
      else if (isActive) connClass = 'active-half';
      html += `<div class="pipeline-connector ${connClass}"></div>`;
    }
  });

  progressPipeline.innerHTML = html;

  progressPipeline.querySelectorAll('.pipeline-node').forEach(node => {
    node.addEventListener('click', () => {
      const stepKey = node.dataset.step;
      if (!stepKey || isAnimating || commitLock) return;
      const currentState = getState();
      const currentDecisions = getActiveDecisions(currentState);
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      const prev = steps[stepIndex - 1];
      const isUnlocked = !!currentState.activeSite && (!prev || !!currentDecisions[prev.key]);
      if (!isUnlocked) return;
      goToStep(stepKey, stepIndex < getActiveStepIndex(currentDecisions) ? 1 : -1);
    });
  });
}

// —— 基地装配带（建造模式）：6 插槽 + 降落部署动画 ——

function glyph(inner) {
  return `<svg class="ps-glyph" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// 18 个选项的专属小图形（stroke 简笔，必须两两可区分）
const OPTION_GLYPHS = {
  // 能源
  nuclear: glyph('<path d="M8 27a12 12 0 0 1 24 0"/><path d="M5 27h30"/><path d="M5 31h30"/><circle cx="20" cy="21" r="1.5"/><path d="M20 19.5V15M20 19.5l4 2.3M20 19.5l-4 2.3"/>'),
  storage: glyph('<rect x="5" y="16" width="15" height="12" rx="2"/><path d="M20 20h3v4h-3"/><path d="M9 20v4M12.5 20v4M16 20v4"/><circle cx="28.5" cy="22" r="3"/><circle cx="33.5" cy="22" r="3"/>'),
  solar: glyph('<circle cx="30" cy="9" r="3.2"/><path d="M30 3.5v1.8M30 12.7v1.8M24.5 9h1.8M33.7 9h1.8M26.2 5.2l1.3 1.3M33.8 5.2l-1.3 1.3"/><path d="M5 19l12-3.5V31L5 34.5Z"/><path d="M19 15l12 2.5v13L19 29Z"/><path d="M11 17.2v15.8M25 16.4v13.6"/>'),
  // 水源
  isru: glyph('<path d="M10 5v17M6 5h8"/><path d="M10 22l-3.5 6h7Z"/><path d="M4 28h22"/><path d="M30 12v14M23 19h14M25 14.5l10 9M35 14.5l-10 9"/>'),
  earth_supply: glyph('<path d="M12 7c4 0 6.5 3.5 6.5 7.5L16.8 21H7.2L5.5 14.5C5.5 10.5 8 7 12 7Z"/><circle cx="12" cy="13.5" r="1.7"/><path d="M7.5 21l-2 4M16.5 21l2 4M12 21v5"/><path d="M29 13c2.6 3.2 4.2 5.4 4.2 7.4a4.2 4.2 0 1 1-8.4 0c0-2 1.6-4.2 4.2-7.4Z"/>'),
  recycling: glyph('<path d="M28.5 13a9 9 0 1 0 1.8 6.5"/><path d="M31 7v6h-6"/><path d="M20 16.5c2 2.5 3.2 4.2 3.2 5.8a3.2 3.2 0 1 1-6.4 0c0-1.6 1.2-3.3 3.2-5.8Z"/>'),
  // 防护
  regolith: glyph('<path d="M5 30a15 11 0 0 1 30 0"/><path d="M3 30h34"/><path d="M13 30a7 6 0 0 1 14 0"/><path d="M9.5 24h21"/><path d="M12 18l2 2.2M28 18l-2 2.2M20 15v3"/>'),
  cave: glyph('<path d="M4 11h32"/><path d="M13 11l2 4 2-4M24 11l2 3 2-3"/><path d="M10 31v-6a10 8 0 0 1 20 0v6"/><path d="M8 31h24"/><circle cx="20" cy="27" r="1.8"/>'),
  hull: glyph('<path d="M20 5l12 4v9c0 8-5 12.5-12 16-7-3.5-12-8-12-16V9Z"/><path d="M20 10.5l7 2.4v6c0 4.7-3 7.6-7 9.7-4-2.1-7-5-7-9.7v-6Z"/>'),
  // 通信
  laser: glyph('<path d="M7 25a10 10 0 0 1 13-9"/><path d="M13.5 30l4-6.5"/><path d="M9 30h10"/><path d="M19.5 17.5L33 8M22 20.5L35.5 11.5M17 14.5L30.5 5.5"/>'),
  relay: glyph('<rect x="16" y="15" width="8" height="8" rx="1"/><path d="M16 19H9"/><rect x="4" y="16" width="5" height="6" rx="1"/><path d="M24 19h7"/><rect x="31" y="16" width="5" height="6" rx="1"/><path d="M5 31a19 8 0 0 1 30 0"/>'),
  direct: glyph('<path d="M20 33V16"/><path d="M15 33h10"/><circle cx="20" cy="14" r="2"/><path d="M14.5 9.5a8 8 0 0 1 11 0M11 5.5a13.5 13.5 0 0 1 18 0"/>'),
  // 生命
  closed_farm: glyph('<path d="M7 28a13 13 0 0 1 26 0"/><path d="M5 28h30"/><path d="M20 28v-6"/><path d="M20 22c-3.2 0-5.2-2.2-5.2-5.2 3.2 0 5.2 2.2 5.2 5.2Z"/><path d="M20 22c3.2 0 5.2-2.2 5.2-5.2-3.2 0-5.2 2.2-5.2 5.2Z"/><path d="M12.5 20a7.5 7.5 0 0 1 4-5.5"/>'),
  earth_food: glyph('<rect x="6" y="14" width="16" height="14" rx="2"/><path d="M6 20h16M14 14v6"/><circle cx="30" cy="24" r="4"/><path d="M30 20c0-2.2 1.6-3.4 3.2-3.6"/>'),
  algae: glyph('<path d="M14 6h12"/><path d="M17 6v20a3 3 0 0 0 6 0V6"/><path d="M17 17h6"/><circle cx="19.2" cy="23" r="1.2"/><circle cx="21.3" cy="26.5" r="1.5"/><circle cx="19.8" cy="30" r="1"/><path d="M28.5 13c1.8 0 3 1.2 3 3M31.5 9c2.4 0 4 1.6 4 4"/>'),
  // 运输
  hopper: glyph('<path d="M16 9h8l2.5 8h-13Z"/><path d="M14.5 17L10 25M25.5 17L30 25M20 17v6"/><path d="M17 25c0 3 1.2 4.5 3 6 1.8-1.5 3-3 3-6"/><path d="M5 31c2.5-1.6 5-1.6 7.5 0M27.5 31c2.5-1.6 5-1.6 7.5 0"/>'),
  mass_driver: glyph('<path d="M4 29h25M4 32.5h25"/><rect x="8" y="24" width="8" height="5" rx="1"/><path d="M27 25a15 15 0 0 1 8-9"/><circle cx="35.5" cy="15" r="1.5"/>'),
  cable: glyph('<path d="M4 9l32 6"/><path d="M20 12.4V20"/><rect x="15" y="20" width="10" height="8" rx="2"/><path d="M15 24h10"/><path d="M6 33h28"/>')
};

function renderAssembly(state) {
  if (!assemblyEl) return;
  const siteId = state.activeSite;
  if (!siteId) {
    assemblyEl.style.display = 'none';
    assemblyEl.innerHTML = '';
    assemblyMemory = { siteId: null, filled: {} };
    return;
  }
  assemblyEl.style.display = '';
  const decisions = getActiveDecisions(state);
  const meta = siteMeta[siteId];

  // 切换基地：按该基地 decisions 重渲染，不播降落动画
  const siteChanged = assemblyMemory.siteId !== siteId;
  if (siteChanged) assemblyMemory = { siteId, filled: {} };

  const filledNow = {};
  let deployedNew = false;

  const slotsHtml = steps.map(step => {
    const choiceId = decisions[step.key] || null;
    const prevChoice = assemblyMemory.filled[step.key] || null;
    if (choiceId) filledNow[step.key] = choiceId;
    const isNewDeploy = !siteChanged && !!choiceId && prevChoice !== choiceId;
    if (isNewDeploy) deployedNew = true;

    if (!choiceId) {
      return `<div class="ps-slot empty" data-step="${step.key}" title="${step.name} · 待部署">
        <span class="ps-slot-visual"><span class="ps-slot-sysicon">${STEP_ICONS[step.key] || '●'}</span></span>
        <span class="ps-slot-label">${STEP_SHORT[step.key] || step.name}</span>
      </div>`;
    }

    const opt = options[step.key]?.find(o => o.id === choiceId);
    const label = shortLabel(opt?.label || choiceId);
    return `<div class="ps-slot filled ${isNewDeploy ? 'deploy' : ''}" data-step="${step.key}" title="${step.name} · ${opt?.label || choiceId}">
      ${isNewDeploy ? '<span class="ps-slot-ring"></span>' : ''}
      <span class="ps-slot-visual">${OPTION_GLYPHS[choiceId] || `<span class="ps-slot-sysicon">${opt?.icon || '●'}</span>`}</span>
      <span class="ps-slot-label">${label}</span>
    </div>`;
  }).join('');

  assemblyEl.innerHTML = `
    <div class="ps-assembly-head">
      <span class="ps-assembly-title">基地装配带</span>
      <small>${meta?.name || siteId} · ${getCompletedSteps(decisions)}/${steps.length} 系统已部署 · 点击插槽可跳转</small>
    </div>
    <div class="ps-assembly-slots">${slotsHtml}</div>`;

  assemblyMemory = { siteId, filled: filledNow };
  if (deployedNew) fxSound('confirm');

  // 插槽点击跳转对应步骤（沿用已完成 chip 的方向约定）
  assemblyEl.querySelectorAll('.ps-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      if (isAnimating || commitLock) return;
      const stepKey = slot.dataset.step;
      const stateNow = getState();
      if (!stateNow.activeSite) return;
      const decisionsNow = getActiveDecisions(stateNow);
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      if (stepIndex < 0) return;
      const prev = steps[stepIndex - 1];
      if (prev && !decisionsNow[prev.key]) { fxSound('error'); return; }
      const activeIndex = getActiveStepIndex(decisionsNow);
      if (activeIndex === stepIndex) return;
      fxSound('select');
      goToStep(stepKey, stepIndex < activeIndex ? 1 : -1);
    });
  });
}

// —— 补给链路网络图（2D canvas，等距圆柱投影 + 流动虚线） ——

function stopNetworkLoop() {
  if (networkRafId != null) {
    cancelAnimationFrame(networkRafId);
    networkRafId = null;
  }
  networkCanvas = null;
  networkState = null;
  networkData = null;
}

function startNetworkLoop(canvas, state, net) {
  stopNetworkLoop();
  if (!canvas) return;
  networkCanvas = canvas;
  networkState = state;
  networkData = net;
  const tick = () => {
    networkRafId = null;
    if (!networkCanvas || !networkCanvas.isConnected) { stopNetworkLoop(); return; }
    drawNetwork(networkCanvas, networkState, networkData);
    networkDashOffset = (networkDashOffset + 0.5) % 100000;
    networkRafId = requestAnimationFrame(tick);
  };
  networkRafId = requestAnimationFrame(tick);
}

function linkLabel(link) {
  const amt = link.amount ?? 0;
  if (link.resource === 'water') return `+${amt}t水`;
  if (link.resource === 'power') return `+${amt}kW`;
  if (link.resource === 'food') return `+${amt}%食物`;
  return `+${amt}${link.unit || ''}`;
}

function renderNetworkPanel(state) {
  if (!networkEl) return;
  const planned = getPlannedList(state);
  if (planned.length < 2) {
    networkEl.style.display = 'none';
    networkEl.innerHTML = '';
    stopNetworkLoop();
    return;
  }
  networkEl.style.display = '';
  const net = currentNetwork;
  const sharing = !!net?.sharingEnabled;
  const score = net && typeof net.networkScore === 'number' ? net.networkScore : null;
  const baseCount = net?.bases?.length || planned.length;

  networkEl.innerHTML = `
    <div class="ps-net-head">
      <span class="ps-net-title">补给链路</span>
      <small>${baseCount} 个基地 · ${sharing ? '链路已建立' : '链路待建立'}</small>
    </div>
    <div class="ps-net-body">
      <canvas class="ps-net-canvas"></canvas>
      <div class="ps-net-side">
        <div class="ps-net-score">
          <span class="ps-net-score-value" data-net-score>${score == null ? '—' : score}</span>
          <span class="ps-net-score-label">网络评分</span>
        </div>
        <div class="ps-net-share">
          <div class="ps-net-share-row"><i class="ps-net-swatch water"></i>水共享<b>+${net?.waterShared_t ?? 0} t/年</b></div>
          <div class="ps-net-share-row"><i class="ps-net-swatch power"></i>电共享<b>+${net?.powerShared_kW ?? 0} kW</b></div>
          <div class="ps-net-share-row"><i class="ps-net-swatch food"></i>食物共享<b>+${Math.round((net?.foodShared_ratio ?? 0) * 100)}%</b></div>
        </div>
        ${!sharing ? `<div class="ps-net-offhint">${net ? '运输能力不足，链路未建立' : '网络数据暂不可用'}</div>` : ''}
      </div>
    </div>`;

  const scoreEl = networkEl.querySelector('[data-net-score]');
  if (score != null && scoreEl) {
    countUpOrSet(scoreEl, score, { from: prevNetworkScore, duration: 700, format: v => String(Math.round(v)) });
    prevNetworkScore = score;
  }

  startNetworkLoop(networkEl.querySelector('.ps-net-canvas'), state, net);
}

function drawNetwork(canvas, state, net) {
  const planned = getPlannedList(state);
  if (planned.length < 2) return;

  const cssW = canvas.clientWidth || 480;
  const cssH = canvas.clientHeight || 230;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // 等距圆柱投影：x = lon 映射，y = lat 映射（按已规划基地自适应取景）
  const metas = planned.map(id => siteMeta[id]).filter(m => m && typeof m.lon === 'number' && typeof m.lat === 'number');
  if (metas.length < 2) return;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  metas.forEach(m => {
    minLon = Math.min(minLon, m.lon); maxLon = Math.max(maxLon, m.lon);
    minLat = Math.min(minLat, m.lat); maxLat = Math.max(maxLat, m.lat);
  });
  const lonSpan = Math.max(maxLon - minLon, 40); // 最小跨度，避免极点集群过度放大
  const latSpan = Math.max(maxLat - minLat, 25);
  const lonC = (minLon + maxLon) / 2;
  const latC = (minLat + maxLat) / 2;
  const pad = 42;
  const project = (lon, lat) => {
    const x = pad + ((lon - (lonC - lonSpan / 2)) / lonSpan) * (cssW - pad * 2);
    const y = cssH - (pad + ((lat - (latC - latSpan / 2)) / latSpan) * (cssH - pad * 2));
    return [x, y];
  };
  const pos = {};
  planned.forEach(id => {
    const m = siteMeta[id];
    if (m && typeof m.lon === 'number') pos[id] = project(m.lon, m.lat);
  });

  // 背景网格
  ctx.strokeStyle = 'rgba(120, 180, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let gx = pad; gx < cssW; gx += 36) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, cssH); ctx.stroke();
  }
  for (let gy = pad; gy < cssH; gy += 36) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cssW, gy); ctx.stroke();
  }

  // 链路：贝塞尔弧线 + 流动虚线（from → to）
  const links = net?.links || [];
  links.forEach((link, i) => {
    const p0 = pos[link.from];
    const p1 = pos[link.to];
    if (!p0 || !p1) return;
    const color = LINK_COLORS[link.resource] || '#8ccaff';
    const mx = (p0[0] + p1[0]) / 2;
    const my = (p0[1] + p1[1]) / 2;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dist = Math.hypot(dx, dy) || 1;
    const sign = i % 2 === 0 ? -1 : 1;
    const off = Math.min(46, dist * 0.25) * sign;
    const cx = mx + (-dy / dist) * off;
    const cy = my + (dx / dist) * off;

    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.quadraticCurveTo(cx, cy, p1[0], p1[1]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -networkDashOffset;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // 方向箭头（指向 to）
    const tx = p1[0] - cx;
    const ty = p1[1] - cy;
    const tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl;
    const uy = ty / tl;
    const ax = p1[0] - ux * 10;
    const ay = p1[1] - uy * 10;
    ctx.beginPath();
    ctx.moveTo(ax + ux * 6, ay + uy * 6);
    ctx.lineTo(ax - uy * 3.4, ay + ux * 3.4);
    ctx.lineTo(ax + uy * 3.4, ay - ux * 3.4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // 数量标签（贝塞尔中点，t = 0.5）
    const lx = (p0[0] + 2 * cx + p1[0]) / 4;
    const ly = (p0[1] + 2 * cy + p1[1]) / 4;
    const label = linkLabel(link);
    ctx.font = '10px "Exo 2", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(6, 14, 24, 0.78)';
    ctx.fillRect(lx - tw / 2 - 4, ly - 8, tw + 8, 15);
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly);
  });

  // 节点：颜色 = 基地 tone，完成基地外圈环，当前基地白色虚线环
  planned.forEach(id => {
    const p = pos[id];
    if (!p) return;
    const color = siteTone(id);
    const baseInfo = net?.bases?.find(b => b.siteId === id);
    const isActive = id === state.activeSite;

    ctx.beginPath();
    ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (baseInfo?.completed) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (isActive) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.lineDashOffset = -networkDashOffset * 0.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = '11px "Exo 2", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(215, 237, 255, 0.9)';
    ctx.fillText(baseInfo?.name || siteMeta[id]?.name || id, p[0], p[1] + 16);
  });
}

// —— Stage / Single Card ——

function renderStage(state) {
  if (!planStage) return;

  renderCompletedSummary(state);

  if (!state.activeSite) {
    currentCardSiteId = null;
    renderNoSite();
    return;
  }

  // 切换基地后强制重建决策卡（规格标签 / 后果预览都按新基地取值）
  const siteChanged = currentCardSiteId !== state.activeSite;
  currentCardSiteId = state.activeSite;

  const decisions = getActiveDecisions(state);
  const activeIndex = getActiveStepIndex(decisions);

  if (activeIndex === -1) {
    switchToCard('__complete__', () => buildCompletionCard(getState()));
    return;
  }

  const activeStep = steps[activeIndex];
  const desiredCardKey = activeStep.key;

  if (!siteChanged && currentCardStepKey === desiredCardKey) return;

  const currentIndex = currentCardStepKey
    ? steps.findIndex(s => s.key === currentCardStepKey)
    : -1;
  const direction = siteChanged ? 0 : (currentIndex < activeIndex ? 1 : -1);
  switchToCard(desiredCardKey, () => buildActiveCard(activeStep), direction);
}

function renderNoSite() {
  if (completedSummary) completedSummary.innerHTML = '';
  switchToCard('__nosite__', () => buildNoSiteCard());
}

function buildNoSiteCard() {
  const card = document.createElement('div');
  card.className = 'decision-card decision-card-single active';
  card.innerHTML = `
    <div class="decision-card-placeholder">
      <h2>基地沙盘推演</h2>
      <p>点击上方控制台的「＋ 添加基地」开始规划，或返回首页从月面选择一个基地。最多可同时规划 ${MAX_BASES} 个基地并建立补给链路。</p>
      <a href="index.html" class="btn btn-primary">返回首页选择基地</a>
    </div>
  `;
  return card;
}

function renderCompletedSummary(state) {
  if (!completedSummary) return;
  if (!state.activeSite) {
    completedSummary.innerHTML = '';
    return;
  }
  const decisions = getActiveDecisions(state);
  const chips = [];
  steps.forEach((step, index) => {
    const choiceId = decisions[step.key];
    if (!choiceId) return;
    const choice = options[step.key].find(o => o.id === choiceId);
    if (!choice) return;
    chips.push(`
      <button class="completed-chip" data-step="${step.key}" title="点击修改">
        <span class="completed-chip-step">${index + 1}</span>
        <span class="completed-chip-icon">${choice.icon}</span>
        <span class="completed-chip-label">${choice.label}</span>
      </button>
    `);
  });

  completedSummary.innerHTML = chips.length
    ? `<div class="completed-chips">${chips.join('')}</div>`
    : '';

  completedSummary.querySelectorAll('.completed-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (isAnimating || commitLock) return;
      const stepKey = chip.dataset.step;
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      const activeIndex = getActiveStepIndex(getActiveDecisions(getState()));
      const direction = stepIndex < activeIndex ? 1 : -1;
      goToStep(stepKey, direction);
    });
  });
}

function buildActiveCard(step) {
  const stepIndex = steps.findIndex(s => s.key === step.key);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const activeSiteId = getState().activeSite;

  const card = document.createElement('div');
  card.className = 'decision-card decision-card-single active';

  card.innerHTML = `
    <div class="decision-step-number">步骤 ${stepIndex + 1} / ${steps.length}</div>
    <div class="decision-header">
      <div class="decision-name">${step.name}</div>
    </div>
    <div class="decision-desc">${step.description}</div>
    <div class="option-list" id="options-${step.key}"></div>
    <div class="outcome-preview" id="outcome-preview"><span class="preview-kicker">实时后果预览</span><span>悬停方案，查看它会如何改变当前基地。</span></div>
    <div class="decision-card-actions">
      ${!isFirst ? `<button class="btn btn-ghost card-back-btn" data-back>← 上一步</button>` : '<span></span>'}
      ${!isLast ? `<span class="decision-hint">选择一项以继续</span>` : `<span class="decision-hint">选择最后一项完成推演</span>`}
    </div>
  `;

  const optionList = card.querySelector(`#options-${step.key}`);
  options[step.key].forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="option-title">${opt.icon} ${opt.label}</span><span class="option-hint">${opt.hint}</span>${buildSpecsLine(step.key, opt.id, activeSiteId)}`;
    btn.addEventListener('click', () => {
      if (isAnimating || commitLock) return;
      // 决策手感：先 250ms 确认脉冲（边框点亮 + 轻微放大），再提交决策触发卡片切换
      commitLock = true;
      card.classList.add('ps-committing');
      btn.classList.add('ps-pulse');
      fxSound('select');
      window.setTimeout(() => {
        commitLock = false;
        setDecision(step.key, opt.id); // 契约：写入 activeSite
      }, 250);
    });
    btn.addEventListener('mouseenter', () => renderOutcomePreview(card, step.key, opt.id));
    btn.addEventListener('focus', () => renderOutcomePreview(card, step.key, opt.id));
    optionList.appendChild(btn);
    fxTilt(btn, { max: 5 });
  });

  const backBtn = card.querySelector('[data-back]');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (isAnimating || commitLock) return;
      const prevStep = steps[stepIndex - 1];
      if (prevStep) goToStep(prevStep.key, 1);
    });
  }

  return card;
}

// 选项规格标签：本站修正后的 质量 / 功率 / 风险 / 可持续，选择前即可横向对比
function buildSpecsLine(stepKey, choiceId, siteId) {
  const rule = siteId ? safeRule(stepKey, choiceId, siteId) : null;
  if (!rule) return '';
  const mass = rule.mass_t ?? 0;
  const power = (rule.powerBalance_kW ?? 0) - (rule.powerConsumption_kW ?? 0);
  const risk = Math.max(0, Math.min(3, rule.riskScore ?? 0));
  const sustain = rule.sustainability ?? 0;
  const dots = '●'.repeat(risk) + '○'.repeat(3 - risk);
  const sign = v => (v > 0 ? `+${v}` : `${v}`);
  return `<span class="ps-specs">
    <span class="ps-spec">质量<b>${sign(mass)}t</b></span>
    <span class="ps-spec">功率<b class="${power >= 0 ? 'pos' : 'neg'}">${sign(power)}kW</b></span>
    <span class="ps-spec">风险<b class="ps-risk">${dots}</b></span>
    <span class="ps-spec">可持续<b>♻×${sustain}</b></span>
  </span>`;
}

function renderOutcomePreview(card, stepKey, optionId) {
  const preview = card.querySelector('#outcome-preview');
  if (!preview) return;
  const state = getState();
  const siteId = state.activeSite;
  if (!siteId) return;
  const decisions = getActiveDecisions(state);
  const currentId = decisions[stepKey] || null;
  const nextRule = safeRule(stepKey, optionId, siteId);
  if (!nextRule) return;
  const curRule = currentId ? safeRule(stepKey, currentId, siteId) : null;
  const pw = r => (r?.powerBalance_kW ?? 0) - (r?.powerConsumption_kW ?? 0);
  const power = Math.round(pw(nextRule) - pw(curRule));
  const water = Math.round((nextRule.waterSupply_t_y ?? 0) - (curRule?.waterSupply_t_y ?? 0));
  const radiation = Math.round((nextRule.radiationDelta_mSv_y ?? 0) - (curRule?.radiationDelta_mSv_y ?? 0));
  const delta = value => `${value >= 0 ? '+' : ''}${value}`;
  preview.innerHTML = `<span class="preview-kicker">方案预测 · 未提交</span><div class="preview-metrics"><b>功率 ${delta(power)} kW</b><b>供水 ${delta(water)} t/年</b><b>辐射 ${delta(radiation)} mSv</b></div>`;
}

function buildCompletionCard(state) {
  const metrics = safeComputeMetrics(state);
  const viabilityClass = metrics && metrics.viabilityScore >= 70 ? 'good' : metrics && metrics.viabilityScore >= 45 ? 'warn' : 'bad';
  const directive = missionDirectives[getMissionDirective()];
  const missionPass = metrics && directive.test(metrics);
  const siteName = metrics?.siteName || siteMeta[state.activeSite]?.name || '';
  const netScore = currentNetwork && typeof currentNetwork.networkScore === 'number' ? currentNetwork.networkScore : null;

  // 6 步全部完成、完成卡片首次构建时播放完成音
  if (!completionSoundPlayed) {
    completionSoundPlayed = true;
    fxSound('complete');
  }

  const card = document.createElement('div');
  card.className = 'decision-card decision-card-single completion-card active';
  card.innerHTML = `
    <div class="completion-icon">🎉</div>
    <h2 class="completion-title">推演完成 · ${siteName}</h2>
    <p class="completion-desc">你已完成该基地全部 6 项核心决策，综合可行性评分为 <strong class="${viabilityClass}" data-ps-score>${metrics?.viabilityScore ?? '—'}/100</strong>。</p>
    <div class="completion-mission ${missionPass ? 'passed' : 'missed'}">${missionPass ? '✓' : '△'} ${directive.icon} ${directive.name}：${missionPass ? '任务达成' : '尚未达成'} <small>${directive.target}</small></div>
    ${netScore != null ? `<div class="ps-net-pill">🛰 基地网络评分 <strong data-ps-netscore>${netScore}</strong> / 100 <small>${currentNetwork.bases?.length || 0} 基地联动</small></div>` : ''}
    ${metrics && metrics.budgetOver_t > 0 ? `<div class="ps-budget-warn">⚠ 首年发射质量超出预算 ${metrics.budgetOver_t} t（${metrics.totalMass_t} / ${metrics.launchBudget_t} t），可行性评分已被扣减。</div>` : ''}
    ${metrics ? `
    <div class="ps-radar-block">
      <div class="ps-block-title">六维能力雷达</div>
      <canvas class="ps-radar" id="ps-radar-canvas"></canvas>
    </div>` : ''}
    <div class="ps-event-block">
      <div class="ps-block-title">任务事件推演</div>
      <p class="ps-event-hint">从事件牌堆随机抽取 2 张，按你的实际决策即时结算三档结果。</p>
      <button class="btn btn-secondary ps-roll-btn" id="ps-roll-events">🎲 掷出事件</button>
      <div class="ps-event-list" id="ps-event-list"></div>
    </div>
    <div class="completion-actions">
      <button class="btn btn-primary" id="generate-summary-btn">📊 生成可行性简报</button>
      <button class="btn btn-secondary" data-output="compare">⚖️ 多基地对比</button>
      <button class="btn btn-secondary" data-output="story">📖 基地一日</button>
      <button class="btn btn-secondary" data-output="poster">🚀 招募海报</button>
    </div>
    <button class="btn btn-ghost" id="completion-reset-btn" style="margin-top:1rem;width:100%;">重新推演</button>
  `;

  // 总分数字滚动（从上一次展示的分值起滚）
  const scoreEl = card.querySelector('[data-ps-score]');
  if (scoreEl && metrics) {
    countUpOrSet(scoreEl, metrics.viabilityScore, {
      from: prevCompletionScore,
      duration: 900,
      format: v => `${Math.round(v)}/100`
    });
    prevCompletionScore = metrics.viabilityScore;
  }

  // 网络评分数字滚动
  const netScoreEl = card.querySelector('[data-ps-netscore]');
  if (netScoreEl && netScore != null) {
    countUpOrSet(netScoreEl, netScore, {
      from: prevCompletionNetScore,
      duration: 900,
      format: v => String(Math.round(v))
    });
    prevCompletionNetScore = netScore;
  }

  // 六维雷达图（纯 canvas，无库）
  const radarCanvas = card.querySelector('#ps-radar-canvas');
  if (radarCanvas && metrics) drawRadar(radarCanvas, metrics);

  // 任务事件推演：掷出 2 张不重复事件卡（判定用 legacy 扁平状态）
  const rollBtn = card.querySelector('#ps-roll-events');
  const eventList = card.querySelector('#ps-event-list');
  rollBtn?.addEventListener('click', () => {
    fxSound('confirm');
    const stateNow = getState();
    renderEventCards(eventList, buildLegacyState(stateNow), safeComputeMetrics(stateNow));
  });

  card.querySelector('#generate-summary-btn')?.addEventListener('click', onRunAgentSummary);
  card.querySelectorAll('[data-output]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.output;
      if (type) runAgentOutput(type);
    });
  });
  card.querySelector('#completion-reset-btn')?.addEventListener('click', onResultReset);

  return card;
}

// ===== 任务事件推演（本地结算，不调 AI） =====
// 判定结果三档：0 化解 / 1 受损 / 2 重创
const EVENT_DECK = [
  {
    id: 'spe', icon: '☀️', name: '太阳质子事件（SPE）',
    brief: '一次强耀斑引发的高能质子流正在扑向月面，全体进入辐射应急程序。',
    judge(state) {
      const label = optionLabel('radiation', state.radiation);
      if (state.radiation === 'cave') return { tier: 0, text: `全员撤入熔岩管深处，「${label}」提供的天然岩层把剂量压到本底水平，任务零损失。` };
      if (state.radiation === 'regolith') return { tier: 1, text: `「${label}」的月壤覆盖层削弱了大部分质子通量，舱内仍录得短时剂量尖峰，部分舱段临时封闭 36 小时。` };
      return { tier: 1, text: `「${label}」的风暴掩体只防住了冲击峰值，未轮值乘员全部入掩体避险，舱外作业停摆一周。` };
    }
  },
  {
    id: 'moonquake', icon: '🌑', name: '浅源月震',
    brief: '月壳应力释放引发里氏 4 级月震，震中距基地仅 18 km。',
    judge(state) {
      const label = optionLabel('radiation', state.radiation);
      if (state.radiation === 'regolith') return { tier: 0, text: `「${label}」的覆土结构像减震垫一样吸收了应力波，舱体完好，仅货架物品散落。` };
      if (state.radiation === 'cave') return { tier: 2, text: `「${label}」的结构验证不足的代价显现了：管顶出现剥落碎屑，一支工程队被迫停工评估锚固方案。` };
      return { tier: 1, text: `「${label}」的刚性舱体把震动直接传导进生活区，连接件松动导致一处气闸报警，抢修 12 小时。` };
    }
  },
  {
    id: 'supply_delay', icon: '🚀', name: '补给船延期',
    brief: '地球发射窗口受天气影响，下一班补给船推迟 40 天抵达。',
    judge(state) {
      const waterLabel = optionLabel('water', state.water);
      const foodLabel = optionLabel('habitat', state.habitat);
      const weakWater = state.water === 'earth_supply';
      const weakFood = state.habitat === 'earth_food';
      if (weakWater && weakFood) return { tier: 2, text: `水源与食品同时依赖地球补给（「${waterLabel}」「${foodLabel}」），延期直接触发全站配给制，士气跌至冰点。` };
      if (weakWater || weakFood) return { tier: 1, text: `「${weakWater ? waterLabel : foodLabel}」依赖地球补给线，延期迫使基地启动定量配给，非必要舱段开始限水限电。` };
      return { tier: 0, text: `「${waterLabel}」与「${foodLabel}」构成就地闭环，补给船延期只影响备件库存，任务节奏不受干扰。` };
    }
  },
  {
    id: 'dust', icon: '🌫️', name: '月尘沾染',
    brief: '一场月尘扰动让静电悬浮的细尘覆盖了基地外露设备。',
    judge(state) {
      const label = optionLabel('energy', state.energy);
      if (state.energy === 'nuclear') return { tier: 0, text: `「${label}」深埋防护且无需采光，月尘对功率输出毫无影响，只需清扫散热器表面。` };
      if (state.energy === 'storage') return { tier: 1, text: `「${label}」的光伏板被月尘覆盖，充电效率下降约 10%，电解制氢节奏被迫放缓，需派出清扫队。` };
      return { tier: 1, text: `「${label}」的薄膜阵列被细尘覆盖，功率输出骤降近 20%，月夜前的储能窗口被压缩，基地进入节电模式。` };
    }
  },
  {
    id: 'equipment_failure', icon: '🔧', name: '关键设备故障',
    brief: '运输系统主控日志报警：核心部件出现不可忽略的异常磨损。',
    judge(state) {
      const label = optionLabel('transport', state.transport);
      if (state.transport === 'mass_driver') return { tier: 2, text: `「${label}」的主驱动绕组烧毁，这条大宗货运动脉停摆，地面备件不足以就地修复，需等待下一班补给。` };
      if (state.transport === 'hopper') return { tier: 1, text: `一架「${label}」着陆腿作动器失效，机队其余单元维持运营，但勘探半径被迫收缩一半。` };
      return { tier: 0, text: `「${label}」结构简单、备件通用，故障驱动轮在 48 小时内完成更换，运输节律很快恢复。` };
    }
  },
  {
    id: 'psych', icon: '🧠', name: '乘员心理危机',
    brief: '长期封闭环境的压力开始显现，值班日志记录了多起情绪冲突。',
    judge(state, metrics) {
      const commLabel = optionLabel('communication', state.communication);
      const crew = CREW_OPTIONS.includes(state.crew) ? state.crew : 12;
      let tier = (metrics?.commScore ?? 0) >= 80 ? 0 : 1;
      if (crew >= 50) tier += 1;             // 大社区摩擦更多
      if (state.habitat === 'closed_farm') tier -= 1; // 农场绿意有安抚作用
      tier = Math.max(0, Math.min(2, tier));
      const texts = [
        `${crew} 名乘员依托「${commLabel}」的稳定高带宽链路与地球家人连线，情绪波动在远程心理干预下很快平复。`,
        `「${commLabel}」的链路时断时续，${crew} 名乘员中开始出现睡眠障碍与摩擦，任务管制中心被迫调整轮班与作息。`,
        `${crew} 人的封闭社区里矛盾被持续放大，「${commLabel}」无法提供稳定的心理支持通道，一名乘员不得不提前撤离。`
      ];
      return { tier, text: texts[tier] };
    }
  },
  {
    id: 'micrometeorite', icon: '☄️', name: '微陨石撞击',
    brief: '一颗 2 cm 级微陨石击中基地外围结构，撞击点腾起细小尘雾。',
    judge(state) {
      const label = optionLabel('radiation', state.radiation);
      if (state.radiation === 'cave') return { tier: 0, text: `撞击发生在「${label}」的岩层顶盖上方，天然屏蔽层把冲击完全挡在生活区之外。` };
      if (state.radiation === 'regolith') return { tier: 0, text: `「${label}」的覆土层同时充当了惠普尔防护屏，微陨石在月壤中解体，舱体零损伤。` };
      return { tier: 1, text: `「${label}」的舱壁被击穿出一个小孔，舱压报警触发，乘员按预案完成紧急修补，一批外露线缆报废。` };
    }
  },
  {
    id: 'comm_blackout', icon: '📡', name: '通信中断',
    brief: '地月链路突然中断，基地与任务管制中心失去联系。',
    judge(state) {
      const label = optionLabel('communication', state.communication);
      if (state.communication === 'relay') return { tier: 0, text: `「${label}」的多跳链路自动切换备份路由，中断仅持续 90 秒，地面甚至没察觉异常。` };
      if (state.communication === 'laser') return { tier: 1, text: `「${label}」的精密指向机构需要重新捕获目标，链路中断 6 小时，科学数据回传排队积压。` };
      return { tier: 1, text: `「${label}」的单一直联链路中断后没有备份，基地失联 14 小时，只能按预案自主运行等待窗口。` };
    }
  }
];

function optionLabel(stepKey, choiceId) {
  return options[stepKey]?.find(o => o.id === choiceId)?.label || '未部署';
}

function rollEventCards(state) {
  const pool = [...EVENT_DECK];
  const picked = [];
  while (picked.length < 2 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

function renderEventCards(listEl, legacyState, metrics) {
  if (!listEl) return;
  const badges = [
    '<span class="ps-badge ps-ok">✓ 化解</span>',
    '<span class="ps-badge ps-hit">△ 受损</span>',
    '<span class="ps-badge ps-down">✕ 重创</span>'
  ];
  listEl.innerHTML = rollEventCards(legacyState).map(ev => {
    const r = ev.judge(legacyState, metrics);
    return `
      <div class="ps-event-card">
        <div class="ps-event-head"><span class="ps-event-icon">${ev.icon}</span><strong>${ev.name}</strong>${badges[r.tier]}</div>
        <p class="ps-event-brief">${ev.brief}</p>
        <p class="ps-event-result">${r.text}</p>
      </div>`;
  }).join('');
}

// ===== 六维能力雷达图（纯 canvas，无库） =====
function buildRadarAxes(metrics) {
  const energy = Math.min(100, Math.max(0, metrics.powerSurplus_kW + 30));
  const water = metrics.waterBalance_t_y < 0 ? 0 : Math.min(100, 30 + Math.min(1, metrics.waterBalance_t_y / 500) * 70);
  const radiation = Math.min(100, Math.max(0, (400 - metrics.radiation_mSv_y) / 395 * 100));
  const comm = Math.min(100, Math.max(0, metrics.commScore));
  const life = Math.min(100, Math.max(0, metrics.foodSupportRatio * 100));
  const transport = Math.min(100, Math.max(0, metrics.transportCapacity));
  return [
    { label: '能源', value: energy },
    { label: '水源', value: water },
    { label: '辐射', value: radiation },
    { label: '通信', value: comm },
    { label: '生命', value: life },
    { label: '运输', value: transport }
  ];
}

function drawRadar(canvas, metrics) {
  const size = 300;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 42; // 给轴标签留边
  const axes = buildRadarAxes(metrics);
  const n = axes.length;
  const angleAt = i => -Math.PI / 2 + (Math.PI * 2 * i) / n;
  const pointAt = (i, r) => [cx + Math.cos(angleAt(i)) * r, cy + Math.sin(angleAt(i)) * r];

  // 网格圈
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [x, y] = pointAt(i % n, radius * ring / 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 轴线
  for (let i = 0; i < n; i++) {
    const [x, y] = pointAt(i, radius);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.18)';
    ctx.stroke();
  }

  // 数值多边形（半透明填充 + 冷光描边）
  ctx.beginPath();
  axes.forEach((a, i) => {
    const [x, y] = pointAt(i, radius * (a.value / 100));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 212, 255, 0.16)';
  ctx.fill();
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(0, 212, 255, 0.55)';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 顶点
  axes.forEach((a, i) => {
    const [x, y] = pointAt(i, radius * (a.value / 100));
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#8ccaff';
    ctx.fill();
  });

  // 轴标签
  ctx.font = '12px "Exo 2", "Noto Sans SC", sans-serif';
  ctx.fillStyle = '#9aa0a8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  axes.forEach((a, i) => {
    const [x, y] = pointAt(i, radius + 20);
    ctx.fillText(a.label, x, y);
  });
}

function goToStep(stepKey, direction = 1) {
  const step = steps.find(s => s.key === stepKey);
  if (!step) return;
  switchToCard(stepKey, () => buildActiveCard(step), direction);
}

function switchToCard(key, buildCardFn, direction = 0) {
  if (!decisionCardWrapper) return;
  if (isAnimating) {
    // 等待当前动画结束后再切换（由 animationend 自动触发重渲染）
    pendingSwitch = { key, buildCardFn, direction };
    return;
  }

  const current = decisionCardWrapper.querySelector('.decision-card-single');
  const next = buildCardFn();
  if (!next) return;

  currentCardStepKey = key;

  if (!current) {
    decisionCardWrapper.innerHTML = '';
    decisionCardWrapper.appendChild(next);
    return;
  }

  isAnimating = true;
  next.classList.add('card-initial');
  decisionCardWrapper.appendChild(next);

  // 强制同步布局，确保下一帧同时开始两个动画
  void next.offsetWidth;

  const exitClass = direction > 0 ? 'exit-left' : 'exit-right';
  const enterClass = direction > 0 ? 'enter-right' : 'enter-left';

  current.classList.add('card-exit', exitClass);
  next.classList.remove('card-initial');
  next.classList.add('card-enter', enterClass);

  const onNextEnd = (e) => {
    if (e.target !== next) return;
    next.removeEventListener('animationend', onNextEnd);
    current.remove();
    next.classList.remove('card-enter', enterClass);
    isAnimating = false;
    if (pendingSwitch) {
      const p = pendingSwitch;
      pendingSwitch = null;
      switchToCard(p.key, p.buildCardFn, p.direction);
    }
  };

  next.addEventListener('animationend', onNextEnd);
}

// —— Agent Outputs ——

const OUTPUT_TITLES = {
  summary: '基地可行性简报',
  story: '基地一日',
  poster: '招募海报文案',
  compare: '多基地对比报告'
};

async function runAgentOutput(type) {
  if (isGenerating) return;
  isGenerating = true;

  const btn = document.getElementById('generate-summary-btn');
  const originalText = btn?.textContent || '生成';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'AI 思考中…';
  }

  const state = getState();
  const metrics = safeComputeMetrics(state);

  try {
    let text = '';
    if (type === 'summary') {
      text = await generateSummary(buildLegacyState(state));
    } else if (type === 'story') {
      text = await generateStory(buildLegacyState(state));
    } else if (type === 'poster') {
      text = await generatePoster(buildLegacyState(state));
    } else if (type === 'compare') {
      text = await compareBases(buildPlannedSiteStates(state));
    }
    showResult(markdownToHtml(text), OUTPUT_TITLES[type] || 'AI 产出');
  } catch (err) {
    console.warn('后端 Agent 失败，使用本地推演结果：', err);
    if (type === 'summary') {
      showResult(markdownToHtml(buildLocalSummary(state, metrics)), '基地可行性简报');
    } else if (type === 'compare') {
      showResult(markdownToHtml(buildLocalCompare(state)), '多基地对比报告');
    } else {
      showResult(markdownToHtml(`**AI 服务暂不可用**\n\n${err.message}\n\n请稍后重试，或检查 DEEPSEEK_API_KEY 配置。`), '提示');
    }
  } finally {
    isGenerating = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function onSuggestNext() {
  const state = getState();
  const decisions = getActiveDecisions(state);
  if (!state.activeSite || isDecisionComplete(decisions)) return;
  appendMessage('agent', '正在分析当前配置并给出建议…');
  try {
    const text = await suggestNext(buildLegacyState(state));
    appendMessage('agent', text);
  } catch (err) {
    appendMessage('agent', `建议失败：${err.message}`);
  }
}

function buildLocalSummary(state, metrics) {
  if (!metrics) return '# 基地可行性简报\n\n当前基地指标暂不可用。';
  const decisions = getActiveDecisions(state);
  const lines = [
    `# ${metrics.siteName}基地可行性简报`,
    ``,
    `## 配置摘要`,
    `- 选址：${metrics.siteName}`,
    ...steps.map(s => `- ${s.name}：${options[s.key].find(o => o.id === decisions[s.key])?.label || '未选择'}`),
    ``,
    `## 关键指标`,
    `- 综合可行性：${metrics.viabilityScore}/100`,
    `- 常驻乘员：${metrics.crewCount} 人`,
    `- 能源结余：${metrics.powerSurplus_kW > 0 ? '+' : ''}${metrics.powerSurplus_kW} kW（乘员用电 ${metrics.powerDemand_kW} kW 已计入）`,
    `- 总部署质量：${metrics.totalMass_t} t`,
    `- 发射质量预算：${metrics.totalMass_t}/${metrics.launchBudget_t} t（占用 ${Math.round(metrics.budgetUsage * 100)}%${metrics.budgetOver_t > 0 ? `，超支 ${metrics.budgetOver_t} t` : ''}）`,
    `- 年供水量：${metrics.waterSupply_t_y} t`,
    `- 水供需平衡：${metrics.waterBalance_t_y >= 0 ? '+' : ''}${metrics.waterBalance_t_y} t/年（需求 ${Math.round(metrics.waterDemand_t_y)} t/年）`,
    `- 年辐射剂量：${metrics.radiation_mSv_y} mSv`,
    `- 通信评分：${metrics.commScore}`,
    `- 食品自给率：${metrics.foodSelfSufficiency}%（可支撑比例 ${(metrics.foodSupportRatio * 100).toFixed(0)}%）`,
    `- 运输能力：${metrics.transportCapacity}`,
    `- 综合风险：${metrics.riskScore}/18`,
    `- 可持续性：${metrics.sustainability}/30`,
    ``,
    `## 结论`,
    metrics.viabilityScore >= 60
      ? '当前配置在选定基地具备基本可行性，建议进入详细工程设计阶段。'
      : '当前配置存在明显短板（能源、辐射、水源或自持能力），建议调整选项以提升生存能力。',
    ``,
    '> 本简报由前端规则表生成；接入 DeepSeek 后将由 AI 基于领域知识进一步润色与分析。'
  ];
  return lines.join('\n');
}

function buildLocalCompare(state) {
  const planned = getPlannedList(state);
  const rows = planned
    .map(siteId => ({ siteId, metrics: siteMetrics(state, siteId) }))
    .filter(r => r.metrics);

  if (!rows.length) {
    return '# 多基地对比报告（本地推演）\n\n暂无可对比的基地，请先在控制台添加基地。';
  }

  const lines = [
    '# 多基地对比报告（本地推演）',
    '',
    planned.length >= 2
      ? `基于你已规划的 ${planned.length} 个基地，各自的推演结果如下：`
      : '目前只规划了 1 个基地，结果如下（在控制台「＋ 添加基地」后可进行横向对比）：',
    ''
  ];
  rows.forEach(({ siteId, metrics: m }) => {
    const d = getSiteDecisions(state, siteId) || {};
    lines.push(`## ${m.siteName}（${getCompletedSteps(d)}/${steps.length} 系统已部署）`);
    lines.push(`- 综合可行性：${m.viabilityScore}/100`);
    lines.push(`- 能源结余：${m.powerSurplus_kW > 0 ? '+' : ''}${m.powerSurplus_kW} kW`);
    lines.push(`- 年供水量：${m.waterSupply_t_y} t`);
    lines.push(`- 年辐射：${m.radiation_mSv_y} mSv`);
    lines.push(`- 可持续：${m.sustainability}/30`);
    lines.push('');
  });
  const best = [...rows].sort((a, b) => b.metrics.viabilityScore - a.metrics.viabilityScore)[0];
  lines.push(`## 推荐`);
  lines.push(`综合评分最高的是 **${best.metrics.siteName}**，得分为 ${best.metrics.viabilityScore}/100。接入 AI 后将获得更详细的选址理由与风险分析。`);
  return lines.join('\n');
}

function showResult(html, title) {
  if (!resultPanel || !resultTitle) return;
  resultTitle.textContent = title || 'AI 产出';
  resultBody.innerHTML = html;
  resultPanel.classList.add('visible');
}

function hideResult() {
  if (resultPanel) resultPanel.classList.remove('visible');
}

function markdownToHtml(md) {
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h3>$1</h3>')
    .replace(/^# (.*$)/gim, '<h2>$1</h2>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>');

  const blocks = html.split(/\n\s*\n/);
  const out = [];
  blocks.forEach(block => {
    block = block.trim();
    if (!block) return;
    if (/^<h[1-6]/.test(block)) {
      out.push(block);
      return;
    }
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length && lines.every(l => l.startsWith('<li>'))) {
      out.push('<ul>' + lines.join('') + '</ul>');
    } else {
      out.push('<p>' + lines.join('<br>') + '</p>');
    }
  });

  return out.join('');
}

// Agent chat
function appendMessage(role, text) {
  if (!chatMessages) return;
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  msg.textContent = text;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTyping() {
  if (!chatMessages) return;
  const el = document.createElement('div');
  el.className = 'message agent typing';
  el.id = 'chat-typing';
  el.textContent = 'AI 正在思考…';
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('chat-typing');
  if (el) el.remove();
}

async function sendChat() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  appendMessage('user', text);
  showTyping();
  if (chatSend) chatSend.disabled = true;

  try {
    const answer = await askAgent(buildLegacyState(getState()), text);
    removeTyping();
    appendMessage('agent', answer || '（AI 没有返回内容）');
  } catch (err) {
    removeTyping();
    appendMessage('agent', `请求失败：${err.message}`);
  } finally {
    if (chatSend) chatSend.disabled = false;
  }
}
