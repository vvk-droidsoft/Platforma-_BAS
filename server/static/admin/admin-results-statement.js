/* Ведомость результатов: модалка с мультифильтрами и выгрузка Excel. */

let rsOptions = null;
let rsLastPayload = null;
let rsSel = {
  streams: new Set(),
  groups: new Set(), // "stream::group"
  cadets: new Set(),
  tests: new Set()
};

function rsGroupKey(stream, group) {
  return String(stream || "").trim() + "::" + String(group || "").trim();
}

function rsParseGroupKey(key) {
  const i = String(key).indexOf("::");
  if (i < 0) return { stream_num: "", group_num: "" };
  return {
    stream_num: key.slice(0, i),
    group_num: key.slice(i + 2)
  };
}

function rsSetMsg(text, isErr) {
  const el = $("resultsStatementMsg");
  if (!el) return;
  el.innerHTML = text
    ? ('<span class="' + (isErr ? "bad" : "hint") + '">' + esc(text) + "</span>")
    : "";
}

function rsClosePanels(exceptId) {
  document.querySelectorAll("#resultsStatementModal .ms-dd-panel").forEach(p => {
    if (exceptId && p.id === exceptId) return;
    p.classList.add("hidden");
  });
}

function rsBindDd(btnId, panelId) {
  const btn = $(btnId);
  const panel = $(panelId);
  if (!btn || !panel || btn._rsBound) return;
  btn._rsBound = true;
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    const open = !panel.classList.contains("hidden");
    rsClosePanels();
    if (!open) panel.classList.remove("hidden");
  });
  panel.addEventListener("click", e => e.stopPropagation());
}

function rsSelectedGroups() {
  const opts = (rsOptions && rsOptions.groups) || [];
  if (rsSel.groups.size) {
    return opts.filter(g => rsSel.groups.has(rsGroupKey(g.stream_num, g.group_num)));
  }
  if (rsSel.streams.size) {
    return opts.filter(g => rsSel.streams.has(String(g.stream_num)));
  }
  return opts.slice();
}

function rsCadetPool() {
  const by = (rsOptions && rsOptions.cadets_by_group) || {};
  const map = new Map();
  rsSelectedGroups().forEach(g => {
    const key = rsGroupKey(g.stream_num, g.group_num);
    (by[key] || []).forEach(c => {
      if (!c || !c.num) return;
      if (!map.has(c.num)) map.set(c.num, c);
    });
  });
  return Array.from(map.values()).sort((a, b) => {
    const na = Number(a.num);
    const nb = Number(b.num);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a.num).localeCompare(String(b.num), "ru", { numeric: true });
  });
}

function rsBtnLabel(kind, count, total) {
  if (kind === "test") {
    if (!count) return "Выберите тесты";
    if (count === total) return "Все тесты (" + count + ")";
    return "Тесты: " + count;
  }
  if (kind === "stream") {
    if (!count) return "Все потоки";
    if (count === total) return "Все потоки (" + count + ")";
    return "Потоки: " + count;
  }
  if (kind === "group") {
    if (!count) return "Все группы";
    if (count === total) return "Все группы (" + count + ")";
    return "Группы: " + count;
  }
  if (!count) return "Все курсанты";
  if (count === total) return "Все курсанты (" + count + ")";
  return "Курсанты: " + count;
}

function rsRenderPanel(panelId, items, selectedSet, onChange, emptyText) {
  const panel = $(panelId);
  if (!panel) return;
  if (!items.length) {
    panel.innerHTML = '<div class="hint" style="padding:8px">' + esc(emptyText || "Нет данных") + "</div>";
    return;
  }
  panel.innerHTML = items.map(it => {
    const checked = selectedSet.has(it.value) ? " checked" : "";
    return (
      '<label class="ms-dd-item">' +
      '<input type="checkbox" value="' + esc(it.value) + '"' + checked + ">" +
      '<span>' + esc(it.label) + "</span>" +
      "</label>"
    );
  }).join("");
  panel.querySelectorAll('input[type="checkbox"]').forEach(inp => {
    inp.addEventListener("change", () => {
      if (inp.checked) selectedSet.add(inp.value);
      else selectedSet.delete(inp.value);
      onChange();
    });
  });
}

