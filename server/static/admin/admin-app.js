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
const STAFF_ROLE_ORDER = { senior: 0, instructor: 1, assistant: 2, admin: -1 };

function cmpSortVal(a, b, dir) {
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) return (a - b) * dir;
    return 0;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), "ru", { numeric: true, sensitivity: "base" }) * dir;
}

function sortMarkHtml(state, key) {
  return state.key === key ? (state.dir > 0 ? "▲" : "▼") : "";
}

function thSortHtml(state, key, label) {
  if (!key) return "<th></th>";
  return `<th class="sortable" data-sort="${key}">${label}<span class="sort-mark">${sortMarkHtml(state, key)}</span></th>`;
}

function bindTableSort(headId, state, redraw) {
  const el = $(headId);
  if (!el || el._lisSortBound) return;
  el._lisSortBound = true;
  el.addEventListener("click", e => {
    const th = e.target.closest("[data-sort]");
    if (!th || !th.dataset.sort) return;
    const key = th.dataset.sort;
    if (state.key === key) state.dir = -state.dir;
    else {
      state.key = key;
      state.dir = key === "when" ? -1 : 1;
    }
    redraw();
  });
}

/** Копирование работает и по HTTP (не только HTTPS/localhost). */
function copyText(text) {
  const value = String(text ?? "");
  if (!value) return Promise.reject(new Error("Пусто"));
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(value).catch(function () {
      return copyTextFallback(value);
    });
  }
  return copyTextFallback(value);
}
function copyTextFallback(value) {
  return new Promise(function (resolve, reject) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    } catch (e) {
      reject(e);
    }
  });
}
function flashCopied(btn, ms) {
  if (!btn) return;
  const label = btn.textContent;
  btn.textContent = "Скопировано";
  setTimeout(function () { btn.textContent = label; }, ms || 1200);
}

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
function canPublishForAll() {
  return currentUser && (currentUser.role === "admin" || currentUser.role === "senior");
}
function canEditTestParams() {
  return canPublishForAll();
}
function canEditOwnTest(t) {
  if (!currentUser || !t) return false;
  if (currentUser.role === "admin") return true;
  return !!(t.owner_user_id && t.owner_user_id === currentUser.id);
}
function openFullTestEditor(testId) {
  if (!testId) return;
  location.href = "/tools/generator?edit=" + encodeURIComponent(testId);
}
function canEditGrade() {
  return currentUser && (currentUser.role === "admin" || currentUser.role === "senior");
}

