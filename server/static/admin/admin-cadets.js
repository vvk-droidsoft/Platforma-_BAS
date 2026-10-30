/* Cadets module: дерево поток → группа → курсанты. */

let trainingGroupsCache = [];
let trainingStreamsCache = [];
let trainingTreeCache = { streams: [], orphans: [], totals: {} };

const TREE_STATE_KEY = "lisCadetsTreeState";

function cadetKey(a) {
  return String(a && a.student_num != null ? a.student_num : "").trim();
}

function peopleNames(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function loadTreeState() {
  try { return JSON.parse(localStorage.getItem(TREE_STATE_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}

function saveTreeState(st) {
  try { localStorage.setItem(TREE_STATE_KEY, JSON.stringify(st || {})); } catch (e) {}
}

function isTreeOpen(kind, id, st) {
  const key = kind + ":" + id;
  if (Object.prototype.hasOwnProperty.call(st, key)) return !!st[key];
  return false;
}

function setTreeOpen(kind, id, open) {
  const st = loadTreeState();
  st[kind + ":" + id] = !!open;
  saveTreeState(st);
}

function applyCadetsPayload(data) {
  if (!data) return;
  if (Array.isArray(data.cadets)) cadetsCache = data.cadets;
  if (Array.isArray(data.groups)) trainingGroupsCache = data.groups;
  if (Array.isArray(data.streams)) trainingStreamsCache = data.streams;
  if (data.tree) trainingTreeCache = data.tree;
}

function cadetLookupByNum(num) {
  const key = String(num == null ? "" : num).trim();
  if (!key) return null;
  return (cadetsCache || []).find(c => cadetKey(c) === key) || null;
}

function activeCadetForm() {
  return document.querySelector("#streamsTree .cadet-inline-form:not(.hidden)");
}

function hideAllCadetForms() {
  document.querySelectorAll("#streamsTree .cadet-inline-form").forEach(el => el.classList.add("hidden"));
}

function clearCadetForm(panel) {
  cadetEditId = "";
  const form = panel || activeCadetForm();
  if (!form) return;
  form.querySelectorAll(".cf-num, .cf-call, .cf-fio, .cf-phone, .cf-passport, .cf-note").forEach(el => { el.value = ""; });
  const title = form.querySelector(".cf-title");
  if (title) title.textContent = "Новый курсант";
  const save = form.querySelector(".cf-save");
  if (save) save.textContent = "Сохранить";
}

function formField(form, cls) {
  return form ? form.querySelector("." + cls) : null;
}

function selectedCadetIds() {
  return Array.from(document.querySelectorAll("#streamsTree input.cadet-check:checked"))
    .map(el => el.value)
    .filter(Boolean);
}

function syncCadetSelectionUi() {
  const ids = selectedCadetIds();
  const btn = $("btnDelCadetsSelected");
  const hint = $("cadetSelectedHint");
  if (btn) btn.disabled = !ids.length;
  if (hint) hint.textContent = ids.length ? ("Выбрано: " + ids.length) : "";
  document.querySelectorAll("#streamsTree input.cadet-check-all").forEach(all => {
    const scope = all.closest(".tree-body") || all.closest(".tree-node");
    if (!scope) return;
    const boxes = scope.querySelectorAll("input.cadet-check");
    const n = scope.querySelectorAll("input.cadet-check:checked").length;
    all.checked = boxes.length > 0 && n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
  });
}

function cadetInlineFormHtml(streamNum, groupNum, locked) {
  const sn = streamNum || "";
  const gn = groupNum || "";
  const ro = locked ? " readonly" : "";
  return `<div class="cadet-inline-form hidden" data-form-stream="${esc(sn)}" data-form-group="${esc(gn)}">
    <h2 class="cf-title">Новый курсант</h2>
    <div class="row" style="align-items:flex-end;flex-wrap:wrap">
      <div>
        <label>Поток</label>
        <input class="cf-stream" type="text" style="min-width:90px" value="${esc(sn)}"${ro} autocomplete="off">
      </div>
      <div>
        <label>Группа</label>
        <input class="cf-group" type="text" style="min-width:90px" value="${esc(gn)}"${ro} autocomplete="off">
      </div>
      <div>
        <label>Номер курсанта</label>
        <input class="cf-num" type="text" style="min-width:120px" autocomplete="off">
      </div>
      <div>
        <label>Позывной</label>
        <input class="cf-call" type="text" style="min-width:120px" autocomplete="off">
      </div>
      <div>
        <label>ФИО</label>
        <input class="cf-fio" type="text" style="min-width:180px" autocomplete="off">
      </div>
      <div>
        <label>Телефон</label>
        <input class="cf-phone" type="text" style="min-width:120px" autocomplete="off">
      </div>
      <div>
        <label>Паспорт</label>
        <input class="cf-passport" type="text" style="min-width:140px" autocomplete="off">
      </div>
      <div style="flex:1;min-width:180px">
        <label>Примечание</label>
        <input class="cf-note" type="text" style="width:100%;min-width:160px" autocomplete="off">
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn main cf-save" type="button">Сохранить</button>
      <button class="btn cf-cancel" type="button">Отмена</button>
    </div>
  </div>`;
}

function openCadetForm(panel, opts) {
  opts = opts || {};
  if (!panel) return;
  hideAllCadetForms();
  panel.classList.remove("hidden");
  clearCadetForm(panel);
  const streamLocked = panel.querySelector(".cf-stream") && panel.querySelector(".cf-stream").readOnly;
  if (!streamLocked) {
    if (opts.stream != null && formField(panel, "cf-stream")) formField(panel, "cf-stream").value = opts.stream || "";
    if (opts.group != null && formField(panel, "cf-group")) formField(panel, "cf-group").value = opts.group || "";
  } else {
    if (formField(panel, "cf-stream")) formField(panel, "cf-stream").value = panel.getAttribute("data-form-stream") || "";
    if (formField(panel, "cf-group")) formField(panel, "cf-group").value = panel.getAttribute("data-form-group") || "";
  }
  const title = panel.querySelector(".cf-title");
  const save = panel.querySelector(".cf-save");
  if (opts.cadet) {
    const c = opts.cadet;
    cadetEditId = c.id;
    if (formField(panel, "cf-num")) formField(panel, "cf-num").value = c.student_num || "";
    if (formField(panel, "cf-call")) formField(panel, "cf-call").value = c.callsign || "";
    if (formField(panel, "cf-fio")) formField(panel, "cf-fio").value = c.full_name || "";
    if (formField(panel, "cf-phone")) formField(panel, "cf-phone").value = c.phone || "";
    if (formField(panel, "cf-passport")) formField(panel, "cf-passport").value = c.passport || "";
    if (formField(panel, "cf-note")) formField(panel, "cf-note").value = c.note || "";
    if (!streamLocked) {
      if (formField(panel, "cf-stream")) formField(panel, "cf-stream").value = c.stream_num || "";
      if (formField(panel, "cf-group")) formField(panel, "cf-group").value = c.group_num || "";
    }
    if (title) title.textContent = "Изменить курсанта";
    if (save) save.textContent = "Сохранить";
  } else {
    if (title) title.textContent = "Новый курсант";
    if (save) save.textContent = "Сохранить";
  }
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const num = formField(panel, "cf-num");
  if (num) num.focus();
}

function findCadetFormPanel(streamNum, groupNum) {
  const sn = normFilterLabel(streamNum);
  const gn = normFilterLabel(groupNum);
  const forms = Array.from(document.querySelectorAll("#streamsTree .cadet-inline-form"));
  if (!sn && !gn) {
    return forms.find(f => !(f.getAttribute("data-form-stream") || "") && !(f.getAttribute("data-form-group") || "")) || null;
  }
  return forms.find(f =>
    normFilterLabel(f.getAttribute("data-form-stream")) === sn &&
    normFilterLabel(f.getAttribute("data-form-group")) === gn
  ) || null;
}

function cadetsTableHtml(list, streamNum, groupNum) {
  const rows = (list || []).map(c => {
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
      <td>${esc(c.full_name || "")}</td>
      <td>${esc(c.phone || "")}</td>
      <td>${esc(c.passport || "")}</td>
      <td>${esc(c.note || "")}</td>
      <td class="row">${actions.join(" ") || '<span class="hint">—</span>'}</td>
    </tr>`;
  }).join("");
  const empty = `<tr><td colspan="9" class="hint">${(list || []).length ? "" : "В группе пока нет курсантов"}</td></tr>`;
  const locked = !!(streamNum || groupNum);
  return `<div class="scrollx"><table>
    <thead><tr>
      <th style="width:40px"><input type="checkbox" class="cadet-check-all" title="Выбрать в группе"></th>
      <th>№ п/п</th><th>Номер</th><th>Позывной</th><th>ФИО</th><th>Телефон</th><th>Паспорт</th><th>Примечание</th><th></th>
    </tr></thead>
    <tbody>${rows || empty}</tbody>
  </table></div>
  <div class="row" style="margin-top:8px">
    <button class="btn" type="button" data-import-stream="${esc(streamNum || "")}" data-import-group="${esc(groupNum || "")}" title="Единый шаблон курсантов">Добавить из файла</button>
    <button class="btn" type="button" data-open-cadet-form="${esc(streamNum || "")}" data-open-cadet-group="${esc(groupNum || "")}">Добавить курсанта</button>
    <button class="btn" type="button" data-tpl-cadets="1">Скачать шаблон</button>
  </div>
  ${cadetInlineFormHtml(streamNum, groupNum, locked)}`;
}

function staffBlocksHtml(instructors, assistants, seniors) {
  const blocks = [];
  const inst = peopleNames(instructors);
  const asst = peopleNames(assistants);
  const sen = peopleNames(seniors);
  if (inst) blocks.push(`<div><span class="hint">Инструктор</span><div>${esc(inst)}</div></div>`);
  if (asst) blocks.push(`<div><span class="hint">Ассистенты</span><div>${esc(asst)}</div></div>`);
  if (sen) blocks.push(`<div><span class="hint">Старшие потока</span><div>${esc(sen)}</div></div>`);
  if (!blocks.length) return `<div class="hint">Состав не загружен</div>`;
  return `<div class="tree-staff">${blocks.join("")}</div>`;
}

function placeHtml(g) {
  const bits = [];
  if (g.classroom) bits.push("Аудитория: " + g.classroom);
  if (g.polygon_name) bits.push("Полигон: " + g.polygon_name);
  if (g.tent_num) bits.push("Палатка: " + g.tent_num);
  if (g.note) bits.push(g.note);
  return bits.length
    ? `<div class="tree-place">${esc(bits.join(" · "))}</div>`
    : `<div class="tree-place hint">Место не указано</div>`;
}

function renderCadetsTable() {
  const host = $("streamsTree");
  if (!host) return;
  const tree = trainingTreeCache || { streams: [], orphans: [], totals: {} };
  if ((!tree.streams || !tree.streams.length) && Array.isArray(cadetsCache) && cadetsCache.length && !tree.orphans) {
    // fallback: нет дерева в ответе — плоский список как «Без привязки»
    trainingTreeCache = { streams: [], orphans: cadetsCache.slice(), totals: { cadets: cadetsCache.length, orphans: cadetsCache.length } };
  }
  const st = loadTreeState();
  const totals = tree.totals || {};
  if ($("cadetsMeta")) {
    const n = totals.cadets != null ? totals.cadets : (cadetsCache || []).length;
    $("cadetsMeta").textContent = n ? (" · " + n) : "";
  }
  if ($("cadetsTreeMeta")) {
    const parts = [];
    if (totals.streams) parts.push("потоков: " + totals.streams);
    if (totals.groups) parts.push("групп: " + totals.groups);
    if (totals.cadets != null) parts.push("курсантов: " + totals.cadets);
    if (totals.orphans) parts.push("без привязки: " + totals.orphans);
    $("cadetsTreeMeta").textContent = parts.join(" · ");
  }

  const parts = [];
  (tree.streams || []).forEach(s => {
    const open = isTreeOpen("stream", s.id, st);
    const meta = [
      "групп: " + (s.groups_count || 0),
      "курсантов: " + (s.cadets_count || 0),
      "состав: " + (s.staff_count || 0)
    ].join(" · ");
    const groupsHtml = (s.groups || []).map(g => {
      const gOpen = isTreeOpen("group", g.id, st);
      const gMeta = [
        "курсантов: " + (g.cadets_count || 0) + (g.planned_count ? (" / план " + g.planned_count) : ""),
        "состав: " + (g.staff_count || 0)
      ].join(" · ");
      return `<div class="tree-node group-node${gOpen ? "" : " collapsed"}" data-tree-kind="group" data-tree-id="${esc(g.id)}">
        <button type="button" class="tree-head" aria-expanded="${gOpen ? "true" : "false"}">
          <span>
            <span class="tree-title">Группа № ${esc(g.group_num || "—")}</span>
            <div class="tree-meta">${esc(gMeta)}</div>
          </span>
          <span class="tree-chevron">▼</span>
        </button>
        <div class="tree-body">
          ${placeHtml(g)}
          ${staffBlocksHtml(g.instructors, g.assistants, null)}
          ${cadetsTableHtml(g.cadets, s.stream_num, g.group_num)}
        </div>
      </div>`;
    }).join("") || `<p class="hint">Групп в потоке пока нет — загрузите распределение.</p>`;

    parts.push(`<div class="tree-node stream-node${open ? "" : " collapsed"}" data-tree-kind="stream" data-tree-id="${esc(s.id)}">
      <button type="button" class="tree-head" aria-expanded="${open ? "true" : "false"}">
        <span>
          <span class="tree-title">Поток № ${esc(s.stream_num || "—")}</span>
          <div class="tree-meta">${esc(meta)}</div>
        </span>
        <span class="tree-chevron">▼</span>
      </button>
      <div class="tree-body">
        ${staffBlocksHtml(null, null, s.stream_seniors)}
        ${groupsHtml}
      </div>
    </div>`);
  });

  const orphans = tree.orphans || [];
  if (orphans.length) {
    const open = isTreeOpen("orphan", "all", st);
    parts.push(`<div class="tree-node orphan-node${open ? "" : " collapsed"}" data-tree-kind="orphan" data-tree-id="all">
      <button type="button" class="tree-head" aria-expanded="${open ? "true" : "false"}">
        <span>
          <span class="tree-title">Без привязки к группе</span>
          <div class="tree-meta">курсантов: ${orphans.length}</div>
        </span>
        <span class="tree-chevron">▼</span>
      </button>
      <div class="tree-body">
        ${cadetsTableHtml(orphans, "", "")}
      </div>
    </div>`);
  }

  if (!parts.length) {
    host.innerHTML = `<p class="hint">Потоков и курсантов пока нет. Загрузите распределение групп и список курсантов.</p>`;
  } else {
    host.innerHTML = parts.join("");
  }
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
  if (!data.tree && Array.isArray(data.cadets)) {
    trainingTreeCache = {
      streams: [],
      orphans: data.cadets,
      totals: { cadets: data.cadets.length, orphans: data.cadets.length }
    };
  }
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

function cadetFormPayload(form) {
  form = form || activeCadetForm();
  if (!form) return null;
  return {
    student_num: (formField(form, "cf-num") && formField(form, "cf-num").value) || "",
    callsign: (formField(form, "cf-call") && formField(form, "cf-call").value) || "",
    group_num: (formField(form, "cf-group") && formField(form, "cf-group").value) || "",
    stream_num: (formField(form, "cf-stream") && formField(form, "cf-stream").value) || "",
    full_name: (formField(form, "cf-fio") && formField(form, "cf-fio").value) || "",
    phone: (formField(form, "cf-phone") && formField(form, "cf-phone").value) || "",
    passport: (formField(form, "cf-passport") && formField(form, "cf-passport").value) || "",
    note: (formField(form, "cf-note") && formField(form, "cf-note").value) || ""
  };
}

async function saveCadet(form) {
  form = form || activeCadetForm();
  const payload = cadetFormPayload(form);
  if (!payload) return;
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
    cadetEditId = "";
    renderCadetsTable();
  } catch (e) {
    const msg = e.message || "";
    if (/уже существует|уже есть/i.test(msg)) showCadetDupModal(msg);
    else alert(msg);
  }
}

function ensureNodeOpen(node) {
  if (!node) return;
  if (node.classList.contains("collapsed")) {
    node.classList.remove("collapsed");
    const head = node.querySelector(":scope > .tree-head");
    if (head) head.setAttribute("aria-expanded", "true");
    const kind = node.getAttribute("data-tree-kind");
    const id = node.getAttribute("data-tree-id");
    if (kind && id) setTreeOpen(kind, id, true);
  }
  const parent = node.parentElement && node.parentElement.closest(".tree-node");
  if (parent) ensureNodeOpen(parent);
}

function startCadetEdit(id) {
  const c = (cadetsCache || []).find(x => x.id === id);
  if (!c || !c.can_edit) return;
  let panel = findCadetFormPanel(c.stream_num, c.group_num);
  if (!panel) panel = findCadetFormPanel("", "");
  if (!panel) return;
  const groupNode = panel.closest(".tree-node");
  ensureNodeOpen(groupNode);
  openCadetForm(panel, { cadet: c });
}

async function downloadXlsx(url, filename) {
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    credentials: "same-origin"
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

async function importCadetsFile(file, opts) {
  opts = opts || {};
  const fd = new FormData();
  fd.append("file", file);
  if (opts.stream) fd.append("default_stream", opts.stream);
  if (opts.group) fd.append("default_group", opts.group);
  const r = await fetch("/api/admin/cadets/import", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd,
    credentials: "same-origin"
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Ошибка импорта");
  applyCadetsPayload(data);
  renderCadetsTable();
  showCadetImportResult(data);
  return data;
}

async function importCadetsExcel() {
  const f = $("cadetsExcel") && $("cadetsExcel").files[0];
  if (!f) {
    if ($("cadetsImportMsg")) $("cadetsImportMsg").innerHTML = '<span class="bad">Выберите файл Excel</span>';
    return;
  }
  if ($("cadetsImportMsg")) $("cadetsImportMsg").textContent = "Загрузка…";
  try {
    await importCadetsFile(f);
    if ($("cadetsExcel")) $("cadetsExcel").value = "";
    if ($("cadetsImportMsg")) $("cadetsImportMsg").textContent = "";
  } catch (e) {
    if ($("cadetsImportMsg")) $("cadetsImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

let pendingGroupImport = { stream: "", group: "" };

function ensureGroupImportInput() {
  let inp = $("cadetsGroupExcel");
  if (inp) return inp;
  inp = document.createElement("input");
  inp.type = "file";
  inp.id = "cadetsGroupExcel";
  inp.accept = ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  inp.className = "hidden";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const ctx = pendingGroupImport || {};
    importCadetsFile(f, { stream: ctx.stream || "", group: ctx.group || "" })
      .catch(e => alert(e.message))
      .finally(() => { inp.value = ""; });
  });
  document.body.appendChild(inp);
  return inp;
}

function openGroupCadetsImport(streamNum, groupNum) {
  pendingGroupImport = { stream: streamNum || "", group: groupNum || "" };
  const inp = ensureGroupImportInput();
  inp.click();
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
      body: fd,
      credentials: "same-origin"
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
  } catch (e) {
    if ($("groupsImportMsg")) $("groupsImportMsg").innerHTML = '<span class="bad">' + esc(e.message) + "</span>";
  }
}

function setAllTreeOpen(open) {
  const st = loadTreeState();
  document.querySelectorAll("#streamsTree .tree-node[data-tree-id]").forEach(node => {
    const kind = node.getAttribute("data-tree-kind");
    const id = node.getAttribute("data-tree-id");
    if (!kind || !id) return;
    st[kind + ":" + id] = !!open;
    node.classList.toggle("collapsed", !open);
    const head = node.querySelector(":scope > .tree-head");
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
  });
  saveTreeState(st);
}

if ($("streamsTree")) {
  $("streamsTree").addEventListener("click", e => {
    const head = e.target.closest(".tree-head");
    if (head && $("streamsTree").contains(head)) {
      const node = head.closest(".tree-node");
      if (!node) return;
      const kind = node.getAttribute("data-tree-kind");
      const id = node.getAttribute("data-tree-id");
      const open = node.classList.contains("collapsed");
      node.classList.toggle("collapsed", !open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
      if (kind && id) setTreeOpen(kind, id, open);
      return;
    }
    const openFormBtn = e.target.closest("[data-open-cadet-form]");
    if (openFormBtn) {
      const sn = openFormBtn.getAttribute("data-open-cadet-form") || "";
      const gn = openFormBtn.getAttribute("data-open-cadet-group") || "";
      let panel = findCadetFormPanel(sn, gn);
      if (!panel) {
        const body = openFormBtn.closest(".tree-body");
        panel = body && body.querySelector(".cadet-inline-form");
      }
      if (panel) openCadetForm(panel, { stream: sn, group: gn });
      return;
    }
    const saveBtn = e.target.closest(".cf-save");
    if (saveBtn) {
      const panel = saveBtn.closest(".cadet-inline-form");
      saveCadet(panel).catch(err => alert(err.message));
      return;
    }
    const cancelBtn = e.target.closest(".cf-cancel");
    if (cancelBtn) {
      const panel = cancelBtn.closest(".cadet-inline-form");
      clearCadetForm(panel);
      if (panel) panel.classList.add("hidden");
      return;
    }
    const fromFile = e.target.closest("[data-import-stream]");
    if (fromFile) {
      openGroupCadetsImport(
        fromFile.getAttribute("data-import-stream") || "",
        fromFile.getAttribute("data-import-group") || ""
      );
      return;
    }
    if (e.target.closest("[data-tpl-cadets]")) {
      downloadCadetsTemplate().catch(err => alert(err.message));
      return;
    }
  });
  $("streamsTree").addEventListener("change", e => {
    if (e.target && e.target.classList && e.target.classList.contains("cadet-check-all")) {
      const on = !!e.target.checked;
      const scope = e.target.closest(".tree-body") || e.target.closest(".tree-node");
      if (scope) scope.querySelectorAll("input.cadet-check").forEach(el => { el.checked = on; });
      syncCadetSelectionUi();
      return;
    }
    if (e.target && e.target.classList && e.target.classList.contains("cadet-check")) {
      syncCadetSelectionUi();
    }
  });
}

if ($("btnStreamsExpandAll")) $("btnStreamsExpandAll").onclick = () => setAllTreeOpen(true);
if ($("btnStreamsCollapseAll")) $("btnStreamsCollapseAll").onclick = () => setAllTreeOpen(false);
if ($("btnCadetsTemplate")) $("btnCadetsTemplate").onclick = () => downloadCadetsTemplate().catch(e => alert(e.message));
if ($("btnGroupsTemplate")) $("btnGroupsTemplate").onclick = () => downloadGroupsTemplate().catch(e => alert(e.message));
if ($("btnImportCadets")) $("btnImportCadets").onclick = () => importCadetsExcel().catch(e => alert(e.message));
if ($("btnImportGroups")) $("btnImportGroups").onclick = () => importGroupsExcel().catch(e => alert(e.message));
if ($("btnDelCadetsSelected")) $("btnDelCadetsSelected").onclick = () => deleteSelectedCadets().catch(e => alert(e.message));
if ($("btnClearMyCadets")) $("btnClearMyCadets").onclick = () => clearMyCadets().catch(e => alert(e.message));
if ($("btnCadetDupBack")) $("btnCadetDupBack").onclick = closeCadetDupModal;
if ($("cadetDupModal")) $("cadetDupModal").addEventListener("click", e => { if (e.target === $("cadetDupModal")) closeCadetDupModal(); });
if ($("btnCloseCadetImport")) $("btnCloseCadetImport").onclick = closeCadetImportModal;
if ($("cadetImportModal")) $("cadetImportModal").addEventListener("click", e => { if (e.target === $("cadetImportModal")) closeCadetImportModal(); });