function rsSyncFilters() {
  const streams = (rsOptions && rsOptions.streams) || [];
  const groupsAll = (rsOptions && rsOptions.groups) || [];
  const tests = (rsOptions && rsOptions.tests) || [];

  // убрать группы вне выбранных потоков
  if (rsSel.streams.size) {
    Array.from(rsSel.groups).forEach(k => {
      const p = rsParseGroupKey(k);
      if (!rsSel.streams.has(p.stream_num)) rsSel.groups.delete(k);
    });
  }

  const groupItems = groupsAll
    .filter(g => !rsSel.streams.size || rsSel.streams.has(String(g.stream_num)))
    .map(g => ({
      value: rsGroupKey(g.stream_num, g.group_num),
      label: g.label || ("Поток " + g.stream_num + " · группа " + g.group_num)
    }));

  const cadets = rsCadetPool();
  const cadetNums = new Set(cadets.map(c => c.num));
  Array.from(rsSel.cadets).forEach(n => {
    if (!cadetNums.has(n)) rsSel.cadets.delete(n);
  });

  rsRenderPanel(
    "rsDdStreamPanel",
    streams.map(s => ({ value: String(s), label: "Поток " + s })),
    rsSel.streams,
    () => rsSyncFilters(),
    "Нет потоков"
  );
  rsRenderPanel(
    "rsDdGroupPanel",
    groupItems,
    rsSel.groups,
    () => rsSyncFilters(),
    "Нет групп"
  );
  rsRenderPanel(
    "rsDdCadetPanel",
    cadets.map(c => ({
      value: c.num,
      label: c.num + (c.callsign ? (" · " + c.callsign) : "") + (c.fio ? (" · " + c.fio) : "")
    })),
    rsSel.cadets,
    () => rsUpdateBtnLabels(),
    "Выберите группу"
  );
  rsRenderPanel(
    "rsDdTestPanel",
    tests.map(t => ({
      value: t.id,
      label: (t.label || t.title || t.id) + (t.title && t.label !== t.title ? (" — " + t.title) : "")
    })),
    rsSel.tests,
    () => rsUpdateBtnLabels(),
    "Нет тестов"
  );
  rsUpdateBtnLabels();
}

function rsUpdateBtnLabels() {
  const streams = (rsOptions && rsOptions.streams) || [];
  const groupsVisible = ((rsOptions && rsOptions.groups) || []).filter(
    g => !rsSel.streams.size || rsSel.streams.has(String(g.stream_num))
  );
  const cadets = rsCadetPool();
  const tests = (rsOptions && rsOptions.tests) || [];
  if ($("rsDdStreamBtn")) {
    $("rsDdStreamBtn").textContent = rsBtnLabel("stream", rsSel.streams.size, streams.length);
  }
  if ($("rsDdGroupBtn")) {
    $("rsDdGroupBtn").textContent = rsBtnLabel("group", rsSel.groups.size, groupsVisible.length);
  }
  if ($("rsDdCadetBtn")) {
    $("rsDdCadetBtn").textContent = rsBtnLabel("cadet", rsSel.cadets.size, cadets.length);
  }
  if ($("rsDdTestBtn")) {
    $("rsDdTestBtn").textContent = rsBtnLabel("test", rsSel.tests.size, tests.length);
  }
}

function rsBuildBody() {
  const groups = rsSelectedGroups().map(g => ({
    stream_num: g.stream_num,
    group_num: g.group_num
  }));
  const streams = rsSel.streams.size
    ? Array.from(rsSel.streams)
    : Array.from(new Set(groups.map(g => g.stream_num)));
  const cadet_nums = rsSel.cadets.size ? Array.from(rsSel.cadets) : [];
  const test_ids = Array.from(rsSel.tests);
  return { streams, groups, cadet_nums, test_ids };
}

