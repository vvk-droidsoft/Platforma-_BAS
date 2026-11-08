/* Shell for /org — штатная расстановка. Структура — всем с доступом к штатке (ЛС — чтение, senior своего отдела — правка);
   конфигуратор ЛС и учётные записи — только admin. */
const $ = id => document.getElementById(id);
let token = localStorage.getItem("lisAdminToken") || "";
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem("lisAdminUser") || "null"); } catch (e) { currentUser = null; }

let usersCache = [];
let staffCache = [];
/** Активные отделы (для всех списков). */
let depCache = [];
/** Все отделы, включая архивные (только admin, для конфигуратора). */
let depAll = [];
/** Активные должности из справочника job_titles (источник для всех select). */
let jobTitlesCache = [];
/** Все должности, включая архивные (только admin). */
let jobTitlesAll = [];
let structSort = { key: "role", dir: 1 };
let accSort = { key: "dep", dir: 1 };
const MOD_STATE_KEY = "lisOrgModState";

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = "Bearer " + token;
  if (opts.json) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, Object.assign({}, opts, { headers, credentials: "same-origin" }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.message || r.status));
  return data;
}

function isAdmin() {
  return !!(currentUser && currentUser.role === "admin");
}

function isSenior() {
  return !!(currentUser && currentUser.role === "senior");
}

function canAccessOrg() {
  const role = currentUser && currentUser.role;
  return role === "admin" || role === "senior" || role === "instructor" || role === "assistant";
}

function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
  });
  document.querySelectorAll(".staff-org").forEach(el => {
    el.hidden = !canAccessOrg();
  });
}

function updateUserBar() {
  const bar = $("userBar");
  const btnPw = $("btnChangePw");
  if (!currentUser) {
    bar.classList.add("hidden");
    btnPw.classList.add("hidden");
    bar.textContent = "";
    return;
  }
  bar.innerHTML = typeof userBarHtml === "function" ? userBarHtml(currentUser) : esc(
    [currentUser.display_name || currentUser.login, currentUser.role_label || currentUser.role].filter(Boolean).join(" · ")
  );
  bar.classList.remove("hidden");
  btnPw.classList.remove("hidden");
}

function goHomeLogin() {
  location.replace("/login");
}

function showApp(ok, forcePw) {
  if (!ok) {
    goHomeLogin();
    return;
  }
  $("pwBox").classList.add("hidden");
  $("app").classList.toggle("hidden", !!forcePw);
  $("btnLogout").classList.toggle("hidden", false);
  $("btnChangePw").classList.toggle("hidden", false);
  if (forcePw) {
    $("pwBox").classList.remove("hidden");
    $("pwHint").textContent = "Задан временный пароль — установите свой, чтобы продолжить.";
    $("btnPwCancel").classList.add("hidden");
  } else if ($("btnPwCancel")) {
    $("btnPwCancel").classList.remove("hidden");
  }
}

