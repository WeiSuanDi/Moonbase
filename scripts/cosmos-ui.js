// 为所有静态页面注入轻量的深空氛围层；不依赖框架，也不拦截页面交互。
(function () {
  function mount() {
    if (document.querySelector('.cosmos-field')) return;
    const field = document.createElement('div');
    field.className = 'cosmos-field';
    field.setAttribute('aria-hidden', 'true');
    field.innerHTML = '<i></i><i></i><i></i><b></b>';
    document.body.prepend(field);
  }

  mount();
  if (window.__moonCosmosUi) return;
  window.__moonCosmosUi = true;
  document.addEventListener('moon:navigation-complete', mount);
})();
