import {
  baseState,
  subscribe,
  setSite,
  setDecision,
  setCrew,
  resetGame,
  getState,
  steps,
  options,
  computeMetrics,
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

let isGenerating = false;
let unsubscribe = null;
let currentCardStepKey = null;
let isAnimating = false;
let pendingSwitch = null;
let prevTopbarMetrics = null;   // 上一次渲染的 topbar 数值（countUp 的 from）
let wasOverBudget = false;      // 预算「内 → 超」跳变检测
let completionSoundPlayed = false; // 完成音效只在首次构建时播放
let prevCompletionScore = 0;    // 完成卡片总分的滚动起点

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
  resolveSiteFromUrl();
  bindEvents();
  unsubscribe = subscribe(render);
  const state = getState();
  render(state);
  if (state.site) {
    if (highlightSite) highlightSite(state.site);
    if (updateDecisionOverlays) updateDecisionOverlays(state);
  }
}

function cleanup() {
  unbindEvents();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  isGenerating = false;
  currentCardStepKey = null;
  isAnimating = false;
}

// 注册页面生命周期（由 navigator.js 通过 window.__pageModules 调用）
window.__pageModules = window.__pageModules || {};
window.__pageModules["plan"] = { init: init, cleanup: cleanup };

function resolveSiteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const siteFromUrl = params.get('site');
  if (siteFromUrl && siteMeta[siteFromUrl]) {
    setSite(siteFromUrl);
  }
}

function getActiveStepIndex(state) {
  if (!state.site) return -1;
  return steps.findIndex(s => !state[s.key]);
}

function getStepStatus(state, step, index) {
  const prev = steps[index - 1];
  const isUnlocked = !prev || state[prev.key];
  const isDone = !!state[step.key];
  const isActive = isUnlocked && !isDone;
  return { isUnlocked, isDone, isActive };
}

function render(state) {
  renderTopBar(state);
  renderMissionConsole(state);
  renderStage(state);
  if (updateDecisionOverlays) updateDecisionOverlays(state);
  checkBudgetTransition(state);
  if (!(state.site && isDecisionComplete(state))) {
    completionSoundPlayed = false;
    prevCompletionScore = 0;
  }
}

// 首次从预算内变为超预算时播放错误音
function checkBudgetTransition(state) {
  const metrics = computeMetrics(state);
  const over = !!(metrics && metrics.budgetOver_t > 0);
  if (over && !wasOverBudget) fxSound('error');
  wasOverBudget = over;
}

function renderMissionConsole(state) {
  if (!missionConsole) return;
  const activeId = getMissionDirective();
  const active = missionDirectives[activeId];
  const metrics = computeMetrics(state);
  const completed = getCompletedSteps(state);
  const isPassing = metrics && active.test(metrics);
  const alert = completed < 2 ? null : buildMissionAlert(state, metrics);
  const crew = CREW_OPTIONS.includes(state.crew) ? state.crew : 12;

  missionConsole.innerHTML = `
    <div class="mission-console-inner">
      <div class="mission-console-title"><span class="signal-dot"></span><span>MISSION CONTROL</span><small>选择本轮推演的首要任务</small></div>
      <div class="mission-directives">
        ${Object.entries(missionDirectives).map(([id, item]) => `
          <button class="mission-directive ${id === activeId ? 'selected' : ''}" data-directive="${id}">
            <span>${item.icon}</span><strong>${item.name}</strong><em>${item.target}</em>
          </button>`).join('')}
      </div>
      <div class="mission-status ${state.site ? (isPassing ? 'on-track' : 'at-risk') : ''}">
        <span>${state.site ? (isPassing ? '● 任务指标已达成' : '◌ 任务指标待校准') : '◌ 选择基地后启动任务'}</span>
        <small>${state.site ? `${completed} / ${steps.length} 系统已部署 · ${active.brief}` : '三种指令会给出不同的成功判定。'}</small>
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
    </div>`;

  missionConsole.querySelectorAll('[data-directive]').forEach(btn => btn.addEventListener('click', () => setMissionDirective(btn.dataset.directive)));
  missionConsole.querySelectorAll('[data-crew]').forEach(btn => btn.addEventListener('click', () => setCrew(Number(btn.dataset.crew))));
}

