/* Cadets module. Loaded after admin-app.js, before flight boot. */

function cadetKey(a) {
  return String(a && a.student_num != null ? a.student_num : "").trim();
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

function cadetLookupByNum(num) {
  const key = String(num == null ? "" : num).trim();
  if (!key) return null;
  return (cadetsCache || []).find(c => cadetKey(c) === key) || null;
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

if ($("filterCadetsStream")) $("filterCadetsStream").onchange = () => {
  if ($("filterCadetsGroup")) $("filterCadetsGroup").value = "";
  renderCadetsTable();
};
if ($("filterCadetsGroup")) $("filterCadetsGroup").onchange = () => renderCadetsTable();
bindTableSort("cadetsHead", cadetsSort, renderCadetsTable);
if ($("btnAddCadet")) $("btnAddCadet").onclick = () => saveCadet().catch(e => alert(e.message));
if ($("btnCancelCadetEdit")) $("btnCancelCadetEdit").onclick = () => clearCadetForm();
if ($("btnCadetsTemplate")) $("btnCadetsTemplate").onclick = () => downloadCadetsTemplate().catch(e => alert(e.message));
if ($("btnImportCadets")) $("btnImportCadets").onclick = () => importCadetsExcel().catch(e => alert(e.message));
if ($("btnDelCadetsSelected")) $("btnDelCadetsSelected").onclick = () => deleteSelectedCadets().catch(e => alert(e.message));
if ($("btnClearMyCadets")) $("btnClearMyCadets").onclick = () => clearMyCadets().catch(e => alert(e.message));
if ($("cadetsBody")) $("cadetsBody").addEventListener("change", e => {
  if (e.target && e.target.classList && e.target.classList.contains("cadet-check")) syncCadetSelectionUi();
});
if ($("btnCadetDupBack")) $("btnCadetDupBack").onclick = closeCadetDupModal;
if ($("cadetDupModal")) $("cadetDupModal").addEventListener("click", e => { if (e.target === $("cadetDupModal")) closeCadetDupModal(); });
if ($("btnCloseCadetImport")) $("btnCloseCadetImport").onclick = closeCadetImportModal;
if ($("cadetImportModal")) $("cadetImportModal").addEventListener("click", e => { if (e.target === $("cadetImportModal")) closeCadetImportModal(); });

