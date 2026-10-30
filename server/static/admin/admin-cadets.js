/* Cadets module. Loaded after admin-app.js, before flight boot. */

let trainingGroupsCache = [];
let trainingStreamsCache = [];

function cadetKey(a) {
  return String(a && a.student_num != null ? a.student_num : "").trim();
}

function peopleNames(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function applyCadetsPayload(data) {
  if (!data) return;
  if (Array.isArray(data.cadets)) cadetsCache = data.cadets;
  if (Array.isArray(data.groups)) trainingGroupsCache = data.groups;
  if (Array.isArray(data.streams)) trainingStreamsCache = data.streams;
}

function syncCadetsFilters() {
  const streamF = normFilterLabel($("filterCadetsStream") && $("filterCadetsStream").value);
  const base = cadetsCache || [];
  const streamOpts = uniqueFilterLabels(
    [].concat(
      base.map(x => x.stream_num),
      (trainingStreamsCache || []).map(s => s.stream_num),
      (trainingGroupsCache || []).map(g => g.stream_num)
    ),
    x => x
  );
  fillFilterSelect("filterCadetsStream", streamOpts, "Все потоки");
  if (streamF && streamOpts.some(s => normFilterLabel(s) === streamF)) {
    $("filterCadetsStream").value = streamF;
  }
  const forGroups = streamF
    ? base.filter(c => normFilterLabel(c.stream_num) === streamF)
    : base;
  const groupOpts = uniqueFilterLabels(
    [].concat(
      forGroups.map(x => x.group_num),
      (trainingGroupsCache || [])
        .filter(g => !streamF || normFilterLabel(g.stream_num) === streamF)
        .map(g => g.group_num)
    ),
    x => x
  );
  fillFilterSelect("filterCadetsGroup", groupOpts, "Все группы");
}

function findGroupCard(streamNum, groupNum) {
  const s = normFilterLabel(streamNum);
  const g = normFilterLabel(groupNum);
  if (!s || !g) return null;
  return (trainingGroupsCache || []).find(
    x => normFilterLabel(x.stream_num) === s && normFilterLabel(x.group_num) === g
  ) || null;
}

function renderGroupCard() {
  const card = $("groupCard");
  if (!card) return;
  const streamF = normFilterLabel($("filterCadetsStream") && $("filterCadetsStream").value);
  const groupF = normFilterLabel($("filterCadetsGroup") && $("filterCadetsGroup").value);
  const g = findGroupCard(streamF, groupF);
  if (!g) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  if ($("groupCardTitle")) {
    $("groupCardTitle").textContent = "Поток " + (g.stream_num || "—") + " · группа " + (g.group_num || "—");
  }
  const bits = [];
  if (g.classroom) bits.push("Аудитория: " + g.classroom);
  if (g.polygon_name) bits.push("Полигон: " + g.polygon_name);
  if (g.tent_num) bits.push("Палатка: " + g.tent_num);
  if (g.note) bits.push(g.note);
  if ($("groupCardMeta")) $("groupCardMeta").textContent = bits.join(" · ") || "Место не указано";
  const fact = (cadetsCache || []).filter(
    c => normFilterLabel(c.stream_num) === streamF && normFilterLabel(c.group_num) === groupF
  ).length;
  const plan = Number(g.planned_count) || 0;
  if ($("groupCardCount")) {
    $("groupCardCount").textContent = plan
      ? ("Курсантов: " + fact + " / план " + plan)
      : ("Курсантов: " + fact);
  }
  const blocks = [];
  const inst = peopleNames(g.instructors);
  const asst = peopleNames(g.assistants);
  const seniors = peopleNames(g.stream_seniors);
  if (inst) blocks.push("<div><span class=\"hint\">Инструктор</span><div>" + esc(inst) + "</div></div>");
  if (asst) blocks.push("<div><span class=\"hint\">Ассистенты</span><div>" + esc(asst) + "</div></div>");
  if (seniors) blocks.push("<div><span class=\"hint\">Старшие потока</span><div>" + esc(seniors) + "</div></div>");
  if ($("groupCardPeople")) {
    $("groupCardPeople").innerHTML = blocks.join("") || "<span class=\"hint\">Состав группы не загружен</span>";
  }
}

function cadetLookupByNum(num) {
  const key = String(num == null ? "" : num).trim();
  if (!key) return null;
  return (cadetsCache || []).find(c => cadetKey(c) === key) || null;
}

function clearCadetForm() {
  cadetEditId = "";
  ["cadetNum", "cadetCall", "cadetGroup", "cadetStream", "cadetFio", "cadetPhone", "cadetPassport", "cadetNote"]
    .forEach(id => { if ($(id)) $(id).value = ""; });
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
    case "fio": return c.full_name || "";
    case "group": return c.group_num || "";
    case "stream": return c.stream_num || "";
    case "phone": return c.phone || "";
    default: return "";
  }
}