function buildMissionAlert(state, metrics) {
  if (state.energy === 'solar' && metrics.powerSurplus_kW < 20) return { title: '月夜储能窗口偏窄', detail: '当前能源方案缺少冗余；后续交通与生命维持会继续占用功率。' };
  if (state.water === 'earth_supply') return { title: '补给线压力上升', detail: '当前水源依赖地球运输，建议用生命维持方案提高闭环能力。' };
  if (state.radiation === 'hull') return { title: '银河宇宙线暴露偏高', detail: '加厚舱壁能快速部署，但长驻任务仍需要额外屏蔽策略。' };
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
  if (!state.site) {
    topbarSite.innerHTML = `<div class="topbar-site-placeholder">尚未选择基地</div>`;
    return;
  }

  const base = bases.find(b => b.id === state.site);
  const meta = siteMeta[state.site];
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
  const metrics = computeMetrics(state);
  if (!metrics || !state.site) {
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
  const hasSite = !!state.site;
  const stepIcons = { energy: '⚡', water: '💧', radiation: '🛡️', communication: '📡', habitat: '🌱', transport: '🚀' };
  const stepLabels = { energy: '能源', water: '水源', radiation: '防护', communication: '通信', habitat: '生命', transport: '运输' };

  let html = '';
  steps.forEach((step, i) => {
    const { isDone, isActive } = getStepStatus(state, step, i);

    let statusClass = 'locked';
    if (isDone) statusClass = 'done';
    else if (isActive) statusClass = 'active';

    const icon = stepIcons[step.key] || '●';
    const label = stepLabels[step.key] || step.name;

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
      if (!stepKey || isAnimating) return;
      const currentState = getState();
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      const prev = steps[stepIndex - 1];
      const isUnlocked = !!currentState.site && (!prev || !!currentState[prev.key]);
      if (!isUnlocked) return;
      goToStep(stepKey, stepIndex < getActiveStepIndex(currentState) ? 1 : -1);
    });
  });
}

// —— Stage / Single Card ——

