/* Flight sheet + library module. Loaded after admin-app.js, boots the cabinet. */

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
  if (!isLibraryUser()) return;
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
  } catch {
    token = "";
    setCurrentUser(null);
    localStorage.removeItem("lisAdminToken");
    goHomeLogin();
  }
})();