function isFlightSheetUser() {
  if (!currentUser) return false;
  const wanted = "си_тестер";
  const login = String(currentUser.login || "").trim().toLowerCase();
  const name = String(currentUser.display_name || "").trim().toLowerCase();
  return login === wanted || name === wanted;
}
function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
  });
  document.querySelectorAll(".flight-sheet-only, .library-only").forEach(el => {
    el.hidden = !isFlightSheetUser();
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

function originLink(path) {
  return location.origin + path;
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

function staffStatsForDep(depId) {
  const list = (staffCache || []).filter(s => s.department_id === depId);
  const senior = list.filter(s => s.role === "senior").length;
  const instructor = list.filter(s => s.role === "instructor").length;
  const assistant = list.filter(s => s.role === "assistant").length;
  return {
    senior,
    instructor,
    assistant,
    total: senior + instructor + assistant
  };
}

function syncDetailAddForm() {
  const depF = ($("filterStaffDep") && $("filterStaffDep").value) || "";
  const hint = $("detailAddHint");
  const form = $("detailAddForm");
  if (!hint || !form) return;
  if (!depF) {
    hint.textContent = "Выберите отдел";
    hint.classList.remove("hidden");
    form.style.display = "none";
    return;
  }
  const dep = (depCache || []).find(d => d.id === depF);
  hint.textContent = "Отдел: " + (dep ? dep.name : "");
  hint.classList.remove("hidden");
  form.style.display = "flex";
}

function staffSortValue(s, key) {
  switch (key) {
    case "dep": return s.department_name || "";
    case "role": return STAFF_ROLE_ORDER[s.role] != null ? STAFF_ROLE_ORDER[s.role] : 9;
    case "fio": return s.fio || "";
    case "call": return s.callsign || "";
    default: return "";
  }
}

function sortedStaffList(list, state) {
  const arr = (list || []).slice();
  const { key, dir } = state;
  arr.sort((a, b) => cmpSortVal(staffSortValue(a, key), staffSortValue(b, key), dir));
  return arr;
}

function renderStaffTable() {
  const depF = ($("filterStaffDep") && $("filterStaffDep").value) || "";
  const roleF = ($("filterStaffRole") && $("filterStaffRole").value) || "";
  const showDep = !depF;
  let list = staffCache || [];
  if (depF) list = list.filter(s => s.department_id === depF);
  if (roleF) list = list.filter(s => s.role === roleF);
  list = sortedStaffList(list, staffSort);
  const cols = showDep ? 5 : 4;
  if ($("staffHead")) {
    const parts = [];
    if (showDep) parts.push(thSortHtml(staffSort, "dep", "Отдел"));
    parts.push(thSortHtml(staffSort, "role", "Роль"));
    parts.push(thSortHtml(staffSort, "fio", "ФИО"));
    parts.push(thSortHtml(staffSort, "call", "Позывной"));
    parts.push("<th></th>");
    $("staffHead").innerHTML = parts.join("");
  }
  $("staffBody").innerHTML = list.map(s =>
    `<tr class="row-click" data-edit-staff="${esc(s.id)}" title="Нажмите для редактирования">
      ${showDep ? `<td>${esc(s.department_name)}</td>` : ""}
      <td>${esc(s.role_label || s.role)}</td>
      <td>${esc(s.fio)}</td>
      <td>${esc(s.callsign)}</td>
      <td><button class="btn" type="button" data-del-staff="${esc(s.id)}">Удалить</button></td>
    </tr>`
  ).join("") || `<tr><td colspan="${cols}" class="hint">Нет сотрудников по выбранному фильтру</td></tr>`;
  if ($("orgDetailMeta")) {
    $("orgDetailMeta").textContent = list.length ? (" · " + list.length) : "";
  }
  syncDetailAddForm();
}

let openDepId = "";

function renderDepModalHead() {
  if (!$("depModalHead")) return;
  $("depModalHead").innerHTML =
    thSortHtml(depModalSort, "role", "Роль") +
    thSortHtml(depModalSort, "fio", "ФИО") +
    thSortHtml(depModalSort, "call", "Позывной");
}

function renderDepModalBody() {
  if (!openDepId) return;
  const roleF = ($("depModalRole") && $("depModalRole").value) || "";
  let list = (staffCache || []).filter(s => s.department_id === openDepId);
  if (roleF) list = list.filter(s => s.role === roleF);
  list = sortedStaffList(list, depModalSort);
  const st = staffStatsForDep(openDepId);
  $("depModalSub").textContent =
    "Всего: " + st.total + " · СИ: " + st.senior + " · И: " + st.instructor + " · АИ: " + st.assistant;
  renderDepModalHead();
  $("depModalBody").innerHTML = list.map(s =>
    `<tr class="row-click" data-edit-staff="${esc(s.id)}" title="Нажмите для редактирования">
      <td>${esc(s.role_label || s.role)}</td>
      <td>${esc(s.fio)}</td>
      <td>${esc(s.callsign)}</td>
    </tr>`
  ).join("") || `<tr><td colspan="3" class="hint">В отделе нет сотрудников по фильтру</td></tr>`;
}

function openDepWindow(depId) {
  const dep = (depCache || []).find(d => d.id === depId);
  if (!dep) return;
  openDepId = depId;
  $("depModalTitle").textContent = "Отдел · " + (dep.name || "");
  if ($("depModalRole")) $("depModalRole").value = "";
  renderDepModalBody();
  $("depModal").classList.remove("hidden");
}

function closeDepWindow() {
  openDepId = "";
  $("depModal").classList.add("hidden");
}

function openOrgDetailModule(depId) {
  const mod = document.querySelector('#app .mod[data-mod="org-detail"]');
  if (mod) {
    mod.classList.remove("collapsed");
    const head = mod.querySelector(".mod-head");
    if (head) head.setAttribute("aria-expanded", "true");
    try { saveModState(); } catch (e) {}
    mod.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if ($("filterStaffDep") && depId) {
    $("filterStaffDep").value = depId;
  }
  if ($("filterStaffRole")) $("filterStaffRole").value = "";
  renderStaffTable();
}

async function refreshOrg() {
  if (!isAdmin()) return;
  const prevDep = ($("filterStaffDep") && $("filterStaffDep").value) || "";
  const prevRole = ($("filterStaffRole") && $("filterStaffRole").value) || "";
  const prevAccDep = ($("filterAccDep") && $("filterAccDep").value) || "";
  const prevAccRole = ($("filterAccRole") && $("filterAccRole").value) || "";
  const prevStaffDep = ($("staffDep") && $("staffDep").value) || "";
  depCache = await api("/api/admin/departments");
  staffCache = await api("/api/admin/staff");
  const users = await api("/api/admin/users");
  renderDepsTable();
  $("staffDep").innerHTML = depCache.map(d =>
    `<option value="${esc(d.id)}">${esc(d.name)}</option>`
  ).join("");
  if (prevStaffDep && depCache.some(d => d.id === prevStaffDep)) $("staffDep").value = prevStaffDep;
  $("accDep").innerHTML = `<option value="">—</option>` + depCache.map(d =>
    `<option value="${esc(d.id)}">${esc(d.name)}</option>`
  ).join("");
  if ($("filterStaffDep")) {
    $("filterStaffDep").innerHTML = `<option value="">Все отделы</option>` + depCache.map(d =>
      `<option value="${esc(d.id)}">${esc(d.name)}</option>`
    ).join("");
    if (prevDep && depCache.some(d => d.id === prevDep)) $("filterStaffDep").value = prevDep;
  }
  if ($("filterStaffRole") && prevRole) $("filterStaffRole").value = prevRole;
  if ($("filterAccDep")) {
    $("filterAccDep").innerHTML = `<option value="">Все отделы</option>` + depCache.map(d =>
      `<option value="${esc(d.id)}">${esc(d.name)}</option>`
    ).join("") + `<option value="__none__">Без отдела</option>`;
    if (prevAccDep === "__none__" || (prevAccDep && depCache.some(d => d.id === prevAccDep))) {
      $("filterAccDep").value = prevAccDep;
    }
  }
  if ($("filterAccRole") && prevAccRole) $("filterAccRole").value = prevAccRole;
  renderStaffTable();
  if (openDepId) renderDepModalBody();
  $("accStaff").innerHTML = `<option value="">— вручную —</option>` + staffCache.map(s =>
    `<option value="${esc(s.id)}" data-role="${esc(s.role)}" data-dep="${esc(s.department_id)}" data-fio="${esc(s.fio)}">${esc(s.department_name)} · ${esc(s.role_label)} · ${esc(s.fio)}${s.callsign ? " (" + esc(s.callsign) + ")" : ""}</option>`
  ).join("");
  usersCache = users || [];
  renderAccounts();
}

function depSortValue(d, key) {
  const st = staffStatsForDep(d.id);
  switch (key) {
    case "name": return d.name || "";
    case "total": return st.total;
    case "senior": return st.senior;
    case "instructor": return st.instructor;
    case "assistant": return st.assistant;
    default: return "";
  }
}

function renderDepsHead() {
  if (!$("depHead")) return;
  $("depHead").innerHTML =
    thSortHtml(depSort, "name", "Отдел") +
    thSortHtml(depSort, "total", '<span class="th-stack">Количество<br>человек<br>в отделе</span>') +
    thSortHtml(depSort, "senior", "СИ") +
    thSortHtml(depSort, "instructor", "И") +
    thSortHtml(depSort, "assistant", "АИ") +
    "<th></th>";
}

function renderDepsTable() {
  renderDepsHead();
  const list = (depCache || []).slice().sort((a, b) =>
    cmpSortVal(depSortValue(a, depSort.key), depSortValue(b, depSort.key), depSort.dir)
  );
  $("depBody").innerHTML = list.map(d => {
    const st = staffStatsForDep(d.id);
    return `<tr class="row-click" data-edit-dep="${esc(d.id)}" title="Нажмите для редактирования">
      <td class="dep-name">${esc(d.name)}</td>
      <td>${st.total}</td>
      <td>${st.senior}</td>
      <td>${st.instructor}</td>
      <td>${st.assistant}</td>
      <td><button class="btn" type="button" data-del-dep="${esc(d.id)}">Удалить</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="hint">Пока нет отделов</td></tr>`;
}

function userSortValue(u, key) {
  switch (key) {
    case "login": return (u.login || "").toString();
    case "name": return (u.display_name || "").toString();
    case "role": {
      const order = { admin: 0, senior: 1, instructor: 2, assistant: 3 };
      return order[u.role] != null ? order[u.role] : 9;
    }
    case "dep": return (u.department_name || "").toString();
    case "password": return (u.password || "").toString();
    case "status": return u.active ? 0 : 1;
    default: return "";
  }
}

function sortedUsers(list) {
  const arr = (list || []).slice();
  const { key, dir } = accSort;
  arr.sort((a, b) => {
    if (key === "dep") {
      const ea = !(a.department_name || "").trim();
      const eb = !(b.department_name || "").trim();
      if (ea !== eb) return (ea ? 1 : -1) * dir;
    }
    return cmpSortVal(userSortValue(a, key), userSortValue(b, key), dir);
  });
  return arr;
}

function filteredUsers(list) {
  const depF = ($("filterAccDep") && $("filterAccDep").value) || "";
  const roleF = ($("filterAccRole") && $("filterAccRole").value) || "";
  const fioF = (($("filterAccFio") && $("filterAccFio").value) || "").trim().toLowerCase();
  return (list || []).filter(u => {
    if (depF) {
      if (depF === "__none__") {
        if ((u.department_id || "").trim()) return false;
      } else if ((u.department_id || "") !== depF) {
        return false;
      }
    }
    if (roleF && (u.role || "") !== roleF) return false;
    if (fioF) {
      const login = String(u.login || "").toLowerCase();
      const name = String(u.display_name || "").toLowerCase();
      const surname = name.split(/\s+/)[0] || "";
      const call = String(u.callsign || u.staff_callsign || "").toLowerCase();
      if (
        !login.includes(fioF) &&
        !surname.includes(fioF) &&
        !name.includes(fioF) &&
        !call.includes(fioF)
      ) return false;
    }
    return true;
  });
}

function renderAccHead() {
  if (!$("accHead")) return;
  $("accHead").innerHTML =
    thSortHtml(accSort, "login", "Логин") +
    thSortHtml(accSort, "name", "Имя") +
    thSortHtml(accSort, "role", "Роль") +
    thSortHtml(accSort, "dep", "Отдел") +
    thSortHtml(accSort, "password", "Пароль") +
    thSortHtml(accSort, "status", "Статус") +
    "<th></th>";
}

function renderAccounts() {
  renderAccHead();
  const rows = sortedUsers(filteredUsers(usersCache));
  $("accBody").innerHTML = rows.map(u =>
    `<tr class="row-click" data-edit-user="${esc(u.id)}" title="Нажмите для редактирования">
      <td>${esc(u.login)}</td>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.role_label || u.role)}</td>
      <td>${esc(u.department_name || "—")}</td>
      <td style="color:var(--warn);letter-spacing:.04em">${esc(u.password || "—")}</td>
      <td>${u.active ? "активен" : "отключён"}</td>
      <td class="acc-actions">
        <button class="btn" type="button" data-reset-pw="${esc(u.id)}">Новый пароль</button>
        <span class="acc-actions-pair">
          <button class="btn" type="button" data-toggle-user="${esc(u.id)}" data-active="${u.active ? 0 : 1}">${u.active ? "Отключить" : "Включить"}</button>
          <button class="btn danger" type="button" data-del-user="${esc(u.id)}">Удалить</button>
        </span>
      </td>
    </tr>`
  ).join("") || `<tr><td colspan="7" class="hint">Нет учётных записей</td></tr>`;
}

let editDepId = "";
let editStaffId = "";
let editUserId = "";

function fillEditDepSelects(selId, selected) {
  const el = $(selId);
  if (!el) return;
  el.innerHTML = (depCache || []).map(d =>
    `<option value="${esc(d.id)}">${esc(d.name)}</option>`
  ).join("");
  if (selected && (depCache || []).some(d => d.id === selected)) el.value = selected;
}

function openEditDep(depId) {
  if (!isAdmin()) return;
  const dep = (depCache || []).find(d => d.id === depId);
  if (!dep) return;
  editDepId = depId;
  $("editDepName").value = dep.name || "";
  $("editDepMsg").textContent = "";
  $("editDepModal").classList.remove("hidden");
  try { $("editDepName").focus(); $("editDepName").select(); } catch (e) {}
}

function closeEditDep() {
  editDepId = "";
  $("editDepModal").classList.add("hidden");
}

async function saveEditDep() {
  if (!isAdmin() || !editDepId) return;
  const name = ($("editDepName").value || "").trim();
  if (!name) {
    $("editDepMsg").innerHTML = '<span class="bad">Укажите название</span>';
    return;
  }
  $("editDepMsg").textContent = "Сохранение…";
  try {
    await api("/api/admin/departments/" + encodeURIComponent(editDepId), {
      method: "PUT",
      json: { name }
    });
    const id = editDepId;
    closeEditDep();
    await refreshOrg();
    if (openDepId === id) {
      const dep = (depCache || []).find(d => d.id === id);
      if (dep) $("depModalTitle").textContent = "Отдел · " + (dep.name || "");
      renderDepModalBody();
    }
  } catch (e) {
    $("editDepMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function openEditStaff(staffId) {
  if (!isAdmin()) return;
  const s = (staffCache || []).find(x => x.id === staffId);
  if (!s) return;
  editStaffId = staffId;
  fillEditDepSelects("editStaffDep", s.department_id);
  $("editStaffRole").value = s.role || "instructor";
  $("editStaffFio").value = s.fio || "";
  $("editStaffCall").value = s.callsign || "";
  $("editStaffMsg").textContent = "";
  $("editStaffModal").classList.remove("hidden");
  try { $("editStaffFio").focus(); } catch (e) {}
}

function closeEditStaff() {
  editStaffId = "";
  $("editStaffModal").classList.add("hidden");
}

async function saveEditStaff() {
  if (!isAdmin() || !editStaffId) return;
  const department_id = ($("editStaffDep").value || "").trim();
  const role = ($("editStaffRole").value || "").trim();
  const fio = ($("editStaffFio").value || "").trim();
  const callsign = ($("editStaffCall").value || "").trim();
  if (!department_id || !fio) {
    $("editStaffMsg").innerHTML = '<span class="bad">Укажите отдел и ФИО</span>';
    return;
  }
  $("editStaffMsg").textContent = "Сохранение…";
  try {
    await api("/api/admin/staff/" + encodeURIComponent(editStaffId), {
      method: "PUT",
      json: { department_id, role, fio, callsign }
    });
    closeEditStaff();
    await refreshOrg();
  } catch (e) {
    $("editStaffMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function syncEditUserDepVisibility() {
  const role = ($("editUserRole") && $("editUserRole").value) || "";
  const dep = $("editUserDep");
  if (!dep) return;
  dep.disabled = role === "admin";
  if (role === "admin") dep.value = "";
}

function openEditUser(userId) {
  if (!isAdmin()) return;
  const u = (usersCache || []).find(x => x.id === userId);
  if (!u) return;
  editUserId = userId;
  $("editUserLogin").value = u.login || "";
  $("editUserName").value = u.display_name || "";
  $("editUserRole").value = u.role || "instructor";
  const depEl = $("editUserDep");
  depEl.innerHTML = `<option value="">—</option>` + (depCache || []).map(d =>
    `<option value="${esc(d.id)}">${esc(d.name)}</option>`
  ).join("");
  depEl.value = u.department_id || "";
  if ($("editUserCall")) {
    $("editUserCall").value = u.callsign || u.staff_callsign || "";
  }
  if ($("editUserPass")) {
    $("editUserPass").value = "";
    $("editUserPass").placeholder = u.password
      ? ("Сейчас: " + u.password + " · пусто — не менять")
      : "Пусто — не менять";
  }
  if ($("editUserMustChange")) $("editUserMustChange").checked = true;
  syncEditUserDepVisibility();
  $("editUserMsg").textContent = "";
  $("editUserModal").classList.remove("hidden");
  try { $("editUserLogin").focus(); } catch (e) {}
}

function closeEditUser() {
  editUserId = "";
  $("editUserModal").classList.add("hidden");
}

async function saveEditUser() {
  if (!isAdmin() || !editUserId) return;
  const login = ($("editUserLogin").value || "").trim();
  const display_name = ($("editUserName").value || "").trim();
  const role = ($("editUserRole").value || "").trim();
  let department_id = ($("editUserDep").value || "").trim() || null;
  const callsign = ($("editUserCall") && $("editUserCall").value || "").trim();
  const password = ($("editUserPass") && $("editUserPass").value || "").trim();
  const must_change_password = !!($("editUserMustChange") && $("editUserMustChange").checked);
  if (role === "admin") department_id = null;
  if (!login) {
    $("editUserMsg").innerHTML = '<span class="bad">Укажите логин</span>';
    return;
  }
  if (role !== "admin" && !department_id) {
    $("editUserMsg").innerHTML = '<span class="bad">Для этой роли нужен отдел</span>';
    return;
  }
  if (password && password.length < 4) {
    $("editUserMsg").innerHTML = '<span class="bad">Пароль: минимум 4 символа</span>';
    return;
  }
  $("editUserMsg").textContent = "Сохранение…";
  try {
    await api("/api/admin/users/" + encodeURIComponent(editUserId), {
      method: "PUT",
      json: {
        login,
        display_name,
        role,
        department_id,
        callsign,
        password,
        must_change_password
      }
    });
    closeEditUser();
    await refreshOrg();
  } catch (e) {
    $("editUserMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function qrUrl(data) {
  return "/api/qr.png?data=" + encodeURIComponent(data);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
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

function questionsWord(n) {
  const num = Math.abs(Number(n) || 0);
  const n100 = num % 100;
  const n10 = num % 10;
  if (n100 > 10 && n100 < 20) return "вопросов";
  if (n10 === 1) return "вопрос";
  if (n10 >= 2 && n10 <= 4) return "вопроса";
  return "вопросов";
}

function questionsCountPhrase(n) {
  const num = Number(n) || 0;
  if (num === 1) return "один вопрос";
  return num + " " + questionsWord(num);
}
function testQuestionsLabel(t) {
  const n = t && t.questions_count != null ? Number(t.questions_count) : NaN;
  if (!Number.isFinite(n) || n < 1) return "";
  return n + " " + questionsWord(n);
}
function testTimerLabel(t, empty) {
  if (t && t.timer_minutes != null) return t.timer_minutes + " мин";
  return empty != null ? empty : "таймер не задан";
}
function testHeadlineMeta(t) {
  const parts = [];
  const q = testQuestionsLabel(t);
  if (q) parts.push('<b class="ok">' + esc(q) + "</b>");
  else parts.push('<b class="warn">вопросы: —</b>');
  const tm = testTimerLabel(t, "");
  if (tm) parts.push('<b class="' + (t.timer_minutes ? "ok" : "warn") + '">' + esc(tm) + "</b>");
  else parts.push('<b class="warn">таймер не задан</b>');
  return parts.join(" · ");
}

/** Шкала с сервера. Пока не загрузилась — те же пороги, что записаны в базе по умолчанию. */
let gradingRules = [
  { min: 80, grade: "5" },
  { min: 70, grade: "4" },
  { min: 60, grade: "3" },
  { min: 0, grade: "2" }
];

function gradeForPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return "–";
  const rules = (gradingRules || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
  for (const rule of rules) {
    if (p >= Number(rule.min)) return String(rule.grade);
  }
  return rules.length ? String(rules[rules.length - 1].grade) : "–";
}

function formatRatioPct(ok, bad) {
  const total = (Number(ok) || 0) + (Number(bad) || 0);
  if (total <= 0) return '<span class="hint">—</span>';
  const okPct = Math.round((Number(ok) || 0) / total * 100);
  const badPct = Math.round((Number(bad) || 0) / total * 100);
  return (
    `<span class="ratio-ok">${okPct}%</span>` +
    `<span class="ratio-sep">/</span>` +
    `<span class="ratio-bad">${badPct}%</span>`
  );
}

function formatDuration(sec) {
  if (sec == null || sec === "" || !Number.isFinite(Number(sec)) || Number(sec) < 0) return "—";
  const s = Math.floor(Number(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  return m + ":" + String(r).padStart(2, "0");
}

function gradeClass(g) {
  const s = String(g || "").trim();
  if (s === "5") return "grade-5";
  if (s === "4") return "grade-4";
  if (s === "3") return "grade-3";
  if (s === "2") return "grade-2";
  return "";
}

function attemptUnanswered(a) {
  if (a.unanswered_count != null) return Number(a.unanswered_count) || 0;
  const answers = Array.isArray(a.answers) ? a.answers : [];
  return answers.filter(x => x.pick == null).length;
}

function attemptStatusHtml(a) {
  if (!a || a._phantom) {
    return '<span class="hint">не проходил тестирование</span>';
  }
  // Таймер важнее оценки: неотвеченные вопросы = не уложился по времени
  const unanswered = attemptUnanswered(a);
  if (unanswered > 0) {
    return '<span class="badge-timeout">не успел ответить на ' + esc(questionsCountPhrase(unanswered)) + "</span>";
  }
  if (a.status === "continue") {
    return '<span class="warn">разрешена досдача</span>';
  }
  if (a.status === "unlocked") {
    return '<span class="warn">разрешена пересдача</span>';
  }
  const g = Number(String(a.grade || "").replace(",", "."));
  if (Number.isFinite(g) && g >= 3) return '<span class="badge-ok">сдан</span>';
  if (String(a.grade || "").trim() === "2" || g === 2) return '<span class="badge-fail">не сдал</span>';
  if (a.status === "finished") {
    return g >= 3 ? '<span class="badge-ok">сдан</span>' : '<span class="badge-fail">не сдал</span>';
  }
  return '<span class="hint">' + esc(a.status || "—") + "</span>";
}

function attemptSortValue(a, key) {
  const total = (a.total != null && a.total > 0) ? a.total
    : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : 0);
  switch (key) {
    case "test": return (a.test_title || "").toString().toLowerCase();
    case "num": {
      const n = Number(a.student_num);
      return Number.isFinite(n) ? n : (a.student_num || "").toString().toLowerCase();
    }
    case "call": return (a.callsign || "").toString().toLowerCase();
    case "score": return a.score != null ? Number(a.score) : -1;
    case "percent": return a.percent != null ? Number(a.percent) : -1;
    case "duration": return a.duration_sec != null ? Number(a.duration_sec) : -1;
    case "grade": return (a.grade || "").toString().toLowerCase();
    case "status": return (a.status || "").toString().toLowerCase();
    case "when": return (a.finished_at || a.created_at || "");
    case "total": return total;
    default: return "";
  }
}

function cadetKey(a) {
  return String(a && a.student_num != null ? a.student_num : "").trim();
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

function syncCadetsFilters() {
  const streamF = normFilterLabel($("filterCadetsStream") && $("filterCadetsStream").value);
  const base = cadetsCache || [];
  fillFilterSelect("filterCadetsStream", uniqueFilterLabels(base, x => x.stream_num), "Все потоки");
  if (streamF && (cadetsCache || []).some(c => normFilterLabel(c.stream_num) === streamF)) {
    $("filterCadetsStream").value = streamF;
  }
  const forGroups = streamF
    ? base.filter(c => normFilterLabel(c.stream_num) === streamF)
    : base;
  fillFilterSelect("filterCadetsGroup", uniqueFilterLabels(forGroups, x => x.group_num), "Все группы");
}

function syncRosterFilters() {
  const streamF = normFilterLabel($("filterRosterStream") && $("filterRosterStream").value);
  const base = rosterCache || [];
  fillFilterSelect("filterRosterStream", uniqueFilterLabels(base, x => x.stream_num), "Все потоки");
  if (streamF && base.some(c => normFilterLabel(c.stream_num) === streamF)) {
    $("filterRosterStream").value = streamF;
  }
  const forGroups = streamF
    ? base.filter(c => normFilterLabel(c.stream_num) === streamF)
    : base;
  fillFilterSelect("filterRosterGroup", uniqueFilterLabels(forGroups, x => x.group_num), "Все группы");
}

function syncResultsFilters() {
  const testId = ($("filterTest") && $("filterTest").value) || "";
  let base = attemptsAllCache || [];
  if (testId) base = base.filter(a => a.test_id === testId);
  const streamF = normFilterLabel($("filterResultsStream") && $("filterResultsStream").value);
  fillFilterSelect("filterResultsStream", uniqueFilterLabels(base, x => x.stream_num), "Все потоки");
  if (streamF && base.some(a => normFilterLabel(a.stream_num) === streamF)) {
    $("filterResultsStream").value = streamF;
  }
  const forGroups = streamF
    ? base.filter(a => normFilterLabel(a.stream_num) === streamF)
    : base;
  fillFilterSelect("filterResultsGroup", uniqueFilterLabels(forGroups, x => x.group_num), "Все группы");
}

let resultsRosterCache = [];
let resultsSearchQ = "";

function cadetLookupByNum(num) {
  const key = String(num == null ? "" : num).trim();
  if (!key) return null;
  return (cadetsCache || []).find(c => cadetKey(c) === key) || null;
}

function attemptSearchBlob(a) {
  const c = cadetLookupByNum(a.student_num);
  const parts = [
    a.student_num,
    a.callsign,
    a.full_name,
    a.group_num,
    a.stream_num,
    a.test_title,
    c && c.student_num,
    c && c.callsign,
    c && c.full_name,
    c && c.group_num,
    c && c.stream_num
  ];
  return parts
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase())
    .join("\n");
}

function attemptMatchesSearch(a, q) {
  if (!q) return true;
  const blob = attemptSearchBlob(a);
  if (blob.includes(q)) return true;
  // совпадение по отдельным полям целиком (номер / позывной)
  const fields = [
    cadetKey(a),
    String(a.callsign || "").trim().toLowerCase(),
    String(a.full_name || "").trim().toLowerCase()
  ];
  const c = cadetLookupByNum(a.student_num);
  if (c) {
    fields.push(
      cadetKey(c),
      String(c.callsign || "").trim().toLowerCase(),
      String(c.full_name || "").trim().toLowerCase()
    );
  }
  return fields.some(f => f && (f === q || f.includes(q)));
}

function applyResultsSearch() {
  resultsSearchQ = (($("resultsSearch") && $("resultsSearch").value) || "").trim().toLowerCase();
  const hint = $("resultsSearchHint");
  renderAttempts();
  if (hint) {
    if (!resultsSearchQ) {
      hint.textContent = "";
    } else {
      const n = (attemptsCache || []).length;
      hint.textContent = n ? ("Найдено: " + n) : "Совпадений нет";
    }
  }
}

function filteredAttempts() {
  let list = (attemptsAllCache || []).slice();
  const testId = ($("filterTest") && $("filterTest").value) || "";
  const cadet = ($("filterCadet") && $("filterCadet").value) || "";
  const searching = !!resultsSearchQ;

  // при поиске показываем все тесты/попытки по идентификатору
  if (!searching) {
    if (testId) list = list.filter(a => a.test_id === testId);
    if (cadet) list = list.filter(a => cadetKey(a) === cadet);
  }
  list = list.filter(a => matchStreamGroup(a, "filterResultsStream", "filterResultsGroup"));

  // при фильтре по тесту (без поиска) — добавить курсантов из roster без попытки
  if (!searching && testId && resultsRosterCache && resultsRosterCache.length) {
    const have = new Set(list.map(a => cadetKey(a)));
    const t = (testsCache || []).find(x => x.id === testId);
    resultsRosterCache.forEach(r => {
      const num = cadetKey(r);
      if (!num || have.has(num)) return;
      const phantom = {
        _phantom: true,
        id: "roster:" + testId + ":" + num,
        test_id: testId,
        test_title: t ? t.title : "",
        student_num: r.student_num,
        callsign: r.roster_callsign || r.callsign || "",
        full_name: r.full_name || "",
        group_num: r.group_num || "",
        stream_num: r.stream_num || "",
        status: "",
        grade: "",
        score: null,
        percent: null,
        duration_sec: null,
        answers: []
      };
      if (cadet && cadetKey(phantom) !== cadet) return;
      if (!matchStreamGroup(phantom, "filterResultsStream", "filterResultsGroup")) return;
      list.push(phantom);
    });
  }

  if (searching) {
    // номера/позывные/ФИО из справочника курсантов, подходящие под запрос
    const matchedNums = new Set();
    (cadetsCache || []).forEach(c => {
      const blob = [
        c.student_num, c.callsign, c.full_name, c.group_num, c.stream_num
      ].filter(Boolean).map(v => String(v).trim().toLowerCase()).join("\n");
      if (blob.includes(resultsSearchQ)) matchedNums.add(cadetKey(c));
    });
    list = list.filter(a =>
      attemptMatchesSearch(a, resultsSearchQ) || matchedNums.has(cadetKey(a))
    );
  }
  return list;
}

function fillCadetFilter() {
  const sel = $("filterCadet");
  if (!sel) return;
  const testId = ($("filterTest") && $("filterTest").value) || "";
  let source = attemptsAllCache || [];
  if (testId) source = source.filter(a => a.test_id === testId);
  const map = new Map();
  source.forEach(a => {
    const k = cadetKey(a);
    if (!k || map.has(k)) return;
    const call = (a.callsign || "").trim();
    map.set(k, call ? ("№" + k + " · " + call) : ("№" + k));
  });
  const cur = sel.value;
  const opts = Array.from(map.entries()).sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]), "ru", { numeric: true })
  );
  sel.innerHTML = '<option value="">Все курсанты</option>' +
    opts.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join("");
  sel.value = map.has(cur) ? cur : "";
}

function renderAttemptsHead(hideTest) {
  const cols = [
    { key: "test", label: "Тест", hide: hideTest, cls: "th-test" },
    { key: "num", label: "Номер", cls: "th-num" },
    { key: "call", label: "Позывной", cls: "th-call" },
    { key: "score", label: "Баллы", cls: "th-score" },
    { key: "percent", label: "%" },
    { key: "duration", label: '<span class="th-stack">Время<br>прохождения</span>', cls: "th-duration" },
    { key: "grade", label: "Оценка", cls: "th-grade" },
    { key: "status", label: "Статус" },
    { key: "when", label: "Когда" },
    { key: "", label: "" }
  ];
  $("attemptsHead").innerHTML = cols.map(c => {
    if (c.hide) return "";
    if (!c.key) return "<th></th>";
    const extra = ["center", c.cls].filter(Boolean).join(" ");
    return thSortHtml(resultsSort, c.key, c.label).replace(
      'class="sortable"',
      'class="sortable ' + extra + '"'
    );
  }).join("");
}

function sortedAttempts(list) {
  const arr = (list || []).slice();
  const { key, dir } = resultsSort;
  arr.sort((a, b) => cmpSortVal(attemptSortValue(a, key), attemptSortValue(b, key), dir));
  return arr;
}

function renderAttempts() {
  syncResultsFilters();
  const hideTest = !resultsSearchQ && !!($("filterTest") && $("filterTest").value);
  renderAttemptsHead(hideTest);
  const rows = sortedAttempts(filteredAttempts());
  attemptsCache = rows;
  $("resultsMeta").textContent = rows.length ? (" · " + rows.length) : "";
  const colCount = hideTest ? 9 : 10;
  $("attemptsBody").innerHTML = rows.map(a => {
    const st = attemptStatusHtml(a);
    const unlockBtn = a.status === "finished" && !a._phantom
      ? `<button class="btn" type="button" data-unlock="${esc(a.test_id)}" data-num="${esc(a.student_num)}" data-call="${esc(a.callsign)}">Пароль пересдачи</button>`
      : "";
    const total = (a.total != null && a.total > 0) ? a.total
      : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : a.total);
    const gCls = gradeClass(a.grade);
    const detailBtn = a._phantom ? ""
      : `<button class="linkish" type="button" data-detail="${esc(a.id)}" title="${esc(a.test_title || "Подробнее")}">${esc(a.test_title || "Подробнее")}</button>`;
    const testCell = hideTest ? ""
      : `<td class="td-test">${a._phantom ? esc(a.test_title || "—") : detailBtn}</td>`;
    const timeoutMark = (a.timed_out || attemptUnanswered(a) > 0)
      ? ' <span class="badge-timeout" title="Не уложился по времени">⏱</span>' : "";
    return `<tr>
      ${testCell}
      <td class="td-num center">${esc(a.student_num)}</td>
      <td class="td-call center">${esc(a.callsign || "—")}</td>
      <td class="td-score center">${a.score != null ? a.score + "/" + (total != null ? total : "—") : "—"}</td>
      <td class="center">${a.percent != null ? a.percent + "%" : "—"}</td>
      <td class="td-duration center">${esc(formatDuration(a.duration_sec))}</td>
      <td class="td-grade center"><b class="${gCls}">${esc(a.grade || "—")}</b>${timeoutMark}</td>
      <td class="center">${st}</td>
      <td class="center">${esc((a.finished_at || a.created_at || "").replace("T"," ").slice(0,19) || "—")}</td>
      <td>${unlockBtn || (!a._phantom && hideTest ? `<button class="linkish" type="button" data-detail="${esc(a.id)}">Подробнее</button>` : "")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${colCount}" class="hint">${(attemptsAllCache || []).length ? "Нет результатов по фильтру" : "Результатов пока нет"}</td></tr>`;
}

function clearCadetForm() {
  cadetEditId = "";
  if ($("cadetNum")) $("cadetNum").value = "";
  if ($("cadetCall")) $("cadetCall").value = "";
  if ($("cadetGroup")) $("cadetGroup").value = "";
  if ($("cadetStream")) $("cadetStream").value = "";
  if ($("btnAddCadet")) $("btnAddCadet").textContent = "Добавить курсанта";
  if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").classList.add("hidden");
}

function selectedCadetIds() {
  return Array.from(document.querySelectorAll("#cadetsBody input.cadet-check:checked"))
    .map(el => el.value)
    .filter(Boolean);
}

function syncCadetSelectionUi() {
  const ids = selectedCadetIds();
  const btn = $("btnDelCadetsSelected");
  const hint = $("cadetSelectedHint");
  const boxes = document.querySelectorAll("#cadetsBody input.cadet-check");
  const all = $("cadetCheckAll");
  if (btn) btn.disabled = !ids.length;
  if (hint) hint.textContent = ids.length ? ("Выбрано: " + ids.length) : "";
  if (all && boxes.length) {
    const n = document.querySelectorAll("#cadetsBody input.cadet-check:checked").length;
    all.checked = n > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  } else if (all) {
    all.checked = false;
    all.indeterminate = false;
  }
}

function cadetSortValue(c, key) {
  switch (key) {
    case "npp": return Number(c.npp) || 0;
    case "num": return c.student_num || "";
    case "call": return c.callsign || "";
    case "group": return c.group_num || "";
    case "stream": return c.stream_num || "";
    default: return "";
  }
}

function renderCadetsHead() {
  if (!$("cadetsHead")) return;
  $("cadetsHead").innerHTML =
    `<th style="width:40px"><input type="checkbox" id="cadetCheckAll" title="Выбрать все доступные"></th>` +
    thSortHtml(cadetsSort, "npp", "№ п/п") +
    thSortHtml(cadetsSort, "num", "Номер курсанта") +
    thSortHtml(cadetsSort, "call", "Позывной") +
    thSortHtml(cadetsSort, "group", "Номер группы") +
    thSortHtml(cadetsSort, "stream", "Номер потока") +
    "<th></th>";
  if ($("cadetCheckAll")) {
    $("cadetCheckAll").onchange = () => {
      const on = !!$("cadetCheckAll").checked;
      document.querySelectorAll("#cadetsBody input.cadet-check").forEach(el => { el.checked = on; });
      syncCadetSelectionUi();
    };
  }
}

function renderCadetsTable() {
  syncCadetsFilters();
  let list = (cadetsCache || []).filter(c => matchStreamGroup(c, "filterCadetsStream", "filterCadetsGroup"));
  list = list.slice().sort((a, b) =>
    cmpSortVal(cadetSortValue(a, cadetsSort.key), cadetSortValue(b, cadetsSort.key), cadetsSort.dir)
  );
  if ($("cadetsMeta")) $("cadetsMeta").textContent = list.length ? (" · " + list.length) : "";
  if (!$("cadetsBody")) return;
  renderCadetsHead();
  $("cadetsBody").innerHTML = list.map(c => {
    const actions = [];
    if (c.can_edit) {
      actions.push(`<button class="btn" type="button" data-edit-cadet="${esc(c.id)}">Изменить</button>`);
    }
    if (c.can_delete) {
      actions.push(`<button class="btn" type="button" data-del-cadet="${esc(c.id)}">Удалить</button>`);
    }
    const check = c.can_delete
      ? `<input type="checkbox" class="cadet-check" value="${esc(c.id)}" aria-label="Выбрать">`
      : "";
    return `<tr>
      <td>${check}</td>
      <td class="npp">${esc(c.npp)}</td>
      <td>${esc(c.student_num)}</td>
      <td>${esc(c.callsign || "")}</td>
      <td>${esc(c.group_num || "")}</td>
      <td>${esc(c.stream_num || "")}</td>
      <td class="row">${actions.join(" ") || '<span class="hint">—</span>'}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="hint">${(cadetsCache || []).length ? "Нет курсантов по фильтру" : "Курсантов пока нет"}</td></tr>`;
  syncCadetSelectionUi();
}

async function deleteSelectedCadets() {
  const ids = selectedCadetIds();
  if (!ids.length) return;
  if (!confirm("Удалить выбранных курсантов: " + ids.length + "?")) return;
  const res = await api("/api/admin/cadets/bulk-delete", {
    method: "POST",
    json: { ids }
  });
  cadetsCache = res.cadets || [];
  if (cadetEditId && ids.indexOf(cadetEditId) >= 0) clearCadetForm();
  renderCadetsTable();
  if (res.denied) {
    alert("Удалено: " + (res.deleted || 0) + ". Без прав: " + res.denied);
  }
}

async function clearMyCadets() {
  const mine = (cadetsCache || []).filter(c =>
    currentUser && c.owner_user_id && c.owner_user_id === currentUser.id
  );
  const n = mine.length;
  if (!n) {
    alert("В списке нет курсантов, добавленных под вашей учётной записью.");
    return;
  }
  if (!confirm("Очистить список курсантов, добавленных под вашей учётной записью (" + n + ")? Это действие нельзя отменить.")) {
    return;
  }
  const res = await api("/api/admin/cadets/clear-mine", { method: "POST", json: {} });
  cadetsCache = res.cadets || [];
  clearCadetForm();
  renderCadetsTable();
  alert("Удалено записей: " + (res.deleted || 0));
}

async function refreshCadets() {
  const data = await api("/api/admin/cadets");
  cadetsCache = data.cadets || [];
  renderCadetsTable();
}

function showCadetDupModal(msg) {
  if ($("cadetDupText")) $("cadetDupText").textContent = msg || "Курсант с таким номером уже существует";
  if ($("cadetDupModal")) $("cadetDupModal").classList.remove("hidden");
}

function closeCadetDupModal() {
  if ($("cadetDupModal")) $("cadetDupModal").classList.add("hidden");
}

function showCadetImportResult(data) {
  const added = Number(data.added) || 0;
  const total = Number(data.total) || 0;
  const sum = $("cadetImportSummary");
  let c1 = "var(--warn)", c2 = "var(--warn)";
  if (added === total && total > 0) { c1 = "var(--ok)"; c2 = "var(--ok)"; }
  else if (added === 0) { c1 = "var(--bad)"; c2 = "var(--warn)"; }
  if (sum) {
    sum.innerHTML = '<span style="color:' + c1 + '">' + added + '</span> из <span style="color:' + c2 + '">' +
      total + '</span> записей добавлено';
  }
  const rows = Array.isArray(data.rows) ? data.rows.slice() : [];
  rows.sort((a, b) => {
    const as = a.status === "skipped" ? 0 : 1;
    const bs = b.status === "skipped" ? 0 : 1;
    if (as !== bs) return as - bs;
    return String(a.student_num || "").localeCompare(String(b.student_num || ""), "ru", { numeric: true });
  });
  if ($("cadetImportBody")) {
    $("cadetImportBody").innerHTML = rows.map(r => {
      const ok = r.status === "added";
      const color = ok ? "var(--ok)" : "var(--bad)";
      const st = ok ? "добавлен" : esc(r.reason || "Номер уже существует");
      return `<tr style="color:${color}">
        <td>${esc(r.student_num)}</td>
        <td>${esc(r.callsign || "")}</td>
        <td>${esc(r.group_num || "")}</td>
        <td>${esc(r.stream_num || "")}</td>
        <td>${st}</td>
      </tr>`;
    }).join("") || "";
  }
  if ($("cadetImportModal")) $("cadetImportModal").classList.remove("hidden");
}

function closeCadetImportModal() {
  if ($("cadetImportModal")) $("cadetImportModal").classList.add("hidden");
}

async function saveCadet() {
  const payload = {
    student_num: ($("cadetNum") && $("cadetNum").value) || "",
    callsign: ($("cadetCall") && $("cadetCall").value) || "",
    group_num: ($("cadetGroup") && $("cadetGroup").value) || "",
    stream_num: ($("cadetStream") && $("cadetStream").value) || "",
    full_name: ""
  };
  try {
    if (cadetEditId) {
      const res = await api("/api/admin/cadets/" + encodeURIComponent(cadetEditId), {
        method: "PUT", json: payload
      });
      cadetsCache = res.cadets || cadetsCache;
    } else {
      const res = await api("/api/admin/cadets", { method: "POST", json: payload });
      cadetsCache = res.cadets || cadetsCache;
    }
    clearCadetForm();
    renderCadetsTable();
  } catch (e) {
    const msg = e.message || "";
    if (/уже существует/i.test(msg)) showCadetDupModal("Курсант с таким номером уже существует");
    else alert(msg);
  }
}

function startCadetEdit(id) {
  const c = (cadetsCache || []).find(x => x.id === id);
  if (!c || !c.can_edit) return;
  cadetEditId = id;
  $("cadetNum").value = c.student_num || "";
  $("cadetCall").value = c.callsign || "";
  $("cadetGroup").value = c.group_num || "";
  $("cadetStream").value = c.stream_num || "";
  $("btnAddCadet").textContent = "Сохранить";
  if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").classList.remove("hidden");
  const form = $("cadetAddForm");
  if (form) form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function downloadCadetsTemplate() {
  const r = await fetch("/api/admin/cadets-template.xlsx", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "Не удалось скачать шаблон");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lis-cadets-template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importCadetsExcel() {
  const f = $("cadetsExcel") && $("cadetsExcel").files[0];
  if (!f) {
    if ($("cadetsImportMsg")) $("cadetsImportMsg").innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if ($("cadetsImportMsg")) $("cadetsImportMsg").textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await fetch("/api/admin/cadets/import", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Ошибка импорта");
    if ($("cadetsExcel")) $("cadetsExcel").value = "";
    if ($("cadetsImportMsg")) $("cadetsImportMsg").textContent = "";
    cadetsCache = data.cadets || cadetsCache;
    renderCadetsTable();
    showCadetImportResult(data);
  } catch (e) {
    if ($("cadetsImportMsg")) $("cadetsImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

function testSortValue(t, key) {
  switch (key) {
    case "title": return t.title || "";
    case "author": return ((t.owner_name || t.owner_login || "") + " " + (t.department_name || "")).trim();
    case "roster": return t.roster_count != null ? Number(t.roster_count) : 0;
    case "timer": return t.timer_minutes != null ? Number(t.timer_minutes) : -1;
    case "questions": return t.questions_count != null ? Number(t.questions_count) : -1;
    default: return "";
  }
}

function testAuthorKey(t) {
  return String((t && t.owner_user_id) || "");
}
function testAuthorLabel(t) {
  const name = ((t && (t.owner_name || t.owner_login)) || "").trim();
  const dept = ((t && t.department_name) || "").trim();
  if (name && dept) return name + " · " + dept;
  if (name) return name;
  if (dept) return "Без имени · " + dept;
  return "Без автора";
}
function fillTestsAuthorFilter() {
  const sel = $("filterTestsAuthor");
  if (!sel) return;
  const prev = sel.value || "";
  const map = new Map();
  (testsCache || []).forEach(t => {
    const key = testAuthorKey(t);
    if (map.has(key)) return;
    map.set(key, testAuthorLabel(t));
  });
  const authors = Array.from(map.entries()).sort((a, b) =>
    String(a[1]).localeCompare(String(b[1]), "ru", { sensitivity: "base" })
  );
  sel.innerHTML = `<option value="">Все авторы</option>` + authors.map(([id, label]) =>
    `<option value="${esc(id)}">${esc(label)}</option>`
  ).join("");
  if (prev && authors.some(([id]) => id === prev)) sel.value = prev;
  else sel.value = "";
}
function visibleTests() {
  const authorId = ($("filterTestsAuthor") && $("filterTestsAuthor").value) || "";
  return (testsCache || []).filter(t => !authorId || testAuthorKey(t) === authorId);
}

function renderTestsHead() {
  if (!$("testsHead")) return;
  $("testsHead").innerHTML =
    thSortHtml(testsSort, "title", "Название") +
    thSortHtml(testsSort, "author", "Автор") +
    "<th>Ссылка / QR</th><th>Действия</th>";
}

function renderTestsTable() {
  fillTestsAuthorFilter();
  const filtered = visibleTests();
  const tests = filtered.slice().sort((a, b) =>
    cmpSortVal(testSortValue(a, testsSort.key), testSortValue(b, testsSort.key), testsSort.dir)
  );
  const total = (testsCache || []).length;
  if (total && tests.length !== total) {
    $("testsMeta").textContent = " · " + tests.length + " из " + total;
  } else {
    $("testsMeta").textContent = total ? (" · " + total) : "";
  }
  renderTestsHead();
  $("testsBody").innerHTML = tests.map(t => {
    const link = originLink("/t/" + t.id);
    const rc = t.roster_count != null ? t.roster_count : 0;
    const author = t.owner_name || t.owner_login || "—";
    const dept = t.department_name ? (" · " + t.department_name) : "";
    const own = canEditOwnTest(t);
    return `<tr class="${own ? "row-click" : ""}" ${own ? `data-edit-full="${esc(t.id)}" title="Открыть полное редактирование"` : ""}>
      <td>
        <b>${esc(t.title)}</b>
        <div class="test-meta">${testHeadlineMeta(t)}
          · курсантов: <b class="${rc ? "ok" : "warn"}">${esc(rc)}</b>
          · мастер-пароль: <b class="${t.has_master_password || t.master_password ? "ok" : "hint"}">${t.has_master_password || t.master_password ? "задан" : "общий"}</b>
          ${t.published_for_all ? ' · <b class="ok">в общем каталоге</b>' : ""}</div>
      </td>
      <td><div class="hint" style="margin:0">${esc(author)}${esc(dept)}</div></td>
      <td>
        <a class="linkbox" href="${link}" target="_blank" rel="noopener">${esc(link)}</a>
        <div class="row" style="margin-top:8px;align-items:flex-start">
          <img class="qr" src="${qrUrl(link)}" alt="QR">
          <p class="hint" style="margin:0;max-width:220px">Один QR на всех · доступ по номеру из списка курсантов</p>
        </div>
      </td>
      <td>
        <div class="test-actions">
          <button class="btn" type="button" data-copy="${encodeURIComponent(link)}">Копировать ссылку</button>
          <button class="btn" type="button" data-roster="${esc(t.id)}" data-title="${esc(t.title)}">Курсанты</button>
          ${canEditOwnTest(t) ? `<button class="btn main" type="button" data-edit-full="${esc(t.id)}">Редактировать</button>` : ""}
          ${canEditTestParams() ? `<button class="btn" type="button" data-edit-test="${esc(t.id)}">Параметры</button>` : ""}
          <button class="btn danger" type="button" data-del="${esc(t.id)}">Удалить</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">${(testsCache || []).length ? "Нет тестов выбранного автора" : "Тестов пока нет"}</td></tr>`;
}

let editTestId = "";
let catalogCache = [];

function renderCatalogTable() {
  const list = catalogCache || [];
  if ($("catalogMeta")) $("catalogMeta").textContent = list.length ? (" · " + list.length) : "";
  const body = $("catalogBody");
  if (!body) return;
  body.innerHTML = list.map(t => {
    const author = t.owner_name || t.owner_login || "—";
    const dept = t.department_name || "—";
    const timer = testTimerLabel(t, "—");
    const qLabel = testQuestionsLabel(t) || "—";
    const mine = currentUser && t.owner_user_id && t.owner_user_id === currentUser.id;
    return `<tr class="${mine ? "row-click" : ""}" ${mine ? `data-edit-full="${esc(t.id)}" title="Открыть редактирование теста"` : ""}>
      <td>
        <b>${esc(t.title)}</b>
        <div class="test-meta">${testHeadlineMeta(t)}</div>
      </td>
      <td class="hint">${esc(author)}</td>
      <td class="hint">${esc(dept)}</td>
      <td class="hint"><b class="${t.questions_count ? "ok" : "warn"}">${esc(qLabel)}</b></td>
      <td class="hint"><b class="${t.timer_minutes ? "ok" : "warn"}">${esc(timer)}</b></td>
      <td class="catalog-act">
        ${mine
          ? `<button class="btn main btn-catalog" type="button" data-edit-full="${esc(t.id)}">Ваш тест</button>`
          : `<button class="btn main btn-catalog" type="button" data-adopt="${esc(t.id)}">Выбрать</button>`}
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="hint">Пока нет опубликованных тестов. Старший инструктор может отметить «Опубликовать тест для всех» в параметрах или в генераторе.</td></tr>`;
}

async function refreshCatalog() {
  try {
    catalogCache = await api("/api/tests/catalog");
  } catch (e) {
    catalogCache = [];
    if ($("catalogMsg")) $("catalogMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
  renderCatalogTable();
}

async function adoptCatalogTest(testId) {
  if (!testId) return;
  if ($("catalogMsg")) $("catalogMsg").textContent = "Копирую тест…";
  try {
    const data = await api("/api/tests/" + encodeURIComponent(testId) + "/adopt", { method: "POST" });
    if ($("catalogMsg")) {
      $("catalogMsg").innerHTML = '<span class="ok">Тест «' + esc(data.title || "") +
        '» добавлен в ваш кабинет. Откройте «Курсанты» и раздайте ссылку.</span>';
    }
    await refresh();
  } catch (e) {
    if ($("catalogMsg")) $("catalogMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

async function openEditTest(testId) {
  if (!canEditTestParams() || !testId) return;
  try {
    const t = await api("/api/admin/tests/" + encodeURIComponent(testId));
    editTestId = testId;
    $("editTestTitle").value = t.title || "";
    $("editTestTimer").value = t.timer_minutes != null ? t.timer_minutes : 40;
    const masterWrap = $("editTestMaster") && $("editTestMaster").closest("div");
    if ($("editTestMaster")) {
      $("editTestMaster").value = t.master_password || "";
      if (masterWrap) masterWrap.style.display = isAdmin() ? "" : "none";
    }
    $("editTestMsg").textContent = isAdmin()
      ? (t.has_master_password
        ? "Задан пароль этого теста"
        : "Пароль теста не задан — действует общий пароль сервера")
      : "";
    const pubWrap = $("editPublishWrap");
    const pubHint = $("editPublishHint");
    if (pubWrap) {
      pubWrap.style.display = canPublishForAll() ? "flex" : "none";
      if ($("editTestPublish")) $("editTestPublish").checked = !!t.published_for_all;
    }
    if (pubHint) pubHint.style.display = canPublishForAll() ? "" : "none";
    $("editTestModal").classList.remove("hidden");
    try { $("editTestTitle").focus(); } catch (e) {}
  } catch (e) {
    alert(e.message);
  }
}

function closeEditTest() {
  editTestId = "";
  $("editTestModal").classList.add("hidden");
}

async function saveEditTest() {
  if (!canEditTestParams() || !editTestId) return;
  const title = ($("editTestTitle").value || "").trim();
  const timerRaw = ($("editTestTimer").value || "").trim();
  const master_password = ($("editTestMaster").value || "").trim();
  if (!title) {
    $("editTestMsg").innerHTML = '<span class="bad">Укажите название</span>';
    return;
  }
  const timer_minutes = parseInt(timerRaw, 10);
  if (!Number.isFinite(timer_minutes) || timer_minutes < 1) {
    $("editTestMsg").innerHTML = '<span class="bad">Таймер: от 1 минуты</span>';
    return;
  }
  $("editTestMsg").textContent = "Сохранение…";
  const payload = { title, timer_minutes };
  if (isAdmin()) payload.master_password = master_password;
  if (canPublishForAll() && $("editTestPublish")) {
    payload.published_for_all = !!$("editTestPublish").checked;
  }
  try {
    await api("/api/admin/tests/" + encodeURIComponent(editTestId), {
      method: "PUT",
      json: payload
    });
    closeEditTest();
    await refresh();
  } catch (e) {
    $("editTestMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function renderGradingEditor() {
  const body = $("gradingBody");
  if (!body) return;
  const editable = canEditGrade();
  const rules = (gradingRules || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
  body.innerHTML = rules.map((rule, idx) =>
    `<tr>
      <td><input class="grade-min" data-idx="${idx}" type="number" min="0" max="100" value="${esc(rule.min)}" style="width:90px" ${editable ? "" : "disabled"}></td>
      <td><input class="grade-val" data-idx="${idx}" type="text" value="${esc(rule.grade)}" style="width:80px" ${editable ? "" : "disabled"}></td>
      <td>${editable ? `<button class="btn" type="button" data-grade-del="${idx}">Удалить</button>` : ""}</td>
    </tr>`
  ).join("");
  if ($("btnAddGradeRule")) $("btnAddGradeRule").hidden = !editable;
  if ($("btnSaveGrading")) $("btnSaveGrading").hidden = !editable;
}

function readGradingForm() {
  const rows = [];
  document.querySelectorAll("#gradingBody tr").forEach(tr => {
    const minEl = tr.querySelector(".grade-min");
    const gradeEl = tr.querySelector(".grade-val");
    if (!minEl || !gradeEl) return;
    rows.push({ min: minEl.value.trim(), grade: gradeEl.value.trim() });
  });
  return rows;
}

async function loadGrading() {
  const data = await api("/api/grading");
  gradingRules = Array.isArray(data.rules) && data.rules.length ? data.rules : gradingRules;
  renderGradingEditor();
}

async function saveGrading() {
  const msg = $("gradingMsg");
  if (!canEditGrade()) {
    if (msg) msg.innerHTML = '<span class="bad">Шкалу меняют администратор и старший инструктор</span>';
    return;
  }
  const rules = readGradingForm().map(r => ({ min: Number(r.min), grade: r.grade }));
  if (msg) msg.textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/grading", { method: "PUT", json: { rules } });
    gradingRules = res.rules || rules;
    renderGradingEditor();
    if (msg) msg.innerHTML = '<span class="ok">Шкала сохранена, оценки пересчитаны</span>';
    await refresh();
  } catch (e) {
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

let flightSheet = null;

function flightSheetDays(columns) {
  let days = 0;
  (columns || []).forEach(col => {
    const day = Number(col.day) || 0;
    if (day > days) days = day;
  });
  return days;
}

function renderFlightSheet(sheet, note) {
  flightSheet = sheet || null;
  const msg = $("flightSheetMsg");
  const wrap = $("flightSheetTableWrap");
  const meta = $("flightSheetMeta");
  const saveBtn = $("btnFlightSheetSave");
  const delBtn = $("btnFlightSheetDelete");
  const createBtn = $("btnFlightSheetCreate");
  if (!wrap) return;
  const columns = (sheet && sheet.columns) || [];
  const rows = (sheet && sheet.rows) || [];
  const hasSheet = columns.length > 0;
  if (createBtn) createBtn.hidden = hasSheet;
  if (!hasSheet) {
    wrap.innerHTML = "";
    if (saveBtn) saveBtn.hidden = true;
    if (delBtn) delBtn.hidden = true;
    if (meta) meta.textContent = "";
    if (msg && note) msg.innerHTML = note;
    return;
  }
  const days = flightSheetDays(columns);
  if (meta) meta.textContent = rows.length + " курсантов · " + days + " дн.";
  const fixed = columns.filter(col => col.locked);
  const dayCols = columns.filter(col => !col.locked);
  let titles = fixed.map(col => `<th rowspan="3">${esc(col.title)}</th>`).join("");
  let dates = "";
  for (let day = 1; day <= days; day++) {
    const sample = dayCols.find(col => Number(col.day) === day) || {};
    const title = sample.day_title || ("День " + day);
    const dayDate = sample.day_date || "";
    titles += `<th colspan="2"><input class="fs-day" data-fs-day="${day}" data-fs-part="title" value="${esc(title)}"></th>`;
    dates += `<th colspan="2"><input class="fs-day" data-fs-day="${day}" data-fs-part="date" value="${esc(dayDate)}"></th>`;
  }
  titles += `<th class="fs-plus" rowspan="3"><button type="button" class="btn fs-add" id="btnFlightSheetAddDay" title="Добавить день">+</button></th>`;
  const head = dayCols.map(col => `<th>${esc(col.title)}</th>`).join("");
  const body = rows.map((row, i) => {
    const cells = columns.map(col => {
      const value = row[col.id] == null ? "" : String(row[col.id]);
      if (col.locked) return `<td class="fs-lock">${esc(value)}</td>`;
      return `<td><input data-fs-row="${i}" data-fs-col="${esc(col.id)}" value="${esc(value)}"></td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const empty = `<tr><td colspan="${columns.length}">В базе нет курсантов</td></tr>`;
  wrap.innerHTML = `<div class="scrollx"><table id="flightSheetTable"><thead><tr>${titles}</tr><tr>${dates}</tr><tr>${head}</tr></thead><tbody>${body || empty}</tbody></table></div>`;
  const addBtn = $("btnFlightSheetAddDay");
  if (addBtn) addBtn.onclick = () => addFlightDay().catch(showFlightSheetError);
  if (saveBtn) saveBtn.hidden = false;
  if (delBtn) delBtn.hidden = false;
  if (msg && note) msg.innerHTML = note;
}

function showFlightSheetError(e) {
  const msg = $("flightSheetMsg");
  if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  else alert(e.message);
}

function collectFlightSheetDays() {
  const map = {};
  document.querySelectorAll("#flightSheetTable input[data-fs-day]").forEach(input => {
    const day = input.getAttribute("data-fs-day");
    const part = input.getAttribute("data-fs-part");
    if (!map[day]) map[day] = { day: Number(day), title: "", date: "" };
    if (part === "title" || part === "date") map[day][part] = input.value;
  });
  return Object.keys(map).map(key => map[key]);
}

function flightSheetPayload() {
  return { rows: collectFlightSheetRows(), days: collectFlightSheetDays() };
}

function collectFlightSheetRows() {
  const columns = (flightSheet && flightSheet.columns) || [];
  const stored = (flightSheet && flightSheet.rows) || [];
  const rows = stored.map(row => Object.assign({}, row));
  document.querySelectorAll("#flightSheetTable input[data-fs-col]").forEach(input => {
    const i = Number(input.getAttribute("data-fs-row"));
    const id = input.getAttribute("data-fs-col");
    if (!rows[i]) rows[i] = {};
    rows[i][id] = input.value;
  });
  return rows.map(row => {
    const clean = {};
    columns.forEach(col => { clean[col.id] = row[col.id] == null ? "" : String(row[col.id]); });
    return clean;
  });
}

async function loadFlightSheet() {
  if (!isFlightSheetUser()) return;
  const data = await api("/api/admin/flight-sheet");
  renderFlightSheet(data.sheet, "");
}

async function importFlightSheet(file) {
  const msg = $("flightSheetMsg");
  if (!file) return;
  if (msg) msg.textContent = "Чтение шаблона…";
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/flight-sheet/import", { method: "POST", headers, body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось прочитать шаблон");
  renderFlightSheet(data.sheet, '<span class="ok">' + esc(data.message || "Данные загружены") + "</span>");
}

async function addFlightDay() {
  const rows = flightSheet ? collectFlightSheetRows() : [];
  const days = flightSheet ? collectFlightSheetDays() : [];
  const data = await api("/api/admin/flight-sheet/day", { method: "POST", json: { rows, days } });
  renderFlightSheet(data.sheet, '<span class="ok">' + esc(data.message || "День добавлен") + "</span>");
}

async function downloadFlightSheet() {
  if (flightSheet) await saveFlightSheet(true);
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/flight-sheet/template.xlsx", { headers });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось скачать шаблон");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Полётная ведомость.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const msg = $("flightSheetMsg");
  if (msg) msg.innerHTML = '<span class="ok">Шаблон скачан</span>';
}

async function saveFlightSheet(silent) {
  const msg = $("flightSheetMsg");
  if (!flightSheet) return;
  const data = await api("/api/admin/flight-sheet", { method: "PUT", json: flightSheetPayload() });
  renderFlightSheet(data.sheet, silent ? "" : '<span class="ok">Таблица сохранена</span>');
  if (msg && !data.sheet) msg.innerHTML = '<span class="bad">Таблица не сохранена</span>';
}

async function deleteFlightSheet() {
  if (!flightSheet) return;
  if (!confirm("Удалить таблицу полётной ведомости?")) return;
  await api("/api/admin/flight-sheet", { method: "DELETE" });
  renderFlightSheet(null, '<span class="ok">Таблица удалена</span>');
}

let libraryCategory = "materials";
const libraryHints = {
  materials: "Инструкции, презентации и методички. У каждого документа есть название, краткое описание и файл.",
  work: "Рабочие документы. У каждого документа есть название, краткое описание и файл."
};

function renderLibrary(docs) {
  const body = $("libraryBody");
  const meta = $("libraryMeta");
  if (!body) return;
  const list = docs || [];
  if (meta) meta.textContent = list.length ? (list.length + " док.") : "";
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="4">Документов пока нет</td></tr>`;
    return;
  }
  body.innerHTML = list.map(doc => `
    <tr>
      <td>${esc(doc.title)}</td>
      <td>${esc(doc.summary)}</td>
      <td><a href="/api/admin/library/${esc(doc.id)}/file" target="_blank" rel="noopener">${esc(doc.filename || "Открыть")}</a></td>
      <td><button class="btn danger" type="button" data-library-del="${esc(doc.id)}">Удалить</button></td>
    </tr>
  `).join("");
}

async function loadLibrary() {
  if (!isFlightSheetUser()) return;
  const data = await api("/api/admin/library?category=" + encodeURIComponent(libraryCategory));
  renderLibrary(data.docs || []);
}

function setLibraryTab(category) {
  libraryCategory = category === "work" ? "work" : "materials";
  document.querySelectorAll("#libraryTabs [data-library-tab]").forEach(btn => {
    btn.classList.toggle("main", btn.getAttribute("data-library-tab") === libraryCategory);
  });
  const hint = $("libraryHint");
  if (hint) hint.textContent = libraryHints[libraryCategory];
  const msg = $("libraryMsg");
  if (msg) msg.textContent = "";
  loadLibrary().catch(e => {
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  });
}

async function addLibraryDoc() {
  const msg = $("libraryMsg");
  const title = ($("libraryTitle") && $("libraryTitle").value || "").trim();
  const summary = ($("librarySummary") && $("librarySummary").value || "").trim();
  const file = $("libraryFile") && $("libraryFile").files && $("libraryFile").files[0];
  if (!title) {
    if (msg) msg.innerHTML = '<span class="bad">Укажите название документа</span>';
    return;
  }
  if (!summary) {
    if (msg) msg.innerHTML = '<span class="bad">Укажите краткое описание</span>';
    return;
  }
  if (!file) {
    if (msg) msg.innerHTML = '<span class="bad">Выберите файл</span>';
    return;
  }
  if (msg) msg.textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("category", libraryCategory);
  fd.append("title", title);
  fd.append("summary", summary);
  fd.append("file", file);
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/library", { method: "POST", headers, body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Не удалось добавить документ");
  if ($("libraryTitle")) $("libraryTitle").value = "";
  if ($("librarySummary")) $("librarySummary").value = "";
  if ($("libraryFile")) $("libraryFile").value = "";
  await loadLibrary();
  if (msg) msg.innerHTML = '<span class="ok">Документ добавлен</span>';
}

async function deleteLibraryDoc(id) {
  if (!id) return;
  if (!confirm("Удалить документ из библиотеки?")) return;
  await api("/api/admin/library/" + encodeURIComponent(id), { method: "DELETE" });
  await loadLibrary();
  const msg = $("libraryMsg");
  if (msg) msg.innerHTML = '<span class="ok">Документ удалён</span>';
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
    try { await loadLibrary(); } catch (e) {}
  }
}

let detailAttempt = null;

function answerIsCorrect(ans) {
  if (!ans) return false;
  if (ans.ok === true) return true;
  return ans.pick != null && ans.correct != null && Number(ans.pick) === Number(ans.correct);
}

function classifyDetailAnswers(answers) {
  const list = Array.isArray(answers) ? answers : [];
  const answered = list.filter(a => a.pick != null);
  const unanswered = list.filter(a => a.pick == null);
  const correct = answered.filter(answerIsCorrect);
  const wrong = answered.filter(a => !answerIsCorrect(a));
  return { answered, unanswered, correct, wrong };
}

function renderAnswerBlock(ans, idx) {
  const ok = answerIsCorrect(ans);
  const none = ans.pick == null;
  const cls = ok ? "ok" : (none ? "" : "bad");
  const mark = ok ? '<span class="ok">верно</span>'
    : (none ? '<span class="hint">нет ответа</span>' : '<span class="bad">неверно</span>');
  const opts = Array.isArray(ans.a) ? ans.a : [];
  let list = "";
  if (opts.length) {
    list = "<ul>" + opts.map((text, j) => {
      const n = j + 1;
      let liCls = "";
      if (ans.correct != null && n === Number(ans.correct)) liCls = "right";
      if (ans.pick != null && n === Number(ans.pick)) {
        liCls = (ans.correct != null && n === Number(ans.correct)) ? "right" : "wrongpick";
      }
      const prefix = (ans.pick != null && n === Number(ans.pick)) ? "→ " : "";
      const suffix = (ans.correct != null && n === Number(ans.correct)) ? " ✓" : "";
      return `<li class="${liCls}">${prefix}${esc(text)}${suffix}</li>`;
    }).join("") + "</ul>";
  } else {
    const bits = [];
    if (ans.pickText) bits.push("Ответ курсанта: " + esc(ans.pickText));
    else if (ans.pick != null) bits.push("Ответ курсанта: вариант " + esc(ans.pick));
    if (ans.correctText) bits.push("Верный: " + esc(ans.correctText));
    else if (ans.correct != null) bits.push("Верный: вариант " + esc(ans.correct));
    list = bits.length ? `<p class="hint">${bits.join(" · ")}</p>` : '<p class="hint">Текст вариантов не сохранён</p>';
  }
  return `<div class="ans ${cls}">
    <div class="qi">Вопрос ${esc(ans.i != null ? ans.i : idx + 1)} · ${mark}</div>
    <div class="qt">${esc(ans.q || "—")}</div>
    ${list}
  </div>`;
}

function openAnsList(kind) {
  if (!detailAttempt) return;
  const parts = classifyDetailAnswers(detailAttempt.answers);
  let title = "";
  let items = [];
  if (kind === "answered") {
    title = "Успел ответить · " + questionsCountPhrase(parts.answered.length);
    items = parts.answered;
  } else if (kind === "unanswered") {
    title = "Не успел ответить · " + questionsCountPhrase(parts.unanswered.length);
    items = parts.unanswered;
  } else if (kind === "correct") {
    title = "Правильных ответов · " + parts.correct.length;
    items = parts.correct;
  } else if (kind === "wrong") {
    title = "Неправильных ответов · " + parts.wrong.length;
    items = parts.wrong;
  }
  $("ansListTitle").textContent = title;
  $("ansListBody").innerHTML = items.length
    ? items.map((a, i) => renderAnswerBlock(a, i)).join("")
    : '<p class="hint">Список пуст</p>';
  $("ansListModal").classList.remove("hidden");
}

function closeAnsList() {
  $("ansListModal").classList.add("hidden");
}

async function openDetail(id) {
  let a = attemptsCache.find(x => x.id === id);
  try {
    a = await api("/api/admin/attempts/" + encodeURIComponent(id));
  } catch (e) {
    if (!a) { alert(e.message); return; }
  }
  detailAttempt = a;
  $("detailTitle").textContent = a.test_title || "Подробности теста";
  $("detailSub").textContent = "Номер " + (a.student_num || "—") + " · Позывной " + (a.callsign || "—");
  const when = (a.finished_at || a.created_at || "").replace("T", " ").slice(0, 19);
  const total = (a.total != null && a.total > 0) ? a.total
    : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : "—");
  const parts = classifyDetailAnswers(a.answers);
  const okN = parts.correct.length;
  const badAnsweredN = parts.wrong.length;
  const unansweredN = parts.unanswered.length;
  const badWithSkipN = badAnsweredN + unansweredN;
  const totalForGrade = okN + badWithSkipN;
  const percentWithSkip = totalForGrade > 0 ? Math.round(okN / totalForGrade * 100) : null;
  const gradeWithSkip = percentWithSkip != null ? gradeForPercent(percentWithSkip) : "–";
  const statusNode = document.createElement("div");
  statusNode.innerHTML = attemptStatusHtml(a);
  $("detailMeta").innerHTML = [
    ["Баллы", a.score != null ? (a.score + " / " + total) : "—"],
    ["Процент", percentWithSkip != null ? percentWithSkip + "%" : (a.percent != null ? a.percent + "%" : "—")],
    ["Время прохождения", formatDuration(a.duration_sec)],
    ["Когда", when || "—"]
  ].map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join("") +
    `<div><b>Статус</b>${statusNode.innerHTML}</div>` +
    (a.timed_out || unansweredN > 0
      ? '<div><b>Пометка</b><span class="badge-timeout">Не уложился по времени</span></div>' : "") +
    (a.grade_manual ? '<div><b>Оценка</b><span class="hint">изменена преподавателем</span></div>' : "");

  const shownGrade = a.grade_manual ? (a.grade || gradeWithSkip) : (gradeWithSkip !== "–" ? gradeWithSkip : (a.grade || "–"));
  const gradeEditAllowed = canEditGrade();
  if ($("detailGradeEdit")) {
    $("detailGradeEdit").value = shownGrade === "–" ? "" : shownGrade;
    $("detailGradeEdit").readOnly = !gradeEditAllowed;
    $("detailGradeEdit").disabled = !gradeEditAllowed;
    $("detailGradeEdit").title = gradeEditAllowed ? "" : "Менять оценку могут администратор и старший инструктор";
  }
  if ($("btnSaveDetailGrade")) $("btnSaveDetailGrade").hidden = !gradeEditAllowed;
  if ($("detailGradeMsg")) $("detailGradeMsg").textContent = "";
  if ($("detailContinueMsg")) $("detailContinueMsg").textContent = "";
  const contBox = $("detailContinueBox");
  if (contBox) {
    contBox.style.display = unansweredN > 0 ? "flex" : "none";
    if ($("detailContinueMin")) {
      $("detailContinueMin").value = a.continue_minutes || 10;
    }
  }

  if ($("detailStats")) {
    const ratioAnswered = formatRatioPct(okN, badAnsweredN);
    const ratioWithSkip = formatRatioPct(okN, badWithSkipN);
    const gradeCls = /^[2-5]$/.test(String(shownGrade)) ? ("grade-" + shownGrade) : "";
    $("detailStats").innerHTML =
      `<button type="button" class="stat-chip" data-ans-list="answered"><b>Успел ответить</b><span>на ${esc(questionsCountPhrase(parts.answered.length))}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="unanswered"><b>Не успел ответить</b><span>на ${esc(questionsCountPhrase(unansweredN))}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="correct"><b>Правильных ответов</b><span>${esc(okN)}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="wrong"><b>Неправильных ответов</b><span>${esc(badAnsweredN)}</span></button>` +
      `<div class="stat-chip-break" aria-hidden="true"></div>` +
      `<div class="stat-chip stat-ratio">` +
        `<div class="stat-ratio-dual">` +
          `<div class="ratio-title">Соотношение правильных и неправильных ответов</div>` +
          `<div class="ratio-cols">` +
            `<div class="ratio-col left">` +
              `<div class="ratio-label">С учётом неотвеченных</div>` +
              `<div class="ratio-vals">${ratioWithSkip}</div>` +
            `</div>` +
            `<div class="ratio-col center">` +
              `<div class="ratio-grade-big ${gradeCls}">${esc(shownGrade)}</div>` +
            `</div>` +
            `<div class="ratio-col right">` +
              `<div class="ratio-label">Из отвеченных</div>` +
              `<div class="ratio-vals">${ratioAnswered}</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  const answers = Array.isArray(a.answers) ? a.answers : [];
  if (!answers.length) {
    $("detailAnswers").innerHTML = '<p class="hint">Подробные ответы не сохранены для этой попытки.</p>';
  } else {
    $("detailAnswers").innerHTML = '<h2 style="margin-top:8px">Все вопросы</h2>' +
      answers.map((ans, idx) => renderAnswerBlock(ans, idx)).join("");
  }
  $("detailModal").classList.remove("hidden");
}

async function saveDetailGrade() {
  if (!detailAttempt || !detailAttempt.id) return;
  if (!canEditGrade()) {
    $("detailGradeMsg").innerHTML = '<span class="bad">Менять оценку могут администратор и старший инструктор</span>';
    return;
  }
  const grade = ($("detailGradeEdit") && $("detailGradeEdit").value || "").trim();
  if (!grade) {
    $("detailGradeMsg").innerHTML = '<span class="bad">Укажите оценку</span>';
    return;
  }
  $("detailGradeMsg").textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/attempts/" + encodeURIComponent(detailAttempt.id) + "/grade", {
      method: "PUT",
      json: { grade }
    });
    detailAttempt = res.attempt || detailAttempt;
    $("detailGradeMsg").innerHTML = '<span class="ok">Оценка сохранена</span>';
    await refresh();
    openDetail(detailAttempt.id);
  } catch (e) {
    $("detailGradeMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

async function allowContinueRemaining() {
  if (!detailAttempt || !detailAttempt.id) return;
  const minutes = parseInt(($("detailContinueMin") && $("detailContinueMin").value) || "10", 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    $("detailContinueMsg").innerHTML = '<span class="bad">Укажите минуты</span>';
    return;
  }
  $("detailContinueMsg").textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/attempts/" + encodeURIComponent(detailAttempt.id) + "/continue", {
      method: "POST",
      json: { minutes }
    });
    detailAttempt = res.attempt || detailAttempt;
    $("detailContinueMsg").innerHTML = '<span class="ok">Досдача разрешена · ' + minutes + " мин. Курсант входит тем же номером и позывным.</span>";
    await refresh();
  } catch (e) {
    $("detailContinueMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function setRosterMeta(access) {
  const a = access || {};
  const totalRetakes = rosterCache.reduce((s, r) => s + (Number(r.retake_count) || 0), 0);
  const q = a.questions_count != null && Number(a.questions_count) > 0
    ? (Number(a.questions_count) + " " + questionsWord(a.questions_count))
    : "";
  const tm = a.timer_minutes != null ? (a.timer_minutes + " мин") : "";
  $("rosterSub").textContent =
    [q, tm].filter(Boolean).join(" · ") +
    (q || tm ? " · " : "") +
    "В списке " + (a.roster_count || rosterCache.length || 0) + " курсантов" +
    (a.retake_unused ? (" · свободных паролей: " + a.retake_unused) : "") +
    (totalRetakes ? (" · пересдач всего: " + totalRetakes) : "");
}

function showLastRetake(code, num) {
  $("lastRetakeCode").value = code || "";
  $("lastRetakeFor").innerHTML = code
    ? ('Для №<b class="warn">' + esc(num) + "</b> · курсант вводит этот пароль на том же QR")
    : "Нажмите «Пароль пересдачи» у курсанта";
}

function rosterSortValue(row, key) {
  switch (key) {
    case "npp": return Number(row.npp) || 0;
    case "call": return row.roster_callsign || row.callsign || "";
    case "num": return row.student_num || "";
    case "stream": return row.stream_num || "";
    case "group": return row.group_num || "";
    case "fio": return row.full_name || "";
    case "status": return row.status === "finished" ? 2 : (row.status === "unlocked" ? 1 : 0);
    case "grade": return row.grade || "";
    case "retakes": return Number(row.retake_count) || 0;
    case "code": return row.retake_code || "";
    default: return "";
  }
}

function syncRosterClearUi() {
  const bar = $("rosterClearBar");
  const modeBtn = $("btnRosterClearMode");
  if (bar) bar.style.display = rosterSelectMode ? "flex" : "none";
  if (modeBtn) modeBtn.style.display = rosterSelectMode ? "none" : "";
  const boxes = document.querySelectorAll("#rosterBody input.roster-check");
  const n = document.querySelectorAll("#rosterBody input.roster-check:checked").length;
  const del = $("btnRosterDelSelected");
  const hint = $("rosterClearHint");
  const all = $("rosterCheckAll");
  if (del) del.disabled = !n;
  if (hint) hint.textContent = n ? ("Выбрано: " + n) : (rosterSelectMode ? "Отметьте записи для удаления" : "");
  if (all && boxes.length) {
    all.checked = n > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  } else if (all) {
    all.checked = false;
    all.indeterminate = false;
  }
}

function setRosterSelectMode(on) {
  rosterSelectMode = !!on;
  renderRoster();
}

function selectedRosterNums() {
  return Array.from(document.querySelectorAll("#rosterBody input.roster-check:checked"))
    .map(el => el.value)
    .filter(Boolean);
}

function renderRosterHead() {
  if (!$("rosterHead")) return;
  $("rosterHead").innerHTML =
    (rosterSelectMode
      ? `<th style="width:40px"><input type="checkbox" id="rosterCheckAll" title="Выбрать все"></th>`
      : "") +
    thSortHtml(rosterSort, "npp", "№ п/п") +
    thSortHtml(rosterSort, "call", "Позывной") +
    thSortHtml(rosterSort, "num", "Номер") +
    thSortHtml(rosterSort, "stream", "Поток") +
    thSortHtml(rosterSort, "group", "Группа") +
    thSortHtml(rosterSort, "fio", "ФИО") +
    thSortHtml(rosterSort, "status", "Статус") +
    thSortHtml(rosterSort, "grade", "Оценка") +
    thSortHtml(rosterSort, "retakes", "Пересдачи") +
    thSortHtml(rosterSort, "code", "Пароль пересдачи") +
    "<th></th>";
  if ($("rosterCheckAll")) {
    $("rosterCheckAll").onchange = () => {
      const on = !!$("rosterCheckAll").checked;
      document.querySelectorAll("#rosterBody input.roster-check").forEach(el => { el.checked = on; });
      syncRosterClearUi();
    };
  }
}

function renderRoster() {
  const unusedByNum = {};
  retakesCache.filter(r => r.status === "unused").forEach(r => {
    if (!unusedByNum[r.for_num]) unusedByNum[r.for_num] = r;
  });

  syncRosterFilters();
  renderRosterHead();
  const rows = (rosterCache || [])
    .filter(r => matchStreamGroup(r, "filterRosterStream", "filterRosterGroup"))
    .slice()
    .sort((a, b) =>
      cmpSortVal(rosterSortValue(a, rosterSort.key), rosterSortValue(b, rosterSort.key), rosterSort.dir)
    );
  $("rosterBody").innerHTML = rows.map(row => {
    const done = row.status === "finished";
    const unlocked = row.status === "unlocked";
    const st = done ? '<span class="ok">сдан</span>'
      : unlocked ? '<span class="warn">пересдача</span>'
      : '<span class="hint">ещё не сдавал</span>';
    const code = row.retake_code || (unusedByNum[row.student_num] && unusedByNum[row.student_num].code) || "";
    const codeCell = code
      ? `<button type="button" class="code-pill linkish" data-show-retake="${esc(code)}" data-show-num="${esc(row.student_num)}" title="Показать в поле сверху">${esc(code)}</button>`
      : "—";
    const call = row.roster_callsign || row.callsign || "";
    const fio = row.full_name || "";
    const stream = row.stream_num || "";
    const group = row.group_num || "";
    const retakes = Number(row.retake_count) || 0;
    const retakeBtn = (done || unlocked) && !rosterSelectMode
      ? `<button class="btn" type="button" data-retake="${esc(row.student_num)}" style="margin-right:6px">Пароль пересдачи</button>`
      : "";
    const checkCell = rosterSelectMode
      ? `<td><input type="checkbox" class="roster-check" value="${esc(row.student_num)}"></td>`
      : "";
    const actions = rosterSelectMode
      ? ""
      : `${retakeBtn}<button class="btn danger" type="button" data-rm-roster="${esc(row.student_num)}">Удалить</button>`;
    return `<tr>
      ${checkCell}
      <td class="npp">${esc(row.npp != null ? row.npp : "")}</td>
      <td>${esc(call || "—")}</td>
      <td><b>${esc(row.student_num)}</b></td>
      <td>${esc(stream || "—")}</td>
      <td>${esc(group || "—")}</td>
      <td>${esc(fio || "—")}</td>
      <td class="${done ? "done" : "pending"}">${st}</td>
      <td>${esc(row.grade || "—")}${row.score != null ? " · " + row.score + (row.total != null ? "/" + row.total : "") : ""}</td>
      <td><b class="${retakes ? "warn" : "hint"}">${esc(retakes)}</b></td>
      <td>${codeCell}</td>
      <td class="row" style="gap:6px">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${rosterSelectMode ? 12 : 11}" class="hint">${(rosterCache || []).length ? "Нет курсантов по фильтру" : "Список пуст — добавьте вручную или загрузите Excel"}</td></tr>`;
  syncRosterClearUi();
  document.querySelectorAll("#rosterBody input.roster-check").forEach(el => {
    el.onchange = () => syncRosterClearUi();
  });

  const unused = retakesCache.filter(r => r.status === "unused");
  const used = retakesCache.filter(r => r.status === "used");
  if (!retakesCache.length) {
    $("retakesBox").innerHTML = '<span class="hint">Пока нет выданных паролей пересдачи</span>';
  } else {
    $("retakesBox").innerHTML =
      (unused.length ? "<div style='margin-bottom:8px'><b class='warn'>Свободные:</b> " +
        unused.map(r => `<span class="code-pill">${esc(r.code)}</span> → №${esc(r.for_num)}`).join(" · ") + "</div>" : "") +
      (used.length ? "<div class='hint'>Использованы: " +
        used.map(r => esc(r.code) + " (№" + esc(r.for_num || r.used_num) + ")").join(", ") + "</div>" : "");
  }
}

async function openRoster(testId, title) {
  rosterTestId = testId;
  rosterSelectMode = false;
  const data = await api("/api/admin/tests/" + encodeURIComponent(testId) + "/roster");
  rosterCache = data.roster || [];
  retakesCache = data.retakes || [];
  const a = data.access || {};
  const bits = [title || testId];
  if (a.questions_count != null && Number(a.questions_count) > 0) {
    bits.push(Number(a.questions_count) + " " + questionsWord(a.questions_count));
  }
  if (a.timer_minutes != null) bits.push(a.timer_minutes + " мин");
  $("rosterTitle").textContent = "Курсанты · " + bits.join(" · ");
  setRosterMeta(data.access);
  $("rosterSaveMsg").textContent = "Шаблон: Номер курсанта · Позывной · Номер группы · Номер потока · ФИО";
  $("timerSaveMsg").textContent = "Задаётся один раз для всего взвода";
  $("rosterNum").value = "";
  $("rosterCall").value = "";
  if ($("rosterGroup")) $("rosterGroup").value = "";
  if ($("rosterStream")) $("rosterStream").value = "";
  if ($("rosterFio")) $("rosterFio").value = "";
  if ($("rosterExcel")) $("rosterExcel").value = "";
  if ($("filterRosterStream")) $("filterRosterStream").value = "";
  if ($("filterRosterGroup")) $("filterRosterGroup").value = "";
  const tm = data.access && data.access.timer_minutes;
  $("rosterTimer").value = tm != null ? tm : 40;
  rosterLinkCache = originLink("/t/" + testId);
  $("rosterLink").textContent = rosterLinkCache;
  $("rosterQr").src = qrUrl(rosterLinkCache);
  const firstUnused = retakesCache.find(r => r.status === "unused");
  showLastRetake(firstUnused ? firstUnused.code : "", firstUnused ? firstUnused.for_num : "");
  renderRoster();
  $("rosterModal").classList.remove("hidden");
  $("rosterNum").focus();
}

async function saveTimer() {
  if (!rosterTestId) return;
  const minutes = parseInt($("rosterTimer").value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    $("timerSaveMsg").innerHTML = '<span class="bad">Укажите число минут (≥ 1)</span>';
    return;
  }
  $("timerSaveMsg").textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/timer", {
      method: "PUT",
      json: { minutes }
    });
    $("timerSaveMsg").innerHTML = '<span class="ok">Таймер: ' + res.timer_minutes + " мин для всех</span>";
    setRosterMeta(res.access);
    await refresh();
  } catch (e) {
    $("timerSaveMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function showRosterDupModal(duplicates) {
  const rows = Array.isArray(duplicates) ? duplicates : [];
  if (!rows.length) return;
  if ($("rosterDupText")) {
    $("rosterDupText").textContent =
      "Запись с таким номером уже существует, проверьте правильность ввода данных";
  }
  if ($("rosterDupBody")) {
    $("rosterDupBody").innerHTML = rows.map(r => `<tr>
      <td><b>${esc(r.num || r.student_num || "")}</b></td>
      <td>${esc(r.call || r.callsign || "")}</td>
      <td>${esc(r.group || r.group_num || "")}</td>
      <td>${esc(r.stream || r.stream_num || "")}</td>
      <td>${esc(r.fio || r.full_name || "")}</td>
      <td>${esc(r.source || "—")}</td>
    </tr>`).join("");
  }
  if ($("rosterDupModal")) $("rosterDupModal").classList.remove("hidden");
}

function closeRosterDupModal() {
  if ($("rosterDupModal")) $("rosterDupModal").classList.add("hidden");
}

async function addRosterEntry() {
  if (!rosterTestId) return;
  const num = ($("rosterNum").value || "").trim();
  const call = ($("rosterCall").value || "").trim();
  const fio = ($("rosterFio") && $("rosterFio").value || "").trim();
  const group_num = ($("rosterGroup") && $("rosterGroup").value || "").trim();
  const stream_num = ($("rosterStream") && $("rosterStream").value || "").trim();
  if (!num) {
    $("rosterSaveMsg").innerHTML = '<span class="bad">Укажите номер</span>';
    $("rosterNum").focus();
    return;
  }
  $("rosterSaveMsg").textContent = "Добавление…";
  try {
    const res = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster/entry", {
      method: "POST",
      json: { num, call, fio, full_name: fio, group_num, stream_num }
    });
    rosterCache = res.roster || [];
    setRosterMeta(res.access);
    if (res.duplicate) {
      showRosterDupModal(res.duplicates || [{ num, call, fio, group: group_num, stream: stream_num }]);
      $("rosterSaveMsg").innerHTML = '<span class="bad">Номер уже есть в списке</span>';
      renderRoster();
      return;
    }
    $("rosterSaveMsg").innerHTML = '<span class="ok">Добавлен №' + esc(num) + (call ? (" · " + esc(call)) : "") + "</span>";
    $("rosterNum").value = "";
    $("rosterCall").value = "";
    if ($("rosterGroup")) $("rosterGroup").value = "";
    if ($("rosterStream")) $("rosterStream").value = "";
    if ($("rosterFio")) $("rosterFio").value = "";
    $("rosterNum").focus();
    renderRoster();
    await refresh();
  } catch (e) {
    $("rosterSaveMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

async function removeRosterEntry(num) {
  if (!rosterTestId || !num) return;
  if (!confirm("Убрать №" + num + " из списка допущенных?")) return;
  const res = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster/" + encodeURIComponent(num), {
    method: "DELETE"
  });
  rosterCache = res.roster || [];
  setRosterMeta(res.access);
  renderRoster();
  await refresh();
}

async function downloadRosterTemplate() {
  const r = await fetch("/api/admin/roster-template.xlsx", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "Не удалось скачать шаблон");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lis-cadets-template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadStaffTemplate() {
  const r = await fetch("/api/admin/staff-template.xlsx", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "Не удалось скачать шаблон");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lis-staff-template.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showStaffDupModal(duplicates) {
  const rows = Array.isArray(duplicates) ? duplicates : [];
  if (!rows.length) return;
  if ($("staffDupText")) {
    $("staffDupText").textContent =
      "Найдено дубликатов: " + rows.length + ". Записи с такими ФИО не добавлены.";
  }
  if ($("staffDupBody")) {
    $("staffDupBody").innerHTML = rows.map(r => `<tr>
      <td>${esc(String(r.row != null ? r.row : ""))}</td>
      <td><b>${esc(r.fio || "")}</b></td>
      <td>${esc(r.role || "")}</td>
      <td>${esc(r.callsign || "")}</td>
      <td>${esc(r.department || "")}</td>
      <td>${esc(r.reason || "")}</td>
    </tr>`).join("");
  }
  if ($("staffDupModal")) $("staffDupModal").classList.remove("hidden");
}

function closeStaffDupModal() {
  if ($("staffDupModal")) $("staffDupModal").classList.add("hidden");
}

async function importStaffExcel() {
  const depId = ($("filterStaffDep") && $("filterStaffDep").value) || "";
  const f = $("staffExcel") && $("staffExcel").files[0];
  if (!f) {
    if ($("staffImportMsg")) $("staffImportMsg").innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if ($("staffImportMsg")) $("staffImportMsg").textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", f);
  if (depId) fd.append("department_id", depId);
  try {
    const r = await fetch("/api/admin/staff/import", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Ошибка импорта");
    let msg = "Добавлено: " + (data.imported || 0);
    if (data.skipped) msg += " · пропущено: " + data.skipped;
    if ($("staffImportMsg")) $("staffImportMsg").innerHTML = '<span class="ok">' + esc(msg) + "</span>";
    if ($("staffExcel")) $("staffExcel").value = "";
    await refreshOrg();
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      showStaffDupModal(data.duplicates);
    }
  } catch (e) {
    if ($("staffImportMsg")) $("staffImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

async function importRosterExcel() {
  if (!rosterTestId) return;
  const files = [...(($("rosterExcel") && $("rosterExcel").files) || [])];
  if (!files.length) {
    $("rosterSaveMsg").innerHTML = '<span class="bad">Выберите файл(ы) Excel</span>';
    return;
  }
  $("rosterSaveMsg").textContent = "Сохранение " + files.length + " файл(ов)…";
  const fd = new FormData();
  files.forEach(f => fd.append("files", f));
  fd.append("mode", $("rosterAppend").checked ? "append" : "replace");
  try {
    const r = await fetch("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster/import", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Ошибка сохранения");
    rosterCache = data.roster || [];
    setRosterMeta(data.access);
    const imported = Number(data.imported) || 0;
    const skipped = Number(data.skipped) || 0;
    const filesN = Number(data.files) || files.length;
    const msg = "Файлов: " + filesN + " · добавлено: " + imported +
      " · пропущено (дубли): " + skipped +
      " · в списке: " + (data.count != null ? data.count : (rosterCache || []).length);
    $("rosterSaveMsg").innerHTML = '<span class="' + (skipped ? "warn" : "ok") + '">' + esc(msg) + "</span>";
    $("rosterExcel").value = "";
    renderRoster();
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      showRosterDupModal(data.duplicates);
    }
    await refresh();
  } catch (e) {
    $("rosterSaveMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

async function deleteSelectedRoster() {
  if (!rosterTestId) return;
  const nums = selectedRosterNums();
  if (!nums.length) return;
  if (!confirm("Удалить выбранных курсантов из списка теста: " + nums.length + "?")) return;
  const res = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster/bulk-delete", {
    method: "POST",
    json: { nums }
  });
  rosterCache = res.roster || [];
  setRosterMeta(res.access);
  rosterSelectMode = false;
  renderRoster();
  await refresh();
}

async function issueRetake(num) {
  if (!rosterTestId || !num) return;
  const res = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/retake", {
    method: "POST",
    json: { num }
  });
  const code = (res.retake && res.retake.code) || (res.invite && res.invite.code);
  showLastRetake(code || "", num);
  if (code) {
    try { $("lastRetakeCode").focus(); $("lastRetakeCode").select(); } catch (e) {}
  }
  const data = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster");
  rosterCache = data.roster || [];
  retakesCache = data.retakes || [];
  setRosterMeta(data.access);
  renderRoster();
  await refresh();
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
$("btnAddDep").onclick = async () => {
  try {
    await api("/api/admin/departments", { method: "POST", json: { name: $("depName").value } });
    $("depName").value = "";
    await refreshOrg();
  } catch (e) { alert(e.message); }
};
$("btnAddStaff").onclick = async () => {
  try {
    await api("/api/admin/staff", {
      method: "POST",
      json: {
        department_id: $("staffDep").value,
        role: $("staffRole").value,
        fio: $("staffFio").value,
        callsign: $("staffCall").value
      }
    });
    $("staffFio").value = "";
    $("staffCall").value = "";
    await refreshOrg();
  } catch (e) { alert(e.message); }
};
if ($("btnAddStaffDetail")) $("btnAddStaffDetail").onclick = async () => {
  const depId = ($("filterStaffDep") && $("filterStaffDep").value) || "";
  if (!depId) {
    alert("Выберите отдел");
    return;
  }
  try {
    const role = ($("detailStaffRole") && $("detailStaffRole").value) || "instructor";
    await api("/api/admin/staff", {
      method: "POST",
      json: {
        department_id: depId,
        role,
        fio: $("detailStaffFio").value,
        callsign: $("detailStaffCall").value
      }
    });
    $("detailStaffFio").value = "";
    $("detailStaffCall").value = "";
    await refreshOrg();
  } catch (e) { alert(e.message); }
};
if ($("filterStaffDep")) $("filterStaffDep").onchange = () => renderStaffTable();
if ($("filterStaffRole")) $("filterStaffRole").onchange = () => renderStaffTable();
if ($("filterAccDep")) $("filterAccDep").onchange = () => renderAccounts();
if ($("filterAccRole")) $("filterAccRole").onchange = () => renderAccounts();
if ($("filterAccFio")) $("filterAccFio").oninput = () => renderAccounts();
if ($("btnCloseDep")) $("btnCloseDep").onclick = closeDepWindow;
if ($("depModal")) $("depModal").addEventListener("click", e => { if (e.target === $("depModal")) closeDepWindow(); });
if ($("depModalRole")) $("depModalRole").onchange = () => renderDepModalBody();
if ($("btnDepToDetail")) $("btnDepToDetail").onclick = () => {
  const id = openDepId;
  closeDepWindow();
  if (id) openOrgDetailModule(id);
};
if ($("btnCloseEditDep")) $("btnCloseEditDep").onclick = closeEditDep;
if ($("editDepModal")) $("editDepModal").addEventListener("click", e => {
  if (e.target === $("editDepModal")) closeEditDep();
});
if ($("btnSaveEditDep")) $("btnSaveEditDep").onclick = () => saveEditDep().catch(err => alert(err.message));
if ($("btnEditDepCard")) $("btnEditDepCard").onclick = () => {
  const id = editDepId;
  closeEditDep();
  if (id) openDepWindow(id);
};
if ($("btnEditDepDetail")) $("btnEditDepDetail").onclick = () => {
  const id = editDepId;
  closeEditDep();
  if (id) openOrgDetailModule(id);
};
if ($("editDepName")) $("editDepName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); saveEditDep().catch(err => alert(err.message)); }
});
if ($("btnCloseEditStaff")) $("btnCloseEditStaff").onclick = closeEditStaff;
if ($("btnCloseEditStaff2")) $("btnCloseEditStaff2").onclick = closeEditStaff;
if ($("editStaffModal")) $("editStaffModal").addEventListener("click", e => {
  if (e.target === $("editStaffModal")) closeEditStaff();
});
if ($("btnSaveEditStaff")) $("btnSaveEditStaff").onclick = () => saveEditStaff().catch(err => alert(err.message));
if ($("btnCloseEditUser")) $("btnCloseEditUser").onclick = closeEditUser;
if ($("btnCloseEditUser2")) $("btnCloseEditUser2").onclick = closeEditUser;
if ($("editUserModal")) $("editUserModal").addEventListener("click", e => {
  if (e.target === $("editUserModal")) closeEditUser();
});
if ($("btnSaveEditUser")) $("btnSaveEditUser").onclick = () => saveEditUser().catch(err => alert(err.message));
if ($("editUserRole")) $("editUserRole").onchange = syncEditUserDepVisibility;
const CYR_TO_LAT = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"z",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",
  н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"c",ш:"s",щ:"s",ъ:"",
  ы:"y",ь:"",э:"e",ю:"y",я:"y"
};
const ROLE_LABEL_RU = {
  admin: "Администратор",
  senior: "Старший инструктор",
  instructor: "Инструктор",
  assistant: "Ассистент инструктора"
};

function firstLatinLetter(ch) {
  if (!ch) return "";
  const low = String(ch[0]).toLowerCase();
  if (low >= "a" && low <= "z") return low;
  const m = CYR_TO_LAT[low];
  return m ? m[0] : "";
}

function credentialsFromStaffFio(fio, role) {
  const parts = String(fio || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const surname = parts[0] || "";
  const login = surname ? (surname[0].toUpperCase() + surname.slice(1)) : "";
  const initials = [];
  for (let i = 0; i < Math.min(3, parts.length); i++) {
    const lat = firstLatinLetter(parts[i]);
    if (lat) initials.push(lat);
  }
  while (initials.length < 3) initials.push(initials.length ? initials[initials.length - 1] : "x");
  const roleLabel = ROLE_LABEL_RU[role] || role || "";
  const roleCh = firstLatinLetter(roleLabel) || "x";
  return { login, password: initials.slice(0, 3).join("") + roleCh };
}

function showAccDupModal(duplicates) {
  const rows = Array.isArray(duplicates) ? duplicates : [];
  if (!rows.length) return;
  if ($("accDupText")) {
    $("accDupText").textContent =
      "Пропущено дубликатов: " + rows.length + ". Учётные записи с такими логинами не созданы.";
  }
  if ($("accDupBody")) {
    $("accDupBody").innerHTML = rows.map(r => `<tr>
      <td><b>${esc(r.fio || "")}</b></td>
      <td>${esc(r.login || "")}</td>
      <td>${esc(r.role || "")}</td>
      <td>${esc(r.department || "")}</td>
      <td>${esc(r.reason || "")}</td>
    </tr>`).join("");
  }
  if ($("accDupModal")) $("accDupModal").classList.remove("hidden");
}

function closeAccDupModal() {
  if ($("accDupModal")) $("accDupModal").classList.add("hidden");
}

$("accStaff").onchange = () => {
  const opt = $("accStaff").selectedOptions[0];
  if (!opt || !opt.value) return;
  const role = opt.dataset.role || "instructor";
  const fio = opt.dataset.fio || "";
  $("accRole").value = role;
  $("accDep").value = opt.dataset.dep || "";
  $("accName").value = fio;
  const creds = credentialsFromStaffFio(fio, role);
  $("accLogin").value = creds.login;
  $("accPass").value = creds.password;
};
$("btnCreateAcc").onclick = async () => {
  $("accMsg").textContent = "";
  try {
    const res = await api("/api/admin/users", {
      method: "POST",
      json: {
        login: $("accLogin").value,
        password: $("accPass").value,
        role: $("accRole").value,
        department_id: $("accDep").value || null,
        staff_id: $("accStaff").value || null,
        display_name: $("accName").value,
        must_change_password: true
      }
    });
    $("accMsg").innerHTML = '<span class="ok">Создано. Временный пароль: <b>' + esc(res.temp_password) + "</b> — сохраните его.</span>";
    $("accLogin").value = "";
    $("accPass").value = "";
    $("accName").value = "";
    $("accStaff").value = "";
    await refreshOrg();
  } catch (e) {
    $("accMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
};

async function createAccountsForAllStaff() {
  if ($("accMsg")) $("accMsg").textContent = "Создание учётных записей…";
  try {
    const res = await api("/api/admin/users/from-staff", { method: "POST", json: {} });
    let msg = "Создано: " + (res.created || 0);
    if (res.skipped) msg += " · пропущено: " + res.skipped;
    if ($("accMsg")) $("accMsg").innerHTML = '<span class="ok">' + esc(msg) + "</span>";
    await refreshOrg();
    if (Array.isArray(res.duplicates) && res.duplicates.length) {
      showAccDupModal(res.duplicates);
    }
  } catch (e) {
    if ($("accMsg")) $("accMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}
if ($("btnCreateAccAllStaff")) {
  $("btnCreateAccAllStaff").onclick = () => createAccountsForAllStaff().catch(e => alert(e.message));
}
if ($("btnCloseAccDup")) $("btnCloseAccDup").onclick = closeAccDupModal;
if ($("accDupModal")) $("accDupModal").addEventListener("click", e => {
  if (e.target === $("accDupModal")) closeAccDupModal();
});
$("btnRefresh").onclick = () => refresh().catch(e => alert(e.message));
if ($("btnAddGradeRule")) $("btnAddGradeRule").onclick = () => {
  gradingRules = readGradingForm().map(r => ({
    min: r.min === "" ? 0 : Number(r.min),
    grade: r.grade
  }));
  gradingRules.push({ min: 0, grade: "" });
  renderGradingEditor();
};
if ($("btnSaveGrading")) $("btnSaveGrading").onclick = () => saveGrading().catch(e => alert(e.message));
if ($("gradingBody")) $("gradingBody").addEventListener("click", e => {
  const btn = e.target.closest("[data-grade-del]");
  if (!btn) return;
  const idx = Number(btn.dataset.gradeDel);
  const rows = readGradingForm();
  rows.splice(idx, 1);
  gradingRules = rows.map(r => ({ min: r.min === "" ? 0 : Number(r.min), grade: r.grade }));
  renderGradingEditor();
});
if ($("btnResultsSearch")) $("btnResultsSearch").onclick = () => applyResultsSearch();
if ($("resultsSearch")) {
  $("resultsSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyResultsSearch();
    }
  });
}
$("filterTest").onchange = async () => {
  resultsSort = { key: "when", dir: -1 };
  if ($("filterResultsStream")) $("filterResultsStream").value = "";
  if ($("filterResultsGroup")) $("filterResultsGroup").value = "";
  const testId = ($("filterTest") && $("filterTest").value) || "";
  resultsRosterCache = [];
  if (testId) {
    try {
      const data = await api("/api/admin/tests/" + encodeURIComponent(testId) + "/roster");
      resultsRosterCache = data.roster || [];
    } catch (e) { resultsRosterCache = []; }
  }
  fillCadetFilter();
  renderAttempts();
};
$("filterCadet").onchange = () => {
  renderAttempts();
};
if ($("filterResultsStream")) $("filterResultsStream").onchange = () => {
  if ($("filterResultsGroup")) $("filterResultsGroup").value = "";
  renderAttempts();
};
if ($("filterResultsGroup")) $("filterResultsGroup").onchange = () => renderAttempts();
if ($("filterCadetsStream")) $("filterCadetsStream").onchange = () => {
  if ($("filterCadetsGroup")) $("filterCadetsGroup").value = "";
  renderCadetsTable();
};
if ($("filterCadetsGroup")) $("filterCadetsGroup").onchange = () => renderCadetsTable();
if ($("filterRosterStream")) $("filterRosterStream").onchange = () => {
  if ($("filterRosterGroup")) $("filterRosterGroup").value = "";
  renderRoster();
};
if ($("filterRosterGroup")) $("filterRosterGroup").onchange = () => renderRoster();
$("btnAddRoster").onclick = () => addRosterEntry().catch(e => alert(e.message));
$("btnSaveTimer").onclick = () => saveTimer().catch(e => alert(e.message));
$("rosterTimer").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); saveTimer().catch(err => alert(err.message)); }
});
$("rosterCall").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); $("rosterNum").focus(); }
});
$("rosterNum").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); if ($("rosterFio")) $("rosterFio").focus(); else addRosterEntry().catch(err => alert(err.message)); }
});
if ($("rosterFio")) {
  $("rosterFio").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addRosterEntry().catch(err => alert(err.message)); }
  });
}
bindTableSort("attemptsHead", resultsSort, renderAttempts);
bindTableSort("accHead", accSort, renderAccounts);
bindTableSort("depHead", depSort, renderDepsTable);
bindTableSort("staffHead", staffSort, renderStaffTable);
bindTableSort("depModalHead", depModalSort, renderDepModalBody);
bindTableSort("cadetsHead", cadetsSort, renderCadetsTable);
bindTableSort("testsHead", testsSort, renderTestsTable);
if ($("filterTestsAuthor")) $("filterTestsAuthor").onchange = () => renderTestsTable();
bindTableSort("rosterHead", rosterSort, renderRoster);
$("btnRosterTemplate").onclick = () => downloadRosterTemplate().catch(e => alert(e.message));
$("btnImportRoster").onclick = () => importRosterExcel().catch(e => alert(e.message));
if ($("btnRosterClearMode")) $("btnRosterClearMode").onclick = () => setRosterSelectMode(true);
if ($("btnRosterClearCancel")) $("btnRosterClearCancel").onclick = () => setRosterSelectMode(false);
if ($("btnRosterSelectAll")) $("btnRosterSelectAll").onclick = () => {
  document.querySelectorAll("#rosterBody input.roster-check").forEach(el => { el.checked = true; });
  const all = $("rosterCheckAll");
  if (all) all.checked = true;
  syncRosterClearUi();
};
if ($("btnRosterDelSelected")) $("btnRosterDelSelected").onclick = () => deleteSelectedRoster().catch(e => alert(e.message));
if ($("btnStaffTemplate")) $("btnStaffTemplate").onclick = () => downloadStaffTemplate().catch(e => alert(e.message));
if ($("btnImportStaff")) $("btnImportStaff").onclick = () => importStaffExcel().catch(e => alert(e.message));
if ($("btnAddCadet")) $("btnAddCadet").onclick = () => saveCadet().catch(e => alert(e.message));
if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").onclick = () => clearCadetForm();
if ($("btnCadetsTemplate")) $("btnCadetsTemplate").onclick = () => downloadCadetsTemplate().catch(e => alert(e.message));
if ($("btnImportCadets")) $("btnImportCadets").onclick = () => importCadetsExcel().catch(e => alert(e.message));
if ($("btnFlightSheetUpload")) $("btnFlightSheetUpload").onclick = () => {
  const input = $("flightSheetFile");
  if (input) input.click();
};
if ($("btnFlightSheetCreate")) $("btnFlightSheetCreate").onclick = () => addFlightDay().catch(showFlightSheetError);
if ($("btnFlightSheetDownload")) $("btnFlightSheetDownload").onclick = () => downloadFlightSheet().catch(showFlightSheetError);
if ($("libraryTabs")) $("libraryTabs").addEventListener("click", e => {
  const btn = e.target.closest("[data-library-tab]");
  if (!btn) return;
  setLibraryTab(btn.getAttribute("data-library-tab"));
});
if ($("btnLibraryAdd")) $("btnLibraryAdd").onclick = () => addLibraryDoc().catch(e => {
  const msg = $("libraryMsg");
  if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
});
if ($("libraryBody")) $("libraryBody").addEventListener("click", e => {
  const btn = e.target.closest("[data-library-del]");
  if (!btn) return;
  deleteLibraryDoc(btn.getAttribute("data-library-del")).catch(err => {
    const msg = $("libraryMsg");
    if (msg) msg.innerHTML = '<span class="bad">' + esc(err.message) + "</span>";
  });
});
if ($("flightSheetFile")) $("flightSheetFile").onchange = () => {
  const file = $("flightSheetFile").files && $("flightSheetFile").files[0];
  $("flightSheetFile").value = "";
  if (!file) return;
  importFlightSheet(file).catch(showFlightSheetError);
};
if ($("btnFlightSheetSave")) $("btnFlightSheetSave").onclick = () => saveFlightSheet().catch(showFlightSheetError);
if ($("btnFlightSheetDelete")) $("btnFlightSheetDelete").onclick = () => deleteFlightSheet().catch(showFlightSheetError);
if ($("btnDelCadetsSelected")) $("btnDelCadetsSelected").onclick = () => deleteSelectedCadets().catch(e => alert(e.message));
if ($("btnClearMyCadets")) $("btnClearMyCadets").onclick = () => clearMyCadets().catch(e => alert(e.message));
if ($("cadetsBody")) $("cadetsBody").addEventListener("change", e => {
  if (e.target && e.target.classList && e.target.classList.contains("cadet-check")) syncCadetSelectionUi();
});
if ($("btnCadetDupBack")) $("btnCadetDupBack").onclick = closeCadetDupModal;
if ($("cadetDupModal")) $("cadetDupModal").addEventListener("click", e => { if (e.target === $("cadetDupModal")) closeCadetDupModal(); });
if ($("btnCloseCadetImport")) $("btnCloseCadetImport").onclick = closeCadetImportModal;
if ($("cadetImportModal")) $("cadetImportModal").addEventListener("click", e => { if (e.target === $("cadetImportModal")) closeCadetImportModal(); });
if ($("btnCloseRosterDup")) $("btnCloseRosterDup").onclick = closeRosterDupModal;
if ($("rosterDupModal")) $("rosterDupModal").addEventListener("click", e => {
  if (e.target === $("rosterDupModal")) closeRosterDupModal();
});
if ($("btnCloseStaffDup")) $("btnCloseStaffDup").onclick = closeStaffDupModal;
if ($("staffDupModal")) $("staffDupModal").addEventListener("click", e => {
  if (e.target === $("staffDupModal")) closeStaffDupModal();
});
$("btnCopyRosterLink").onclick = () => {
  if (!rosterLinkCache) return;
  const b = $("btnCopyRosterLink");
  copyText(rosterLinkCache).then(() => flashCopied(b)).catch(() => prompt("Скопируйте:", rosterLinkCache));
};

if ($("btnCloseEditTest")) $("btnCloseEditTest").onclick = closeEditTest;
if ($("btnCloseEditTest2")) $("btnCloseEditTest2").onclick = closeEditTest;
if ($("editTestModal")) $("editTestModal").addEventListener("click", e => {
  if (e.target === $("editTestModal")) closeEditTest();
});
if ($("btnSaveEditTest")) $("btnSaveEditTest").onclick = () => saveEditTest().catch(err => alert(err.message));

function closeDetail() {
  detailAttempt = null;
  $("detailModal").classList.add("hidden");
  closeAnsList();
}
function closeRoster() {
  rosterSelectMode = false;
  $("rosterModal").classList.add("hidden");
}

$("btnCloseDetail").onclick = closeDetail;
$("btnCloseRoster").onclick = closeRoster;
$("detailModal").addEventListener("click", e => { if (e.target === $("detailModal")) closeDetail(); });
$("rosterModal").addEventListener("click", e => { if (e.target === $("rosterModal")) closeRoster(); });
if ($("btnCloseAnsList")) $("btnCloseAnsList").onclick = closeAnsList;
if ($("ansListModal")) $("ansListModal").addEventListener("click", e => {
  if (e.target === $("ansListModal")) closeAnsList();
});
if ($("detailStats")) $("detailStats").addEventListener("click", e => {
  const chip = e.target.closest("[data-ans-list]");
  if (!chip) return;
  openAnsList(chip.getAttribute("data-ans-list"));
});
if ($("btnSaveDetailGrade")) $("btnSaveDetailGrade").onclick = () => saveDetailGrade().catch(err => alert(err.message));
if ($("btnAllowContinue")) $("btnAllowContinue").onclick = () => allowContinueRemaining().catch(err => alert(err.message));
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

(async () => {
  initModules();
  if (!token) { goHomeLogin(); return; }
  try {
    const me = await api("/api/admin/me");
    setCurrentUser(me.user);
    if (me.user && me.user.must_change_password) {
      showApp(true, true);
      return;
    }
    showApp(true);
    initModules();
    await refresh();
    if (isAdmin()) await refreshOrg().catch(() => {});
  } catch {
    token = "";
    setCurrentUser(null);
    localStorage.removeItem("lisAdminToken");
    goHomeLogin();
  }
})();