function renderStage(state) {
  if (!planStage) return;

  renderCompletedSummary(state);

  if (!state.site) {
    renderNoSite();
    return;
  }

  const activeIndex = getActiveStepIndex(state);

  if (activeIndex === -1) {
    switchToCard('__complete__', () => buildCompletionCard(state));
    return;
  }

  const activeStep = steps[activeIndex];
  const desiredCardKey = activeStep.key;

  if (currentCardStepKey === desiredCardKey) return;

  const currentIndex = currentCardStepKey
    ? steps.findIndex(s => s.key === currentCardStepKey)
    : -1;
  const direction = currentIndex < activeIndex ? 1 : -1;
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
      <p>为选定的月面基地完成 6 项核心决策，即可解锁 AI 深度产出。</p>
      <a href="index.html" class="btn btn-primary">返回首页选择基地</a>
    </div>
  `;
  return card;
}

function renderCompletedSummary(state) {
  if (!completedSummary) return;
  const chips = [];
  steps.forEach((step, index) => {
    const choiceId = state[step.key];
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
      if (isAnimating) return;
      const stepKey = chip.dataset.step;
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      const activeIndex = getActiveStepIndex(getState());
      const direction = stepIndex < activeIndex ? 1 : -1;
      goToStep(stepKey, direction);
    });
  });
}

function buildActiveCard(step) {
  const stepIndex = steps.findIndex(s => s.key === step.key);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

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
    btn.innerHTML = `<span class="option-title">${opt.icon} ${opt.label}</span><span class="option-hint">${opt.hint}</span>`;
    btn.addEventListener('click', () => {
      if (isAnimating) return;
      setDecision(step.key, opt.id);
      if (getState()[step.key] === opt.id) fxSound('select');
    });
    btn.addEventListener('mouseenter', () => renderOutcomePreview(card, step.key, opt.id));
    btn.addEventListener('focus', () => renderOutcomePreview(card, step.key, opt.id));
    optionList.appendChild(btn);
    fxTilt(btn, { max: 5 });
  });

  const backBtn = card.querySelector('[data-back]');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (isAnimating) return;
      const prevStep = steps[stepIndex - 1];
      if (prevStep) goToStep(prevStep.key, 1);
    });
  }

  return card;
}

function renderOutcomePreview(card, stepKey, optionId) {
  const preview = card.querySelector('#outcome-preview');
  if (!preview) return;
  const now = computeMetrics(getState());
  const trial = { ...getState(), [stepKey]: optionId };
  const next = computeMetrics(trial);
  if (!next) return;
  const delta = (value, before, unit) => `${value >= 0 ? '+' : ''}${value}${unit}`;
  const power = next.powerSurplus_kW - (now?.powerSurplus_kW || 0);
  const water = next.waterSupply_t_y - (now?.waterSupply_t_y || 0);
  const radiation = next.radiation_mSv_y - (now?.radiation_mSv_y || 0);
  preview.innerHTML = `<span class="preview-kicker">方案预测 · 未提交</span><div class="preview-metrics"><b>功率 ${delta(power, now?.powerSurplus_kW, ' kW')}</b><b>供水 ${delta(water, now?.waterSupply_t_y, ' t/年')}</b><b>辐射 ${delta(radiation, now?.radiation_mSv_y, ' mSv')}</b></div>`;
}

function buildCompletionCard(state) {
  const metrics = computeMetrics(state);
  const viabilityClass = metrics && metrics.viabilityScore >= 70 ? 'good' : metrics && metrics.viabilityScore >= 45 ? 'warn' : 'bad';
  const directive = missionDirectives[getMissionDirective()];
  const missionPass = metrics && directive.test(metrics);

  // 6 步全部完成、完成卡片首次构建时播放完成音
  if (!completionSoundPlayed) {
    completionSoundPlayed = true;
    fxSound('complete');
  }

  const card = document.createElement('div');
  card.className = 'decision-card decision-card-single completion-card active';
  card.innerHTML = `
    <div class="completion-icon">🎉</div>
    <h2 class="completion-title">推演完成</h2>
    <p class="completion-desc">你已完成全部 6 项核心决策，综合可行性评分为 <strong class="${viabilityClass}" data-ps-score>${metrics?.viabilityScore ?? '—'}/100</strong>。</p>
    <div class="completion-mission ${missionPass ? 'passed' : 'missed'}">${missionPass ? '✓' : '△'} ${directive.icon} ${directive.name}：${missionPass ? '任务达成' : '尚未达成'} <small>${directive.target}</small></div>
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

  // 六维雷达图（纯 canvas，无库）
  const radarCanvas = card.querySelector('#ps-radar-canvas');
  if (radarCanvas && metrics) drawRadar(radarCanvas, metrics);

  // 任务事件推演：掷出 2 张不重复事件卡
  const rollBtn = card.querySelector('#ps-roll-events');
  const eventList = card.querySelector('#ps-event-list');
  rollBtn?.addEventListener('click', () => {
    fxSound('confirm');
    renderEventCards(eventList, getState());
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

function renderEventCards(listEl, state) {
  if (!listEl) return;
  const metrics = computeMetrics(state);
  const badges = [
    '<span class="ps-badge ps-ok">✓ 化解</span>',
    '<span class="ps-badge ps-hit">△ 受损</span>',
    '<span class="ps-badge ps-down">✕ 重创</span>'
  ];
  listEl.innerHTML = rollEventCards(state).map(ev => {
    const r = ev.judge(state, metrics);
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
  const metrics = computeMetrics(state);

  try {
    let text = '';
    if (type === 'summary') {
      text = await generateSummary({ ...state, metrics });
    } else if (type === 'story') {
      text = await generateStory({ ...state, metrics });
    } else if (type === 'poster') {
      text = await generatePoster({ ...state, metrics });
    } else if (type === 'compare') {
      const states = buildAllSiteStates(state);
      text = await compareBases(states);
    }
    showResult(markdownToHtml(text), OUTPUT_TITLES[type] || 'AI 产出');
  } catch (err) {
    console.warn('后端 Agent 失败，使用本地推演结果：', err);
    if (type === 'summary') {
      showResult(markdownToHtml(buildLocalSummary(state, metrics)), '基地可行性简报');
    } else if (type === 'compare') {
      showResult(markdownToHtml(buildLocalCompare(state, metrics)), '多基地对比报告');
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

function buildAllSiteStates(currentState) {
  return bases.map(base => {
    const alt = { ...currentState, site: base.id };
    return { ...alt, metrics: computeMetrics(alt) };
  });
}

async function onSuggestNext() {
  const state = getState();
  if (!state.site || isDecisionComplete(state)) return;
  appendMessage('agent', '正在分析当前配置并给出建议…');
  try {
    const text = await suggestNext({ ...state, metrics: computeMetrics(state) });
    appendMessage('agent', text);
  } catch (err) {
    appendMessage('agent', `建议失败：${err.message}`);
  }
}

function buildLocalSummary(state, metrics) {
  const lines = [
    `# ${metrics.siteName}基地可行性简报`,
    ``,
    `## 配置摘要`,
    `- 选址：${metrics.siteName}`,
    ...steps.map(s => `- ${s.name}：${options[s.key].find(o => o.id === state[s.key])?.label || '未选择'}`),
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

function buildLocalCompare(currentState, currentMetrics) {
  const lines = [
    '# 多基地对比报告（本地推演）',
    '',
    '基于你当前六大决策，在不同基地的推演结果如下：',
    ''
  ];
  buildAllSiteStates(currentState).forEach(st => {
    const m = st.metrics;
    lines.push(`## ${m.siteName}`);
    lines.push(`- 综合可行性：${m.viabilityScore}/100`);
    lines.push(`- 能源结余：${m.powerSurplus_kW > 0 ? '+' : ''}${m.powerSurplus_kW} kW`);
    lines.push(`- 年供水量：${m.waterSupply_t_y} t`);
    lines.push(`- 年辐射：${m.radiation_mSv_y} mSv`);
    lines.push(`- 可持续：${m.sustainability}/30`);
    lines.push('');
  });
  const best = buildAllSiteStates(currentState).sort((a, b) => b.metrics.viabilityScore - a.metrics.viabilityScore)[0];
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
    const state = getState();
    const answer = await askAgent({ ...state, metrics: computeMetrics(state) }, text);
    removeTyping();
    appendMessage('agent', answer || '（AI 没有返回内容）');
  } catch (err) {
    removeTyping();
    appendMessage('agent', `请求失败：${err.message}`);
  } finally {
    if (chatSend) chatSend.disabled = false;
  }
}
