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
let testsCache = [];
let cadetsSort = { key: "npp", dir: 1 };
let testsSort = { key: "title", dir: 1 };
let rosterSort = { key: "npp", dir: 1 };
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
  const r = await fetch(path, Object.assign({}, opts, { headers, credentials: "same-origin" }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.message || r.status));
  return data;
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function hasModule(id) {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  const mods = currentUser.modules;
  if (mods && Object.prototype.hasOwnProperty.call(mods, id)) return !!mods[id];
  const levels = currentUser.module_levels;
  if (levels && Object.prototype.hasOwnProperty.call(levels, id)) {
    const lv = levels[id];
    return lv === "read" || lv === "write";
  }
  return !!(currentUser.is_tester || currentUser.can_flight_sheet);
}

function canEditModule(id) {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  const levels = currentUser.module_levels;
  if (levels && Object.prototype.hasOwnProperty.call(levels, id)) return levels[id] === "write";
  return hasModule(id);
}
function isFlightSheetUser() {
  return hasModule("flight_sheet");
}
function isLibraryUser() {
  return hasModule("library");
}
function isInstructorOrAssistantRole() {
  const role = currentUser && currentUser.role;
  return role === "instructor" || role === "assistant";
}

function syncDistRoleVisibility() {
  const staffBrowseOnly = isInstructorOrAssistantRole();
  document.querySelectorAll(".dist-manage-only").forEach(el => {
    el.hidden = staffBrowseOnly;
  });
  const hint = $("distModHint");
  if (hint) {
    hint.textContent = staffBrowseOnly
      ? "Выберите распределение — ниже отобразятся потоки и группы, где вы указаны как инструктор или ассистент."
      : "Документ распределения: у потока общая шапка (сроки, старшие, полигон, итоги), внутри — сворачиваемые группы. Создание и правка документа — у администратора; инструкторы и ассистенты видят состав.";
  }
  if (staffBrowseOnly && typeof setDistBrowseOpen === "function") {
    try { setDistBrowseOpen(true); } catch (e) {}
  }
}

function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
  });
  const isDistEditor = !!(currentUser && (currentUser.role === "admin" || currentUser.role === "senior"));
  document.querySelectorAll(".dist-editor-only").forEach(el => {
    el.hidden = !isDistEditor;
  });
  document.querySelectorAll("[data-feature]").forEach(el => {
    el.hidden = !hasModule(el.getAttribute("data-feature"));
  });
  document.querySelectorAll("[data-feature-write]").forEach(el => {
    el.hidden = !canEditModule(el.getAttribute("data-feature-write"));
  });
  syncDistRoleVisibility();
  try {
    document.dispatchEvent(new CustomEvent("lis-user-ready", { detail: { user: currentUser } }));
  } catch (e) {}
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
  if (typeof bindOwnAvatarPicker === "function") {
    bindOwnAvatarPicker(bar, currentUser, {
      upload: async (uid, file) => {
        const fd = new FormData();
        fd.append("file", file);
        const headers = {};
        if (token) headers.Authorization = "Bearer " + token;
        const r = await fetch("/api/admin/users/" + encodeURIComponent(uid) + "/avatar", {
          method: "POST", headers, body: fd, credentials: "same-origin"
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.message || r.status));
        setCurrentUser(Object.assign({}, currentUser, data.user || {}));
      }
    });
  }
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
function setModOpen(key, open) {
  const mod = document.querySelector('#app .mod[data-mod="' + key + '"]');
  if (!mod) return;
  mod.classList.toggle("collapsed", !open);
  const head = mod.querySelector(".mod-head");
  if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
}

