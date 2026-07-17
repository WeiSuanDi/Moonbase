// timeline 页「你的建设征程」进度联动
// 读取沙盘（plan.html）多基地状态，在历史时间线上方渲染各基地三阶段进度徽章，
// 形成「历史 → 你的征程」的呼应。点击基地行跳回 plan.html?site=<id> 继续推演。
//
// 降级策略：阶段相关导出（PHASES / getCurrentPhase / isPhaseComplete /
// getPhaseProgress / isDecisionComplete）由并行开发提供。本脚本只静态命名导入
// 旧版 state.js 已确定存在的导出，阶段导出统一走动态 import + 存在性检查；
// 缺失或加载失败时区块显示「沙盘数据加载中…」，不报错、不崩页。

import {
  subscribe,
  getState,
  getSiteDecisions,
  getPlannedSites,
  siteMeta,
  computeSiteMetrics
} from './state.js';

const MOUNT_ID = 'tl-progress';

let phaseApi = null;       // 解析成功后的阶段 API；null 表示未就绪或不可用
let phaseApiStarted = false;
let unsubscribe = null;
let boundMount = null;     // 已绑定点击代理的挂载元素（DOM 被导航器替换后需重绑）

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// 动态解析阶段 API：命名导入在旧版 state.js 下会导致整个模块加载失败，故必须动态 import
async function ensurePhaseApi() {
  if (phaseApiStarted) return;
  phaseApiStarted = true;
  try {
    const mod = await import('./state.js');
    const usable = mod &&
      Array.isArray(mod.PHASES) && mod.PHASES.length > 0 &&
      typeof mod.getCurrentPhase === 'function' &&
      typeof mod.isPhaseComplete === 'function' &&
      typeof mod.getPhaseProgress === 'function';
    if (usable) {
      phaseApi = {
        PHASES: mod.PHASES,
        getCurrentPhase: mod.getCurrentPhase,
        isPhaseComplete: mod.isPhaseComplete,
        getPhaseProgress: mod.getPhaseProgress,
        isDecisionComplete: typeof mod.isDecisionComplete === 'function' ? mod.isDecisionComplete : null
      };
    }
  } catch (err) {
    phaseApi = null; // 旧版 state.js / 加载失败：保持降级文案
  }
  render();
}

function buildHead() {
  return '<div class="tl-progress-head">' +
    '<span class="tl-progress-title">📡 你的建设征程<span class="tl-progress-en">· YOUR CAMPAIGN</span></span>' +
    '<span class="tl-progress-hint">历史在远方，征程在脚下 · 点击基地继续推演</span>' +
    '</div>';
}

function buildLoading() {
  return '<div class="tl-progress-inner">' + buildHead() +
    '<div class="tl-progress-empty">沙盘数据加载中…</div></div>';
}

function buildEmpty() {
  return '<div class="tl-progress-inner">' + buildHead() +
    '<div class="tl-progress-empty">' +
    '<p>还没有规划中的基地。读完人类六十年的探月史，下一行由你书写。</p>' +
    '<a class="tl-progress-cta" href="plan.html" data-tl-nav>开始推演 →</a>' +
    '</div></div>';
}

function buildPhaseBadge(decisions, phase, currentPhase) {
  let done = 0;
  let total = 0;
  let complete = false;
  try {
    const progress = phaseApi.getPhaseProgress(decisions, phase.id);
    done = progress && typeof progress.done === 'number' ? progress.done : 0;
    total = progress && typeof progress.total === 'number' ? progress.total : 0;
  } catch (err) { /* 保持 0/0 */ }
  try {
    complete = !!phaseApi.isPhaseComplete(decisions, phase.id);
  } catch (err) { /* 保持 false */ }

  const active = !complete && currentPhase === phase.id;
  const cls = complete ? 'is-done' : (active ? 'is-active' : 'is-idle');
  const title = esc((phase.en || '') + (phase.brief ? ' — ' + phase.brief : ''));
  const check = complete ? '<span class="tl-progress-phase-check">✓</span>' : '';

  return '<span class="tl-progress-phase ' + cls + '" title="' + title + '">' +
    '<span class="tl-progress-phase-icon">' + esc(phase.icon || '•') + '</span>' +
    '<span class="tl-progress-phase-name">' + esc(phase.name || ('阶段 ' + phase.id)) + '</span>' +
    '<b>' + done + '/' + total + '</b>' + check +
    '</span>';
}

