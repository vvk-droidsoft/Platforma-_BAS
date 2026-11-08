/* Org: структура организации, конфигуратор ЛС, учётные записи. Before flight boot. */

let editDepId = "";

let editTitleId = "";

let editStaffArchived = false;

/** Открытые отделы в аккордеоне структуры (null — ещё не инициализировано). */
let structOpen = null;

let editStaffId = "";

let editUserId = "";
/** Справочник grantable-модулей для карточки учётки. */
let grantableModulesCache = null;

/** staff_id для модалки «Создать учётную запись» из карточки сотрудника. */
let createStaffAccId = "";

/** Кэш списка распределений для блока занятости. */
let distListCache = [];
/** id → полное распределение (со streams). */
let distDetailCache = {};
/** staff_id → текст занятости; null до первой загрузки карты. */
let distEmploymentMap = null;
/** Подпись «свободен» в текущем режиме фильтра. */
let empUnassignedLabel = "Не задействован на эту дату";
const EMP_NOT_ASSIGNED = "Не задействован в этом распределении";
const EMP_FREE_ON_DATE = "Не задействован на эту дату";

function jobTitleByCode(code) {
  const list = jobTitlesAll.length ? jobTitlesAll : jobTitlesCache;
  return list.find(t => t.code === code) || null;
}

function jobTitleLabel(code) {
  const t = jobTitleByCode(code);
  return t ? t.name : (ROLE_LABEL_RU[code] || code || "");
}

function jobTitleShort(code, fallback) {
  const t = jobTitleByCode(code);
  return (t && t.short) || fallback || code || "?";
}

/** Порядок должностей как в справочнике (sort_order); неизвестные — в конец. */
function jobTitleOrder(code) {
  const list = jobTitlesAll.length ? jobTitlesAll : jobTitlesCache;
  const i = list.findIndex(t => t.code === code);
  return i >= 0 ? i : 9999;
}

/**
 * select должностей из кэша API (не хардкод).
 * opts.allLabel — пункт «Все»; opts.keep — код архивной/текущей должности, который надо оставить в списке.
 */
function fillJobTitleSelect(selId, opts) {
  const el = $(selId);
  if (!el) return;
  opts = opts || {};
  const prev = opts.value != null ? opts.value : el.value;
  const list = jobTitlesCache.slice();
  if (opts.keep && !list.some(t => t.code === opts.keep)) {
    list.push(jobTitleByCode(opts.keep) || { code: opts.keep, name: opts.keep });
  }
  el.innerHTML =
    (opts.allLabel ? `<option value="">${esc(opts.allLabel)}</option>` : "") +
    list.map(t => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join("");
  if (prev && list.some(t => t.code === prev)) el.value = prev;
}

/** Роли входа (admin/senior/instructor/assistant) остаются фиксированными; подписи — из справочника. */
function relabelLoginRoleSelects() {
  ["accRole", "filterAccRole", "editUserRole", "createStaffAccRole"].forEach(id => {
    const el = $(id);
    if (!el) return;
    Array.from(el.options).forEach(o => {
      if (o.value && o.value !== "admin" && ROLE_LABEL_RU[o.value]) {
        const label = jobTitleLabel(o.value);
        if (o.textContent !== label) o.textContent = label;
      }
    });
  });
}

/** Роль входа для учётки по коду должности (кастомные должности → assistant). */
function loginRoleForTitle(code) {
  return code === "senior" || code === "instructor" || code === "assistant" ? code : "assistant";
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, "0");
  return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear() +
    " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function staffEmploymentLabel(s) {
  if (!distEmploymentMap) return "";
  return distEmploymentMap[s.id] || empUnassignedLabel;
}

function isEmpFreeLabel(label) {
  return !label || String(label).indexOf("Не задействован") === 0;
}

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function ensureEmpDateDefault() {
  const el = $("filterEmpDate");
  if (!el) return todayIsoLocal();
  if (!el.value) el.value = todayIsoLocal();
  return el.value;
}

/** Период покрывает дату (YYYY-MM-DD); без обеих границ — нет. */
function periodCoversDate(from, to, dateIso) {
  if (!dateIso) return true;
  const d = String(dateIso).slice(0, 10);
  const a = String(from || "").slice(0, 10);
  const b = String(to || "").slice(0, 10);
  if (!a && !b) return false;
  if (a && d < a) return false;
  if (b && d > b) return false;
  return true;
}

function staffSortValue(s, key) {
  switch (key) {
    case "dep": return s.department_name || "";
    case "role": return jobTitleOrder(s.role);
    case "fio": return s.fio || "";
    case "call": return s.callsign || "";
    case "emp": return staffEmploymentLabel(s);
    default: return "";
  }
}

function sortedStaffList(list, state) {
  const arr = (list || []).slice();
  const { key, dir } = state;
  arr.sort((a, b) =>
    cmpSortVal(staffSortValue(a, key), staffSortValue(b, key), dir) ||
    cmpSortVal(a.fio || "", b.fio || "", 1)
  );
  return arr;
}

/** Дата занятости: 21.10.26 */
function formatEmploymentDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "").trim());
  if (!m) return "";
  return m[3] + "." + m[2] + "." + m[1].slice(2);
}

function employmentPeriodPhrase(from, to) {
  const a = formatEmploymentDate(from);
  const b = formatEmploymentDate(to);
  if (a && b) return "с " + a + " по " + b;
  if (a) return "с " + a;
  if (b) return "по " + b;
  return "";
}

/**
 * staff_id → «Группа №X / Поток №X с … по …» (+ название распределения при агрегации).
 * opts.onDate — только периоды, покрывающие дату; opts.distTitle — суффикс.
 */
