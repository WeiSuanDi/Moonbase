// 客户端导航器：拦截内部链接，用 fetch + pushState 实现无刷新页面切换
// 保持 <audio> 和音乐按钮在导航过程中不被销毁，从而实现无缝背景音乐
(function () {
  "use strict";

  if (window.__moonNavigator) return;
  window.__moonNavigator = true;

  var isNavigating = false;

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
    if (s.src && (s.src.indexOf("navigator.js") !== -1 || s.src.indexOf("music-player.js") !== -1)) {
      return true;
    }
    return false;
  }

  function filterAttrs(attrs) {
    return attrs.filter(function (a) {
      if (a.name === "src") {
        return a.value.indexOf("navigator.js") === -1 && a.value.indexOf("music-player.js") === -1;
      }
      return true;
    });
  }

  // 异步注入脚本，等待模块加载完成
  function injectScriptsAsync(scripts) {
    return new Promise(function (resolve) {
      // 排序：importmap → module → 其他
      var ordered = [];
      ordered = ordered.concat(scripts.filter(function (s) { return s.type === "importmap"; }));
      ordered = ordered.concat(scripts.filter(function (s) { return s.type === "module"; }));
      ordered = ordered.concat(scripts.filter(function (s) { return s.type !== "importmap" && s.type !== "module"; }));

      var pending = 0;

      function checkDone() {
        pending--;
        if (pending <= 0) {
          // 给模块代码体一点执行时间
          setTimeout(resolve, 20);
        }
      }

      // 过滤掉需要跳过的脚本
      ordered = ordered.filter(function (s) { return !isSkippedScript(s); });

      // 计算需要等待的异步脚本数
      var asyncScripts = ordered.filter(function (s) { return s.src && s.type === "module"; });
      pending = asyncScripts.length;

      if (pending === 0) {
        // 全同步，直接注入
        ordered.forEach(function (s) {
          appendScript(s);
        });
        resolve();
        return;
      }

      // 先注入非模块脚本（同步执行）
      ordered.forEach(function (s) {
        if (!s.src || s.type !== "module") {
          appendScript(s);
        }
      });

      // 再注入模块脚本（需要等待加载）
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

  // ——— 核心：导航到指定 URL ———
  async function navigateTo(url, addToHistory) {
    if (isNavigating) return;
    isNavigating = true;

    // 1. 调用旧页面的清理函数
    if (typeof window.__pageCleanup === "function") {
      try { window.__pageCleanup(); } catch (e) { console.warn("页面清理失败：", e); }
    }
    delete window.__pageInit;
    delete window.__pageCleanup;

    try {
      // 2. 获取目标页面
      var response = await fetch(url);
      if (!response.ok) throw new Error("HTTP " + response.status);
      var html = await response.text();

      // 3. 解析 HTML
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, "text/html");

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

      // 14. 调用新页面的初始化函数
      if (typeof window.__pageInit === "function") {
        try { window.__pageInit(); } catch (e) { console.warn("页面初始化失败：", e); }
      }
    } catch (err) {
      console.error("导航失败，使用完整页面跳转：", err);
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
    navigateTo(url, true);
  };

  // 记录初始页面
  window.__currentPage = location.href;
  history.replaceState({ url: location.href }, "", location.href);

  // ——— 初始页面加载：等模块加载完毕后调用 init ———
  function scheduleInit() {
    setTimeout(function () {
      if (typeof window.__pageInit === "function") {
        try { window.__pageInit(); } catch (e) { console.warn("初始页面初始化失败：", e); }
      }
    }, 80);
  }

  if (document.readyState === "complete") {
    scheduleInit();
  } else {
    window.addEventListener("load", scheduleInit);
  }
})();