function buildSiteRow(state, siteId) {
  const meta = siteMeta[siteId] || {};
  const decisions = getSiteDecisions(state, siteId);

  let currentPhase = null;
  try {
    currentPhase = phaseApi.getCurrentPhase(decisions);
  } catch (err) { /* 保持 null，全部徽章按未激活渲染 */ }

  const badges = phaseApi.PHASES.map(phase => buildPhaseBadge(decisions, phase, currentPhase)).join('');

  // 可行性分：无任何决策时显示 —（computeSiteMetrics 对空决策也会给出基线分，不符合语义）
  let score = '—';
  const hasDecisions = Object.keys(decisions || {}).some(key => !!decisions[key]);
  if (hasDecisions) {
    try {
      const metrics = computeSiteMetrics(siteId, decisions, state && state.crew);
      if (metrics && typeof metrics.viabilityScore === 'number') score = String(metrics.viabilityScore);
    } catch (err) { /* 保持 — */ }
  }

  // 全部决策完成：整行点亮。isDecisionComplete 缺失时回退为逐阶段检查
  let allDone = false;
  try {
    allDone = typeof phaseApi.isDecisionComplete === 'function'
      ? !!phaseApi.isDecisionComplete(decisions)
      : phaseApi.PHASES.every(phase => !!phaseApi.isPhaseComplete(decisions, phase.id));
  } catch (err) { /* 保持 false */ }

  return '<a class="tl-progress-site' + (allDone ? ' is-complete' : '') + '"' +
    ' href="plan.html?site=' + encodeURIComponent(siteId) + '" data-tl-nav>' +
    '<span class="tl-progress-site-info">' +
    '<span class="tl-progress-site-name">' + esc(meta.name || siteId) + '</span>' +
    '<span class="tl-progress-site-sub">' + esc(meta.subtitle || '') + '</span>' +
    '</span>' +
    '<span class="tl-progress-phases">' + badges + '</span>' +
    '<span class="tl-progress-score">可行性 <b>' + esc(score) + '</b></span>' +
    '</a>';
}

function buildHtml() {
  if (!phaseApi) return buildLoading(); // 旧版 state.js 或尚未解析完成：降级文案

  let state = null;
  try {
    state = getState();
  } catch (err) {
    return buildLoading();
  }
  let siteIds = [];
  try {
    const planned = getPlannedSites(state);
    siteIds = Array.isArray(planned) ? planned : [];
  } catch (err) { /* 视为无基地 */ }

  if (!siteIds.length) return buildEmpty();

  const rows = siteIds.map(siteId => buildSiteRow(state, siteId)).join('');
  return '<div class="tl-progress-inner">' + buildHead() +
    '<div class="tl-progress-sites">' + rows + '</div></div>';
}

function render() {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) return;
  try {
    mount.innerHTML = buildHtml();
  } catch (err) {
    mount.innerHTML = buildLoading(); // 渲染异常也不允许崩页
  }
}

// 点击代理：优先走 navigator.js 的无刷新导航；不存在时让 <a href> 原生跳转
function onMountClick(event) {
  const target = event.target;
  const link = target && typeof target.closest === 'function' ? target.closest('[data-tl-nav]') : null;
  if (!link) return;
  if (typeof window.__navigate === 'function') {
    event.preventDefault();
    window.__navigate(link.getAttribute('href'));
  }
}

function init() {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) return;
  if (boundMount !== mount) {
    mount.addEventListener('click', onMountClick);
    boundMount = mount;
  }
  ensurePhaseApi();
  if (!unsubscribe) {
    try {
      unsubscribe = subscribe(render); // subscribe 会立即以当前状态回调一次
    } catch (err) {
      unsubscribe = null;
      render();
    }
  } else {
    render();
  }
}

function cleanup() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  const mount = document.getElementById(MOUNT_ID);
  if (mount) mount.innerHTML = '';
}

// 注册页面生命周期（由 navigator.js 通过 window.__pageModules 调用）
window.__pageModules = window.__pageModules || {};
window.__pageModules['timeline'] = { init: init, cleanup: cleanup };