function renderCadetsHead() {
  if (!$("cadetsHead")) return;
  $("cadetsHead").innerHTML =
    `<th style="width:40px"><input type="checkbox" id="cadetCheckAll" title="Выбрать все доступные"></th>` +
    thSortHtml(cadetsSort, "npp", "№ п/п") +
    thSortHtml(cadetsSort, "num", "Номер") +
    thSortHtml(cadetsSort, "call", "Позывной") +
    thSortHtml(cadetsSort, "fio", "ФИО") +
    thSortHtml(cadetsSort, "group", "Группа") +
    thSortHtml(cadetsSort, "stream", "Поток") +
    thSortHtml(cadetsSort, "phone", "Телефон") +
    "<th>Инструктор</th><th></th>";
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
  renderGroupCard();
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
    const inst = peopleNames(c.instructors) || "—";
    return `<tr>
      <td>${check}</td>
      <td class="npp">${esc(c.npp)}</td>
      <td>${esc(c.student_num)}</td>
      <td>${esc(c.callsign || "")}</td>
      <td>${esc(c.full_name || "")}</td>
      <td>${esc(c.group_num || "")}</td>
      <td>${esc(c.stream_num || "")}</td>
      <td>${esc(c.phone || "")}</td>
      <td>${esc(inst)}</td>
      <td class="row">${actions.join(" ") || '<span class="hint">—</span>'}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="hint">${(cadetsCache || []).length ? "Нет курсантов по фильтру" : "Курсантов пока нет"}</td></tr>`;
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
  applyCadetsPayload(res);
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
  applyCadetsPayload(res);
  clearCadetForm();
  renderCadetsTable();
  alert("Удалено записей: " + (res.deleted || 0));
}

async function refreshCadets() {
  const data = await api("/api/admin/cadets");
  applyCadetsPayload(data);
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

function cadetFormPayload() {
  return {
    student_num: ($("cadetNum") && $("cadetNum").value) || "",
    callsign: ($("cadetCall") && $("cadetCall").value) || "",
    group_num: ($("cadetGroup") && $("cadetGroup").value) || "",
    stream_num: ($("cadetStream") && $("cadetStream").value) || "",
    full_name: ($("cadetFio") && $("cadetFio").value) || "",
    phone: ($("cadetPhone") && $("cadetPhone").value) || "",
    passport: ($("cadetPassport") && $("cadetPassport").value) || "",
    note: ($("cadetNote") && $("cadetNote").value) || ""
  };
}

async function saveCadet() {
  const payload = cadetFormPayload();
  try {
    if (cadetEditId) {
      const res = await api("/api/admin/cadets/" + encodeURIComponent(cadetEditId), {
        method: "PUT", json: payload
      });
      applyCadetsPayload(res);
    } else {
      const res = await api("/api/admin/cadets", { method: "POST", json: payload });
      applyCadetsPayload(res);
    }
    clearCadetForm();
    renderCadetsTable();
  } catch (e) {
    const msg = e.message || "";
    if (/уже существует|уже есть/i.test(msg)) showCadetDupModal(msg);
    else alert(msg);
  }
}

function startCadetEdit(id) {
  const c = (cadetsCache || []).find(x => x.id === id);
  if (!c || !c.can_edit) return;
  cadetEditId = id;
  if ($("cadetNum")) $("cadetNum").value = c.student_num || "";
  if ($("cadetCall")) $("cadetCall").value = c.callsign || "";
  if ($("cadetGroup")) $("cadetGroup").value = c.group_num || "";
  if ($("cadetStream")) $("cadetStream").value = c.stream_num || "";
  if ($("cadetFio")) $("cadetFio").value = c.full_name || "";
  if ($("cadetPhone")) $("cadetPhone").value = c.phone || "";
  if ($("cadetPassport")) $("cadetPassport").value = c.passport || "";
  if ($("cadetNote")) $("cadetNote").value = c.note || "";
  $("btnAddCadet").textContent = "Сохранить";
  if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").classList.remove("hidden");
  const form = $("cadetAddForm");
  if (form) form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function downloadXlsx(url, filename) {
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + token }
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "Не удалось скачать шаблон");
  }
  const blob = await r.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = obj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(obj);
}

