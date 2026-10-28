/* Общая навигация: На главную / Назад */
(function () {
  function goBack() {
    try {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch (e) {}
    window.location.href = "/";
  }

  function ensureNav() {
    if (document.getElementById("lisNav")) return;
    var path = location.pathname || "";
    if (path === "/login" || path.indexOf("/login") === 0) return;
    var host = document.querySelector(".wrap") || document.body;
    if (!host) return;
    var nav = document.createElement("nav");
    nav.id = "lisNav";
    nav.className = "lis-nav";
    nav.setAttribute("aria-label", "Навигация");
    var isHome = location.pathname === "/" || location.pathname === "";
    if (!isHome) {
      var home = document.createElement("a");
      home.href = "/";
      home.textContent = "На главную";
      nav.appendChild(home);
    }
    var back = document.createElement("button");
    back.type = "button";
    back.id = "lisNavBack";
    back.textContent = "Назад";
    back.addEventListener("click", goBack);
    nav.appendChild(back);
    if (host === document.body) {
      host.insertBefore(nav, host.firstChild);
    } else {
      host.insertBefore(nav, host.firstChild);
    }
  }

  if (!document.getElementById("lisNavStyle")) {
    var link = document.createElement("link");
    link.id = "lisNavStyle";
    link.rel = "stylesheet";
    link.href = "/static/lis-nav.css";
    document.head.appendChild(link);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureNav);
  } else {
    ensureNav();
  }
})();
