/* Shell for /org — штатная расстановка (admin-only). */
const $ = id => document.getElementById(id);
let token = localStorage.getItem("lisAdminToken") || "";
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem("lisAdminUser") || "null"); } catch (e) { currentUser = null; }

let usersCache = [];
let staffCache = [];
let depCache = [];
let depSort = { key: "name", dir: 1 };
let staffSort = { key: "dep", dir: 1 };
let accSort = { key: "dep", dir: 1 };
let depModalSort = { key: "role", dir: 1 };
const MOD_STATE_KEY = "lisOrgModState";

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers.Authorization = "Bearer " + token;
  if (opts.json) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.message || r.status));
  return data;
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
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
  const parts = [currentUser.display_name || currentUser.login, currentUser.role_label || currentUser.role];
  bar.textContent = parts.filter(Boolean).join(" · ");
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
    if (isAdmin()) await refreshOrg().catch(() => {});
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
    if (typeof closeDepWindow === "function") closeDepWindow();
    if (typeof closeEditDep === "function") closeEditDep();
    if (typeof closeEditStaff === "function") closeEditStaff();
    if (typeof closeEditUser === "function") closeEditUser();
    if (typeof closeStaffDupModal === "function") closeStaffDupModal();
    if (typeof closeAccDupModal === "function") closeAccDupModal();
  }
});

document.addEventListener("click", async e => {
  const editDepRow = e.target.closest("[data-edit-dep]");
  if (editDepRow && !e.target.closest("[data-del-dep]")) {
    if (isAdmin()) openEditDep(editDepRow.getAttribute("data-edit-dep"));
    return;
  }
  const editStaffRow = e.target.closest("[data-edit-staff]");
  if (editStaffRow && !e.target.closest("[data-del-staff]")) {
    if (isAdmin()) openEditStaff(editStaffRow.getAttribute("data-edit-staff"));
    return;
  }
  const editUserRow = e.target.closest("[data-edit-user]");
  if (editUserRow && !e.target.closest("[data-del-user],[data-reset-pw],[data-toggle-user]")) {
    if (isAdmin()) openEditUser(editUserRow.getAttribute("data-edit-user"));
    return;
  }
  const t = e.target.closest("[data-del-dep],[data-del-staff],[data-del-user],[data-reset-pw],[data-toggle-user]") || e.target;
  if (t.dataset && t.dataset.delDep) {
    e.stopPropagation();
    if (!confirm("Удалить отдел и его личный состав?")) return;
    try {
      await api("/api/admin/departments/" + encodeURIComponent(t.dataset.delDep), { method: "DELETE" });
      await refreshOrg();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delStaff) {
    if (!confirm("Удалить сотрудника из базы?")) return;
    try {
      await api("/api/admin/staff/" + encodeURIComponent(t.dataset.delStaff), { method: "DELETE" });
      await refreshOrg();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delUser) {
    if (!confirm("Удалить учётную запись?")) return;
    try {
      await api("/api/admin/users/" + encodeURIComponent(t.dataset.delUser), { method: "DELETE" });
      await refreshOrg();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.resetPw) {
    try {
      const res = await api("/api/admin/users/" + encodeURIComponent(t.dataset.resetPw) + "/password", {
        method: "POST", json: { password: "", must_change_password: true }
      });
      alert("Новый временный пароль:\n\n" + res.temp_password);
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.toggleUser) {
    try {
      await api("/api/admin/users/" + encodeURIComponent(t.dataset.toggleUser) + "/active", {
        method: "POST", json: { active: t.dataset.active === "1" }
      });
      await refreshOrg();
    } catch (err) { alert(err.message); }
  }
});

(async () => {
  try {
    const me = await api("/api/admin/me");
    setCurrentUser(me.user);
    if (!isAdmin()) {
      location.replace("/");
      return;
    }
    if (me.user && me.user.must_change_password) {
      showApp(true, true);
      return;
    }
    showApp(true);
    initModules();
    await refreshOrg();
  } catch (e) {
    token = "";
    setCurrentUser(null);
    localStorage.removeItem("lisAdminToken");
    goHomeLogin();
  }
})();
