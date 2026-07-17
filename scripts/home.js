// 首页脚本：加载 3D 月球；点击标记后先相机俯冲，再跳转沙盘推演子页
import { initMoon, highlightSite, updateDecisionOverlays, flyToSite } from './moon-render.js';
import { getState } from './state.js';

let moonCleanup = null;
let flying = false;          // 俯冲进行中，忽略重复点击
let navigated = false;       // 防止 onArrive 与兜底定时器重复跳转
let navFallbackTimer = null;

// HUD 全息悬停卡样式（index.html 不可改，这里动态注入一次）
function ensureHudStyles() {
  if (document.getElementById('moon-hud-css')) return;
  const link = document.createElement('link');
  link.id = 'moon-hud-css';
  link.rel = 'stylesheet';
  link.href = 'styles/hud.css';
  document.head.appendChild(link);
}

function clearNavFallback() {
  if (navFallbackTimer) {
    clearTimeout(navFallbackTimer);
    navFallbackTimer = null;
  }
}

function goPlan(siteId) {
  if (navigated) return;
  navigated = true;
  clearNavFallback();
  const url = `plan.html?site=${encodeURIComponent(siteId)}`;
  // 优先使用客户端导航，保持背景音乐不中断
  if (window.__navigate) {
    window.__navigate(url);
  } else {
    window.location.href = url;
  }
}

function onMarkerClick(e) {
  const base = e.detail;
  if (!base?.id || flying || navigated) return; // 飞行期间安全忽略重复点击
  flying = true;
  window.__moonFx?.sound('confirm');

  const launched = flyToSite(base.id, {
    duration: 1100,
    onArrive: () => {
      flying = false;
      goPlan(base.id);
    }
  });

  if (!launched) {
    // 场景未就绪等异常情况：直接跳转
    flying = false;
    goPlan(base.id);
    return;
  }

  // 兜底：onArrive 未触发（动画被打断等）也保证跳转
  navFallbackTimer = setTimeout(() => {
    navFallbackTimer = null;
    flying = false;
    goPlan(base.id);
  }, 1600);
}

function init() {
  ensureHudStyles();
  moonCleanup = initMoon();
  window.addEventListener('marker-click', onMarkerClick);

  // 新 state 形状：高亮当前主基地，并按多基地网络渲染所有已规划基地的光柱/决策环与补给弧线
  const state = getState();
  if (state?.activeSite) {
    highlightSite(state.activeSite);
  }
  if (state) {
    updateDecisionOverlays(state);
  }
}

function cleanup() {
  clearNavFallback();
  flying = false;
  navigated = false;
  window.removeEventListener('marker-click', onMarkerClick);
  if (moonCleanup) {
    moonCleanup();
    moonCleanup = null;
  }
}

// 注册页面生命周期（由 navigator.js 通过 window.__pageModules 调用）
// 使用注册表而非 window.__pageInit 是因为 ES 模块只执行一次，
// 返回已访问页面时模块不会重新执行，需要从注册表查找 init/cleanup
window.__pageModules = window.__pageModules || {};
window.__pageModules["index"] = { init: init, cleanup: cleanup };
