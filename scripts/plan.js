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
let infoPanel, siteInfoContent, infoSubtitle, infoTitle, infoTags, infoDesc, infoStats, infoActions, noSiteEl;
let progressPipeline, gamePanel, gameSiteTag, decisionList, statsBoard, generateBtn, agentActions, suggestBtn;
let resultPanel, resultTitle, resultBody, resultClose, resultReset;
let agentFab, agentChat, chatClose, chatMessages, chatInput, chatSend, chatChips;

let isGenerating = false;
let unsubscribe = null;

function queryDom() {
  infoPanel = document.getElementById('info-panel');
  siteInfoContent = document.getElementById('site-info-content');
  infoSubtitle = document.getElementById('info-subtitle');
  infoTitle = document.getElementById('info-title');
  infoTags = document.getElementById('info-tags');
  infoDesc = document.getElementById('info-desc');
  infoStats = document.getElementById('info-stats');
  infoActions = document.getElementById('info-actions');
  noSiteEl = document.getElementById('no-site');

  progressPipeline = document.getElementById('progress-pipeline');
  gamePanel = document.getElementById('game-panel');
  gameSiteTag = document.getElementById('game-site-tag');
  decisionList = document.getElementById('decision-list');
  statsBoard = document.getElementById('stats-board');
  generateBtn = document.getElementById('generate-summary-btn');
  agentActions = document.getElementById('agent-actions');
  suggestBtn = document.getElementById('suggest-btn');

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
  if (generateBtn) generateBtn.addEventListener('click', onRunAgentSummary);
  if (suggestBtn) suggestBtn.addEventListener('click', onSuggestNextClick);
  if (agentFab) agentFab.addEventListener('click', onAgentFabClick);
  if (chatClose) chatClose.addEventListener('click', onChatCloseClick);
  if (chatSend) chatSend.addEventListener('click', onChatSendClick);
  if (chatInput) chatInput.addEventListener('keydown', onChatInputKeydown);
  if (agentActions) agentActions.addEventListener('click', onAgentActionsClick);
  if (chatChips) chatChips.addEventListener('click', onChatChipsClick);
}

function unbindEvents() {
  if (resultClose) resultClose.removeEventListener('click', hideResult);
  if (resultReset) resultReset.removeEventListener('click', onResultReset);
  if (generateBtn) generateBtn.removeEventListener('click', onRunAgentSummary);
  if (suggestBtn) suggestBtn.removeEventListener('click', onSuggestNextClick);
  if (agentFab) agentFab.removeEventListener('click', onAgentFabClick);
  if (chatClose) chatClose.removeEventListener('click', onChatCloseClick);
  if (chatSend) chatSend.removeEventListener('click', onChatSendClick);
  if (chatInput) chatInput.removeEventListener('keydown', onChatInputKeydown);
  if (agentActions) agentActions.removeEventListener('click', onAgentActionsClick);
  if (chatChips) chatChips.removeEventListener('click', onChatChipsClick);
}

// —— 核心逻辑（保持不变，但使用 queryDom 后的引用） ——

function init() {
  queryDom();
  resolveSiteFromUrl();
  bindEvents();
  unsubscribe = subscribe(render);
  const state = getState();
  render(state);
  if (state.site) {
    const base = bases.find(b => b.id === state.site);
    if (base) showBaseInfo(base);
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
}

// 注册页面生命周期（由 navigator.js 通过 window.__pageModules 调用）
window.__pageModules = window.__pageModules || {};
window.__pageModules["plan"] = { init: init, cleanup: cleanup };

// 优先使用 URL 参数中的选址；其次保留已有 state；否则提示返回首页
function resolveSiteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const siteFromUrl = params.get('site');
  if (siteFromUrl && siteMeta[siteFromUrl]) {
    setSite(siteFromUrl);
  }
}

