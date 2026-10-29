/* Roster / retake module. Loaded after admin-app.js, before flight boot. */

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

function closeRoster() {
  rosterSelectMode = false;
  $("rosterModal").classList.add("hidden");
}

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
if ($("btnCloseRosterDup")) $("btnCloseRosterDup").onclick = closeRosterDupModal;
if ($("rosterDupModal")) $("rosterDupModal").addEventListener("click", e => {
  if (e.target === $("rosterDupModal")) closeRosterDupModal();
});
$("btnCopyRosterLink").onclick = () => {
  if (!rosterLinkCache) return;
  const b = $("btnCopyRosterLink");
  copyText(rosterLinkCache).then(() => flashCopied(b)).catch(() => prompt("Скопируйте:", rosterLinkCache));
};
$("btnCloseRoster").onclick = closeRoster;
$("rosterModal").addEventListener("click", e => { if (e.target === $("rosterModal")) closeRoster(); });