async function downloadCadetsTemplate() {
  await downloadXlsx("/api/admin/cadets-template.xlsx", "lis-cadets-template.xlsx");
}

async function downloadGroupsTemplate() {
  await downloadXlsx("/api/admin/groups-template.xlsx", "lis-groups-template.xlsx");
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
    applyCadetsPayload(data);
    renderCadetsTable();
    showCadetImportResult(data);
  } catch (e) {
    if ($("cadetsImportMsg")) $("cadetsImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

async function importGroupsExcel() {
  const f = $("groupsExcel") && $("groupsExcel").files[0];
  if (!f) {
    if ($("groupsImportMsg")) $("groupsImportMsg").innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if ($("groupsImportMsg")) $("groupsImportMsg").textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await fetch("/api/admin/training/groups/import", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Ошибка импорта");
    if ($("groupsExcel")) $("groupsExcel").value = "";
    applyCadetsPayload(data);
    renderCadetsTable();
    const added = Number(data.added) || 0;
    const updated = Number(data.updated) || 0;
    const warn = (data.warnings || []).length;
    let msg = "Групп добавлено: " + added + ", обновлено: " + updated;
    if (warn) msg += ". Предупреждений: " + warn + " (ФИО не из штатки и т.п.)";
    if ($("groupsImportMsg")) {
      $("groupsImportMsg").innerHTML = '<span class="ok">' + esc(msg) + "</span>";
    }
    if (warn && data.warnings && data.warnings.length) {
      console.warn("groups import warnings", data.warnings);
    }
  } catch (e) {
    if ($("groupsImportMsg")) $("groupsImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

if ($("filterCadetsStream")) $("filterCadetsStream").onchange = () => {
  if ($("filterCadetsGroup")) $("filterCadetsGroup").value = "";
  renderCadetsTable();
};
if ($("filterCadetsGroup")) $("filterCadetsGroup").onchange = () => renderCadetsTable();
bindTableSort("cadetsHead", cadetsSort, renderCadetsTable);
if ($("btnAddCadet")) $("btnAddCadet").onclick = () => saveCadet().catch(e => alert(e.message));
if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").onclick = () => clearCadetForm();
if ($("btnCadetsTemplate")) $("btnCadetsTemplate").onclick = () => downloadCadetsTemplate().catch(e => alert(e.message));
if ($("btnGroupsTemplate")) $("btnGroupsTemplate").onclick = () => downloadGroupsTemplate().catch(e => alert(e.message));
if ($("btnImportCadets")) $("btnImportCadets").onclick = () => importCadetsExcel().catch(e => alert(e.message));
if ($("btnImportGroups")) $("btnImportGroups").onclick = () => importGroupsExcel().catch(e => alert(e.message));
if ($("btnDelCadetsSelected")) $("btnDelCadetsSelected").onclick = () => deleteSelectedCadets().catch(e => alert(e.message));
if ($("btnClearMyCadets")) $("btnClearMyCadets").onclick = () => clearMyCadets().catch(e => alert(e.message));
if ($("cadetsBody")) $("cadetsBody").addEventListener("change", e => {
  if (e.target && e.target.classList && e.target.classList.contains("cadet-check")) syncCadetSelectionUi();
});
if ($("btnCadetDupBack")) $("btnCadetDupBack").onclick = closeCadetDupModal;
if ($("cadetDupModal")) $("cadetDupModal").addEventListener("click", e => { if (e.target === $("cadetDupModal")) closeCadetDupModal(); });
if ($("btnCloseCadetImport")) $("btnCloseCadetImport").onclick = closeCadetImportModal;
if ($("cadetImportModal")) $("cadetImportModal").addEventListener("click", e => { if (e.target === $("cadetImportModal")) closeCadetImportModal(); });
