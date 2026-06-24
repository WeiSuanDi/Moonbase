// 首页脚本：仅负责加载 3D 月球，点击标记后跳转到沙盘推演子页
import { initMoon } from './moon-render.js';

let moonCleanup = null;

function onMarkerClick(e) {
  const base = e.detail;
  if (base?.id) {
    // 使用客户端导航器，保持背景音乐不中断
    if (window.__navigate) {
      window.__navigate(`plan.html?site=${encodeURIComponent(base.id)}`);
    } else {
      window.location.href = `plan.html?site=${encodeURIComponent(base.id)}`;
    }
  }
}

function init() {
  moonCleanup = initMoon();
  window.addEventListener('marker-click', onMarkerClick);
}

function cleanup() {
  window.removeEventListener('marker-click', onMarkerClick);
  if (moonCleanup) {
    moonCleanup();
    moonCleanup = null;
  }
}

// 注册页面生命周期（由 navigator.js 调用）
window.__pageInit = init;
window.__pageCleanup = cleanup;
