/* Распределения: документ → потоки (шапка) → сворачиваемые группы */

let distributionsCache = [];
let selectedDistId = "";
let selectedDist = null;
/** Редактирование карточки распределения в «Списке распределений» */
let editingDistId = "";
/** Полный документ при правке в списке (потоки для формы) */
let editingDist = null;
/** id строк распределения, уже добавленных в «Мои группы» */
let distClaimedIds = {};
/** streamId -> collapsed groups map groupId -> bool; stream collapsed separately */
let distUiState = { streams: {}, groups: {} };
/** Куда монтировать форму группы: edit | add | "" */
let distGroupFormCtx = { mode: "", groupId: "", streamId: "", streamNum: "" };
let pendingDistGroupCadetImport = "";

function currentStaffId() {
  return (typeof currentUser !== "undefined" && currentUser && currentUser.staff_id) || "";
}

function isInstructorOrAssistant() {
  const role = (typeof currentUser !== "undefined" && currentUser && currentUser.role) || "";
  return role === "instructor" || role === "assistant";
}

function isAssignedToGroup(g) {
  const sid = currentStaffId();
  if (!sid) return false;
  const people = [].concat(g.instructors || []).concat(g.assistants || []);
  return people.some(p => p && p.id === sid);
}

const distPickers = {
  seniors: []
};

/** Разбор состава группы: [{query, slot, slot_label, staff, candidates, ok}] */
let groupStaffResolved = [];
let groupStaffResolveSeq = 0;
let groupStaffResolveTimer = null;