function buildStaffEmploymentMap(dist, opts) {
  const onDate = opts && opts.onDate ? String(opts.onDate).slice(0, 10) : "";
  const distTitle = String((opts && opts.distTitle) || "").trim();
  const map = {};
  function add(staffId, from, to, unitLabel) {
    if (!staffId) return;
    if (onDate && !periodCoversDate(from, to, onDate)) return;
    const period = employmentPeriodPhrase(from, to);
    if (!period) return;
    const unit = String(unitLabel || "").trim();
    let phrase = unit ? (unit + " " + period) : period;
    if (distTitle) phrase += " · " + distTitle;
    if (!map[staffId]) map[staffId] = [];
    if (map[staffId].indexOf(phrase) < 0) map[staffId].push(phrase);
  }
  (dist && dist.streams ? dist.streams : []).forEach(s => {
    const streamLabel = String(s.stream_num || "").trim()
      ? ("Поток №" + String(s.stream_num).trim())
      : "";
    (s.groups || []).forEach(g => {
      const from = g.period_from || s.period_from || "";
      const to = g.period_to || s.period_to || "";
      const gNum = String(g.group_num || "").trim();
      const groupLabel = gNum ? ("Группа №" + gNum) : "";
      (g.instructors || []).forEach(p => add(p && p.id, from, to, groupLabel));
      (g.assistants || []).forEach(p => add(p && p.id, from, to, groupLabel));
    });
    (s.seniors || []).forEach(p =>
      add(p && p.id, s.period_from || "", s.period_to || "", streamLabel)
    );
  });
  const out = {};
  Object.keys(map).forEach(id => {
    out[id] = map[id].join("; ");
  });
  return out;
}

function mergeEmploymentMaps(maps) {
  const acc = {};
  (maps || []).forEach(m => {
    Object.keys(m || {}).forEach(id => {
      if (!acc[id]) acc[id] = [];
      String(m[id] || "").split("; ").forEach(p => {
        const t = p.trim();
        if (t && acc[id].indexOf(t) < 0) acc[id].push(t);
      });
    });
  });
  const out = {};
  Object.keys(acc).forEach(id => {
    out[id] = acc[id].join("; ");
  });
  return out;
}

async function fillFilterEmpDistSelect(prevId) {
  const sel = $("filterEmpDist");
  if (!sel) return;
  try {
    const data = await api("/api/admin/distributions");
    distListCache = data.distributions || [];
  } catch (e) {
    distListCache = [];
  }
  const cur = prevId != null ? prevId : (sel.value || "");
  sel.innerHTML =
    '<option value="">По дате (все)</option>' +
    distListCache.map(d => {
      const label = (d.title || "Без названия") + (d.dist_date ? (" · " + d.dist_date) : "");
      return `<option value="${esc(d.id)}">${esc(label)}</option>`;
    }).join("");
  if (cur && distListCache.some(d => d.id === cur)) sel.value = cur;
  else sel.value = "";
}

async function loadDistDetail(id) {
  if (!id) return null;
  if (distDetailCache[id]) return distDetailCache[id];
  const data = await api("/api/admin/distributions/" + encodeURIComponent(id));
  distDetailCache[id] = data.distribution || { streams: [] };
  return distDetailCache[id];
}

async function loadAllDistDetails() {
  const ids = (distListCache || []).map(d => d.id).filter(Boolean);
  await Promise.all(ids.map(id => loadDistDetail(id).catch(() => {
    distDetailCache[id] = { streams: [] };
  })));
}

async function applyEmpFilters() {
  const id = ($("filterEmpDist") && $("filterEmpDist").value) || "";
  const onDate = ensureEmpDateDefault();
  try {
    if (id) {
      empUnassignedLabel = EMP_NOT_ASSIGNED;
      const dist = await loadDistDetail(id);
      distEmploymentMap = buildStaffEmploymentMap(dist || {}, { onDate });
    } else {
      empUnassignedLabel = EMP_FREE_ON_DATE;
      await loadAllDistDetails();
      const maps = (distListCache || []).map(d =>
        buildStaffEmploymentMap(distDetailCache[d.id] || {}, {
          onDate,
          distTitle: d.title || ""
        })
      );
      distEmploymentMap = mergeEmploymentMaps(maps);
    }
  } catch (e) {
    distEmploymentMap = {};
  }
  renderStructure();
}

function structFilterState() {
  return {
    dep: ($("fStructDep") && $("fStructDep").value) || "",
    role: ($("fStructRole") && $("fStructRole").value) || "",
    q: (($("fStructSearch") && $("fStructSearch").value) || "").trim().toLowerCase(),
    emp: ($("fStructEmp") && $("fStructEmp").value) || ""
  };
}

function structArchiveOn() {
  return !!(isAdmin() && $("fStructArchive") && $("fStructArchive").checked);
}

/** Счётчики отдела: чипы по должностям (динамически) + всего человек (+ в архиве). */
function depChipsHtml(rows) {
  const active = rows.filter(s => !s.archived_at);
  const byRole = {};
  active.forEach(s => { byRole[s.role] = (byRole[s.role] || 0) + 1; });
  const chips = Object.keys(byRole)
    .sort((a, b) => jobTitleOrder(a) - jobTitleOrder(b))
    .map(code => {
      const sample = active.find(s => s.role === code) || {};
      const label = sample.role_label || jobTitleLabel(code);
      const short = jobTitleShort(code, sample.role_short);
      return `<span class="chip" title="${esc(label)}"><span class="r">${esc(short)}</span> <span class="n">${byRole[code]}</span></span>`;
    });
  chips.push(
    `<span class="chip entity-muted">${active.length} ${pluralRu(active.length, "человек", "человека", "человек")}</span>`
  );
  const arch = rows.length - active.length;
  if (arch) chips.push(`<span class="chip warn">в архиве ${arch}</span>`);
  return `<span class="chips">${chips.join("")}</span>`;
}

function structRowHtml(s, ready) {
  const arch = !!s.archived_at;
  let empCell = "";
  if (arch) {
    empCell = `<td class="entity-muted">—</td>`;
  } else if (!ready) {
    empCell = `<td class="entity-muted">…</td>`;
  } else {
    const emp = staffEmploymentLabel(s);
    empCell = `<td class="${isEmpFreeLabel(emp) ? "ok" : "warn"}">${esc(emp)}</td>`;
  }
  return `<tr class="row-click${arch ? " is-archived" : ""}" data-staff-card="${esc(s.id)}" title="Открыть карточку сотрудника">
      <td class="entity-fio">${esc(s.fio)}${arch ? ' <span class="badge-arch">архив</span>' : ""}</td>
      <td class="entity-call">${esc(s.callsign)}</td>
      <td class="entity-role">${esc(s.role_label || jobTitleLabel(s.role))}</td>
      ${empCell}
    </tr>`;
}

