/* ============================================================
 * fx.js —— 全局科幻氛围层（经典 script / IIFE / 幂等）
 *
 *  - window.__moonFx: sound / countUp / tilt / warpTo（另有 _cover/_reveal 供 navigator 使用）
 *  - 跃迁式过场动画（覆盖 + 揭示），元素挂在 <html> 上跨 body 替换存活
 *  - index.html 开机引导终端日志（MutationObserver 观察 #loader 的 hidden class 收尾）
 *  - 全局扫描线 + 颗粒质感层（mount + 监听 moon:navigation-complete）
 *  - 事件委托音效（hover / confirm），与音乐播放器静音状态联动
 *
 * 任何缺失的元素或 API 都静默降级，绝不阻断页面原有功能。
 * ============================================================ */
(function () {
  "use strict";

  if (window.__moonFx) return;

  var REDUCED = false;
  try {
    REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    REDUCED = false;
  }

  /* ---------------- 静音联动 ----------------
   * music-player.js 用 sessionStorage["moon-music-paused"]="1" 记录用户手动暂停；
   * 用户选择安静时，音效同步静默。音频元素被 muted / 音量为 0 时同样静默。
   */
  function isMusicMuted() {
    try {
      if (window.sessionStorage && sessionStorage.getItem("moon-music-paused") === "1") return true;
    } catch (e) { /* 隐私模式忽略 */ }
    try {
      var audio = document.getElementById("moon-bg-music");
      if (audio && (audio.muted || audio.volume === 0)) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /* ---------------- WebAudio 合成音效 ---------------- */
  var audioCtx = null;
  var masterGain = null;

  function ensureCtx() {
    if (audioCtx) {
      if (audioCtx.state === "suspended" && audioCtx.resume) {
        audioCtx.resume().catch(function () {});
      }
      return audioCtx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.12; // 总音量克制（≤ 0.15）
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      audioCtx = null;
      masterGain = null;
    }
    return audioCtx;
  }

  // 首次用户手势后惰性创建 / 解锁 AudioContext
  ["pointerdown", "keydown", "touchstart"].forEach(function (evt) {
    try {
      document.addEventListener(evt, function () { ensureCtx(); }, { passive: true });
    } catch (e) { /* 忽略 */ }
  });

  function playTone(n) {
    var t0 = audioCtx.currentTime + (n.at || 0);
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.type = n.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, n.f0), t0);
    if (n.f1) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.f1), t0 + n.dur); } catch (e) {}
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, n.vol), t0 + (n.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + n.dur + 0.05);
  }

  var SOUND_DEFS = {
    hover:    [ { f0: 1500, f1: 1150, type: "sine",     dur: 0.06, vol: 0.35 } ],
    select:   [ { f0: 840,            type: "triangle", dur: 0.07, vol: 0.50 } ],
    confirm:  [ { f0: 620,            type: "triangle", dur: 0.09, vol: 0.50 },
                { f0: 930,            type: "triangle", dur: 0.12, vol: 0.55, at: 0.085 } ],
    complete: [ { f0: 440.00,         type: "triangle", dur: 0.18, vol: 0.45 },
                { f0: 523.25,         type: "triangle", dur: 0.18, vol: 0.45, at: 0.08 },
                { f0: 659.25,         type: "triangle", dur: 0.26, vol: 0.50, at: 0.16 } ],
    warp:     [ { f0: 160, f1: 2600,  type: "sawtooth", dur: 0.45, vol: 0.30, attack: 0.05 },
                { f0: 80,  f1: 1300,  type: "sine",     dur: 0.45, vol: 0.20, attack: 0.05 } ],
    error:    [ { f0: 150,            type: "square",   dur: 0.10, vol: 0.38 },
                { f0: 118,            type: "square",   dur: 0.15, vol: 0.38, at: 0.12 } ]
  };

  function sound(name) {
    try {
      if (!name || !SOUND_DEFS[name]) return;
      if (isMusicMuted()) return;
      var ctx = ensureCtx();
      if (!ctx || !masterGain || ctx.state !== "running") return; // 首次手势前静默跳过
      SOUND_DEFS[name].forEach(function (n) {
        try { playTone(n); } catch (e) {}
      });
    } catch (e) { /* 静默降级 */ }
  }

  /* ---------------- countUp 数字滚动 ---------------- */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function countUp(el, to, opts) {
    var noop = function () {};
    if (!el) return noop;
    opts = opts || {};
    var duration = typeof opts.duration === "number" ? opts.duration : 600;
    var format = typeof opts.format === "function"
      ? opts.format
      : function (v) { return String(Math.round(v)); };

    var target = Number(to);
    if (isNaN(target)) target = 0;

    var from = opts.from;
    if (typeof from !== "number" || isNaN(from)) {
      from = 0;
      try {
        var m = String(el.textContent || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
        if (m) from = parseFloat(m[0]);
      } catch (e) { from = 0; }
    }

    if (REDUCED || duration <= 0 || from === target) {
      try { el.textContent = format(target); } catch (e) {}
      return noop;
    }

    var raf = 0;
    var cancelled = false;
    var startTs = -1;

    function step(ts) {
      if (cancelled) return;
      if (startTs < 0) startTs = ts;
      var p = (ts - startTs) / duration;
      if (p > 1) p = 1;
      try { el.textContent = format(from + (target - from) * easeOutCubic(p)); } catch (e) {}
      if (p < 1) raf = requestAnimationFrame(step);
    }

    try {
      raf = requestAnimationFrame(step);
    } catch (e) {
      try { el.textContent = format(target); } catch (e2) {}
      return noop;
    }

    return function cancelCountUp() {
      cancelled = true;
      try { if (raf) cancelAnimationFrame(raf); } catch (e) {}
    };
  }

  /* ---------------- tilt 3D 透视倾斜 ---------------- */
  function tilt(el, opts) {
    var noop = function () {};
    if (!el || typeof el.addEventListener !== "function") return noop;
    if (REDUCED) return noop; // prefers-reduced-motion：不绑定

    var max = opts && typeof opts.max === "number" ? opts.max : 6;
    var originalTransform = el.style.transform || "";
    var originalWillChange = el.style.willChange || "";

    var tx = 0, ty = 0;   // 目标角度
    var cx = 0, cy = 0;   // 当前角度（lerp 平滑）
    var raf = 0;
    var active = false;

    function render() {
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      el.style.transform =
        "perspective(700px) rotateX(" + cx.toFixed(3) + "deg) rotateY(" + cy.toFixed(3) + "deg)";
      if (active || Math.abs(tx - cx) > 0.02 || Math.abs(ty - cy) > 0.02) {
        raf = requestAnimationFrame(render);
      } else {
        raf = 0;
        cx = cy = tx = ty = 0;
        el.style.transform = originalTransform;
      }
    }

    function kick() { if (!raf) raf = requestAnimationFrame(render); }

    function onEnter(e) {
      if (e && e.pointerType && e.pointerType !== "mouse") return;
      active = true;
      el.style.willChange = "transform";
      kick();
    }

    function onMove(e) {
      if (!active) return;
      if (e && e.pointerType && e.pointerType !== "mouse") return;
      var r;
      try { r = el.getBoundingClientRect(); } catch (err) { return; }
      if (!r || !r.width || !r.height) return;
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      if (px < -0.5) px = -0.5; else if (px > 0.5) px = 0.5;
      if (py < -0.5) py = -0.5; else if (py > 0.5) py = 0.5;
      ty = px * 2 * max;   // rotateY
      tx = -py * 2 * max;  // rotateX
      kick();
    }

    function onLeave() {
      active = false;
      tx = 0;
      ty = 0;
      kick();
    }

    try {
      el.addEventListener("pointerenter", onEnter);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
      el.addEventListener("pointercancel", onLeave);
    } catch (e) {
      return noop;
    }

    return function unbindTilt() {
      try {
        el.removeEventListener("pointerenter", onEnter);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("pointercancel", onLeave);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        active = false;
        el.style.transform = originalTransform;
        el.style.willChange = originalWillChange;
      } catch (e) {}
    };
  }

  /* ---------------- 跃迁过场（覆盖 / 揭示） ---------------- */
  var warpOverlay = null;

  function buildOverlay() {
    var ov = document.createElement("div");
    ov.className = "fx-warp-overlay";
    ov.setAttribute("aria-hidden", "true");

    var frag = document.createDocumentFragment();

    if (!REDUCED) {
      // 少量 JS 生成星光线：从中心向外拉伸
      var count = 36;
      for (var i = 0; i < count; i++) {
        var s = document.createElement("i");
        s.className = "fx-warp-star";
        var ang = Math.random() * Math.PI * 2;
        var radius = 6 + Math.random() * 34; // 距中心的百分比半径
        var l = 50 + Math.cos(ang) * radius;
        var t = 50 + Math.sin(ang) * radius;
        s.style.setProperty("--fx-l", l.toFixed(2) + "%");
        s.style.setProperty("--fx-t", t.toFixed(2) + "%");
        s.style.setProperty("--fx-a", (ang * 180 / Math.PI).toFixed(1) + "deg");
        s.style.setProperty("--fx-dist", (30 + Math.random() * 30).toFixed(1) + "vw");
        s.style.setProperty("--fx-d", (Math.random() * 0.12).toFixed(3) + "s");
        frag.appendChild(s);
      }
      var scan = document.createElement("b");
      scan.className = "fx-warp-scan";
      frag.appendChild(scan);
      var glow = document.createElement("u");
      glow.className = "fx-warp-glow";
      frag.appendChild(glow);
    }

    ov.appendChild(frag);
    return ov;
  }

  // 覆盖动画：resolve 于动画中段（屏幕被完全遮住），供 navigator 替换 body
  function cover() {
    return new Promise(function (resolve) {
      try {
        if (warpOverlay && warpOverlay.parentNode && warpOverlay.classList.contains("fx-active")) {
          resolve(); // 已处于覆盖状态（如 warpTo 预演），直接进入中段
          return;
        }
        if (!warpOverlay || !warpOverlay.parentNode) {
          warpOverlay = buildOverlay();
          (document.documentElement || document.body).appendChild(warpOverlay);
        }
        warpOverlay.classList.remove("fx-leaving");
        void warpOverlay.offsetWidth; // 强制 reflow，重启动画
        warpOverlay.classList.add("fx-active");
        setTimeout(resolve, REDUCED ? 170 : 480);
      } catch (e) {
        resolve(); // 动画创建失败也要正常完成导航
      }
    });
  }

  // 揭示动画：新页面全息显影 + 清理 overlay
  function reveal() {
    try {
      if (document.body) {
        document.body.classList.remove("fx-page-reveal");
        void document.body.offsetWidth;
        document.body.classList.add("fx-page-reveal");
        setTimeout(function () {
          try { if (document.body) document.body.classList.remove("fx-page-reveal"); } catch (e) {}
        }, REDUCED ? 260 : 560);
      }
    } catch (e) {}
    try {
      if (warpOverlay) {
        var ov = warpOverlay;
        warpOverlay = null;
        ov.classList.remove("fx-active");
        ov.classList.add("fx-leaving");
        setTimeout(function () {
          try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
        }, 340);
      }
    } catch (e) {}
  }

  function warpTo(url) {
    if (!url) return;
    try { sound("warp"); } catch (e) {}
    cover().then(function () {
      try {
        if (typeof window.__navigate === "function") {
          window.__navigate(url);
        } else {
          window.location.href = url;
        }
      } catch (e) {
        try { window.location.href = url; } catch (e2) {}
      }
    });
  }

  /* ---------------- 全局质感层 ---------------- */
  function mountGrain() {
    try {
      if (!document.body) return;
      if (document.querySelector(".fx-grain")) return;
      var g = document.createElement("div");
      g.className = "fx-grain";
      g.setAttribute("aria-hidden", "true");
      document.body.appendChild(g);
    } catch (e) {}
  }

  /* ---------------- 开机引导终端日志（仅 index） ---------------- */
  var BOOT_LINES = [
    "> 载入月面高程数据",
    "> 校准光学阵列",
    "> 建立深空通讯链路",
    "> 部署基地信标"
  ];
  var BOOT_FINAL = "> 月面前哨上线 · 欢迎登月";

  function initBootLog() {
    var loader = null;
    var logEl = null;
    try {
      loader = document.getElementById("loader");
      logEl = loader ? loader.querySelector(".fx-boot-log") : null;
      if (!loader || !logEl) return;              // 非首页或无日志容器：跳过
      if (loader.classList.contains("hidden")) return; // 已加载完成：跳过
    } catch (e) {
      return;
    }

    var done = false;
    var timers = [];

    function later(fn, ms) {
      var id = setTimeout(function () { if (!done) fn(); }, ms);
      timers.push(id);
      return id;
    }

    function clearTimers() {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    function getPercent() {
      try {
        var el = document.getElementById("loader-percent");
        if (!el) return 0;
        var n = parseInt(String(el.textContent).replace(/[^\d]/g, ""), 10);
        return isNaN(n) ? 0 : n;
      } catch (e) {
        return 0;
      }
    }

    // 收尾：瞬间补全全部日志（加载层 0.8s 淡出期间保持完整画面）
    function completeAll() {
      try {
        logEl.innerHTML = "";
        BOOT_LINES.concat([BOOT_FINAL]).forEach(function (line, idx, arr) {
          var div = document.createElement("div");
          div.className = "fx-boot-line";
          var text = document.createElement("span");
          text.className = "fx-boot-text";
          text.textContent = line;
          div.appendChild(text);
          if (idx < arr.length - 1) {
            var ok = document.createElement("span");
            ok.className = "fx-boot-ok";
            ok.textContent = " …… OK";
            div.appendChild(ok);
          } else {
            div.classList.add("fx-boot-final");
          }
          logEl.appendChild(div);
        });
      } catch (e) {}
    }

    // MutationObserver：仅观察，绝不干预加载层隐藏逻辑
    var observer = null;
    try {
      observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].attributeName === "class" && loader.classList.contains("hidden")) {
            done = true;
            clearTimers();
            completeAll();
            try { observer.disconnect(); } catch (e) {}
            break;
          }
        }
      });
      observer.observe(loader, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {
      observer = null;
    }

    if (REDUCED) {
      // 减少动态：直接输出完整日志，不打字
      done = true;
      clearTimers();
      completeAll();
      try { if (observer) observer.disconnect(); } catch (e) {}
      return;
    }

    var cursor = document.createElement("span");
    cursor.className = "fx-boot-cursor";
    cursor.textContent = "▋";

    function typeLine(idx) {
      if (done || idx >= BOOT_LINES.length) return;
      var div = document.createElement("div");
      div.className = "fx-boot-line";
      var text = document.createElement("span");
      text.className = "fx-boot-text";
      div.appendChild(text);
      div.appendChild(cursor);
      logEl.appendChild(div);

      var content = BOOT_LINES[idx];
      var ci = 0;
      (function tick() {
        if (done) return;
        ci++;
        text.textContent = content.slice(0, ci);
        if (ci < content.length) {
          later(tick, 24 + Math.random() * 30);
          return;
        }
        later(function () {
          try {
            var ok = document.createElement("span");
            ok.className = "fx-boot-ok";
            ok.textContent = " …… OK";
            div.insertBefore(ok, cursor);
          } catch (e) {}
          waitForProgress(idx + 1);
        }, 130);
      })();
    }

    // 与 #loader-percent 大致同步：下一行等待对应百分比阈值
    function waitForProgress(nextIdx) {
      if (done) return;
      if (nextIdx >= BOOT_LINES.length) return; // 全部打完，等待 hidden 收尾
      var threshold = nextIdx * (100 / BOOT_LINES.length) - 5; // 约 20 / 45 / 70
      var waited = 0;
      (function poll() {
        if (done) return;
        if (getPercent() >= threshold || waited > 1600) {
          typeLine(nextIdx);
          return;
        }
        waited += 150;
        later(poll, 150);
      })();
    }

    later(function () { typeLine(0); }, 260);
  }

  /* ---------------- 事件委托音效 ---------------- */
  var lastHoverAt = 0;

  try {
    document.addEventListener("mouseover", function (e) {
      try {
        var t = e.target && e.target.closest ? e.target.closest("a, button, [role='button']") : null;
        if (!t) return;
        if (e.relatedTarget && t.contains(e.relatedTarget)) return; // 元素内部移动不重复触发
        var now = Date.now();
        if (now - lastHoverAt < 60) return; // 节流 ~60ms
        lastHoverAt = now;
        sound("hover");
      } catch (err) {}
    }, { passive: true });

    document.addEventListener("click", function (e) {
      try {
        var t = e.target && e.target.closest ? e.target.closest(".btn-primary, .hero-cta") : null;
        if (t) sound("confirm"); // 锦上添花，不阻止任何原有事件
      } catch (err) {}
    }, { passive: true });
  } catch (e) {}

  /* ---------------- 挂载 API（尽早暴露） ---------------- */
  window.__moonFx = {
    sound: sound,
    countUp: countUp,
    tilt: tilt,
    warpTo: warpTo,
    isMuted: isMusicMuted,
    _cover: cover,
    _reveal: reveal
  };

  /* ---------------- 启动 ---------------- */
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    try { mountGrain(); } catch (e) {}
    try { initBootLog(); } catch (e) {}
    try {
      // 无加载层的页面：首次进入也来一次全息显影
      if (!document.getElementById("loader") && document.body) {
        document.body.classList.add("fx-page-reveal");
        setTimeout(function () {
          try { document.body.classList.remove("fx-page-reveal"); } catch (e) {}
        }, REDUCED ? 260 : 560);
      }
    } catch (e) {}
  });

  // 与 cosmos-ui 相同：无刷新导航完成后重新挂载质感层
  try {
    document.addEventListener("moon:navigation-complete", function () {
      try { mountGrain(); } catch (e) {}
    });
  } catch (e) {}
})();