function peopleNamesBrief(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function formatRuDate(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const months = [
    "", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  const d = parseInt(m[3], 10);
  const mo = parseInt(m[2], 10);
  return d + " " + (months[mo] || m[2]) + " " + m[1];
}

function periodBrief(s) {
  const a = formatRuDate(s.period_from);
  const b = formatRuDate(s.period_to);
  if (a && b) return "с " + a + " по " + b;
  if (a) return "с " + a;
  if (b) return "по " + b;
  return "сроки не заданы";
}

function periodBriefFromTo(from, to) {
  const a = formatRuDate(from);
  const b = formatRuDate(to);
  if (a && b) return "с " + a + " по " + b;
  if (a) return "с " + a;
  if (b) return "по " + b;
  return "";
}

/** Число календарных дней включительно; null если даты неполные/неверные. */
function trainingPeriodDays(from, to) {
  const a = String(from || "").trim().slice(0, 10);
  const b = String(to || "").trim().slice(0, 10);
  if (!a || !b) return null;
  const m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!m0 || !m1) return null;
  const d0 = new Date(Number(m0[1]), Number(m0[2]) - 1, Number(m0[3]));
  const d1 = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  if (isNaN(d0.getTime()) || isNaN(d1.getTime())) return null;
  return Math.round((d1 - d0) / 86400000) + 1;
}

/**
 * Проверка периода обучения.
 * @returns {{ok:true}|{ok:false,error:string}|{ok:true,warn:string}}
 */
function checkTrainingPeriod(from, to) {
  const a = String(from || "").trim();
  const b = String(to || "").trim();
  if (!a && !b) return { ok: true };
  if (a && !b) return { ok: false, error: "Укажите дату окончания периода обучения" };
  if (b && !a) return { ok: false, error: "Укажите дату начала периода обучения" };
  const days = trainingPeriodDays(a, b);
  if (days == null) return { ok: false, error: "Некорректный формат дат периода обучения" };
  if (days < 1) {
    return {
      ok: false,
      error: "Дата начала обучения не может быть позже даты окончания обучения"
    };
  }
  if (days < 21) {
    return {
      ok: true,
      warn:
        "Период обучения меньше 21 дня (" + days +
        " дн.: " + periodBriefFromTo(a, b) +
        "). Подтвердить эти данные или отменить и исправить?"
    };
  }
  return { ok: true };
}

function setDistMsg(text, bad) {
  const el = $("distDetailMsg");
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function renderPickerChips(key) {
  const root = document.querySelector('.staff-picker[data-picker="' + key + '"]');
  if (!root) return;
  const box = root.querySelector(".staff-chips");
  if (!box) return;
  const list = distPickers[key] || [];
  box.innerHTML = list.map(p =>
    `<span class="staff-chip" data-rm="${esc(p.id)}">${esc(p.fio || p.callsign || p.id)}` +
    `<button type="button" class="staff-chip-x" data-rm="${esc(p.id)}" aria-label="Убрать">×</button></span>`
  ).join("");
}

function setPickerPeople(key, people) {
  distPickers[key] = (people || []).map(p => ({
    id: p.id,
    fio: p.fio || "",
    callsign: p.callsign || "",
    role_label: p.role_label || ""
  }));
  renderPickerChips(key);
}

function addPickerPerson(key, person, multi) {
  if (!person || !person.id) return;
  const cur = distPickers[key] || [];
  if (!multi) {
    setPickerPeople(key, [person]);
    return;
  }
  if (cur.some(p => p.id === person.id)) return;
  setPickerPeople(key, cur.concat([person]));
}

function removePickerPerson(key, id) {
  setPickerPeople(key, (distPickers[key] || []).filter(p => p.id !== id));
}

function setStreamFormOpen(open) {
  const form = $("distStreamForm");
  if (!form) return;
  form.classList.toggle("hidden", !open);
  if ($("btnToggleStreamForm")) {
    $("btnToggleStreamForm").textContent = open ? "Свернуть форму потока" : "Добавить поток";
  }
}

function resetStreamFormFields() {
  if ($("editDistStreamId")) $("editDistStreamId").value = "";
  ["dsNum", "dsFrom", "dsTo", "dsPolygon", "dsNote"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  setPickerPeople("seniors", []);
  if ($("btnSaveDistStream")) $("btnSaveDistStream").textContent = "Добавить поток";
  if ($("btnCancelDistStream")) $("btnCancelDistStream").classList.add("hidden");
  if ($("distStreamFormTitle")) $("distStreamFormTitle").textContent = "Добавить поток";
  const root = document.querySelector('.staff-picker[data-picker="seniors"]');
  if (root) {
    const q = root.querySelector(".staff-q");
    const sug = root.querySelector(".staff-suggest");
    if (q) q.value = "";
    if (sug) { sug.classList.add("hidden"); sug.innerHTML = ""; }
  }
}

function clearStreamForm() {
  resetStreamFormFields();
  setStreamFormOpen(false);
}

function toggleStreamForm() {
  const form = $("distStreamForm");
  if (!form) return;
  if (form.classList.contains("hidden")) {
    resetStreamFormFields();
    setStreamFormOpen(true);
    if ($("btnCancelDistStream")) $("btnCancelDistStream").classList.remove("hidden");
    if ($("dsNum")) $("dsNum").focus();
  } else {
    clearStreamForm();
  }
}

function workingDistId() {
  return editingDistId || selectedDistId || "";
}

function findGroupInDists(groupId) {
  for (const dist of [editingDist, selectedDist]) {
    if (!dist) continue;
    for (const s of dist.streams || []) {
      const g = (s.groups || []).find(x => x.id === groupId);
      if (g) return { dist, stream: s, group: g };
    }
  }
  return null;
}

function findStreamInDists(streamId, streamNum) {
  for (const dist of [editingDist, selectedDist]) {
    if (!dist) continue;
    const s = (dist.streams || []).find(x =>
      (streamId && x.id === streamId) ||
      (streamNum && String(x.stream_num) === String(streamNum))
    );
    if (s) return { dist, stream: s };
  }
  return null;
}

function parkDistGroupForm() {
  const form = $("distGroupForm");
  const park = $("distGroupFormPark");
  if (form && park && form.parentElement !== park) park.appendChild(form);
}

function pickFormSlot(selector) {
  const nodes = Array.from(document.querySelectorAll(selector));
  if (!nodes.length) return null;
  if (editingDistId) {
    const inEdit = nodes.find(n => $("editDistStreamsBox") && $("editDistStreamsBox").contains(n));
    if (inEdit) return inEdit;
  }
  return nodes[0];
}

function placeDistGroupForm() {
  const form = $("distGroupForm");
  if (!form) return;
  parkDistGroupForm();
  const ctx = distGroupFormCtx || {};
  if (ctx.mode === "edit" && ctx.groupId) {
    const slot = pickFormSlot('[data-group-form-slot="' + ctx.groupId + '"]');
    if (slot) {
      slot.appendChild(form);
      form.classList.remove("hidden");
      return;
    }
  }
  if (ctx.mode === "add" && ctx.streamId) {
    const slot = pickFormSlot('[data-stream-add-slot="' + ctx.streamId + '"]');
    if (slot) {
      slot.appendChild(form);
      form.classList.remove("hidden");
      return;
    }
  }
  if (ctx.mode) form.classList.remove("hidden");
  else form.classList.add("hidden");
}

function clearGroupForm() {
  distGroupFormCtx = { mode: "", groupId: "", streamId: "", streamNum: "" };
  if ($("editDistGroupId")) $("editDistGroupId").value = "";
  if ($("dgStreamId")) $("dgStreamId").value = "";
  if ($("dgStreamHint")) $("dgStreamHint").textContent = "";
  ["dgGroup", "dgFrom", "dgTo", "dgPlan", "dgClassroom", "dgTent", "dgNote", "dgStaffText"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  groupStaffResolved = [];
  renderGroupStaffResolved();
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Сохранить группу";
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Добавить группу";
  parkDistGroupForm();
  if ($("distGroupForm")) $("distGroupForm").classList.add("hidden");
}

function renderGroupStaffResolved() {
  const box = $("dgStaffResolved");
  if (!box) return;
  const list = groupStaffResolved || [];
  if (!list.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = '<ol class="dist-staff-list">' + list.map((row, idx) => {
    const inGroup = esc(row.slot_label || (idx === 0 ? "Инструктор группы" : "Ассистент группы"));
    if (row.staff && row.staff.id) {
      const role = row.staff.role_label || row.staff.role || "—";
      return `<li class="dist-staff-item ok" data-idx="${idx}">
        <span class="dist-staff-slot">${inGroup}</span>
        <strong>${esc(row.staff.fio || "")}</strong>
        <span class="dist-staff-role">${esc(role)}</span>
        ${row.staff.department_name ? ('<span class="hint"> · ' + esc(row.staff.department_name) + "</span>") : ""}
      </li>`;
    }
    const cands = row.candidates || [];
    if (cands.length) {
      return `<li class="dist-staff-item warn" data-idx="${idx}">
        <span class="dist-staff-slot">${inGroup}</span>
        <span class="bad">Несколько совпадений для «${esc(row.query || "")}» — выберите:</span>
        <div class="dist-staff-cands">${cands.map(c =>
          `<button type="button" class="btn" data-pick-staff="${esc(c.id)}" data-idx="${idx}">` +
          `<strong>${esc(c.fio || "")}</strong>` +
          ` <span class="dist-staff-role">${esc(c.role_label || c.role || "—")}</span></button>`
        ).join("")}</div>
      </li>`;
    }
    return `<li class="dist-staff-item bad" data-idx="${idx}">
      <span class="dist-staff-slot">${inGroup}</span>
      <span class="bad">Не найден в штатке: «${esc(row.query || "")}»</span>
    </li>`;
  }).join("") + "</ol>";
}

async function resolveGroupStaffText(force) {
  const text = (($("dgStaffText") && $("dgStaffText").value) || "").trim();
  if (!text) {
    groupStaffResolved = [];
    renderGroupStaffResolved();
    return;
  }
  const my = ++groupStaffResolveSeq;
  try {
    const data = await api("/api/admin/staff/resolve-people", {
      method: "POST",
      json: { text }
    });
    if (my !== groupStaffResolveSeq && !force) return;
    groupStaffResolved = data.people || [];
    renderGroupStaffResolved();
  } catch (e) {
    if (my !== groupStaffResolveSeq && !force) return;
    groupStaffResolved = [];
    const box = $("dgStaffResolved");
    if (box) box.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка поиска") + "</span>";
  }
}

function scheduleResolveGroupStaff() {
  clearTimeout(groupStaffResolveTimer);
  groupStaffResolveTimer = setTimeout(() => {
    resolveGroupStaffText(false).catch(() => {});
  }, 350);
}

function setGroupStaffFromPeople(instructors, assistants) {
  const people = []
    .concat(instructors || [])
    .concat(assistants || [])
    .filter(p => p && p.id);
  groupStaffResolved = people.map((p, i) => ({
    query: p.fio || "",
    slot: i === 0 ? "instructor" : "assistant",
    slot_label: i === 0 ? "Инструктор" : "Ассистент",
    staff: {
      id: p.id,
      fio: p.fio || "",
      role: p.role || "",
      role_label: p.role_label || "",
      callsign: p.callsign || "",
      department_name: p.department_name || ""
    },
    candidates: [],
    ok: true
  }));
  if ($("dgStaffText")) {
    $("dgStaffText").value = people.map(p => p.fio || "").filter(Boolean).join(", ");
  }
  renderGroupStaffResolved();
}

function groupStaffIdsFromResolved() {
  const instructor_ids = [];
  const assistant_ids = [];
  (groupStaffResolved || []).forEach((row, i) => {
    const id = row.staff && row.staff.id;
    if (!id) return;
    if (i === 0 || row.slot === "instructor") instructor_ids.push(id);
    else assistant_ids.push(id);
  });
  return {
    instructor_ids: instructor_ids.slice(0, 1),
    assistant_ids
  };
}

function renderDistributionsList() {
  const body = $("distributionsBody");
  if (!body) return;
  const list = distributionsCache || [];
  if ($("distListMeta")) {
    $("distListMeta").textContent = list.length ? (" · " + list.length) : "";
  }
  body.innerHTML = list.map(d => {
    const active = d.id === editingDistId ? " is-active" : "";
    return `<tr class="row-click${active}" data-edit-dist="${esc(d.id)}" title="Изменить параметры распределения">
      <td><strong>${esc(d.title || "—")}</strong></td>
      <td class="center">${esc(d.dist_date || "—")}</td>
      <td class="center">${esc(d.streams_count || 0)}</td>
      <td class="center">${esc(d.groups_count || 0)}</td>
      <td class="center">${esc(d.planned_total || 0)}</td>
      <td>${esc(d.note || "—")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="hint">Распределений пока нет</td></tr>`;
  renderDistSelect();
}

function setDistListEditMsg(text, bad) {
  const el = $("distListEditMsg");
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function clearEditDistForm() {
  editingDistId = "";
  editingDist = null;
  if ($("editDistId")) $("editDistId").value = "";
  ["editDistTitle", "editDistDate", "editDistNote"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  clearStreamForm();
  if ($("editDistStreamsBox")) $("editDistStreamsBox").innerHTML = "";
  if ($("editDistForm")) $("editDistForm").classList.add("hidden");
  setDistListEditMsg("");
  renderDistributionsList();
}

function fillEditDistForm(d) {
  if (!d) return;
  editingDistId = d.id;
  editingDist = d;
  setDistListOpen(true);
  if ($("editDistForm")) $("editDistForm").classList.remove("hidden");
  if ($("editDistId")) $("editDistId").value = d.id;
  if ($("editDistTitle")) $("editDistTitle").value = d.title || "";
  if ($("editDistDate")) $("editDistDate").value = d.dist_date || "";
  if ($("editDistNote")) $("editDistNote").value = d.note || "";
  if ($("editDistFormTitle")) {
    $("editDistFormTitle").textContent = "Изменить: " + (d.title || "распределение");
  }
  refreshAllDistStreams();
  renderDistributionsList();
}

async function startEditDistribution(id) {
  clearStreamForm();
  const brief = (distributionsCache || []).find(x => x.id === id);
  if (brief) fillEditDistForm(brief);
  else {
    editingDistId = id;
    setDistListOpen(true);
    if ($("editDistForm")) $("editDistForm").classList.remove("hidden");
  }
  setDistListEditMsg("");
  try {
    const data = await api("/api/admin/distributions/" + encodeURIComponent(id));
    if (data.distribution) fillEditDistForm(data.distribution);
  } catch (e) {
    setDistListEditMsg(e.message || "Не удалось загрузить потоки", true);
  }
  if ($("editDistForm")) {
    $("editDistForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  if ($("editDistTitle")) $("editDistTitle").focus();
}

function renderDistSelect() {
  const sel = $("distSelect");
  if (!sel) return;
  const list = distributionsCache || [];
  const cur = selectedDistId || sel.value || "";
  const opts = ['<option value="">— выберите распределение —</option>'].concat(
    list.map(d => {
      const label = (d.title || "Без названия") +
        (d.dist_date ? (" · " + d.dist_date) : "");
      return `<option value="${esc(d.id)}">${esc(label)}</option>`;
    })
  );
  sel.innerHTML = opts.join("");
  if (cur && list.some(d => d.id === cur)) sel.value = cur;
  else sel.value = "";
  syncDistBrowseMeta();
}

function syncDistBrowseMeta() {
  const meta = $("distBrowseMeta");
  if (!meta) return;
  if (selectedDist && selectedDist.title) {
    meta.textContent = " · " + selectedDist.title;
  } else {
    meta.textContent = "";
  }
}

function setDistListOpen(open) {
  const block = $("distListBlock");
  const btn = $("btnToggleDistList");
  if (!block) return;
  block.classList.toggle("collapsed", !open);
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleDistList() {
  const block = $("distListBlock");
  if (!block) return;
  setDistListOpen(block.classList.contains("collapsed"));
}

function setDistBrowseOpen(open) {
  const block = $("distBrowseBlock");
  const btn = $("btnToggleDistBrowse");
  if (!block) return;
  block.classList.toggle("collapsed", !open);
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleDistBrowse() {
  const block = $("distBrowseBlock");
  if (!block) return;
  setDistBrowseOpen(block.classList.contains("collapsed"));
}

function clearDistDetail() {
  selectedDistId = "";
  selectedDist = null;
  if ($("distDetailPanel")) $("distDetailPanel").classList.add("hidden");
  if ($("distBrowseEmpty")) $("distBrowseEmpty").classList.remove("hidden");
  if ($("distSelect")) $("distSelect").value = "";
  syncDistBrowseMeta();
  renderDistributionsList();
  setDistMsg("");
}

function isStreamCollapsed(streamId) {
  return !!distUiState.streams[streamId];
}

function isGroupCollapsed(groupId) {
  // по умолчанию группы свёрнуты
  if (!Object.prototype.hasOwnProperty.call(distUiState.groups, groupId)) return true;
  return !!distUiState.groups[groupId];
}

function toggleStreamCollapse(streamId) {
  distUiState.streams[streamId] = !isStreamCollapsed(streamId);
  refreshAllDistStreams();
}

function toggleGroupCollapse(groupId) {
  distUiState.groups[groupId] = !isGroupCollapsed(groupId);
  refreshAllDistStreams();
}

function distCadetDash(v) {
  const s = String(v == null ? "" : v).trim();
  return s || "—";
}

function distMetaParts(parts) {
  return (parts || []).filter(Boolean).join('<span class="dist-sep">·</span>');
}

function distStreamTitleHtml(s) {
  const seniors = peopleNamesBrief(s.seniors) || "не указаны";
  const period = periodBrief(s);
  const line1 =
    '<span class="dist-stream-key">Поток № ' + esc(s.stream_num || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-stream-lbl">старшие:</span> ' +
    '<span class="dist-stream-people">' + esc(seniors) + "</span>";
  const meta = distMetaParts([
    period ? ('<span class="dist-meta">' + esc(period) + "</span>") : "",
    '<span class="dist-meta">план ' + esc(s.planned_total || 0) + "</span>",
    '<span class="dist-meta">групп ' + esc(s.groups_count || 0) + "</span>",
    s.polygon_name
      ? ('<span class="dist-meta">полигон ' + esc(s.polygon_name) + "</span>")
      : ""
  ]);
  return '<span class="dist-title-stack">' +
    '<span class="dist-title-line1">' + line1 + "</span>" +
    (meta ? ('<span class="dist-title-line2">' + meta + "</span>") : "") +
    "</span>";
}

function distGroupTitleHtml(g) {
  const filledN = Number(g.cadets_filled) || 0;
  const cadetsPhrase = typeof cadetsCountPhrase === "function"
    ? cadetsCountPhrase(filledN)
    : (filledN + " курсантов");
  const line1 =
    '<span class="dist-group-key">Группа ' + esc(g.group_num || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-group-lbl">инструктор:</span> ' +
    '<span class="dist-group-people">' + esc(peopleNamesBrief(g.instructors) || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-group-lbl">ассистенты:</span> ' +
    '<span class="dist-group-people">' + esc(peopleNamesBrief(g.assistants) || "—") + "</span>";
  const periodTxt = periodBriefFromTo(g.period_from, g.period_to);
  const meta = distMetaParts([
    periodTxt
      ? ('<span class="dist-meta">Период ' + esc(periodTxt) + "</span>")
      : '<span class="dist-meta">Период не задан</span>',
    '<span class="dist-meta">' + esc(cadetsPhrase) + "</span>",
    g.classroom ? ('<span class="dist-meta">ауд. ' + esc(g.classroom) + "</span>") : "",
    g.tent_num ? ('<span class="dist-meta">палатка ' + esc(g.tent_num) + "</span>") : ""
  ]);
  return '<span class="dist-title-stack">' +
    '<span class="dist-title-line1">' + line1 + "</span>" +
    (meta ? ('<span class="dist-title-line2">' + meta + "</span>") : "") +
    "</span>";
}

function distGroupCadetsTableHtml(g, streamNum) {
  const planned = Math.min(Math.max(0, Number(g.planned_count) || 0), 120);
  const cadets = Array.isArray(g.cadets) ? g.cadets : [];
  const filled = Number(g.cadets_filled) || cadets.filter(c =>
    [c.num, c.callsign, c.note].some(x => String(x || "").trim())
  ).length;
  let rowsSrc = cadets;
  if (!rowsSrc.length && planned) {
    rowsSrc = Array.from({ length: planned }, (_, i) => ({ npp: i + 1 }));
  }
  if (!rowsSrc.length) {
    return '<p class="hint" style="margin:10px 0 0">Таблица курсантов появится, когда в плане группы будет число больше 0 или загрузите список из файла.</p>';
  }
  const body = rowsSrc.map((c, i) => {
    const empty = ![c.num, c.callsign, c.note].some(x => String(x || "").trim());
    return `<tr>
      <td class="npp center">${esc(c.npp || (i + 1))}</td>
      <td class="center">${esc(distCadetDash(c.num))}</td>
      <td class="center">${empty ? '<span class="hint">пусто</span>' : esc(distCadetDash(c.callsign))}</td>
      <td>${esc(distCadetDash(c.note))}</td>
    </tr>`;
  }).join("");
  const meta =
    (filled ? ("заполнено " + filled + " · ") : (cadets.length ? "" : "заготовка · ")) +
    rowsSrc.length + " стр. · поток " + (streamNum || "—") +
    " · группа " + (g.group_num || "—");
  return `<div class="dist-cadets-wrap" style="margin-top:12px">
    <div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:6px">
      <strong>Курсанты</strong>
      <span class="hint">${esc(meta)}</span>
    </div>
    <div class="scrollx"><table class="dist-cadets-table">
      <thead><tr>
        <th>№</th><th>Номер</th><th>Позывной</th><th>Примечание</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </div>`;
}

function renderDistStreamsInto(box, dist, opts) {
  opts = opts || {};
  if (!box) return;
  parkDistGroupForm();
  const streams = (dist && dist.streams) || [];
  if (!streams.length) {
    box.innerHTML = opts.emptyHint
      ? ('<p class="hint">' + opts.emptyHint + "</p>")
      : '<p class="hint">Потоков пока нет</p>';
    placeDistGroupForm();
    return;
  }
  const canEdit = typeof isAdmin === "function" && isAdmin();
  box.innerHTML = streams.map(s => {
    const sid = s.id || ("num:" + s.stream_num);
    const streamOpen = !isStreamCollapsed(sid);
    const groupsHtml = (s.groups || []).map(g => {
      const gid = g.id;
      const open = !isGroupCollapsed(gid);
      const mine = isAssignedToGroup(g);
      const claimed = !!distClaimedIds[gid];
      const actionBtns = [];
      if (canEdit) {
        actionBtns.push(
          `<button class="btn" type="button" data-import-dg-cadets="${esc(gid)}">Загрузить список группы</button>`,
          `<button class="btn" type="button" data-tpl-dg-cadets="${esc(gid)}">Скачать шаблон</button>`,
          `<button class="btn" type="button" data-edit-dg="${esc(gid)}" data-stream-id="${esc(s.id || "")}">Изменить</button>`,
          `<button class="btn danger" type="button" data-del-dg="${esc(gid)}">Удалить</button>`
        );
      }
      if (mine && !claimed) {
        actionBtns.push(
          `<button class="btn" type="button" data-claim-dg="${esc(gid)}">Добавить мою группу</button>`
        );
      } else if (mine && claimed) {
        actionBtns.push(`<span class="hint">Уже в «Мои группы»</span>`);
      }
      const groupActions = actionBtns.length
        ? (`<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">${actionBtns.join("")}</div>
            <p class="hint" data-dg-import-msg="${esc(gid)}" style="margin:6px 0 0"></p>`)
        : "";
      return `<div class="dist-group-card${open ? " open" : ""}" data-group-id="${esc(gid)}">
        <button type="button" class="dist-group-head" data-toggle-group="${esc(gid)}" aria-expanded="${open ? "true" : "false"}">
          <span class="dist-chevron">${open ? "▼" : "▶"}</span>
          <span class="dist-group-title">${distGroupTitleHtml(g)}</span>
        </button>
        <div class="dist-group-body"${open ? "" : " hidden"}>
          ${groupActions}
          <div data-group-form-slot="${esc(gid)}"></div>
          ${g.note ? ('<p class="hint" style="margin:8px 0 0">' + esc(g.note) + "</p>") : ""}
          ${distGroupCadetsTableHtml(g, s.stream_num)}
        </div>
      </div>`;
    }).join("") || '<p class="hint" style="margin:8px 0">Групп пока нет</p>';

    const streamActionBtns = [];
    if (canEdit) {
      streamActionBtns.push(
        `<button class="btn" type="button" data-edit-stream="${esc(s.id || "")}">Изменить шапку</button>`
      );
      if (s.id) {
        streamActionBtns.push(
          `<button class="btn danger" type="button" data-del-stream="${esc(s.id)}">Удалить поток</button>`
        );
      }
    }
    const streamActions = streamActionBtns.length
      ? (`<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">${streamActionBtns.join("")}</div>`)
      : "";
    const addGroupRow = canEdit
      ? (`<div class="dist-group-card dist-add-group-card">
          <button type="button" class="dist-group-head dist-add-group-row" data-add-group="${esc(s.id || "")}" data-stream-num="${esc(s.stream_num || "")}">
            <span class="dist-chevron dist-add-group-plus">+</span>
            <span class="dist-group-title"><span class="dist-group-key">Добавить группу</span></span>
          </button>
        </div>`)
      : "";
    return `<div class="dist-stream-card${streamOpen ? " open" : ""}" data-stream-id="${esc(sid)}">
      <button type="button" class="dist-stream-head" data-toggle-stream="${esc(sid)}" aria-expanded="${streamOpen ? "true" : "false"}">
        <span class="dist-chevron">${streamOpen ? "▼" : "▶"}</span>
        <span class="dist-stream-title">${distStreamTitleHtml(s)}</span>
      </button>
      <div class="dist-stream-body"${streamOpen ? "" : " hidden"}>
        ${streamActions}
        <div class="dist-groups-list">${groupsHtml}${addGroupRow}</div>
        <div data-stream-add-slot="${esc(s.id || "")}"></div>
      </div>
    </div>`;
  }).join("");

  if (opts.showClaimBar !== false) {
    const mineCount = streams.reduce((acc, s) =>
      acc + (s.groups || []).filter(g => isAssignedToGroup(g) && !distClaimedIds[g.id]).length, 0);
    if (mineCount > 0) {
      const bar = document.createElement("div");
      bar.className = "row";
      bar.style.cssText = "gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center";
      bar.innerHTML =
        `<button class="btn" type="button" data-claim-all-my="1">Добавить все мои группы (${mineCount})</button>` +
        `<span class="hint">Группы, где вы указаны инструктором или ассистентом</span>`;
      box.insertBefore(bar, box.firstChild);
    }
  }
  placeDistGroupForm();
}

function renderDistStreams() {
  refreshAllDistStreams();
}

function refreshAllDistStreams() {
  if ($("distStreamsBox")) {
    renderDistStreamsInto($("distStreamsBox"), selectedDist, {
      emptyHint: "Потоков пока нет — добавьте поток в «Списке распределений»",
      showClaimBar: true
    });
  }
  if ($("editDistStreamsBox") && editingDistId) {
    renderDistStreamsInto($("editDistStreamsBox"), editingDist, {
      emptyHint: "Потоков пока нет — нажмите «Добавить поток» или загрузите из файла",
      showClaimBar: true
    });
  }
}

function updateBrowseDistHeader(dist) {
  if (!dist) return;
  if ($("distDetailTitle")) $("distDetailTitle").textContent = dist.title || "Распределение";
  if ($("distDetailMeta")) {
    $("distDetailMeta").textContent =
      "потоков: " + (dist.streams_count || 0) +
      " · групп: " + (dist.groups_count || 0) +
      " · план: " + (dist.planned_total || 0) +
      (dist.dist_date ? (" · " + dist.dist_date) : "") +
      (dist.note ? (" · " + dist.note) : "");
  }
  if ($("distSelect")) $("distSelect").value = dist.id;
  syncDistBrowseMeta();
}

/** Обновить оба открытых представления одного распределения без сброса форм. */
function syncDistDocuments(dist) {
  if (!dist) return;
  if (editingDistId === dist.id) {
    editingDist = dist;
    if ($("editDistFormTitle")) {
      $("editDistFormTitle").textContent = "Изменить: " + (dist.title || "распределение");
    }
  }
  if (selectedDistId === dist.id) {
    selectedDist = dist;
    updateBrowseDistHeader(dist);
  }
  refreshAllDistStreams();
  renderDistributionsList();
}

function showDistDetail(dist) {
  const panel = $("distDetailPanel");
  if (!panel || !dist) return;
  selectedDistId = dist.id;
  selectedDist = dist;
  panel.classList.remove("hidden");
  if ($("distBrowseEmpty")) $("distBrowseEmpty").classList.add("hidden");
  setDistBrowseOpen(true);
  updateBrowseDistHeader(dist);
  clearStreamForm();
  clearGroupForm();
  refreshAllDistStreams();
  renderDistributionsList();
  setDistMsg("");
  refreshDistClaimedIds().then(() => refreshAllDistStreams()).catch(() => {});
}

async function refreshDistributions(keepSelected) {
  const data = await api("/api/admin/distributions");
  distributionsCache = data.distributions || [];
  renderDistributionsList();
  if (keepSelected && selectedDistId) {
    const data2 = await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId));
    if (data2.distribution) {
      selectedDist = data2.distribution;
      updateBrowseDistHeader(data2.distribution);
    } else clearDistDetail();
  }
  if (editingDistId) {
    try {
      const data3 = await api("/api/admin/distributions/" + encodeURIComponent(editingDistId));
      if (data3.distribution) {
        editingDist = data3.distribution;
        if ($("editDistFormTitle")) {
          $("editDistFormTitle").textContent =
            "Изменить: " + (data3.distribution.title || "распределение");
        }
      }
    } catch (e) { /* ignore */ }
  }
  refreshAllDistStreams();
}

async function refreshDistClaimedIds() {
  distClaimedIds = {};
  const id = workingDistId();
  if (!id || !currentStaffId()) return;
  try {
    const data = await api(
      "/api/admin/distributions/" + encodeURIComponent(id) + "/my-groups"
    );
    (data.claimed_ids || []).forEach(cid => { distClaimedIds[cid] = true; });
  } catch (e) { /* ignore */ }
}

async function autoLoadMyGroupsFromDist(distId) {
  if (!isInstructorOrAssistant() || !currentStaffId() || !distId) return;
  try {
    const res = await api(
      "/api/admin/distributions/" + encodeURIComponent(distId) + "/claim-my-groups",
      { method: "POST", json: {} }
    );
    distClaimedIds = {};
    (res.claimed_ids || []).forEach(cid => { distClaimedIds[cid] = true; });
    refreshAllDistStreams();
    if (typeof refreshMyGroups === "function") await refreshMyGroups();
    const n = res.added_count || 0;
    if (n) {
      const text = "В «Мои группы» добавлено: " + n;
      setDistMsg(text);
      if (typeof setMyGroupsMsg === "function") setMyGroupsMsg(text);
    }
  } catch (e) {
    /* не блокируем открытие распределения */
  }
}

async function openDistribution(id) {
  const data = await api("/api/admin/distributions/" + encodeURIComponent(id));
  if (data.distribution) {
    selectedDistId = data.distribution.id;
    await refreshDistClaimedIds();
    showDistDetail(data.distribution);
    await autoLoadMyGroupsFromDist(selectedDistId);
  }
}

async function claimDistGroup(groupRowId) {
  const id = workingDistId();
  if (!id) return;
  try {
    const res = await api(
      "/api/admin/distributions/" + encodeURIComponent(id) + "/claim-group",
      { method: "POST", json: { group_row_id: groupRowId } }
    );
    (res.claimed_ids || []).forEach(cid => { distClaimedIds[cid] = true; });
    refreshAllDistStreams();
    if (typeof refreshMyGroups === "function") await refreshMyGroups();
    setDistMsg("Группа добавлена в «Мои группы»");
    setDistListEditMsg("Группа добавлена в «Мои группы»");
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
    setDistListEditMsg(e.message || "Ошибка", true);
  }
}

async function claimAllMyDistGroups() {
  const id = workingDistId();
  if (!id) return;
  try {
    const res = await api(
      "/api/admin/distributions/" + encodeURIComponent(id) + "/claim-my-groups",
      { method: "POST", json: {} }
    );
    (res.claimed_ids || []).forEach(cid => { distClaimedIds[cid] = true; });
    refreshAllDistStreams();
    if (typeof refreshMyGroups === "function") await refreshMyGroups();
    const n = res.added_count || 0;
    const text = n
      ? ("Добавлено групп: " + n)
      : "Новых групп нет — уже добавлены или не закреплены";
    setDistMsg(text);
    setDistListEditMsg(text);
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
    setDistListEditMsg(e.message || "Ошибка", true);
  }
}

function setNewDistFormOpen(open) {
  const form = $("newDistForm");
  const btn = $("btnToggleNewDist");
  if (form) form.classList.toggle("hidden", !open);
  if (btn) btn.textContent = open ? "Свернуть" : "Добавить новое распределение";
}

function toggleNewDistForm() {
  const form = $("newDistForm");
  const open = !(form && !form.classList.contains("hidden"));
  setNewDistFormOpen(open);
  if (open && $("newDistTitle")) $("newDistTitle").focus();
}

async function createDistribution() {
  const title = ($("newDistTitle") && $("newDistTitle").value) || "";
  const dist_date = ($("newDistDate") && $("newDistDate").value) || "";
  const note = ($("newDistNote") && $("newDistNote").value) || "";
  const res = await api("/api/admin/distributions", {
    method: "POST",
    json: { title, dist_date, note }
  });
  if ($("newDistTitle")) $("newDistTitle").value = "";
  if ($("newDistDate")) $("newDistDate").value = "";
  if ($("newDistNote")) $("newDistNote").value = "";
  setNewDistFormOpen(false);
  await refreshDistributions(false);
  if (res.distribution) startEditDistribution(res.distribution.id);
}

async function saveDistributionMeta() {
  const id = editingDistId || (($("editDistId") && $("editDistId").value) || "");
  if (!id) return;
  const res = await api("/api/admin/distributions/" + encodeURIComponent(id), {
    method: "PUT",
    json: {
      title: ($("editDistTitle") && $("editDistTitle").value) || "",
      dist_date: ($("editDistDate") && $("editDistDate").value) || "",
      note: ($("editDistNote") && $("editDistNote").value) || ""
    }
  });
  await refreshDistributions(true);
  if (res.distribution) {
    startEditDistribution(res.distribution.id);
    setDistListEditMsg("Сохранено");
  }
}

async function deleteDistribution() {
  const id = editingDistId || (($("editDistId") && $("editDistId").value) || "");
  if (!id) return;
  if (!confirm("Удалить распределение и все его потоки?")) return;
  await api("/api/admin/distributions/" + encodeURIComponent(id), { method: "DELETE" });
  if (selectedDistId === id) clearDistDetail();
  clearEditDistForm();
  await refreshDistributions(false);
}

function startEditStream(streamId) {
  const found = findStreamInDists(streamId);
  if (!found) return;
  if (editingDistId !== found.dist.id) fillEditDistForm(found.dist);
  const s = found.stream;
  setStreamFormOpen(true);
  if ($("editDistStreamId")) $("editDistStreamId").value = s.id;
  if ($("dsNum")) $("dsNum").value = s.stream_num || "";
  if ($("dsFrom")) $("dsFrom").value = s.period_from || "";
  if ($("dsTo")) $("dsTo").value = s.period_to || "";
  if ($("dsPolygon")) $("dsPolygon").value = s.polygon_name || "";
  if ($("dsNote")) $("dsNote").value = s.note || "";
  setPickerPeople("seniors", s.seniors || []);
  if ($("btnSaveDistStream")) $("btnSaveDistStream").textContent = "Сохранить поток";
  if ($("btnCancelDistStream")) $("btnCancelDistStream").classList.remove("hidden");
  if ($("distStreamFormTitle")) $("distStreamFormTitle").textContent = "Изменить поток № " + (s.stream_num || "");
  if ($("distStreamForm")) $("distStreamForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveDistStream() {
  const distId = editingDistId || selectedDistId;
  if (!distId) {
    setDistListEditMsg("Сначала откройте распределение для правки", true);
    return;
  }
  const sid = ($("editDistStreamId") && $("editDistStreamId").value) || "";
  const payload = {
    stream_num: ($("dsNum") && $("dsNum").value) || "",
    period_from: ($("dsFrom") && $("dsFrom").value) || "",
    period_to: ($("dsTo") && $("dsTo").value) || "",
    polygon_name: ($("dsPolygon") && $("dsPolygon").value) || "",
    note: ($("dsNote") && $("dsNote").value) || "",
    senior_ids: (distPickers.seniors || []).map(p => p.id)
  };
  try {
    const res = sid
      ? await api("/api/admin/distributions/streams/" + encodeURIComponent(sid), {
        method: "PUT",
        json: payload
      })
      : await api("/api/admin/distributions/" + encodeURIComponent(distId) + "/streams", {
        method: "POST",
        json: payload
      });
    clearStreamForm();
    if (res.distribution) syncDistDocuments(res.distribution);
    await refreshDistributions(false);
    setDistListEditMsg(sid ? "Поток сохранён" : "Поток добавлен");
  } catch (e) {
    setDistListEditMsg(e.message || "Ошибка", true);
  }
}

async function deleteDistStream(streamId) {
  if (!confirm("Удалить поток и все его группы?")) return;
  try {
    const res = await api(
      "/api/admin/distributions/streams/" + encodeURIComponent(streamId),
      { method: "DELETE" }
    );
    clearStreamForm();
    if (res.distribution) syncDistDocuments(res.distribution);
    await refreshDistributions(false);
    setDistListEditMsg("Поток удалён");
  } catch (e) {
    setDistListEditMsg(e.message || "Ошибка", true);
  }
}

function openAddGroupForm(streamId, streamNum) {
  clearGroupForm();
  distGroupFormCtx = {
    mode: "add",
    groupId: "",
    streamId: streamId || "",
    streamNum: streamNum || ""
  };
  if ($("dgStreamId")) $("dgStreamId").value = streamId || "";
  if ($("dgStreamHint")) {
    $("dgStreamHint").textContent = streamNum
      ? ("Поток № " + streamNum + " — заполните только данные группы")
      : "Выберите поток";
  }
  const found = findStreamInDists(streamId, streamNum);
  const stream = found && found.stream;
  if (stream) {
    if ($("dgFrom")) $("dgFrom").value = stream.period_from || "";
    if ($("dgTo")) $("dgTo").value = stream.period_to || "";
  }
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Добавить группу";
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Добавить группу";
  if (streamId) distUiState.streams[streamId] = false;
  refreshAllDistStreams();
  if ($("distGroupForm")) {
    $("distGroupForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function startEditDistGroup(groupId, streamId) {
  const found = findGroupInDists(groupId);
  if (!found) return;
  const g = found.group;
  const stream = found.stream;
  distGroupFormCtx = {
    mode: "edit",
    groupId: groupId,
    streamId: streamId || (stream && stream.id) || "",
    streamNum: (stream && stream.stream_num) || ""
  };
  distUiState.groups[groupId] = false;
  if (stream && stream.id) distUiState.streams[stream.id] = false;
  refreshAllDistStreams();
  if ($("editDistGroupId")) $("editDistGroupId").value = g.id;
  if ($("dgStreamId")) $("dgStreamId").value = streamId || (stream && stream.id) || "";
  if ($("dgStreamHint")) {
    $("dgStreamHint").textContent = stream
      ? ("Поток № " + (stream.stream_num || "—"))
      : "";
  }
  if ($("dgGroup")) $("dgGroup").value = g.group_num || "";
  if ($("dgFrom")) $("dgFrom").value = g.period_from || (stream && stream.period_from) || "";
  if ($("dgTo")) $("dgTo").value = g.period_to || (stream && stream.period_to) || "";
  if ($("dgPlan")) $("dgPlan").value = g.planned_count || 0;
  if ($("dgClassroom")) $("dgClassroom").value = g.classroom || "";
  if ($("dgTent")) $("dgTent").value = g.tent_num || "";
  if ($("dgNote")) $("dgNote").value = g.note || "";
  setGroupStaffFromPeople(g.instructors || [], g.assistants || []);
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Сохранить группу";
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Изменить группу " + (g.group_num || "");
  if ($("distGroupForm")) {
    $("distGroupForm").classList.remove("hidden");
    $("distGroupForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function setDistOpMsg(text, isErr) {
  setDistMsg(text, isErr);
  if (editingDistId) setDistListEditMsg(text, isErr);
}

async function saveDistGroup() {
  const distId = workingDistId();
  if (!distId) {
    setDistOpMsg("Сначала откройте распределение", true);
    return;
  }
  const gid = ($("editDistGroupId") && $("editDistGroupId").value) || "";
  const streamId = ($("dgStreamId") && $("dgStreamId").value) || "";
  if (!gid && !streamId) {
    setDistOpMsg("Сначала нажмите «Добавить группу» у нужного потока", true);
    return;
  }
  const text = (($("dgStaffText") && $("dgStaffText").value) || "").trim();
  if (text) {
    await resolveGroupStaffText(true);
    const unresolved = (groupStaffResolved || []).filter(r => !r.staff || !r.staff.id);
    if (unresolved.length) {
      setDistOpMsg(
        "Не все фамилии найдены в штатке — уточните совпадения в списке ниже",
        true
      );
      return;
    }
  } else {
    groupStaffResolved = [];
  }
  const staffIds = groupStaffIdsFromResolved();
  const periodFrom = ($("dgFrom") && $("dgFrom").value) || "";
  const periodTo = ($("dgTo") && $("dgTo").value) || "";
  const periodCheck = checkTrainingPeriod(periodFrom, periodTo);
  if (!periodCheck.ok) {
    setDistOpMsg(periodCheck.error || "Проверьте период обучения", true);
    return;
  }
  if (periodCheck.warn && !confirm(periodCheck.warn)) {
    setDistOpMsg("Исправьте период обучения и сохраните снова", true);
    return;
  }
  const payload = {
    stream_id: streamId,
    group_num: ($("dgGroup") && $("dgGroup").value) || "",
    period_from: periodFrom,
    period_to: periodTo,
    planned_count: Number(($("dgPlan") && $("dgPlan").value) || 0),
    classroom: ($("dgClassroom") && $("dgClassroom").value) || "",
    tent_num: ($("dgTent") && $("dgTent").value) || "",
    note: ($("dgNote") && $("dgNote").value) || "",
    instructor_ids: staffIds.instructor_ids,
    assistant_ids: staffIds.assistant_ids
  };
  try {
    const res = gid
      ? await api("/api/admin/distributions/groups/" + encodeURIComponent(gid), {
        method: "PUT",
        json: payload
      })
      : await api("/api/admin/distributions/" + encodeURIComponent(distId) + "/groups", {
        method: "POST",
        json: payload
      });
    clearGroupForm();
    if (res.distribution) syncDistDocuments(res.distribution);
    else if (distId) await openDistribution(distId);
    await refreshDistributions(false);
    setDistOpMsg(gid ? "Группа сохранена" : "Группа добавлена");
  } catch (e) {
    setDistOpMsg(e.message || "Ошибка", true);
  }
}

async function deleteDistGroup(groupId) {
  if (!confirm("Удалить группу из распределения?")) return;
  try {
    const res = await api(
      "/api/admin/distributions/groups/" + encodeURIComponent(groupId),
      { method: "DELETE" }
    );
    clearGroupForm();
    if (res.distribution) syncDistDocuments(res.distribution);
    else if (workingDistId()) await openDistribution(workingDistId());
    await refreshDistributions(false);
    setDistOpMsg("Группа удалена");
  } catch (e) {
    setDistOpMsg(e.message || "Ошибка", true);
  }
}

function bindStaffPickers() {
  document.querySelectorAll(".staff-picker").forEach(root => {
    if (root._lisBound) return;
    root._lisBound = true;
    const key = root.getAttribute("data-picker");
    const multi = root.getAttribute("data-multi") === "1";
    const input = root.querySelector(".staff-q");
    const suggest = root.querySelector(".staff-suggest");
    const chips = root.querySelector(".staff-chips");
    let timer = null;
    let seq = 0;

    if (chips) {
      chips.addEventListener("click", e => {
        const btn = e.target.closest("[data-rm]");
        if (!btn) return;
        removePickerPerson(key, btn.getAttribute("data-rm"));
      });
    }

    if (!input || !suggest) return;

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = (input.value || "").trim();
      if (q.length < 2) {
        suggest.classList.add("hidden");
        suggest.innerHTML = "";
        return;
      }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const rows = await api("/api/admin/staff?q=" + encodeURIComponent(q));
          if (my !== seq) return;
          const list = Array.isArray(rows) ? rows : (rows.staff || []);
          if (typeof lisDropdownBgFrom === "function") {
            suggest.style.backgroundColor = lisDropdownBgFrom(input);
          }
          if (!list.length) {
            suggest.innerHTML = '<div class="staff-suggest-empty">Никого не найдено</div>';
            suggest.classList.remove("hidden");
            return;
          }
          suggest.innerHTML = list.map(p =>
            `<button type="button" class="staff-suggest-item" data-id="${esc(p.id)}">` +
            `<strong>${esc(p.fio || "")}</strong>` +
            `<span class="hint">${esc(p.role_label || p.role || "")}` +
            (p.department_name ? (" · " + esc(p.department_name)) : "") +
            (p.callsign ? (" · " + esc(p.callsign)) : "") +
            `</span></button>`
          ).join("");
          suggest.classList.remove("hidden");
        } catch (e) {
          if (my !== seq) return;
          if (typeof lisDropdownBgFrom === "function") {
            suggest.style.backgroundColor = lisDropdownBgFrom(input);
          }
          suggest.innerHTML = '<div class="staff-suggest-empty">' + esc(e.message || "Ошибка") + "</div>";
          suggest.classList.remove("hidden");
        }
      }, 220);
    });

    suggest.addEventListener("click", e => {
      const btn = e.target.closest(".staff-suggest-item");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const fio = (btn.querySelector("strong") && btn.querySelector("strong").textContent) || "";
      addPickerPerson(key, { id, fio }, multi);
      input.value = "";
      suggest.classList.add("hidden");
      suggest.innerHTML = "";
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Escape") suggest.classList.add("hidden");
    });
  });
}

if ($("distributionsBody")) {
  $("distributionsBody").addEventListener("click", e => {
    const row = e.target.closest("[data-edit-dist]");
    if (!row) return;
    startEditDistribution(row.getAttribute("data-edit-dist"));
  });
}

function onDistStreamsClick(e) {
  const togS = e.target.closest("[data-toggle-stream]");
  if (togS) {
    toggleStreamCollapse(togS.getAttribute("data-toggle-stream"));
    return;
  }
  const togG = e.target.closest("[data-toggle-group]");
  if (togG) {
    toggleGroupCollapse(togG.getAttribute("data-toggle-group"));
    return;
  }
  const editS = e.target.closest("[data-edit-stream]");
  if (editS) {
    startEditStream(editS.getAttribute("data-edit-stream"));
    return;
  }
  const delS = e.target.closest("[data-del-stream]");
  if (delS) {
    deleteDistStream(delS.getAttribute("data-del-stream"))
      .catch(err => setDistListEditMsg(err.message || "Ошибка", true));
    return;
  }
  const addG = e.target.closest("[data-add-group]");
  if (addG) {
    openAddGroupForm(
      addG.getAttribute("data-add-group"),
      addG.getAttribute("data-stream-num")
    );
    return;
  }
  const editG = e.target.closest("[data-edit-dg]");
  if (editG) {
    startEditDistGroup(
      editG.getAttribute("data-edit-dg"),
      editG.getAttribute("data-stream-id")
    );
    return;
  }
  const delG = e.target.closest("[data-del-dg]");
  if (delG) {
    deleteDistGroup(delG.getAttribute("data-del-dg")).catch(err => alert(err.message));
    return;
  }
  const tplCadets = e.target.closest("[data-tpl-dg-cadets]");
  if (tplCadets) {
    downloadDistGroupCadetsTemplate(tplCadets.getAttribute("data-tpl-dg-cadets"))
      .catch(err => alert(err.message || "Ошибка"));
    return;
  }
  const impCadets = e.target.closest("[data-import-dg-cadets]");
  if (impCadets) {
    pickImportDistGroupCadets(impCadets.getAttribute("data-import-dg-cadets"));
    return;
  }
  const claim = e.target.closest("[data-claim-dg]");
  if (claim) {
    claimDistGroup(claim.getAttribute("data-claim-dg")).catch(err => alert(err.message));
    return;
  }
  if (e.target.closest("[data-claim-all-my]")) {
    claimAllMyDistGroups().catch(err => alert(err.message));
  }
}

if ($("distStreamsBox")) {
  $("distStreamsBox").addEventListener("click", onDistStreamsClick);
}

if ($("btnToggleDistList")) {
  $("btnToggleDistList").onclick = () => toggleDistList();
}
if ($("btnToggleDistBrowse")) {
  $("btnToggleDistBrowse").onclick = () => toggleDistBrowse();
}
if ($("distSelect")) {
  $("distSelect").onchange = () => {
    const id = ($("distSelect").value || "").trim();
    if (!id) {
      clearDistDetail();
      return;
    }
    openDistribution(id).catch(e => alert(e.message));
  };
}
if ($("btnToggleNewDist")) {
  $("btnToggleNewDist").onclick = () => toggleNewDistForm();
}
if ($("btnAddDistribution")) {
  $("btnAddDistribution").onclick = () => createDistribution().catch(e => alert(e.message));
}
setNewDistFormOpen(false);
setDistListOpen(false);
setDistBrowseOpen(false);
if ($("btnSaveDistribution")) {
  $("btnSaveDistribution").onclick = () =>
    saveDistributionMeta().catch(e => setDistListEditMsg(e.message || "Ошибка", true));
}
if ($("btnCancelEditDist")) {
  $("btnCancelEditDist").onclick = () => clearEditDistForm();
}
if ($("btnDeleteDistribution")) {
  $("btnDeleteDistribution").onclick = () =>
    deleteDistribution().catch(e => setDistListEditMsg(e.message || "Ошибка", true));
}
if ($("btnToggleStreamForm")) {
  $("btnToggleStreamForm").onclick = () => toggleStreamForm();
}
if ($("editDistStreamsBox")) {
  $("editDistStreamsBox").addEventListener("click", onDistStreamsClick);
}
if ($("btnSaveDistStream")) {
  $("btnSaveDistStream").onclick = () =>
    saveDistStream().catch(e => setDistListEditMsg(e.message || "Ошибка", true));
}
if ($("btnCancelDistStream")) {
  $("btnCancelDistStream").onclick = () => clearStreamForm();
}
if ($("btnSaveDistGroup")) {
  $("btnSaveDistGroup").onclick = () => saveDistGroup().catch(e => setDistMsg(e.message, true));
}
if ($("btnCancelDistGroup")) {
  $("btnCancelDistGroup").onclick = () => clearGroupForm();
}
if ($("dgStaffText")) {
  $("dgStaffText").addEventListener("input", () => scheduleResolveGroupStaff());
  $("dgStaffText").addEventListener("blur", () => {
    clearTimeout(groupStaffResolveTimer);
    resolveGroupStaffText(true).catch(() => {});
  });
}
if ($("dgStaffResolved")) {
  $("dgStaffResolved").addEventListener("click", e => {
    const btn = e.target.closest("[data-pick-staff]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-idx"));
    const id = btn.getAttribute("data-pick-staff");
    const row = groupStaffResolved[idx];
    if (!row) return;
    const cand = (row.candidates || []).find(c => c.id === id);
    if (!cand) return;
    row.staff = cand;
    row.ok = true;
    row.candidates = [];
    renderGroupStaffResolved();
  });
}

async function downloadDistGroupCadetsTemplate(groupId) {
  const found = findGroupInDists(groupId);
  const g = (found && found.group) || {};
  const stream = (found && found.stream) || {};
  if (typeof downloadCadetsTemplate === "function") {
    await downloadCadetsTemplate({
      group: g.group_num,
      stream: stream.stream_num
    });
    return;
  }
  const parts = ["Шаблон", "Курсанты"];
  if (g.group_num) parts.push("Группа", g.group_num);
  if (stream.stream_num) parts.push("Поток", stream.stream_num);
  const filename = typeof buildTemplateFileName === "function"
    ? buildTemplateFileName(parts)
    : "Шаблон_Курсанты.xlsx";
  if (typeof downloadXlsx === "function") {
    await downloadXlsx("/api/admin/cadets-template.xlsx", filename);
    return;
  }
  throw new Error("Не удалось скачать шаблон");
}

function pickImportDistGroupCadets(groupId) {
  if (!groupId) return;
  pendingDistGroupCadetImport = groupId;
  distUiState.groups[groupId] = false;
  refreshAllDistStreams();
  const inp = $("distGroupCadetsExcel");
  if (!inp) return;
  inp.value = "";
  inp.click();
}

async function importDistGroupCadets(file, groupId) {
  const gid = groupId || pendingDistGroupCadetImport;
  const msg = gid
    ? document.querySelector('[data-dg-import-msg="' + gid + '"]')
    : null;
  if (!gid) return;
  if (!file) {
    if (msg) msg.innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if (msg) msg.textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  try {
    const r = await fetch(
      "/api/admin/distributions/groups/" + encodeURIComponent(gid) + "/import-cadets",
      { method: "POST", headers, body: fd, credentials: "same-origin" }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(
        typeof data.detail === "string" ? data.detail : (data.message || r.status)
      );
    }
    if (data.distribution) syncDistDocuments(data.distribution);
    else if (workingDistId()) await openDistribution(workingDistId());
    const text =
      "Добавлено в список: " + (data.added || 0) +
      ((data.skipped_nums || []).length
        ? (" · пропущено номеров: " + data.skipped_nums.length)
        : "");
    const msg2 = document.querySelector('[data-dg-import-msg="' + gid + '"]');
    if (msg2) msg2.innerHTML = '<span class="ok">' + esc(text) + "</span>";
    setDistOpMsg("Список курсантов загружен");
  } catch (e) {
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
    else setDistOpMsg(e.message || "Ошибка", true);
  } finally {
    pendingDistGroupCadetImport = "";
    if ($("distGroupCadetsExcel")) $("distGroupCadetsExcel").value = "";
  }
}

async function downloadDistTemplate() {
  const parts = ["Шаблон", "Распределение"];
  if (selectedDist && selectedDist.title) parts.push(selectedDist.title);
  const filename = typeof buildTemplateFileName === "function"
    ? buildTemplateFileName(parts)
    : "Шаблон_Распределение.xlsx";
  if (typeof downloadXlsx === "function") {
    await downloadXlsx("/api/admin/distributions-template.xlsx", filename);
    return;
  }
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/distributions-template.xlsx", {
    headers,
    credentials: "same-origin"
  });
  if (!r.ok) throw new Error("Не удалось скачать шаблон");
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importDistExcel(file) {
  if (!selectedDistId) {
    setDistMsg("Сначала откройте распределение", true);
    return;
  }
  const f = file || ($("distExcel") && $("distExcel").files[0]);
  const msg = $("distImportMsg");
  if (!f) {
    if (msg) msg.innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if (msg) msg.textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", f);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  try {
    const r = await fetch(
      "/api/admin/distributions/" + encodeURIComponent(selectedDistId) + "/import",
      { method: "POST", headers, body: fd, credentials: "same-origin" }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(
        typeof data.detail === "string" ? data.detail : (data.message || r.status)
      );
    }
    if (data.distribution) showDistDetail(data.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    if ($("distExcel")) $("distExcel").value = "";
    const warnN = (data.warnings || []).length;
    const text =
      "Добавлено: " + (data.added || 0) +
      ", обновлено: " + (data.updated || 0) +
      ", всего строк: " + (data.total || 0) +
      (warnN ? (" · предупреждений: " + warnN) : "");
    if (msg) {
      msg.innerHTML = warnN
        ? ('<span class="ok">' + esc(text) + '</span><br><span class="hint">' +
          esc((data.warnings || []).slice(0, 8).join("; ")) +
          (warnN > 8 ? "…" : "") +
          "</span>")
        : ('<span class="ok">' + esc(text) + "</span>");
    }
    setDistMsg("Импорт выполнен");
  } catch (e) {
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
  }
}

function pickAndImportDistExcel() {
  if (!selectedDistId) {
    setDistMsg("Сначала откройте распределение", true);
    return;
  }
  const inp = $("distExcel");
  if (!inp) return;
  inp.value = "";
  inp.click();
}

if ($("btnDistTemplate")) {
  $("btnDistTemplate").onclick = () => downloadDistTemplate().catch(e => alert(e.message));
}
if ($("btnImportDist")) {
  $("btnImportDist").onclick = () => pickAndImportDistExcel();
}
if ($("distExcel")) {
  $("distExcel").addEventListener("change", () => {
    const f = $("distExcel").files && $("distExcel").files[0];
    if (!f) return;
    importDistExcel(f).catch(e => alert(e.message));
  });
}
if ($("distGroupCadetsExcel")) {
  $("distGroupCadetsExcel").addEventListener("change", () => {
    const f = $("distGroupCadetsExcel").files && $("distGroupCadetsExcel").files[0];
    if (!f) return;
    importDistGroupCadets(f).catch(e => alert(e.message));
  });
}

/** Исходный .xls штаба → превью → создание */
let pendingDistSourceFile = null;
let pendingDistSourcePreview = null;

function closeDistSourcePreview() {
  pendingDistSourceFile = null;
  pendingDistSourcePreview = null;
  const modal = $("distSourcePreviewModal");
  if (modal) modal.classList.add("hidden");
  if ($("distSourceExcel")) $("distSourceExcel").value = "";
  if ($("distSourcePreviewMsg")) $("distSourcePreviewMsg").textContent = "";
}

function renderDistSourcePreview(data) {
  pendingDistSourcePreview = data || null;
  const pass = (data && data.passport) || {};
  const stats = (data && data.stats) || {};
  const meta = $("distSourcePreviewMeta");
  if (meta) {
    meta.textContent =
      (pass.title || "Распределение") +
      (pass.dist_date ? (" · " + pass.dist_date) : "") +
      " · потоков: " + (stats.streams || (data.streams || []).length || 0) +
      " · групп: " + (stats.groups || (data.groups || []).length || 0);
  }
  const warn = $("distSourcePreviewWarn");
  const unmatched = (data && data.unmatched_staff) || [];
  const warnings = (data && data.warnings) || [];
  if (warn) {
    const bits = [];
    if (unmatched.length) {
      bits.push(
        "Не найдены в штатке (" + unmatched.length + "): " +
        unmatched.slice(0, 12).join("; ") +
        (unmatched.length > 12 ? "…" : "")
      );
    }
    if (warnings.length) {
      bits.push(warnings.slice(0, 6).join("; ") + (warnings.length > 6 ? "…" : ""));
    }
    warn.innerHTML = bits.length
      ? ('<span class="bad">' + esc(bits.join(" · ")) + "</span>")
      : '<span class="ok">Все указанные ФИО сопоставлены со штаткой (или состав пуст).</span>';
  }
  const body = $("distSourcePreviewBody");
  if (body) {
    const rows = data.groups || [];
    body.innerHTML = rows.map(g => {
      const staff = (g.staff_names || []).join(", ") ||
        [g.instructor, g.assistants].filter(Boolean).join(", ");
      const place = g.tent
        ? ("Палатка " + g.tent)
        : (g.classroom || "—");
      const resolved = g.staff_resolved || [];
      const miss = resolved.filter(x => !x.found).map(x => x.query);
      const okN = resolved.filter(x => x.found).length;
      const staffStatus = resolved.length
        ? (miss.length
          ? ('<span class="bad">' + okN + "/" + resolved.length + " · нет: " + esc(miss.join(", ")) + "</span>")
          : ('<span class="ok">' + okN + "/" + resolved.length + "</span>"))
        : "—";
      return (
        "<tr><td>" + esc(g.stream || "") + "</td>" +
        "<td>" + esc(g.group || "") + "</td>" +
        "<td class=\"center\">" + esc(String(g.count || "0")) + "</td>" +
        "<td>" + esc(staff || "—") + "</td>" +
        "<td>" + esc(place) + "</td>" +
        "<td>" + staffStatus + "</td></tr>"
      );
    }).join("") || "<tr><td colspan=\"6\">Нет групп</td></tr>";
  }
  const modal = $("distSourcePreviewModal");
  if (modal) modal.classList.remove("hidden");
}

async function previewDistSourceFile(file) {
  if (!file) return;
  pendingDistSourceFile = file;
  const msg = $("distSourcePreviewMsg");
  if (msg) msg.textContent = "Разбор файла…";
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch(
    "/api/admin/distributions/import-source?dry_run=1",
    { method: "POST", headers, body: fd, credentials: "same-origin" }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : (data.message || r.status)
    );
  }
  if (msg) msg.textContent = "";
  renderDistSourcePreview(data);
}

async function downloadDistReviewXlsx() {
  if (!pendingDistSourceFile) {
    alert("Сначала выберите исходный файл");
    return;
  }
  const msg = $("distSourcePreviewMsg");
  if (msg) msg.textContent = "Сборка Excel…";
  const fd = new FormData();
  fd.append("file", pendingDistSourceFile);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/distributions/import-source/review.xlsx", {
    method: "POST",
    headers,
    body: fd,
    credentials: "same-origin"
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string" ? data.detail : (data.message || r.status)
    );
  }
  const blob = await r.blob();
  const pass = (pendingDistSourcePreview && pendingDistSourcePreview.passport) || {};
  const base = (pass.title || "Распределение").replace(/[\\/:*?"<>|]+/g, "_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = base + "_dlya_pravki.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
  if (msg) {
    msg.innerHTML =
      '<span class="ok">Файл скачан. Красные ячейки — ФИО не из штатки. Исправьте и загрузите «Создать из исправленного» или позже «Загрузить исправленный» в карточке.</span>';
  }
}

async function applyDistSourceFile() {
  if (!pendingDistSourceFile) {
    alert("Сначала выберите файл");
    return;
  }
  const msg = $("distSourcePreviewMsg");
  const unmatched = (pendingDistSourcePreview && pendingDistSourcePreview.unmatched_staff) || [];
  if (unmatched.length) {
    const ok = confirm(
      "В штатке не найдено " + unmatched.length +
      " чел. Лучше сначала «Скачать Excel для правки». Создать из исходника всё равно?"
    );
    if (!ok) return;
  }
  if (msg) msg.textContent = "Создание…";
  const btn = $("btnApplyDistSource");
  if (btn) btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", pendingDistSourceFile);
    const headers = {};
    if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
    const r = await fetch(
      "/api/admin/distributions/import-source?dry_run=0",
      { method: "POST", headers, body: fd, credentials: "same-origin" }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(
        typeof data.detail === "string" ? data.detail : (data.message || r.status)
      );
    }
    const dist = data.distribution;
    closeDistSourcePreview();
    await refreshDistributions(false);
    if (dist && dist.id) {
      await openDistribution(dist.id);
      setDistMsg(
        "Создано из исходника: групп +" + (data.added || 0) +
        ((data.unmatched_staff || []).length
          ? (", не в штатке: " + data.unmatched_staff.length +
            ". Скачайте Excel для правки и загрузите исправленный в карточку.")
          : "")
      );
    } else {
      setDistMsg("Импорт выполнен");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function applyDistFixedExcel(file) {
  if (!file) return;
  const msg = $("distSourcePreviewMsg");
  if (msg) msg.textContent = "Создание из исправленного…";
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/distributions/import-canonical?dry_run=0", {
    method: "POST",
    headers,
    body: fd,
    credentials: "same-origin"
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : (data.message || r.status)
    );
  }
  const dist = data.distribution;
  closeDistSourcePreview();
  await refreshDistributions(false);
  if (dist && dist.id) {
    await openDistribution(dist.id);
    const miss = (data.unmatched_staff || []).length;
    setDistMsg(
      "Создано из исправленного Excel: +" + (data.added || 0) + " групп" +
      (miss ? (", всё ещё не в штатке: " + miss) : "")
    );
  }
}

if ($("btnImportDistSource")) {
  $("btnImportDistSource").onclick = () => {
    const inp = $("distSourceExcel");
    if (!inp) return;
    inp.value = "";
    inp.click();
  };
}
if ($("distSourceExcel")) {
  $("distSourceExcel").addEventListener("change", () => {
    const f = $("distSourceExcel").files && $("distSourceExcel").files[0];
    if (!f) return;
    previewDistSourceFile(f).catch(e => alert(e.message || e));
  });
}
if ($("btnCloseDistSourcePreview")) {
  $("btnCloseDistSourcePreview").onclick = () => closeDistSourcePreview();
}
if ($("btnCancelDistSource")) {
  $("btnCancelDistSource").onclick = () => closeDistSourcePreview();
}
if ($("btnApplyDistSource")) {
  $("btnApplyDistSource").onclick = () => applyDistSourceFile().catch(e => {
    const msg = $("distSourcePreviewMsg");
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
  });
}
if ($("btnDownloadDistReview")) {
  $("btnDownloadDistReview").onclick = () => downloadDistReviewXlsx().catch(e => {
    const msg = $("distSourcePreviewMsg");
    if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
  });
}
if ($("btnUploadDistFixed")) {
  $("btnUploadDistFixed").onclick = () => {
    const inp = $("distFixedExcel");
    if (!inp) return;
    inp.value = "";
    inp.click();
  };
}
if ($("distFixedExcel")) {
  $("distFixedExcel").addEventListener("change", () => {
    const f = $("distFixedExcel").files && $("distFixedExcel").files[0];
    if (!f) return;
    applyDistFixedExcel(f).catch(e => {
      const msg = $("distSourcePreviewMsg");
      if (msg) msg.innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
    });
  });
}
if ($("distSourcePreviewModal")) {
  $("distSourcePreviewModal").addEventListener("click", event => {
    if (event.target === $("distSourcePreviewModal")) closeDistSourcePreview();
  });
}

bindStaffPickers();
setTimeout(() => {
  refreshDistributions(false).catch(() => {});
}, 0);