function renderStructure() {
  const host = $("orgStructure");
  if (!host) return;
  const f = structFilterState();
  const ready = distEmploymentMap != null;
  const archiveOn = structArchiveOn();
  const depList = (archiveOn ? depAll : depCache) || [];
  if (!structOpen) {
    structOpen = new Set();
    const mine = (currentUser && currentUser.department_id) || "";
    const first = depList.find(d => d.id === mine) || depList[0];
    if (first) structOpen.add(first.id);
  }
  const narrowed = !!(f.q || f.role || f.emp);
  let list = (staffCache || []).filter(s => archiveOn || !s.archived_at);
  if (f.dep) list = list.filter(s => s.department_id === f.dep);
  if (f.role) list = list.filter(s => s.role === f.role);
  if (f.q) {
    list = list.filter(s =>
      String(s.fio || "").toLowerCase().indexOf(f.q) >= 0 ||
      String(s.callsign || "").toLowerCase().indexOf(f.q) >= 0
    );
  }
  if (f.emp && ready) {
    list = list.filter(s => {
      if (s.archived_at) return false;
      const free = isEmpFreeLabel(staffEmploymentLabel(s));
      return f.emp === "free" ? free : !free;
    });
  }
  const byDep = {};
  list.forEach(s => { (byDep[s.department_id] = byDep[s.department_id] || []).push(s); });
  let shownDeps = depList.filter(d => !f.dep || d.id === f.dep);
  if (narrowed) shownDeps = shownDeps.filter(d => (byDep[d.id] || []).length);
  const head =
    thSortHtml(structSort, "fio", "ФИО") +
    thSortHtml(structSort, "call", "Позывной") +
    thSortHtml(structSort, "role", "Должность") +
    thSortHtml(structSort, "emp", "Занятость");
  host.innerHTML = shownDeps.map(d => {
    const rows = sortedStaffList(byDep[d.id] || [], structSort);
    const open = structOpen.has(d.id) || narrowed;
    const body = rows.length
      ? `<div class="scrollx"><table><thead><tr>${head}</tr></thead><tbody>${rows.map(s => structRowHtml(s, ready)).join("")}</tbody></table></div>`
      : `<p class="hint">В отделе нет сотрудников по фильтру</p>`;
    return `<div class="org-acc${open ? "" : " collapsed"}" data-dep-acc="${esc(d.id)}">
      <button type="button" class="org-acc-head" data-toggle-acc="${esc(d.id)}" aria-expanded="${open ? "true" : "false"}">
        <span class="org-acc-title">
          <span class="entity-dept">${esc(d.name)}${d.archived_at ? ' <span class="badge-arch">архив</span>' : ""}</span>
          ${depChipsHtml(rows)}
        </span>
        <span class="org-acc-chev">▼</span>
      </button>
      <div class="org-acc-body">${body}</div>
    </div>`;
  }).join("") || `<p class="hint">Нет сотрудников по выбранному фильтру</p>`;
  if ($("orgStructMeta")) {
    const people = list.filter(s => !s.archived_at).length;
    $("orgStructMeta").textContent =
      " · " + shownDeps.length + " " + pluralRu(shownDeps.length, "отдел", "отдела", "отделов") +
      " · " + people + " " + pluralRu(people, "человек", "человека", "человек");
  }
}

async function loadJobTitles() {
  const list = await api("/api/admin/job-titles" + (isAdmin() ? "?include_archived=1" : ""));
  jobTitlesAll = Array.isArray(list) ? list : [];
  jobTitlesCache = jobTitlesAll.filter(t => !t.archived_at);
  jobTitlesAll.forEach(t => {
    if (t.code && t.name) ROLE_LABEL_RU[t.code] = t.name;
  });
}

async function loadDepartments() {
  const list = await api("/api/admin/departments" + (isAdmin() ? "?include_archived=1" : ""));
  depAll = Array.isArray(list) ? list : [];
  depCache = depAll.filter(d => !d.archived_at);
}

async function loadStaff() {
  staffCache = await api("/api/admin/staff" + (structArchiveOn() ? "?include_archived=1" : ""));
}

function fillDepSelect(selId, opts) {
  const el = $(selId);
  if (!el) return;
  opts = opts || {};
  const prev = el.value;
  el.innerHTML =
    (opts.allLabel ? `<option value="${opts.allValue || ""}">${esc(opts.allLabel)}</option>` : "") +
    depCache.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("") +
    (opts.extra || "");
  if (prev && (depCache.some(d => d.id === prev) || (opts.extra && prev === "__none__"))) el.value = prev;
}

async function refreshOrg() {
  if (!(typeof canAccessOrg === "function" ? canAccessOrg() : isAdmin())) return;
  const admin = isAdmin();
  const prevEmpDist = ($("filterEmpDist") && $("filterEmpDist").value) || "";
  const prevEmpDate = ($("filterEmpDate") && $("filterEmpDate").value) || "";
  await Promise.all([loadJobTitles(), loadDepartments()]);
  await loadStaff();
  fillDepSelect("fStructDep", { allLabel: "Все отделы" });
  fillJobTitleSelect("fStructRole", { allLabel: "Все" });
  relabelLoginRoleSelects();
  if ($("filterEmpDate")) $("filterEmpDate").value = prevEmpDate || todayIsoLocal();
  distDetailCache = {};
  distEmploymentMap = null;
  renderStructure();
  await fillFilterEmpDistSelect(prevEmpDist);
  await applyEmpFilters();
  if (!admin) return;
  const users = await api("/api/admin/users?include_archived=1");
  fillDepSelect("staffDep");
  fillJobTitleSelect("staffRole");
  fillDepSelect("importDep", { allLabel: "— только из файла —" });
  fillDepSelect("accDep", { allLabel: "—" });
  fillDepSelect("filterAccDep", {
    allLabel: "Все отделы",
    extra: `<option value="__none__">Без отдела</option>`
  });
  renderTitlesTable();
  renderDepsConfig();
  if ($("accStaff")) {
    const prevAccStaff = $("accStaff").value;
    $("accStaff").innerHTML = `<option value="">— вручную —</option>` + staffCache.filter(s => !s.archived_at).map(s =>
      `<option value="${esc(s.id)}" data-role="${esc(s.role)}" data-dep="${esc(s.department_id)}" data-fio="${esc(s.fio)}">${esc(s.department_name)} · ${esc(s.role_label)} · ${esc(s.fio)}${s.callsign ? " (" + esc(s.callsign) + ")" : ""}</option>`
    ).join("");
    if (prevAccStaff && staffCache.some(s => s.id === prevAccStaff && !s.archived_at)) $("accStaff").value = prevAccStaff;
  }
  usersCache = users || [];
  renderAccounts();
}