async function savePassword() {
  $("pwMsg").textContent = "";
  if ($("pwNew").value !== $("pwNew2").value) {
    $("pwMsg").innerHTML = '<span class="bad">Пароли не совпадают</span>';
    return;
  }
  try {
    const res = await api("/api/admin/change-password", {
      method: "POST",
      json: { old_password: $("pwOld").value, new_password: $("pwNew").value }
    });
    token = res.token;
    localStorage.setItem("lisAdminToken", token);
    setCurrentUser(res.user);
    $("pwOld").value = "";
    $("pwNew").value = "";
    $("pwNew2").value = "";
    showApp(true);
    initModules();
    if (canAccessOrg()) await refreshOrg().catch(() => {});
  } catch (e) {
    $("pwMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function loadModState() {
  try { return JSON.parse(localStorage.getItem(MOD_STATE_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function saveModState() {
  const st = {};
  document.querySelectorAll("#app .mod[data-mod]").forEach(mod => {
    st[mod.dataset.mod] = !mod.classList.contains("collapsed");
  });
  try { localStorage.setItem(MOD_STATE_KEY, JSON.stringify(st)); } catch (e) {}
}
function applyModState() {
  const st = loadModState();
  document.querySelectorAll("#app .mod[data-mod]").forEach(mod => {
    const key = mod.dataset.mod;
    if (Object.prototype.hasOwnProperty.call(st, key)) {
      mod.classList.toggle("collapsed", !st[key]);
    }
    const head = mod.querySelector(".mod-head");
    if (head) head.setAttribute("aria-expanded", mod.classList.contains("collapsed") ? "false" : "true");
  });
}
function initModules() {
  applyModState();
  document.querySelectorAll("#app .mod-head").forEach(head => {
    if (head._lisModBound) return;
    head._lisModBound = true;
    head.addEventListener("click", () => {
      const mod = head.closest(".mod");
      if (!mod) return;
      mod.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", mod.classList.contains("collapsed") ? "false" : "true");
      saveModState();
    });
  });
}

$("btnLogout").onclick = async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } catch (e) {}
  token = "";
  setCurrentUser(null);
  localStorage.removeItem("lisAdminToken");
  goHomeLogin();
};
$("btnChangePw").onclick = () => {
  $("pwBox").classList.remove("hidden");
  $("btnPwCancel").classList.remove("hidden");
  $("pwHint").textContent = "Смена пароля учётной записи.";
};
$("btnPwSave").onclick = () => savePassword().catch(e => alert(e.message));
$("btnPwCancel").onclick = () => $("pwBox").classList.add("hidden");

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (typeof closeEditTitle === "function") closeEditTitle();
    if (typeof closeEditDep === "function") closeEditDep();
    if (typeof closeEditStaff === "function") closeEditStaff();
    if (typeof closeEditUser === "function") closeEditUser();
    if (typeof closeStaffDupModal === "function") closeStaffDupModal();
    if (typeof closeAccDupModal === "function") closeAccDupModal();
  }
});

document.addEventListener("click", async e => {
  // кнопки действий внутри строк — раньше клика по строке
  const act = e.target.closest(
    "[data-del-dep],[data-restore-dep],[data-archive-title],[data-restore-title]," +
    "[data-del-user],[data-restore-user],[data-reset-pw],[data-toggle-user]"
  );
  if (act) {
    e.stopPropagation();
    const d = act.dataset;
    try {
      if (d.delDep) {
        if (!confirm("Архивировать отдел? Данные сохранятся, отдел можно восстановить.")) return;
        await api("/api/admin/departments/" + encodeURIComponent(d.delDep), { method: "DELETE" });
      } else if (d.restoreDep) {
        await api("/api/admin/departments/" + encodeURIComponent(d.restoreDep) + "/restore", { method: "POST" });
      } else if (d.archiveTitle) {
        if (!confirm("Архивировать должность? Она исчезнет из списков выбора.")) return;
        await api("/api/admin/job-titles/" + encodeURIComponent(d.archiveTitle) + "/archive", { method: "POST" });
      } else if (d.restoreTitle) {
        await api("/api/admin/job-titles/" + encodeURIComponent(d.restoreTitle) + "/restore", { method: "POST" });
      } else if (d.delUser) {
        if (!confirm("Архивировать учётную запись? Вход будет отключён, данные сохранятся.")) return;
        await api("/api/admin/users/" + encodeURIComponent(d.delUser), { method: "DELETE" });
      } else if (d.restoreUser) {
        await api("/api/admin/users/" + encodeURIComponent(d.restoreUser) + "/restore", { method: "POST" });
      } else if (d.resetPw) {
        const res = await api("/api/admin/users/" + encodeURIComponent(d.resetPw) + "/password", {
          method: "POST", json: { password: "", must_change_password: true }
        });
        alert("Новый временный пароль:\n\n" + res.temp_password);
        return;
      } else if (d.toggleUser) {
        await api("/api/admin/users/" + encodeURIComponent(d.toggleUser) + "/active", {
          method: "POST", json: { active: d.active === "1" }
        });
      }
      await refreshOrg();
    } catch (err) { alert(err.message); }
    return;
  }
  const editDepRow = e.target.closest("[data-edit-dep]");
  if (editDepRow) {
    if (isAdmin()) openEditDep(editDepRow.getAttribute("data-edit-dep"));
    return;
  }
  const editTitleRow = e.target.closest("[data-edit-title]");
  if (editTitleRow) {
    if (isAdmin() && typeof openEditTitle === "function") {
      openEditTitle(editTitleRow.getAttribute("data-edit-title"));
    }
    return;
  }
  const staffCardRow = e.target.closest("[data-staff-card]");
  if (staffCardRow) {
    const sid = staffCardRow.getAttribute("data-staff-card");
    if (sid && typeof openStaffCard === "function") {
      openStaffCard(sid).catch(err => alert((err && err.message) || "Ошибка"));
    }
    return;
  }
  const editUserRow = e.target.closest("[data-edit-user]");
  if (editUserRow) {
    if (isAdmin()) openEditUser(editUserRow.getAttribute("data-edit-user"));
  }
});

/** Стартует после admin-org.js (там определён refreshOrg) — иначе гонка с await /api/admin/me. */
async function bootOrgPage() {
  try {
    const me = await api("/api/admin/me");
    if (me.token) {
      token = me.token;
      localStorage.setItem("lisAdminToken", token);
    }
    setCurrentUser(me.user);
    if (!canAccessOrg()) {
      location.replace("/");
      return;
    }
    if (me.user && me.user.must_change_password) {
      showApp(true, true);
      return;
    }
    showApp(true);
    initModules();
    if (!isAdmin()) {
      const structMod = document.querySelector('#app .mod[data-mod="org-structure"]');
      if (structMod) {
        structMod.classList.remove("collapsed");
        const head = structMod.querySelector(".mod-head");
        if (head) head.setAttribute("aria-expanded", "true");
        try { saveModState(); } catch (e) {}
      }
    }
    try {
      await refreshOrg();
    } catch (e) {
      alert((e && e.message) || "Не удалось загрузить штатку");
    }
  } catch (e) {
    token = "";
    setCurrentUser(null);
    localStorage.removeItem("lisAdminToken");
    goHomeLogin();
  }
}
