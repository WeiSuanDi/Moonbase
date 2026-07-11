import {
  baseState,
  subscribe,
  setSite,
  setDecision,
  resetGame,
  getState,
  steps,
  options,
  computeMetrics,
  siteMeta,
  getSiteDifficulty,
  isDecisionComplete,
  getCompletedSteps
} from './state.js';
import { bases, highlightSite, updateDecisionOverlays } from './moon-render.js';
import { askAgent, generateSummary, compareBases, generateStory, generatePoster, suggestNext } from './agent-client.js';

// DOM refs（每次 init 时重新查询）
let planTopBar, topbarSite, progressPipeline, topbarStats;
let planStage, completedSummary, decisionCardWrapper;
let resultPanel, resultTitle, resultBody, resultClose, resultReset;
let agentFab, agentChat, chatClose, chatMessages, chatInput, chatSend, chatChips;

let isGenerating = false;
let unsubscribe = null;
let currentCardStepKey = null;
let isAnimating = false;
let pendingSwitch = null;

function queryDom() {
  planTopBar = document.getElementById('plan-top-bar');
  topbarSite = document.getElementById('topbar-site');
  progressPipeline = document.getElementById('progress-pipeline');
  topbarStats = document.getElementById('topbar-stats');

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
  renderStage(state);
  if (updateDecisionOverlays) updateDecisionOverlays(state);
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
    return;
  }

  const viabilityClass = metrics.viabilityScore >= 70 ? 'good' : metrics.viabilityScore >= 45 ? 'warn' : 'bad';
  const powerClass = metrics.powerSurplus_kW >= 30 ? 'good' : metrics.powerSurplus_kW >= 0 ? 'warn' : 'bad';
  const radiationClass = metrics.radiation_mSv_y <= 100 ? 'good' : metrics.radiation_mSv_y <= 200 ? 'warn' : 'bad';
  const waterClass = metrics.waterSupply_t_y >= 500 ? 'good' : metrics.waterSupply_t_y >= 200 ? 'warn' : 'bad';

  topbarStats.innerHTML = `
    <div class="topbar-stats-main">
      <div class="topbar-viability ${viabilityClass}">
        <span class="topbar-viability-value">${metrics.viabilityScore}</span>
        <span class="topbar-viability-label">可行性</span>
      </div>
      <div class="topbar-mini-metrics">
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">能源</span>
          <span class="mini-metric-value ${powerClass}">${metrics.powerSurplus_kW > 0 ? '+' : ''}${metrics.powerSurplus_kW} kW</span>
        </div>
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">水源</span>
          <span class="mini-metric-value ${waterClass}">${metrics.waterSupply_t_y} t/年</span>
        </div>
        <div class="topbar-mini-metric">
          <span class="mini-metric-label">辐射</span>
          <span class="mini-metric-value ${radiationClass}">${metrics.radiation_mSv_y} mSv</span>
        </div>
      </div>
    </div>
  `;
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
    });
    optionList.appendChild(btn);
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

function buildCompletionCard(state) {
  const metrics = computeMetrics(state);
  const viabilityClass = metrics && metrics.viabilityScore >= 70 ? 'good' : metrics && metrics.viabilityScore >= 45 ? 'warn' : 'bad';

  const card = document.createElement('div');
  card.className = 'decision-card decision-card-single completion-card active';
  card.innerHTML = `
    <div class="completion-icon">🎉</div>
    <h2 class="completion-title">推演完成</h2>
    <p class="completion-desc">你已完成全部 6 项核心决策，综合可行性评分为 <strong class="${viabilityClass}">${metrics?.viabilityScore ?? '—'}/100</strong>。</p>
    <div class="completion-actions">
      <button class="btn btn-primary" id="generate-summary-btn">📊 生成可行性简报</button>
      <button class="btn btn-secondary" data-output="compare">⚖️ 多基地对比</button>
      <button class="btn btn-secondary" data-output="story">📖 基地一日</button>
      <button class="btn btn-secondary" data-output="poster">🚀 招募海报</button>
    </div>
    <button class="btn btn-ghost" id="completion-reset-btn" style="margin-top:1rem;width:100%;">重新推演</button>
  `;

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
    `- 能源结余：${metrics.powerSurplus_kW > 0 ? '+' : ''}${metrics.powerSurplus_kW} kW`,
    `- 总部署质量：${metrics.totalMass_t} t`,
    `- 年供水量：${metrics.waterSupply_t_y} t`,
    `- 年辐射剂量：${metrics.radiation_mSv_y} mSv`,
    `- 通信评分：${metrics.commScore}`,
    `- 食品自给率：${metrics.foodSelfSufficiency}%`,
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