function renderTitlesTable() {
  const body = $("titlesBody");
  if (!body) return;
  const showArch = !!($("cfgTitlesArchive") && $("cfgTitlesArchive").checked);
  const list = showArch ? jobTitlesAll : jobTitlesCache;
  body.innerHTML = list.map(t => {
    const arch = !!t.archived_at;
    const btn = arch
      ? `<button class="btn" type="button" data-restore-title="${esc(t.id)}">Восстановить</button>`
      : `<button class="btn danger" type="button" data-archive-title="${esc(t.id)}"${t.core ? ' disabled title="Базовую должность архивировать нельзя"' : ""}>В архив</button>`;
    return `<tr class="row-click${arch ? " is-archived" : ""}" data-edit-title="${esc(t.id)}" title="Нажмите для переименования">
      <td class="entity-role">${esc(t.name)}${arch ? ' <span class="badge-arch">архив</span>' : ""}</td>
      <td>${esc(t.short || "")}</td>
      <td class="entity-muted">${esc(t.code)}</td>
      <td>${t.staff_count || 0}</td>
      <td>${btn}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="hint">Нет должностей</td></tr>`;
}

function renderDepsConfig() {
  const body = $("depBody");
  if (!body) return;
  const showArch = !!($("cfgDepArchive") && $("cfgDepArchive").checked);
  const list = showArch ? depAll : depCache;
  body.innerHTML = list.map(d => {
    const arch = !!d.archived_at;
    const n = (staffCache || []).filter(s => s.department_id === d.id && !s.archived_at).length;
    const btn = arch
      ? `<button class="btn" type="button" data-restore-dep="${esc(d.id)}">Восстановить</button>`
      : `<button class="btn danger" type="button" data-del-dep="${esc(d.id)}">В архив</button>`;
    return `<tr class="row-click${arch ? " is-archived" : ""}" data-edit-dep="${esc(d.id)}" title="Нажмите для редактирования">
      <td class="dep-name entity-dept">${esc(d.name)}${arch ? ' <span class="badge-arch">архив</span>' : ""}</td>
      <td>${n}</td>
      <td>${btn}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="hint">Пока нет отделов</td></tr>`;
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
    case "status": return u.archived_at ? 2 : (u.active ? 0 : 1);
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
  const archOn = !!($("filterAccArchive") && $("filterAccArchive").checked);
  return (list || []).filter(u => {
    if (u.archived_at && !archOn) return false;
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
  $("accBody").innerHTML = rows.map(u => {
    const arch = !!u.archived_at;
    const actions = arch
      ? `<button class="btn" type="button" data-restore-user="${esc(u.id)}">Восстановить</button>`
      : `<button class="btn" type="button" data-reset-pw="${esc(u.id)}">Новый пароль</button>
        <span class="acc-actions-pair">
          <button class="btn" type="button" data-toggle-user="${esc(u.id)}" data-active="${u.active ? 0 : 1}">${u.active ? "Отключить" : "Включить"}</button>
          <button class="btn danger" type="button" data-del-user="${esc(u.id)}">В архив</button>
        </span>`;
    return `<tr class="row-click${arch ? " is-archived" : ""}" data-edit-user="${esc(u.id)}" title="Нажмите для редактирования">
      <td>${esc(u.login)}</td>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.role_label || u.role)}</td>
      <td>${esc(u.department_name || "—")}</td>
      <td style="color:var(--warn);letter-spacing:.04em">${esc(u.password || "—")}</td>
      <td>${arch ? "в архиве" : (u.active ? "активен" : "отключён")}</td>
      <td class="acc-actions">${actions}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="hint">Нет учётных записей</td></tr>`;
}

function fillEditDepSelects(selId, selected) {
  const el = $(selId);
  if (!el) return;
  const list = (depCache || []).slice();
  if (selected && !list.some(d => d.id === selected)) {
    const d = (depAll || []).find(x => x.id === selected);
    if (d) list.push(d);
  }
  el.innerHTML = list.map(d =>
    `<option value="${esc(d.id)}">${esc(d.name)}${d.archived_at ? " (архив)" : ""}</option>`
  ).join("");
  if (selected && list.some(d => d.id === selected)) el.value = selected;
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
    closeEditDep();
    await refreshOrg();
  } catch (e) {
    $("editDepMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function canEditStaffCard(s) {
  if (!s || !currentUser) return false;
  if (s.archived_at) return false;
  if (currentUser.role === "admin") return true;
  if (currentUser.role === "senior") {
    const myDep = (currentUser.department_id || "").trim();
    return !!(myDep && (s.department_id || "") === myDep);
  }
  return false;
}

function accountForStaff(staffId) {
  const sid = String(staffId || "").trim();
  if (!sid) return null;
  const all = (usersCache || []).filter(u => String(u.staff_id || "").trim() === sid);
  // активная/отключённая запись важнее архивной
  return all.find(u => !u.archived_at) || all[0] || null;
}

function syncCreateStaffAccButton(staffId) {
  const btn = $("btnCreateStaffAcc");
  const box = $("editStaffAccBox");
  const meta = $("editStaffAccMeta");
  const admin = typeof isAdmin === "function" ? isAdmin() : false;
  const linked = admin ? accountForStaff(staffId) : null;
  if (btn) {
    btn.hidden = !admin;
    if (!admin) {
      btn.disabled = true;
    } else {
      btn.disabled = !!linked;
      btn.title = linked
        ? ("Учётка уже есть: " + (linked.login || linked.id))
        : "Создать учётную запись для этого сотрудника";
    }
  }
  if (!box || !meta) return;
  if (!admin) {
    box.classList.add("hidden");
    meta.innerHTML = "";
    return;
  }
  if (!linked) {
    box.classList.add("hidden");
    meta.innerHTML = "";
    return;
  }
  const pass = (linked.password || "").trim();
  meta.innerHTML =
    "<dt>Логин</dt><dd><b>" + esc(linked.login || "—") + "</b>" +
    (linked.archived_at ? ' <span class="badge-arch">архив</span>' : "") + "</dd>" +
    "<dt>Пароль</dt><dd><b>" + esc(pass || "—") + "</b></dd>";
  box.classList.remove("hidden");
}

function staffCardEmploymentHtml(staffId) {
  const lines = [];
  (distListCache || []).forEach(d => {
    const dist = distDetailCache[d.id];
    if (!dist) return;
    const map = buildStaffEmploymentMap(dist, { distTitle: d.title || "" });
    const text = map[staffId];
    if (!text) return;
    String(text).split("; ").forEach(p => {
      const t = p.trim();
      if (t && lines.indexOf(t) < 0) lines.push(t);
    });
  });
  if (!lines.length && distEmploymentMap && distEmploymentMap[staffId]) {
    String(distEmploymentMap[staffId]).split("; ").forEach(p => {
      const t = p.trim();
      if (t && lines.indexOf(t) < 0) lines.push(t);
    });
  }
  if (!lines.length) {
    return '<span class="ok">Нет назначений в загруженных распределениях</span>';
  }
  return "<ul style=\"margin:0;padding-left:1.2em\">" +
    lines.map(l => "<li class=\"warn\">" + esc(l) + "</li>").join("") +
    "</ul>";
}

function setStaffCardEditable(canEdit, lockDepartment) {
  const dep = $("editStaffDep");
  const role = $("editStaffRole");
  const fio = $("editStaffFio");
  const call = $("editStaffCall");
  const saveBtn = $("btnSaveEditStaff");
  const archived = !!editStaffArchived;
  [dep, role, fio, call].forEach(el => {
    if (!el) return;
    el.disabled = !canEdit;
  });
  if (dep && canEdit && lockDepartment) dep.disabled = true;
  if (saveBtn) saveBtn.style.display = canEdit ? "" : "none";
  if ($("editStaffModeHint")) {
    $("editStaffModeHint").textContent = archived
      ? "В архиве — только просмотр"
      : (canEdit
        ? (lockDepartment ? "Редактирование (отдел зафиксирован)" : "Редактирование")
        : "Только просмотр");
  }
  if ($("editStaffTitle")) {
    $("editStaffTitle").textContent = "Карточка сотрудника";
  }
}

function renderStaffCardTimes(s) {
  const el = $("editStaffTimes");
  if (!el) return;
  const rows = [
    ["Создан", formatDateTime(s.created_at), ""],
    ["Изменён", formatDateTime(s.updated_at || s.created_at), ""]
  ];
  if (s.archived_at) rows.push(["В архиве с", formatDateTime(s.archived_at), "warn"]);
  el.innerHTML = rows.map(r =>
    `<dt>${esc(r[0])}</dt><dd class="${r[2]}" style="margin:0">${esc(r[1] || "—")}</dd>`
  ).join("");
}

function syncStaffArchiveButtons(s) {
  const admin = isAdmin();
  const arch = !!(s && s.archived_at);
  if ($("btnArchiveStaff")) $("btnArchiveStaff").hidden = !admin || arch;
  if ($("btnRestoreStaff")) $("btnRestoreStaff").hidden = !admin || !arch;
}

async function openStaffCard(staffId) {
  let s = (staffCache || []).find(x => x.id === staffId);
  if (!s) return;
  // свежая карточка: created_at / updated_at / archived_at
  try {
    const fresh = await api("/api/admin/staff/" + encodeURIComponent(staffId));
    s = Object.assign({}, s, fresh);
  } catch (e) {}
  editStaffId = staffId;
  editStaffArchived = !!s.archived_at;
  const canEdit = canEditStaffCard(s);
  const lockDep = canEdit && isSenior() && !isAdmin();
  fillEditDepSelects("editStaffDep", s.department_id);
  fillJobTitleSelect("editStaffRole", { value: s.role, keep: s.role });
  if ($("editStaffRole") && s.role) $("editStaffRole").value = s.role;
  if ($("editStaffFio")) $("editStaffFio").value = s.fio || "";
  if ($("editStaffCall")) $("editStaffCall").value = s.callsign || "";
  if ($("editStaffMsg")) $("editStaffMsg").textContent = "";
  setStaffCardEditable(canEdit, lockDep);
  renderStaffCardTimes(s);
  syncStaffArchiveButtons(s);
  syncCreateStaffAccButton(staffId);
  if ($("btnCreateStaffAcc") && s.archived_at) $("btnCreateStaffAcc").disabled = true;
  if ($("editStaffEmpBox")) {
    $("editStaffEmpBox").textContent = "Загрузка занятости…";
  }
  $("editStaffModal").classList.remove("hidden");
  try {
    await loadAllDistDetails();
  } catch (e) {}
  if ($("editStaffEmpBox")) {
    $("editStaffEmpBox").innerHTML = staffCardEmploymentHtml(staffId);
  }
  if (canEdit) {
    try { $("editStaffFio").focus(); } catch (e) {}
  }
}

async function archiveEditStaff() {
  if (!isAdmin() || !editStaffId) return;
  const acc = accountForStaff(editStaffId);
  const warnAcc = acc && !acc.archived_at ? (" Учётная запись «" + (acc.login || "") + "» будет отключена.") : "";
  if (!confirm("Архивировать сотрудника?" + warnAcc + " Данные сохранятся, запись можно восстановить.")) return;
  $("editStaffMsg").textContent = "Архивирование…";
  try {
    await api("/api/admin/staff/" + encodeURIComponent(editStaffId), { method: "DELETE" });
    closeEditStaff();
    await refreshOrg();
  } catch (e) {
    $("editStaffMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

async function restoreEditStaff() {
  if (!isAdmin() || !editStaffId) return;
  const acc = accountForStaff(editStaffId);
  let restoreAccount = false;
  if (acc && acc.archived_at) {
    restoreAccount = confirm("Восстановить также учётную запись «" + (acc.login || "") + "»?");
  }
  $("editStaffMsg").textContent = "Восстановление…";
  try {
    await api("/api/admin/staff/" + encodeURIComponent(editStaffId) + "/restore", {
      method: "POST",
      json: { restore_account: restoreAccount }
    });
    closeEditStaff();
    await refreshOrg();
  } catch (e) {
    $("editStaffMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

function openCreateStaffAccModal(staffId) {
  if (!isAdmin()) return;
  const s = (staffCache || []).find(x => x.id === staffId);
  if (!s) return;
  if (accountForStaff(staffId)) {
    if ($("editStaffMsg")) {
      $("editStaffMsg").innerHTML = '<span class="warn">Учётная запись для этого сотрудника уже есть</span>';
    }
    syncCreateStaffAccButton(staffId);
    return;
  }
  createStaffAccId = staffId;
  const role = loginRoleForTitle(s.role || "instructor");
  const fio = s.fio || "";
  const creds = credentialsFromStaffFio(fio, s.role || role);
  if ($("createStaffAccLogin")) $("createStaffAccLogin").value = creds.login;
  if ($("createStaffAccName")) $("createStaffAccName").value = fio;
  if ($("createStaffAccRole")) $("createStaffAccRole").value = role;
  if ($("createStaffAccDep")) {
    $("createStaffAccDep").innerHTML = `<option value="">—</option>` + (depCache || []).map(d =>
      `<option value="${esc(d.id)}">${esc(d.name)}</option>`
    ).join("");
    $("createStaffAccDep").value = s.department_id || "";
  }
  if ($("createStaffAccPass")) $("createStaffAccPass").value = creds.password;
  if ($("createStaffAccMustChange")) $("createStaffAccMustChange").checked = true;
  if ($("createStaffAccMsg")) $("createStaffAccMsg").textContent = "";
  if ($("btnConfirmCreateStaffAcc")) $("btnConfirmCreateStaffAcc").disabled = false;
  if ($("createStaffAccSub")) {
    $("createStaffAccSub").textContent =
      (s.role_label || role) + (s.department_name ? (" · " + s.department_name) : "") +
      " — проверьте данные и при необходимости поправьте";
  }
  $("createStaffAccModal").classList.remove("hidden");
  try { $("createStaffAccLogin").focus(); } catch (e) {}
}

function closeCreateStaffAccModal() {
  createStaffAccId = "";
  if ($("createStaffAccModal")) $("createStaffAccModal").classList.add("hidden");
}

async function confirmCreateStaffAcc() {
  if (!isAdmin() || !createStaffAccId) return;
  if (accountForStaff(createStaffAccId)) {
    if ($("createStaffAccMsg")) {
      $("createStaffAccMsg").innerHTML = '<span class="bad">Учётная запись уже существует</span>';
    }
    return;
  }
  const login = ($("createStaffAccLogin") && $("createStaffAccLogin").value || "").trim();
  const display_name = ($("createStaffAccName") && $("createStaffAccName").value || "").trim();
  const role = ($("createStaffAccRole") && $("createStaffAccRole").value || "").trim();
  const department_id = ($("createStaffAccDep") && $("createStaffAccDep").value || "").trim() || null;
  const password = ($("createStaffAccPass") && $("createStaffAccPass").value || "").trim();
  const must_change_password = !!($("createStaffAccMustChange") && $("createStaffAccMustChange").checked);
  if (!login) {
    $("createStaffAccMsg").innerHTML = '<span class="bad">Укажите логин</span>';
    return;
  }
  if (!department_id) {
    $("createStaffAccMsg").innerHTML = '<span class="bad">Укажите отдел</span>';
    return;
  }
  $("createStaffAccMsg").textContent = "Создание…";
  try {
    const res = await api("/api/admin/users", {
      method: "POST",
      json: {
        login,
        password,
        role,
        department_id,
        staff_id: createStaffAccId,
        display_name,
        must_change_password
      }
    });
    const temp = res.temp_password || password;
    $("createStaffAccMsg").innerHTML =
      '<span class="ok">Создано. Временный пароль: <b>' + esc(temp) + "</b> — сохраните его.</span>";
    await refreshOrg();
    syncCreateStaffAccButton(createStaffAccId);
    if ($("btnConfirmCreateStaffAcc")) $("btnConfirmCreateStaffAcc").disabled = true;
  } catch (e) {
    $("createStaffAccMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

/** Совместимость со старыми вызовами. */
function openEditStaff(staffId) {
  return openStaffCard(staffId);
}

function closeEditStaff() {
  editStaffId = "";
  editStaffArchived = false;
  $("editStaffModal").classList.add("hidden");
}

async function saveEditStaff() {
  if (!editStaffId) return;
  const s = (staffCache || []).find(x => x.id === editStaffId);
  if (!canEditStaffCard(s)) return;
  let department_id = ($("editStaffDep").value || "").trim();
  if (isSenior() && !isAdmin()) {
    department_id = (currentUser.department_id || "").trim();
  }
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
  syncEditUserModulesBypass();
}

function syncEditUserModulesBypass() {
  const box = $("editUserModulesBox");
  if (!box) return;
  const role = ($("editUserRole") && $("editUserRole").value) || "";
  const isAdm = role === "admin";
  box.classList.toggle("is-admin-bypass", isAdm);
  const hint = $("editUserModulesHint");
  if (hint) {
    hint.textContent = isAdm
      ? "Администратор — полный доступ"
      : "Галочка = раздел открыт";
  }
}

async function ensureGrantableModules() {
  if (grantableModulesCache) return grantableModulesCache;
  const data = await api("/api/admin/modules");
  grantableModulesCache = data.modules || [];
  return grantableModulesCache;
}

function renderEditUserModules(effectiveLevels) {
  const host = $("editUserModules");
  if (!host) return;
  const levels = effectiveLevels || {};
  const mods = grantableModulesCache || [];
  host.innerHTML = mods.map(m => {
    const lvl = String(levels[m.id] || "off");
    const on = lvl === "read" || lvl === "write";
    const write = lvl === "write";
    return `<div class="user-mod-row ${on ? "" : "is-off"}" data-mod-id="${esc(m.id)}">
      <label class="user-mod-check">
        <input type="checkbox" class="user-mod-on" ${on ? "checked" : ""}>
        <span>${esc(m.label)}${m.status === "preview" ? ' <span class="hint">(обкатка)</span>' : ""}</span>
      </label>
      <div class="user-mod-levels ${on ? "" : "is-disabled"}">
        <label><input type="radio" name="modlvl-${esc(m.id)}" value="read" ${on && !write ? "checked" : ""}> Только чтение</label>
        <label><input type="radio" name="modlvl-${esc(m.id)}" value="write" ${on && write ? "checked" : ""}> Чтение и редактирование</label>
      </div>
    </div>`;
  }).join("") || '<p class="hint">Нет модулей в реестре</p>';

  host.querySelectorAll(".user-mod-row").forEach(row => {
    const onEl = row.querySelector(".user-mod-on");
    const levelsBox = row.querySelector(".user-mod-levels");
    const radios = row.querySelectorAll('input[type="radio"]');
    const syncRow = () => {
      const on = !!(onEl && onEl.checked);
      row.classList.toggle("is-off", !on);
      if (levelsBox) levelsBox.classList.toggle("is-disabled", !on);
      if (on) {
        const any = Array.from(radios).some(r => r.checked);
        if (!any) {
          const readRadio = row.querySelector('input[value="read"]');
          if (readRadio) readRadio.checked = true;
        }
      }
    };
    if (onEl) onEl.addEventListener("change", syncRow);
  });
  syncEditUserModulesBypass();
}

function collectEditUserModuleGrants() {
  const host = $("editUserModules");
  const out = {};
  if (!host) return out;
  host.querySelectorAll(".user-mod-row").forEach(row => {
    const mid = row.getAttribute("data-mod-id");
    if (!mid) return;
    const on = !!(row.querySelector(".user-mod-on") && row.querySelector(".user-mod-on").checked);
    if (!on) return;
    const checked = row.querySelector('input[type="radio"]:checked');
    out[mid] = (checked && checked.value === "write") ? "write" : "read";
  });
  return out;
}

async function openEditUser(userId) {
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
  if ($("editUserIsTester")) $("editUserIsTester").checked = !!(u.is_tester || u.can_flight_sheet);
  syncEditUserDepVisibility();
  $("editUserMsg").textContent = "";
  $("editUserModal").classList.remove("hidden");
  try { $("editUserLogin").focus(); } catch (e) {}
  try {
    await ensureGrantableModules();
    let effective = u.module_levels || {};
    if (!u.use_module_acl) {
      // подтянуть актуальный effective с сервера (legacy → галочки)
      try {
        const data = await api("/api/admin/users/" + encodeURIComponent(userId) + "/modules");
        effective = data.effective || effective;
        if (data.modules) grantableModulesCache = data.modules;
      } catch (e) {}
    }
    renderEditUserModules(effective);
  } catch (e) {
    if ($("editUserModules")) {
      $("editUserModules").innerHTML = '<p class="hint bad">Не удалось загрузить список модулей</p>';
    }
  }
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
  const is_tester = !!($("editUserIsTester") && $("editUserIsTester").checked);
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
  const payload = {
    login,
    display_name,
    role,
    department_id,
    callsign,
    password,
    must_change_password,
    is_tester
  };
  if (role !== "admin") {
    payload.module_grants = collectEditUserModuleGrants();
  }
  $("editUserMsg").textContent = "Сохранение…";
  try {
    await api("/api/admin/users/" + encodeURIComponent(editUserId), {
      method: "PUT",
      json: payload
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
  a.download = typeof buildTemplateFileName === "function"
    ? buildTemplateFileName(["Шаблон", "Штатка"])
    : "Шаблон_Штатка.xlsx";
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
  const depId = ($("importDep") && $("importDep").value) || "";
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
    if ($("staffImportMsg")) {
      $("staffImportMsg").innerHTML = '<span class="ok">' + esc(msg) + "</span>" +
        (Array.isArray(data.errors) && data.errors.length
          ? '<br><span class="bad">' + data.errors.map(esc).join("<br>") + "</span>"
          : "");
    }
    if ($("staffExcel")) $("staffExcel").value = "";
    await refreshOrg();
    if (Array.isArray(data.duplicates) && data.duplicates.length) {
      showStaffDupModal(data.duplicates);
    }
  } catch (e) {
    if ($("staffExcel")) $("staffExcel").value = "";
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

function openEditTitle(titleId) {
  if (!isAdmin()) return;
  const t = (jobTitlesAll || []).find(x => x.id === titleId);
  if (!t) return;
  editTitleId = titleId;
  $("editTitleName").value = t.name || "";
  $("editTitleMsg").textContent = "";
  if ($("editTitleMeta")) {
    $("editTitleMeta").innerHTML =
      "<dt>Код</dt><dd style=\"margin:0\">" + esc(t.code) + "</dd>" +
      "<dt>Создана</dt><dd style=\"margin:0\">" + esc(formatDateTime(t.created_at) || "—") + "</dd>" +
      "<dt>Изменена</dt><dd style=\"margin:0\">" + esc(formatDateTime(t.updated_at) || "—") + "</dd>" +
      (t.archived_at ? "<dt>В архиве с</dt><dd class=\"warn\" style=\"margin:0\">" + esc(formatDateTime(t.archived_at)) + "</dd>" : "");
  }
  $("editTitleModal").classList.remove("hidden");
  try { $("editTitleName").focus(); $("editTitleName").select(); } catch (e) {}
}

function closeEditTitle() {
  editTitleId = "";
  if ($("editTitleModal")) $("editTitleModal").classList.add("hidden");
}

async function saveEditTitle() {
  if (!isAdmin() || !editTitleId) return;
  const name = ($("editTitleName").value || "").trim();
  if (!name) {
    $("editTitleMsg").innerHTML = '<span class="bad">Укажите название</span>';
    return;
  }
  $("editTitleMsg").textContent = "Сохранение…";
  try {
    await api("/api/admin/job-titles/" + encodeURIComponent(editTitleId), {
      method: "PUT",
      json: { name }
    });
    closeEditTitle();
    await refreshOrg();
  } catch (e) {
    $("editTitleMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
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
if ($("btnAddTitle")) $("btnAddTitle").onclick = async () => {
  try {
    await api("/api/admin/job-titles", { method: "POST", json: { name: $("titleName").value } });
    $("titleName").value = "";
    await refreshOrg();
  } catch (e) { alert(e.message); }
};
if ($("titleName")) $("titleName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); $("btnAddTitle").click(); }
});
if ($("cfgTitlesArchive")) $("cfgTitlesArchive").onchange = () => renderTitlesTable();
if ($("cfgDepArchive")) $("cfgDepArchive").onchange = () => renderDepsConfig();
if ($("btnCloseEditTitle")) $("btnCloseEditTitle").onclick = closeEditTitle;
if ($("btnCloseEditTitle2")) $("btnCloseEditTitle2").onclick = closeEditTitle;
if ($("editTitleModal")) $("editTitleModal").addEventListener("click", e => {
  if (e.target === $("editTitleModal")) closeEditTitle();
});
if ($("btnSaveEditTitle")) $("btnSaveEditTitle").onclick = () => saveEditTitle().catch(err => alert(err.message));
if ($("editTitleName")) $("editTitleName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); saveEditTitle().catch(err => alert(err.message)); }
});

// Структура: фильтры, сортировка, аккордеон
if ($("fStructDep")) $("fStructDep").onchange = () => {
  const id = $("fStructDep").value;
  if (id && structOpen) structOpen.add(id);
  renderStructure();
};
if ($("fStructRole")) $("fStructRole").onchange = () => renderStructure();
if ($("fStructEmp")) $("fStructEmp").onchange = () => renderStructure();
if ($("fStructSearch")) $("fStructSearch").oninput = () => renderStructure();
if ($("fStructArchive")) {
  $("fStructArchive").onchange = () => {
    loadStaff().then(renderStructure).catch(e => alert(e.message || "Ошибка"));
  };
}
if ($("orgStructure")) {
  $("orgStructure").addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      if (structSort.key === key) structSort.dir = -structSort.dir;
      else { structSort.key = key; structSort.dir = 1; }
      renderStructure();
      return;
    }
    const tg = e.target.closest("[data-toggle-acc]");
    if (tg) {
      const id = tg.getAttribute("data-toggle-acc");
      const acc = tg.closest(".org-acc");
      if (!acc) return;
      acc.classList.toggle("collapsed");
      const open = !acc.classList.contains("collapsed");
      tg.setAttribute("aria-expanded", open ? "true" : "false");
      if (!structOpen) structOpen = new Set();
      if (open) structOpen.add(id); else structOpen.delete(id);
    }
  });
}
if ($("filterEmpDist")) {
  $("filterEmpDist").onchange = () => {
    applyEmpFilters().catch(e => alert(e.message || "Ошибка"));
  };
}
if ($("filterEmpDate")) {
  $("filterEmpDate").onchange = () => {
    applyEmpFilters().catch(e => alert(e.message || "Ошибка"));
  };
}
ensureEmpDateDefault();
if ($("btnArchiveStaff")) $("btnArchiveStaff").onclick = () => archiveEditStaff().catch(err => alert(err.message));
if ($("btnRestoreStaff")) $("btnRestoreStaff").onclick = () => restoreEditStaff().catch(err => alert(err.message));
if ($("filterAccArchive")) $("filterAccArchive").onchange = () => renderAccounts();
if ($("filterAccDep")) $("filterAccDep").onchange = () => renderAccounts();
if ($("filterAccRole")) $("filterAccRole").onchange = () => renderAccounts();
if ($("filterAccFio")) $("filterAccFio").oninput = () => renderAccounts();
if ($("btnCloseEditDep")) $("btnCloseEditDep").onclick = closeEditDep;
if ($("editDepModal")) $("editDepModal").addEventListener("click", e => {
  if (e.target === $("editDepModal")) closeEditDep();
});
if ($("btnSaveEditDep")) $("btnSaveEditDep").onclick = () => saveEditDep().catch(err => alert(err.message));
if ($("editDepName")) $("editDepName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); saveEditDep().catch(err => alert(err.message)); }
});
if ($("btnCloseEditStaff")) $("btnCloseEditStaff").onclick = closeEditStaff;
if ($("btnCloseEditStaff2")) $("btnCloseEditStaff2").onclick = closeEditStaff;
if ($("editStaffModal")) $("editStaffModal").addEventListener("click", e => {
  if (e.target === $("editStaffModal")) closeEditStaff();
});
if ($("btnSaveEditStaff")) $("btnSaveEditStaff").onclick = () => saveEditStaff().catch(err => alert(err.message));
if ($("btnCreateStaffAcc")) {
  $("btnCreateStaffAcc").onclick = () => {
    if (!editStaffId || $("btnCreateStaffAcc").disabled) return;
    openCreateStaffAccModal(editStaffId);
  };
}
if ($("btnCloseCreateStaffAcc")) $("btnCloseCreateStaffAcc").onclick = closeCreateStaffAccModal;
if ($("btnCloseCreateStaffAcc2")) $("btnCloseCreateStaffAcc2").onclick = closeCreateStaffAccModal;
if ($("createStaffAccModal")) $("createStaffAccModal").addEventListener("click", e => {
  if (e.target === $("createStaffAccModal")) closeCreateStaffAccModal();
});
if ($("btnConfirmCreateStaffAcc")) {
  $("btnConfirmCreateStaffAcc").onclick = () => confirmCreateStaffAcc().catch(err => alert(err.message));
}
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
  const titleCode = opt.dataset.role || "instructor";
  const role = loginRoleForTitle(titleCode);
  const fio = opt.dataset.fio || "";
  $("accRole").value = role;
  $("accDep").value = opt.dataset.dep || "";
  $("accName").value = fio;
  const creds = credentialsFromStaffFio(fio, titleCode);
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
if ($("btnStaffTemplate")) $("btnStaffTemplate").onclick = () => downloadStaffTemplate().catch(e => alert(e.message));
// «Загрузить из файла»: кнопка → выбор файла → автозагрузка (без отдельной кнопки «Загрузить»)
if ($("btnImportStaff")) $("btnImportStaff").onclick = () => { if ($("staffExcel")) $("staffExcel").click(); };
if ($("staffExcel")) $("staffExcel").onchange = () => {
  if ($("staffExcel").files && $("staffExcel").files[0]) importStaffExcel().catch(e => alert(e.message));
};
if ($("btnCloseStaffDup")) $("btnCloseStaffDup").onclick = closeStaffDupModal;
if ($("staffDupModal")) $("staffDupModal").addEventListener("click", e => {
  if (e.target === $("staffDupModal")) closeStaffDupModal();
});