/** Раскрыть модули из ?open=testing,tests или #tests */
function openModulesFromUrl() {
  let keys = [];
  try {
    const q = new URLSearchParams(location.search).get("open") || "";
    if (q.trim()) keys = q.split(",").map(s => s.trim()).filter(Boolean);
  } catch (e) {}
  if (!keys.length && location.hash) {
    const h = String(location.hash || "").replace(/^#/, "").trim();
    if (h) keys = h.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (!keys.length) return;
  // «Мои тесты» живут внутри «Тестирование»
  if (keys.indexOf("tests") >= 0 && keys.indexOf("testing") < 0) keys.unshift("testing");
  keys.forEach(k => setModOpen(k, true));
  saveModState();
  const focusKey = keys.indexOf("tests") >= 0 ? "tests" : keys[keys.length - 1];
  const el = document.querySelector('#app .mod[data-mod="' + focusKey + '"]');
  if (el && el.scrollIntoView) {
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { el.scrollIntoView(true); }
  }
}

function initModules() {
  applyModState();
  openModulesFromUrl();
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
  await refreshModules().catch(() => {});

  const sel = $("filterTest");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Все тесты</option>` + (testsCache || []).map(t =>
    `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
  sel.value = cur;

  attemptsAllCache = await api("/api/admin/attempts");
  fillCadetFilter();
  renderAttempts();
  try { await refreshCadets(); } catch (e) {}
  if (typeof refreshExams === "function") {
    try { await refreshExams(); } catch (e) {}
  }
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
    if (typeof closeCreateModuleTestModal === "function") closeCreateModuleTestModal();
    closeDetail(); closeRoster();
    closeCadetDupModal(); closeCadetImportModal(); closeRosterDupModal();
    if (typeof closeTestQrModal === "function") closeTestQrModal();
    if (typeof closeAllTestMenus === "function") closeAllTestMenus();
  }
});

if ($("btnCloseTestQr")) {
  $("btnCloseTestQr").onclick = () => closeTestQrModal();
}
if ($("testQrModal")) {
  $("testQrModal").addEventListener("click", e => {
    if (e.target === $("testQrModal")) closeTestQrModal();
  });
}

document.addEventListener("click", e => {
  const menuBtn = e.target.closest("[data-test-menu]");
  if (menuBtn) {
    e.preventDefault();
    e.stopPropagation();
    const pop = menuBtn.parentElement && menuBtn.parentElement.querySelector(".test-menu-pop");
    const open = pop && pop.hidden;
    if (typeof closeAllTestMenus === "function") closeAllTestMenus();
    if (pop && open && typeof placeTestMenu === "function") placeTestMenu(menuBtn, pop);
    else if (pop && open) pop.hidden = false;
    return;
  }
  if (!e.target.closest(".test-menu") && !e.target.closest(".test-menu-pop") && typeof closeAllTestMenus === "function") {
    closeAllTestMenus();
  }
  const qrBtn = e.target.closest("[data-show-qr]");
  if (qrBtn && qrBtn.dataset.showQr) {
    e.preventDefault();
    e.stopPropagation();
    openTestQrModal(qrBtn.dataset.showQr, qrBtn.dataset.qrTitle || "");
  }
});

window.addEventListener("scroll", () => {
  if (typeof closeAllTestMenus === "function") closeAllTestMenus();
}, true);
window.addEventListener("resize", () => {
  if (typeof closeAllTestMenus === "function") closeAllTestMenus();
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
  const editFullEl = e.target.closest("[data-edit-full]");
  if (editFullEl && editFullEl.dataset.editFull) {
    const otherCtl = e.target.closest("a,button,input,select,textarea");
    if (!otherCtl || otherCtl.hasAttribute("data-edit-full")) {
      openFullTestEditor(editFullEl.dataset.editFull);
      return;
    }
  }
  const t = e.target.closest("[data-detail],[data-copy],[data-del],[data-unlock],[data-roster],[data-retake],[data-rm-roster],[data-show-retake],[data-del-cadet],[data-edit-cadet],[data-edit-test]") || e.target;
  if (t.dataset && t.dataset.editTest) {
    openEditTest(t.dataset.editTest).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.delCadet) {
    if (!confirm("Удалить курсанта из списка?")) return;
    try {
      const res = await api("/api/admin/cadets/" + encodeURIComponent(t.dataset.delCadet), { method: "DELETE" });
      if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
      else cadetsCache = res.cadets || [];
      renderCadetsTable();
      if (cadetEditId === t.dataset.delCadet) clearCadetForm();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.editCadet) {
    startCadetEdit(t.dataset.editCadet);
    return;
  }
  if (t.dataset && t.dataset.showRetake) {
    showLastRetake(t.dataset.showRetake, t.dataset.showNum || "");
    try { $("lastRetakeCode").focus(); $("lastRetakeCode").select(); } catch (err) {}
    return;
  }
  if (t.dataset && t.dataset.roster) {
    openRoster(t.dataset.roster, t.dataset.title, t.dataset.audience || "").catch(err => alert(err.message));
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