function showBaseInfo(base) {
  if (!infoSubtitle) return;
  const meta = siteMeta[base.id];
  infoSubtitle.textContent = base.subtitle;
  infoTitle.textContent = base.name;
  infoDesc.textContent = base.desc;

  // Render tags
  if (infoTags && meta?.tags) {
    infoTags.innerHTML = meta.tags.map(t => `<span class="info-tag">${t}</span>`).join('');
  } else if (infoTags) {
    infoTags.innerHTML = '';
  }

  const iceDisplay = meta?.iceAvailable_t >= 1000000
    ? (meta.iceAvailable_t / 1000000).toFixed(2) + 'M'
    : meta?.iceAvailable_t >= 1000
      ? (meta.iceAvailable_t / 1000).toFixed(1) + 'k'
      : meta?.iceAvailable_t;

  infoStats.innerHTML = `
    <div class="info-stat"><div class="info-stat-value">${base.lat}°</div><div class="info-stat-label">纬度</div></div>
    <div class="info-stat"><div class="info-stat-value">${base.lon}°</div><div class="info-stat-label">经度</div></div>
    <div class="info-stat"><div class="info-stat-value">${getSiteDifficulty(base.id)}</div><div class="info-stat-label">建设难度</div></div>
    <div class="info-stat"><div class="info-stat-value">${meta?.sunHoursRatio ? Math.round(meta.sunHoursRatio * 100) + '%' : '-'}</div><div class="info-stat-label">日照比</div></div>
    <div class="info-stat"><div class="info-stat-value">${meta?.longestShadow_h === 9999 ? '永久阴影' : meta?.longestShadow_h + ' h'}</div><div class="info-stat-label">最长阴影</div></div>
    <div class="info-stat"><div class="info-stat-value">${iceDisplay} t</div><div class="info-stat-label">可用水冰</div></div>
  `;

  // Reference & ice concentration block
  const extraInfo = document.createElement('div');
  extraInfo.className = 'info-extra';
  extraInfo.innerHTML = `
    <div class="info-extra-row"><span class="info-extra-label">水冰浓度</span><span class="info-extra-value">${meta?.iceConcentration || '—'}</span></div>
    <div class="info-extra-row"><span class="info-extra-label">置信度</span><span class="info-extra-value">${meta?.iceConfidence || '—'}</span></div>
    <div class="info-extra-row"><span class="info-extra-label">坡度</span><span class="info-extra-value">${meta?.slope_deg != null ? meta.slope_deg + '°' : '—'}</span></div>
    <div class="info-extra-row"><span class="info-extra-label">参考来源</span><span class="info-extra-value">${meta?.reference || '—'}</span></div>
  `;

  // Replace any previous extra info
  const existingExtra = siteInfoContent?.querySelector('.info-extra');
  if (existingExtra) existingExtra.remove();
  if (siteInfoContent) siteInfoContent.insertBefore(extraInfo, infoActions);

  infoActions.innerHTML = '';
  if (base.selectable) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '重新推演该基地';
    btn.addEventListener('click', () => {
      setSite(base.id);
    });
    infoActions.appendChild(btn);
  }
}

function render(state) {
  if (!gamePanel) return;
  const hasSite = !!state.site;

  if (hasSite) {
    gamePanel.classList.remove('hidden');
    if (siteInfoContent) siteInfoContent.style.display = '';
    if (noSiteEl) noSiteEl.style.display = 'none';
    renderGamePanel(state);
    renderProgressPipeline(state);
  } else {
    gamePanel.classList.add('hidden');
    if (siteInfoContent) siteInfoContent.style.display = 'none';
    if (noSiteEl) noSiteEl.style.display = 'block';
    renderProgressPipeline(state);
  }

  const metrics = computeMetrics(state);
  if (metrics) {
    statsBoard.classList.remove('hidden');
    renderStats(metrics, state);
  } else {
    statsBoard.classList.add('hidden');
  }

  const complete = isDecisionComplete(state);
  if (generateBtn) generateBtn.style.display = complete ? 'block' : 'none';
  if (agentActions) agentActions.style.display = complete ? 'grid' : 'none';
  if (suggestBtn) suggestBtn.style.display = hasSite && !complete ? 'inline-flex' : 'none';

  if (updateDecisionOverlays) updateDecisionOverlays(state);
}

