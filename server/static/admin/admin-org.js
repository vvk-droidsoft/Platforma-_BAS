/* Org: departments, staff, accounts. Before flight boot. */

const STAFF_ROLE_ORDER = { senior: 0, instructor: 1, assistant: 2, admin: -1 };

let openDepId = "";

let editDepId = "";

let editStaffId = "";

let editUserId = "";

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
  if ($("editUserFlightSheet")) $("editUserFlightSheet").checked = !!u.can_flight_sheet;
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
  const can_flight_sheet = !!($("editUserFlightSheet") && $("editUserFlightSheet").checked);
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
        must_change_password,
        can_flight_sheet
      }
    });
    closeEditUser();
    await refreshOrg();
  } catch (e) {
    $("editUserMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
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

if ($("btnCreateAccAllStaff")) {
  $("btnCreateAccAllStaff").onclick = () => createAccountsForAllStaff().catch(e => alert(e.message));
}
if ($("btnCloseAccDup")) $("btnCloseAccDup").onclick = closeAccDupModal;
if ($("accDupModal")) $("accDupModal").addEventListener("click", e => {
  if (e.target === $("accDupModal")) closeAccDupModal();
});
bindTableSort("accHead", accSort, renderAccounts);
bindTableSort("depHead", depSort, renderDepsTable);
bindTableSort("staffHead", staffSort, renderStaffTable);
bindTableSort("depModalHead", depModalSort, renderDepModalBody);
if ($("btnStaffTemplate")) $("btnStaffTemplate").onclick = () => downloadStaffTemplate().catch(e => alert(e.message));
if ($("btnImportStaff")) $("btnImportStaff").onclick = () => importStaffExcel().catch(e => alert(e.message));
if ($("btnCloseStaffDup")) $("btnCloseStaffDup").onclick = closeStaffDupModal;
if ($("staffDupModal")) $("staffDupModal").addEventListener("click", e => {
  if (e.target === $("staffDupModal")) closeStaffDupModal();
});

