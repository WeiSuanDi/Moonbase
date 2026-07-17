// 客户端导航器：拦截内部链接，用 fetch + pushState 实现无刷新页面切换
// 保持 <audio> 和音乐按钮在导航过程中不被销毁，从而实现无缝背景音乐
(function () {
  "use strict";

  if (window.__moonNavigator) return;
  window.__moonNavigator = true;

  // 页面模块注册表：每个模块脚本在此注册 { init, cleanup }
  // 因为 ES 模块只执行一次，用注册表确保返回已访问页面时能正确调用 init
  window.__pageModules = window.__pageModules || {};

  var isNavigating = false;

  // ——— 工具：从 URL 提取页面名 ———
  function getPageName(url) {
    var path = new URL(url, location.origin).pathname;
    var name = path.split("/").pop().replace(".html", "") || "index";
    // 首页可能是 "" 或 "index"
    if (name === "" || path === "/" || path === "") name = "index";
    return name;
  }

  // ——— 判断是否为内部 HTML 链接 ———
  function isInternalHtmlLink(a) {
    if (!a || !a.href) return false;
    if (a.origin !== location.origin) return false;
    if (a.protocol === "javascript:" || a.protocol === "mailto:") return false;
    if (a.host !== location.host) return false;
    if (a.target && a.target !== "_self") return false;
    var currentPath = location.pathname.replace(/\/$/, "");
    var targetPath = a.pathname.replace(/\/$/, "");
    if (currentPath === targetPath && a.hash) return false;
    var path = a.pathname;
    if (/\.(pdf|jpg|png|gif|svg|mp3|wav|ogg|css|js|json|xml|txt|map|ico|woff|woff2|ttf|eot)$/i.test(path)) {
      return false;
    }
    return true;
  }

  // ——— 保存持久元素（音乐播放器相关） ———
  var savedAudio = null;
  var savedBtn = null;

  function savePersistentElements() {
    savedAudio = document.getElementById("moon-bg-music");
    savedBtn = document.getElementById("moon-music-toggle");
    if (savedAudio && savedAudio.parentNode) savedAudio.remove();
    if (savedBtn && savedBtn.parentNode) savedBtn.remove();
  }

  function restorePersistentElements() {
    if (savedAudio) document.body.appendChild(savedAudio);
    if (savedBtn) document.body.appendChild(savedBtn);
  }

  // ——— 脚本注入 ———
  function parseScripts(bodyHtml) {
    var temp = document.createElement("div");
    temp.innerHTML = bodyHtml;
    var scriptElements = temp.querySelectorAll("script");
    var scriptData = [];
    scriptElements.forEach(function (s) {
      scriptData.push({
        type: s.type || "text/javascript",
        src: s.src || "",
        text: s.textContent,
        attrs: Array.from(s.attributes).map(function (a) {
          return { name: a.name, value: a.value };
        })
      });
      s.remove();
    });
    return { cleanHtml: temp.innerHTML, scripts: scriptData };
  }

  function isSkippedScript(s) {
    if (s.src && (s.src.indexOf("navigator.js") !== -1 || s.src.indexOf("music-player.js") !== -1 || s.src.indexOf("fx.js") !== -1)) {
      return true;
    }
    return false;
  }

  function filterAttrs(attrs) {
    return attrs.filter(function (a) {
      if (a.name === "src") {
        return a.value.indexOf("navigator.js") === -1 && a.value.indexOf("music-player.js") === -1 && a.value.indexOf("fx.js") === -1;
      }
      return true;
    });
  }

  // 异步注入脚本，等待模块加载完成
  function injectScriptsAsync(scripts) {
    return new Promise(function (resolve) {
      var ordered = [];
      ordered = ordered.concat(scripts.filter(function (s) { return s.type === "importmap"; }));
      ordered = ordered.concat(scripts.filter(function (s) { return s.type === "module"; }));
      ordered = ordered.concat(scripts.filter(function (s) { return s.type !== "importmap" && s.type !== "module"; }));

      ordered = ordered.filter(function (s) { return !isSkippedScript(s); });

      var asyncScripts = ordered.filter(function (s) { return s.src && s.type === "module"; });
      var pending = asyncScripts.length;

      function checkDone() {
        pending--;
        if (pending <= 0) {
          setTimeout(resolve, 20);
        }
      }

      if (pending === 0) {
        ordered.forEach(function (s) { appendScript(s); });
        resolve();
        return;
      }

      ordered.forEach(function (s) {
        if (!s.src || s.type !== "module") {
          appendScript(s);
        }
      });

      ordered.forEach(function (s) {
        if (s.src && s.type === "module") {
          appendScript(s, checkDone);
        }
      });
    });
  }

  function appendScript(s, onLoad) {
    var el = document.createElement("script");
    var attrs = filterAttrs(s.attrs);
    attrs.forEach(function (a) {
      el.setAttribute(a.name, a.value);
    });
    if (s.text && !s.src) {
      el.textContent = s.text;
    }
    if (onLoad) {
      el.onload = onLoad;
      el.onerror = onLoad;
    }
    document.body.appendChild(el);
  }

  // ——— 获取页面注册的模块 ———
  function getPageModule(pageName) {
    return window.__pageModules && window.__pageModules[pageName];
  }

  // ——— 调用页面清理 ———
  function callCleanup(pageName) {
    var mod = getPageModule(pageName);
    if (mod && typeof mod.cleanup === "function") {
      try { mod.cleanup(); } catch (e) { console.warn("页面清理失败：", e); }
    }
  }

  // ——— 调用页面初始化 ———
  function callInit(pageName) {
    var mod = getPageModule(pageName);
    if (mod && typeof mod.init === "function") {
      try { mod.init(); } catch (e) { console.warn("页面初始化失败：", e); }
    }
  }

  // ——— 核心：导航到指定 URL ———
  async function navigateTo(url, addToHistory) {
    if (isNavigating) return;
    isNavigating = true;

    // 1. 调用旧页面的清理函数
    var oldPage = getPageName(window.__currentPage);
    callCleanup(oldPage);

    try {
      // 2. 获取目标页面
      var response = await fetch(url);
      if (!response.ok) throw new Error("HTTP " + response.status);
      var html = await response.text();

      // 3. 解析 HTML
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, "text/html");

      // 3.5 跃迁「覆盖」动画：fetch 完成后、替换 body 前播放（超时兜底，动画失败也照常导航）
      try {
        if (window.__moonFx && typeof window.__moonFx._cover === "function") {
          await Promise.race([
            window.__moonFx._cover(),
            new Promise(function (resolve) { setTimeout(resolve, 900); })
          ]);
        }
      } catch (fxErr) { /* 动画失败静默降级 */ }

      // 4. 保存并移除持久元素
      savePersistentElements();

      // 5. 更新 document title
      document.title = doc.title;

      // 6. 更新 body class
      document.body.className = doc.body.className;

      // 7. 处理 body 内容：分离 HTML 和脚本
      var bodyHtml = doc.body.innerHTML;
      var parsed = parseScripts(bodyHtml);

      // 8. 写入新 body 内容（不含脚本）
      document.body.innerHTML = parsed.cleanHtml;

      // 9. 恢复持久元素
      restorePersistentElements();

      // 10. 注入并等待脚本执行
      await injectScriptsAsync(parsed.scripts);

      // 11. 更新浏览器历史
      if (addToHistory !== false) {
        history.pushState({ url: url }, "", url);
      }

      // 12. 更新当前页面标识
      window.__currentPage = url;

      // 13. 滚动到顶部
      window.scrollTo(0, 0);

      // 14. 调用新页面的初始化函数（从注册表查找，解决 ES 模块缓存问题）
      var newPage = getPageName(url);
      callInit(newPage);

      // 15. 跃迁「揭示」动画：新页面全息显影，并清理 overlay（失败不影响导航）
      try {
        if (window.__moonFx && typeof window.__moonFx._reveal === "function") {
          window.__moonFx._reveal();
        }
      } catch (fxErr) { /* 动画失败静默降级 */ }

      // 16. 广播导航完成，供氛围层（cosmos-ui / fx 质感层）重新挂载
      try {
        document.dispatchEvent(new CustomEvent("moon:navigation-complete", {
          detail: { url: url, page: newPage }
        }));
      } catch (evtErr) { /* 忽略 */ }
    } catch (err) {
      console.error("导航失败，使用完整页面跳转：", err);
      try {
        if (window.__moonFx && typeof window.__moonFx._reveal === "function") {
          window.__moonFx._reveal();
        }
      } catch (fxErr2) { /* 忽略 */ }
      window.location.href = url;
    } finally {
      isNavigating = false;
    }
  }

  // ——— 拦截所有内部链接点击 ———
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a) return;
    if (!isInternalHtmlLink(a)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;

    e.preventDefault();
    navigateTo(a.href, true);
  });

  // ——— 处理浏览器前进/后退 ———
  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.url) {
      navigateTo(e.state.url, false);
    }
  });

  // ——— 暴露 navigateTo 供 JS 调用 ———
  window.__navigate = function (url) {
    return navigateTo(url, true);
  };

  // 记录初始页面
  window.__currentPage = location.href;
  history.replaceState({ url: location.href }, "", location.href);

  // ——— 初始页面加载：等模块加载完毕后调用 init ———
  function scheduleInit() {
    var pageName = getPageName(location.href);
    setTimeout(function () {
      callInit(pageName);
    }, 80);
  }

  if (document.readyState === "complete") {
    scheduleInit();
  } else {
    window.addEventListener("load", scheduleInit);
  }
})();