function renderGamePanel(state) {
  if (!decisionList) return;
  const site = siteMeta[state.site];
  const completed = getCompletedSteps(state);
  gameSiteTag.innerHTML = `<span class="dot"></span> 已选选址：${site?.name || state.site} <span class="progress-tag">${completed}/${steps.length}</span>`;

  decisionList.innerHTML = '';
  steps.forEach((step, index) => {
    const prev = steps[index - 1];
    const isUnlocked = !prev || state[prev.key];
    const isDone = !!state[step.key];
    const isActive = isUnlocked && !isDone;

    const card = document.createElement('div');
    card.className = `decision-card ${isActive ? 'active' : ''} ${isDone ? 'done' : ''} ${!isUnlocked ? 'locked' : ''}`;

    const statusText = isDone ? '已选择' : isUnlocked ? '待决策' : '需先完成上一步';
    const statusClass = isDone ? 'done' : '';

    card.innerHTML = `
      <div class="decision-header">
        <div class="decision-name">${index + 1}. ${step.name}</div>
        <div class="decision-status ${statusClass}">${statusText}</div>
      </div>
      <div class="decision-desc">${step.description}</div>
      <div class="option-list" id="options-${step.key}"></div>
    `;

    const optionList = card.querySelector(`#options-${step.key}`);
    options[step.key].forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      if (state[step.key] === opt.id) btn.classList.add('selected');
      btn.disabled = !isUnlocked;
      btn.innerHTML = `<span class="option-title">${opt.icon} ${opt.label}</span><span class="option-hint">${opt.hint}</span>`;
      btn.addEventListener('click', () => setDecision(step.key, opt.id));
      optionList.appendChild(btn);
    });

    decisionList.appendChild(card);
  });
}