function rsFmtAvg(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function rsRenderPreview(data) {
  const box = $("resultsStatementPreview");
  if (!box) return;
  const cols = (data && data.columns) || [];
  const tables = (data && data.tables) || [];
  if (!tables.length) {
    box.innerHTML = '<p class="hint">Нет данных по выбранным фильтрам.</p>';
    return;
  }
  box.innerHTML = tables.map(t => {
    const head = cols.map(c => "<th>" + esc(c.label || c.title || "Тест") + "</th>").join("");
    const body = (t.rows || []).map(r => {
      const grades = (r.grades || []).map(g =>
        "<td>" + (g == null || g === "" ? "" : esc(String(g))) + "</td>"
      ).join("");
      const cls = r.incomplete ? ' class="rs-incomplete"' : "";
      return (
        "<tr" + cls + ">" +
        "<td>" + esc(String(r.npp || "")) + "</td>" +
        "<td>" + esc(String(r.num || "")) + "</td>" +
        "<td>" + esc(String(r.callsign || "—")) + "</td>" +
        grades +
        "<td>" + esc(rsFmtAvg(r.average)) + "</td>" +
        "</tr>"
      );
    }).join("") || (
      '<tr><td colspan="' + (4 + cols.length) + '" class="hint">Нет курсантов</td></tr>'
    );
    return (
      '<div class="rs-table-block">' +
      '<div class="rs-table-title">' + esc(t.header_line || "") + "</div>" +
      '<div class="rs-table-period">' + esc(t.period_label || "Период не задан") + "</div>" +
      '<div class="scrollx"><table class="rs-preview-table">' +
      "<thead><tr>" +
      "<th>№ п/п</th><th>Номер</th><th>Позывной</th>" +
      head +
      "<th>Средний балл</th>" +
      "</tr></thead>" +
      "<tbody>" + body + "</tbody>" +
      "</table></div>" +
      "</div>"
    );
  }).join("");
}

async function openResultsStatement() {
  const modal = $("resultsStatementModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  rsSetMsg("Загрузка справочников…");
  rsLastPayload = null;
  if ($("btnResultsStatementSave")) $("btnResultsStatementSave").disabled = true;
  if ($("resultsStatementPreview")) $("resultsStatementPreview").innerHTML = "";
  if ($("resultsStatementSaveHint")) $("resultsStatementSaveHint").textContent = "";
  try {
    rsOptions = await api("/api/admin/results-statement/options");
    rsSel.streams = new Set();
    rsSel.groups = new Set();
    rsSel.cadets = new Set();
    rsSel.tests = new Set();
    rsSyncFilters();
    const nGroups = ((rsOptions && rsOptions.groups) || []).length;
    if (!nGroups) {
      rsSetMsg(
        rsOptions && rsOptions.scope === "assigned"
          ? "Нет групп в распределении, закреплённых за вашей учётной записью"
          : "В распределении пока нет групп",
        true
      );
    } else {
      rsSetMsg(
        rsOptions && rsOptions.scope === "assigned"
          ? "Показаны только ваши группы из распределения"
          : ""
      );
    }
  } catch (e) {
    rsSetMsg(e.message || String(e), true);
  }
}

function closeResultsStatement() {
  rsClosePanels();
  const modal = $("resultsStatementModal");
  if (modal) modal.classList.add("hidden");
}

async function buildResultsStatement() {
  const body = rsBuildBody();
  if (!body.test_ids.length) {
    rsSetMsg("Выберите хотя бы один тест", true);
    return;
  }
  if (!body.groups.length) {
    rsSetMsg("Выберите хотя бы одну группу", true);
    return;
  }
  rsSetMsg("Формирование…");
  if ($("btnResultsStatementSave")) $("btnResultsStatementSave").disabled = true;
  try {
    const data = await api("/api/admin/results-statement/preview", {
      method: "POST",
      json: body
    });
    rsLastPayload = body;
    rsRenderPreview(data);
    if ($("btnResultsStatementSave")) $("btnResultsStatementSave").disabled = false;
    const n = (data.tables || []).reduce((s, t) => s + ((t.rows && t.rows.length) || 0), 0);
    rsSetMsg("Готово: " + (data.tables || []).length + " табл., курсантов: " + n);
  } catch (e) {
    rsLastPayload = null;
    rsSetMsg(e.message || String(e), true);
  }
}

async function saveResultsStatementXlsx() {
  const body = rsLastPayload || rsBuildBody();
  if (!body.test_ids.length || !body.groups.length) {
    rsSetMsg("Сначала сформируйте ведомость", true);
    return;
  }
  const hint = $("resultsStatementSaveHint");
  if (hint) hint.textContent = "Сохранение…";
  const headers = { "Content-Type": "application/json" };
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  try {
    const r = await fetch("/api/admin/results-statement.xlsx", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(
        typeof data.detail === "string" ? data.detail : (data.message || r.status)
      );
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Ведомость_результатов.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
    if (hint) hint.textContent = "Файл сохранён";
  } catch (e) {
    if (hint) hint.textContent = "";
    rsSetMsg(e.message || String(e), true);
  }
}

function initResultsStatementUi() {
  if ($("btnResultsStatement")) {
    $("btnResultsStatement").addEventListener("click", () => {
      openResultsStatement().catch(() => {});
    });
  }
  if ($("btnResultsStatementClose")) {
    $("btnResultsStatementClose").addEventListener("click", closeResultsStatement);
  }
  if ($("btnResultsStatementBuild")) {
    $("btnResultsStatementBuild").addEventListener("click", () => {
      buildResultsStatement().catch(() => {});
    });
  }
  if ($("btnResultsStatementSave")) {
    $("btnResultsStatementSave").addEventListener("click", () => {
      saveResultsStatementXlsx().catch(() => {});
    });
  }
  rsBindDd("rsDdStreamBtn", "rsDdStreamPanel");
  rsBindDd("rsDdGroupBtn", "rsDdGroupPanel");
  rsBindDd("rsDdCadetBtn", "rsDdCadetPanel");
  rsBindDd("rsDdTestBtn", "rsDdTestPanel");
  document.addEventListener("click", () => rsClosePanels());
  const modal = $("resultsStatementModal");
  if (modal) {
    modal.addEventListener("click", e => {
      if (e.target === modal) closeResultsStatement();
    });
  }
}

initResultsStatementUi();
