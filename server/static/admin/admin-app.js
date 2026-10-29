const $ = id => document.getElementById(id);
let token = localStorage.getItem("lisAdminToken") || "";
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem("lisAdminUser") || "null"); } catch (e) { currentUser = null; }
let attemptsCache = [];
let attemptsAllCache = [];
let rosterTestId = "";
let rosterCache = [];
let rosterSelectMode = false;
let retakesCache = [];
let rosterLinkCache = "";
let resultsSort = { key: "when", dir: -1 };
let usersCache = [];
let testsCache = [];
let accSort = { key: "dep", dir: 1 };
let depSort = { key: "name", dir: 1 };
let staffSort = { key: "dep", dir: 1 };
let depModalSort = { key: "role", dir: 1 };
let cadetsSort = { key: "npp", dir: 1 };
let testsSort = { key: "title", dir: 1 };
let rosterSort = { key: "npp", dir: 1 };
let staffCache = [];
let depCache = [];
let cadetsCache = [];
let cadetEditId = "";
const MOD_STATE_KEY = "lisAdminModState";

async function api(path, opts={}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
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

function hasModule(id) {
  if (!currentUser) return false;
  const mods = currentUser.modules;
  if (mods && Object.prototype.hasOwnProperty.call(mods, id)) return !!mods[id];
  return !!(currentUser.is_tester || currentUser.can_flight_sheet);
}
function isFlightSheetUser() {
  return hasModule("flight_sheet");
}
function isLibraryUser() {
  return hasModule("library");
}
function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
  });
  document.querySelectorAll("[data-feature]").forEach(el => {
    el.hidden = !hasModule(el.getAttribute("data-feature"));
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
    await refresh();
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

function normFilterLabel(v) {
  return String(v == null ? "" : v).trim();
}

function uniqueFilterLabels(items, getter) {
  const set = new Set();
  (items || []).forEach(item => {
    const v = normFilterLabel(getter(item));
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
}

function fillFilterSelect(selId, values, allLabel) {
  const sel = $(selId);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>` +
    (values || []).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value = (values || []).indexOf(cur) >= 0 ? cur : "";
}

function matchStreamGroup(item, streamSelId, groupSelId) {
  const streamF = normFilterLabel($(streamSelId) && $(streamSelId).value);
  const groupF = normFilterLabel($(groupSelId) && $(groupSelId).value);
  const stream = normFilterLabel(item.stream_num);
  const group = normFilterLabel(item.group_num);
  if (streamF && stream !== streamF) return false;
  if (groupF && group !== groupF) return false;
  return true;
}

async function refresh() {
  await loadGrading().catch(() => {});
  testsCache = await api("/api/tests");
  renderTestsTable();
  await refreshCatalog().catch(() => {});

  const sel = $("filterTest");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Все тесты</option>` + (testsCache || []).map(t =>
    `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
  sel.value = cur;

  attemptsAllCache = await api("/api/admin/attempts");
  fillCadetFilter();
  renderAttempts();
  try { await refreshCadets(); } catch (e) {}
  if (isFlightSheetUser()) {
    try { await loadFlightSheet(); } catch (e) {}
  }
  if (isLibraryUser()) {
    try { await loadLibrary(); } catch (e) {}
  }
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

$("btnRefresh").onclick = () => refresh().catch(e => alert(e.message));

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeDetail(); closeRoster(); closeDepWindow();
    closeCadetDupModal(); closeCadetImportModal(); closeRosterDupModal();
  }
});

$("btnCopyRetake").onclick = () => {
  const code = ($("lastRetakeCode").value || "").trim();
  if (!code) { alert("Сначала сгенерируйте пароль пересдачи"); return; }
  const b = $("btnCopyRetake");
  copyText(code).then(() => flashCopied(b)).catch(() => {
    try { $("lastRetakeCode").select(); } catch (e) {}
    prompt("Скопируйте пароль:", code);
  });
};

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
  const editFullEl = e.target.closest("[data-edit-full]");
  if (editFullEl && editFullEl.dataset.editFull) {
    const otherCtl = e.target.closest("a,button,input,select,textarea");
    if (!otherCtl || otherCtl.hasAttribute("data-edit-full")) {
      openFullTestEditor(editFullEl.dataset.editFull);
      return;
    }
  }
  const t = e.target.closest("[data-detail],[data-copy],[data-del],[data-unlock],[data-roster],[data-retake],[data-rm-roster],[data-show-retake],[data-del-dep],[data-del-staff],[data-del-user],[data-reset-pw],[data-toggle-user],[data-del-cadet],[data-edit-cadet],[data-edit-test],[data-adopt]") || e.target;
  if (t.dataset && t.dataset.editTest) {
    openEditTest(t.dataset.editTest).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.adopt) {
    adoptCatalogTest(t.dataset.adopt).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.delCadet) {
    if (!confirm("Удалить курсанта из списка?")) return;
    try {
      const res = await api("/api/admin/cadets/" + encodeURIComponent(t.dataset.delCadet), { method: "DELETE" });
      cadetsCache = res.cadets || [];
      renderCadetsTable();
      if (cadetEditId === t.dataset.delCadet) clearCadetForm();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.editCadet) {
    startCadetEdit(t.dataset.editCadet);
    return;
  }
  if (t.dataset && t.dataset.delDep) {
    e.stopPropagation();
    if (!confirm("Удалить отдел и его личный состав?")) return;
    try { await api("/api/admin/departments/" + encodeURIComponent(t.dataset.delDep), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delStaff) {
    if (!confirm("Удалить сотрудника из базы?")) return;
    try { await api("/api/admin/staff/" + encodeURIComponent(t.dataset.delStaff), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delUser) {
    if (!confirm("Удалить учётную запись?")) return;
    try { await api("/api/admin/users/" + encodeURIComponent(t.dataset.delUser), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
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
    return;
  }
  if (t.dataset && t.dataset.showRetake) {
    showLastRetake(t.dataset.showRetake, t.dataset.showNum || "");
    try { $("lastRetakeCode").focus(); $("lastRetakeCode").select(); } catch (err) {}
    return;
  }
  if (t.dataset && t.dataset.roster) {
    openRoster(t.dataset.roster, t.dataset.title).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.rmRoster) {
    removeRosterEntry(t.dataset.rmRoster).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.retake) {
    issueRetake(t.dataset.retake).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.detail) {
    openDetail(t.dataset.detail).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.copy) {
    let text = t.dataset.copy;
    try { text = decodeURIComponent(text); } catch (err) {}
    copyText(text).then(() => flashCopied(t)).catch(() => prompt("Скопируйте:", text));
  }
  if (t.dataset && t.dataset.del) {
    if (!confirm("Удалить тест, список номеров и все результаты?")) return;
    await api("/api/tests/" + encodeURIComponent(t.dataset.del), { method: "DELETE" });
    await refresh();
  }
  if (t.dataset && t.dataset.unlock) {
    if (!confirm("Выдать пароль пересдачи для №" + t.dataset.num + "?")) return;
    const res = await api("/api/admin/unlock", {
      method: "POST",
      json: { test_id: t.dataset.unlock, num: t.dataset.num, call: t.dataset.call, issue_invite: true }
    });
    const code = (res.retake && res.retake.code) || (res.invite && res.invite.code);
    if (rosterTestId === t.dataset.unlock) {
      showLastRetake(code || "", t.dataset.num);
      const data = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster");
      rosterCache = data.roster || [];
      retakesCache = data.retakes || [];
      setRosterMeta(data.access);
      renderRoster();
    } else if (code) {
      alert("Пароль пересдачи для №" + t.dataset.num + ":\n\n" + code);
    }
    await refresh();
  }
});