function renderProgressPipeline(state) {
  if (!progressPipeline) return;
  const hasSite = !!state.site;
  const stepIcons = { energy: '⚡', water: '💧', radiation: '🛡️', communication: '📡', habitat: '🌱', transport: '🚀' };
  const stepLabels = { energy: '能源', water: '水源', radiation: '防护', communication: '通信', habitat: '生命', transport: '运输' };

  let html = '';
  steps.forEach((step, i) => {
    const isDone = !!state[step.key];
    const prev = steps[i - 1];
    const isUnlocked = hasSite && (!prev || !!state[prev.key]);
    const isActive = isUnlocked && !isDone;

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

  // Click handlers on pipeline nodes
  progressPipeline.querySelectorAll('.pipeline-node').forEach(node => {
    node.addEventListener('click', () => {
      const stepKey = node.dataset.step;
      if (!stepKey) return;
      const currentState = getState();
      const stepIndex = steps.findIndex(s => s.key === stepKey);
      const prev = steps[stepIndex - 1];
      const isUnlocked = !!currentState.site && (!prev || !!currentState[prev.key]);
      if (!isUnlocked) return;
      // Scroll to the corresponding decision card
      const card = decisionList?.querySelector(`#options-${stepKey}`)?.closest('.decision-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight
        card.style.boxShadow = '0 0 30px rgba(0,212,255,0.2)';
        setTimeout(() => { card.style.boxShadow = ''; }, 800);
      }
    });
  });
}

function renderStats(metrics, state) {
  if (!statsBoard) return;
  const viabilityClass = metrics.viabilityScore >= 70 ? 'good' : metrics.viabilityScore >= 45 ? 'warn' : 'bad';
  const powerClass = metrics.powerSurplus_kW >= 30 ? 'good' : metrics.powerSurplus_kW >= 0 ? 'warn' : 'bad';
  const radiationClass = metrics.radiation_mSv_y <= 100 ? 'good' : metrics.radiation_mSv_y <= 200 ? 'warn' : 'bad';
  const waterClass = metrics.waterSupply_t_y >= 500 ? 'good' : metrics.waterSupply_t_y >= 200 ? 'warn' : 'bad';
  const riskClass = metrics.riskScore <= 6 ? 'good' : metrics.riskScore <= 10 ? 'warn' : 'bad';
  const sustainClass = metrics.sustainability >= 18 ? 'good' : metrics.sustainability >= 12 ? 'warn' : 'bad';

  // Bar widths (percentage-based on max values)
  const viabilityPct = metrics.viabilityScore;
  const powerPct = Math.min(100, Math.max(0, (metrics.powerSurplus_kW + 30) / 130 * 100));
  const radiationPct = Math.min(100, Math.max(0, (400 - metrics.radiation_mSv_y) / 380 * 100));
  const waterPct = Math.min(100, Math.max(0, metrics.waterSupply_t_y / 1200 * 100));
  const commPct = Math.min(100, Math.max(0, metrics.commScore));
  const foodPct = metrics.foodSelfSufficiency;
  const transportPct = Math.min(100, Math.max(0, metrics.transportCapacity));
  const riskPct = Math.min(100, Math.max(0, (18 - metrics.riskScore) / 18 * 100));
  const sustainPct = Math.min(100, Math.max(0, metrics.sustainability / 30 * 100));

  statsBoard.innerHTML = `
    <h3>📊 实时推演仪表盘</h3>

    <div class="stats-highlight">
      <div class="highlight-value ${viabilityClass}">${metrics.viabilityScore}<span style="font-size:1rem;">/100</span></div>
      <div class="highlight-label">综合可行性评分</div>
    </div>

    <div class="stats-metric-group">
      <div class="stats-group-title">🛡️ 生存指标</div>
      ${metricRow('年辐射剂量', metrics.radiation_mSv_y, 'mSv', radiationPct, radiationClass, true)}
      ${metricRow('年供水量', metrics.waterSupply_t_y, 't/年', waterPct, waterClass, false)}
      ${metricRow('食品自给率', metrics.foodSelfSufficiency, '%', foodPct, 'good', false)}
    </div>

    <div class="stats-metric-group">
      <div class="stats-group-title">⚡ 运营指标</div>
      ${metricRow('能源结余', metrics.powerSurplus_kW, 'kW', powerPct, powerClass, false)}
      ${metricRow('通信评分', metrics.commScore, '', commPct, 'good', false)}
      ${metricRow('运输能力', metrics.transportCapacity, '', transportPct, 'good', false)}
    </div>

    <div class="stats-metric-group">
      <div class="stats-group-title">⚠️ 风险指标</div>
      ${metricRow('综合风险', 18 - metrics.riskScore, '/18', riskPct, riskClass, true)}
      ${metricRow('可持续评分', metrics.sustainability, '/30', sustainPct, sustainClass, false)}
      ${metricRow('总部署质量', metrics.totalMass_t, 't', 50, 'good', false)}
    </div>
  `;
}

function metricRow(label, value, unit, pct, cls, lowerBetter) {
  const displayVal = unit ? `${value} ${unit}` : `${value}`;
  const barCls = cls || 'good';
  return `
    <div class="metric-row">
      <span class="metric-label">${label}</span>
      <div class="metric-bar-wrap"><div class="metric-bar-fill ${barCls}" style="width:${pct}%"></div></div>
      <span class="metric-value ${barCls}">${displayVal}</span>
    </div>
  `;
}

const OUTPUT_TITLES = {
  summary: '基地可行性简报',
  story: '基地一日',
  poster: '招募海报文案',
  compare: '多基地对比报告'
};

async function runAgentOutput(type) {
  if (isGenerating) return;
  isGenerating = true;
  const originalText = generateBtn.textContent;
  generateBtn.disabled = true;
  generateBtn.textContent = 'AI 思考中…';

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
    generateBtn.disabled = false;
    generateBtn.textContent = originalText;
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
