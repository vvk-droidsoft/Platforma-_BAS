/* Tests, catalog and grading module. Before flight boot. */

/** Шкала с сервера. Пока не загрузилась — те же пороги, что записаны в базе по умолчанию. */
let gradingRules = [
  { min: 80, grade: "5" },
  { min: 70, grade: "4" },
  { min: 60, grade: "3" },
  { min: 0, grade: "2" }
];

let editTestId = "";

let catalogCache = [];

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

function gradeForPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return "–";
  const rules = (gradingRules || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
  for (const rule of rules) {
    if (p >= Number(rule.min)) return String(rule.grade);
  }
  return rules.length ? String(rules[rules.length - 1].grade) : "–";
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

const TESTING_MODE_KEY = "lisTestingMode";

function isStaffAudience(aud) {
  const a = String(aud || "").trim();
  return (
    a === "Инструктор" ||
    a === "Ассистент инструктора" ||
    a === "Инструкторы и Ассистенты"
  );
}

function getTestingMode() {
  try {
    const m = localStorage.getItem(TESTING_MODE_KEY);
    if (m === "staff" || m === "cadets") return m;
  } catch (e) {}
  return "cadets";
}

function setTestingMode(mode) {
  const m = mode === "staff" ? "staff" : "cadets";
  try { localStorage.setItem(TESTING_MODE_KEY, m); } catch (e) {}
  syncTestingModeUi();
  if (typeof renderTestsTable === "function") renderTestsTable();
  if (typeof renderCatalogTable === "function") renderCatalogTable();
}

function testingModeAudience() {
  return getTestingMode() === "staff" ? "Инструкторы и Ассистенты" : "Курсант";
}

function testMatchesTestingMode(t) {
  const staff = isStaffAudience(t && t.audience);
  return getTestingMode() === "staff" ? staff : !staff;
}

function fillTestsAuthorFilter() {
  const sel = $("filterTestsAuthor");
  if (!sel) return;
  const prev = sel.value || "";
  const map = new Map();
  (testsCache || []).forEach(t => {
    if (!testMatchesTestingMode(t)) return;
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
  return (testsCache || []).filter(t => {
    if (!testMatchesTestingMode(t)) return false;
    if (authorId && testAuthorKey(t) !== authorId) return false;
    return true;
  });
}

function renderTestsHead() {
  if (!$("testsHead")) return;
  $("testsHead").innerHTML =
    thSortHtml(testsSort, "title", "Название") +
    "<th>Статус</th>" +
    thSortHtml(testsSort, "author", "Автор") +
    "<th></th>";
}

function testStatusChipsHtml(t) {
  const rc = t.roster_count != null ? t.roster_count : 0;
  const rosterLbl = audienceRosterLabel(t.audience);
  const q = testQuestionsLabel(t);
  const tm = testTimerLabel(t, "без таймера");
  const chips = [];
  chips.push('<span class="chip ' + (q ? "ok" : "warn") + '">' + esc(q || "вопросы: —") + "</span>");
  chips.push('<span class="chip ' + (t.timer_minutes != null ? "ok" : "") + '">' + esc(tm) + "</span>");
  chips.push('<span class="chip ' + (rc ? "ok" : "warn") + '">' + esc(rc + " · " + rosterLbl.toLowerCase()) + "</span>");
  if (t.has_master_password || t.master_password) {
    chips.push('<span class="chip">пароль задан</span>');
  }
  if (t.published_for_all) chips.push('<span class="chip ok">в каталоге</span>');
  return chips.join("");
}

function renderTestsTable() {
  fillTestsAuthorFilter();
  const filtered = visibleTests();
  const tests = filtered.slice().sort((a, b) =>
    cmpSortVal(testSortValue(a, testsSort.key), testSortValue(b, testsSort.key), testsSort.dir)
  );
  const modeTotal = (testsCache || []).filter(testMatchesTestingMode).length;
  if (modeTotal && tests.length !== modeTotal) {
    $("testsMeta").textContent = " · " + tests.length + " из " + modeTotal;
  } else {
    $("testsMeta").textContent = modeTotal ? (" · " + modeTotal) : "";
  }
  renderTestsHead();
  $("testsBody").innerHTML = tests.map(t => {
    const link = originLink("/t/" + t.id);
    const rosterLbl = audienceRosterLabel(t.audience);
    const author = t.owner_name || t.owner_login || "—";
    const dept = t.department_name ? (" · " + t.department_name) : "";
    const own = canEditOwnTest(t);
    const menuItems = [];
    if (own) {
      menuItems.push(`<button class="btn" type="button" data-edit-full="${esc(t.id)}">Править</button>`);
    }
    if (canEditTestParams()) {
      menuItems.push(`<button class="btn" type="button" data-edit-test="${esc(t.id)}">Параметры</button>`);
    }
    menuItems.push(`<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Открыть тест</a>`);
    menuItems.push(`<button class="btn danger" type="button" data-del="${esc(t.id)}">Удалить</button>`);
    return `<tr class="${own ? "row-click" : ""}" data-test-id="${esc(t.id)}" ${own ? `data-edit-full="${esc(t.id)}" title="Открыть редактирование"` : ""}>
      <td><b>${esc(t.title)}</b></td>
      <td class="test-chips">${testStatusChipsHtml(t)}</td>
      <td><div class="hint" style="margin:0">${esc(author)}${esc(dept)}</div></td>
      <td class="test-act">
        <div class="test-actions-row">
          <button class="btn btn-sq" type="button" data-copy="${encodeURIComponent(link)}" title="Копировать ссылку" aria-label="Копировать">⧉</button>
          <button class="btn btn-sq" type="button" data-show-qr="${esc(link)}" data-qr-title="${esc(t.title)}" title="QR-код" aria-label="QR">QR</button>
          <button class="btn btn-roster" type="button" data-roster="${esc(t.id)}" data-title="${esc(t.title)}" data-audience="${esc(t.audience || "")}">${esc(rosterLbl)}</button>
          <div class="test-menu">
            <button class="btn btn-sq" type="button" data-test-menu title="Ещё" aria-label="Ещё">⋯</button>
            <div class="test-menu-pop" hidden>${menuItems.join("")}</div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">${modeTotal ? "Нет тестов выбранного автора" : (getTestingMode() === "staff" ? "Тестов для инструкторов пока нет" : "Тестов для курсантов пока нет")}</td></tr>`;
  highlightTestFromUrl();
}

function closeAllTestMenus() {
  document.querySelectorAll(".test-menu-pop").forEach(p => {
    p.hidden = true;
    p.style.top = "";
    p.style.left = "";
    p.style.right = "";
  });
}

function placeTestMenu(btn, pop) {
  if (!btn || !pop) return;
  pop.hidden = false;
  pop.style.top = "0px";
  pop.style.left = "0px";
  const br = btn.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let top = br.bottom + 4;
  let left = br.right - pr.width;
  if (left < 8) left = 8;
  if (left + pr.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pr.width - 8);
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, br.top - pr.height - 4);
  pop.style.top = Math.round(top) + "px";
  pop.style.left = Math.round(left) + "px";
  pop.style.right = "auto";
}

function openTestQrModal(link, title) {
  if ($("testQrTitle")) $("testQrTitle").textContent = title || "QR-код теста";
  if ($("testQrImg")) $("testQrImg").src = qrUrl(link);
  if ($("testQrLink")) {
    $("testQrLink").textContent = link;
    $("testQrLink").href = link;
  }
  if ($("testQrModal")) $("testQrModal").classList.remove("hidden");
}

function closeTestQrModal() {
  if ($("testQrModal")) $("testQrModal").classList.add("hidden");
}

function highlightTestFromUrl() {
  let id = "";
  try { id = (new URLSearchParams(location.search).get("highlight") || "").trim(); } catch (e) {}
  if (!id || !$("testsBody")) return;
  const row = $("testsBody").querySelector('[data-test-id="' + id.replace(/"/g, "") + '"]');
  if (!row) return;
  row.style.outline = "2px solid var(--cyan)";
  row.style.background = "rgba(25,240,240,.08)";
  try { row.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { row.scrollIntoView(true); }
}

function renderCatalogTable() {
  // Каталог только для курсантов; чужие инструкторские сюда не показываем
  const list = (catalogCache || []).filter(t => !isStaffAudience(t.audience));
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
        '» добавлен в ваш кабинет. Откройте «' + esc(data.roster_label || audienceRosterLabel(data.audience) || "Курсанты") +
        '» и раздайте ссылку.</span>';
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
bindTableSort("testsHead", testsSort, renderTestsTable);
if ($("filterTestsAuthor")) $("filterTestsAuthor").onchange = () => renderTestsTable();
if ($("btnCloseEditTest")) $("btnCloseEditTest").onclick = closeEditTest;
if ($("btnCloseEditTest2")) $("btnCloseEditTest2").onclick = closeEditTest;
if ($("editTestModal")) $("editTestModal").addEventListener("click", e => {
  if (e.target === $("editTestModal")) closeEditTest();
});
if ($("btnSaveEditTest")) $("btnSaveEditTest").onclick = () => saveEditTest().catch(err => alert(err.message));

let createModuleAudience = "Курсант";

function canCreateAudienceTests() {
  if (!currentUser) return false;
  const role = currentUser.role;
  return role === "admin" || role === "senior" || role === "instructor" || role === "assistant";
}

function syncTestingModeUi() {
  const mode = getTestingMode();
  const staff = mode === "staff";
  createModuleAudience = testingModeAudience();
  document.querySelectorAll("[data-testing-mode]").forEach(btn => {
    const on = btn.getAttribute("data-testing-mode") === mode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const hint = $("testingModeHint");
  if (hint) {
    hint.textContent = staff
      ? "Режим инструкторов и ассистентов: создание теста и список «Мои тесты». Каталога обязательных модулей здесь нет."
      : "Режим курсантов: обязательные модули, промежуточные тесты, «Мои тесты» и результаты.";
  }
  const catalog = $("testingCatalogMod");
  if (catalog) catalog.hidden = staff;
  const myTitle = $("testingMyTestsTitle");
  if (myTitle) {
    myTitle.textContent = staff ? "Мои тесты (для инструкторов)" : "Мои тесты (для курсантов)";
  }
  const myHint = $("testingMyTestsHint");
  if (myHint) {
    myHint.textContent = staff
      ? "Тесты для инструкторского состава. Список допуска — из штатки. Свой тест можно править; ссылка не изменится."
      : "Тесты для курсантов. Список допуска — вручную или из Excel. Свой тест можно править; ссылка не изменится.";
  }
  const createTitle = $("testingCreateTitle");
  if (createTitle) {
    createTitle.textContent = staff ? "Создать тест для инструкторов" : "Создать тест для курсантов";
  }
  const createHint = $("testingCreateHint");
  const showHud = canCreateAudienceTests();
  const senior = canPublishForAll();
  if (createHint) {
    if (staff) {
      createHint.textContent = showHud
        ? "Создайте тест — он сохранится только в «Мои тесты (для инструкторов)». Разделения на обязательное и промежуточное нет."
        : "Откройте генератор с аудиторией «Инструкторы и Ассистенты».";
    } else if (senior) {
      createHint.textContent =
        "Выберите тип ниже: обязательное — в каталог; промежуточное — только в «Мои тесты (для курсантов)».";
    } else if (showHud) {
      createHint.textContent =
        "Создайте промежуточный тест для курсантов — он появится в «Мои тесты (для курсантов)».";
    } else {
      createHint.textContent = "Откройте генератор с аудиторией «Курсант».";
    }
  }
  const cadetBranches = $("testingCadetBranches");
  const actions = $("testingCreateActions");
  const def = $("testingCreateDefault");
  const defLink = $("testingCreateDefaultLink");
  const btn = $("btnCreateTestInMode");
  const mandatory = $("btnBranchMandatory");
  const interim = $("btnBranchInterim");
  // Курсанты: две кнопки типа прямо во вкладке; без дублирующей «Создать тест…»
  if (cadetBranches) cadetBranches.style.display = (!staff && showHud) ? "" : "none";
  if (actions) actions.style.display = (staff && showHud) ? "" : "none";
  if (def) def.style.display = showHud ? "none" : "";
  if (btn) btn.textContent = "Создать тест для инструкторов";
  if (mandatory) {
    const allowMandatory = !staff && senior;
    mandatory.hidden = !allowMandatory;
    mandatory.disabled = !allowMandatory;
  }
  if (interim) {
    interim.hidden = staff || !showHud;
    interim.disabled = staff || !showHud;
  }
  if (defLink) {
    defLink.href = staff
      ? "/tools/generator?audience=" + encodeURIComponent("Инструкторы и Ассистенты")
      : "/tools/generator?audience=" + encodeURIComponent("Курсант");
  }
  if ($("testingMeta")) {
    $("testingMeta").textContent = staff ? " · инструкторы" : " · курсанты";
  }
}

function openCreateModuleWizard(kind) {
  createModuleAudience = testingModeAudience();
  const k = kind === "mandatory" ? "mandatory" : "interim";
  if (k === "mandatory" && (createModuleAudience !== "Курсант" || !canPublishForAll())) return;
  const modal = $("createModuleTestModal");
  const wizard = $("createModuleWizardStep");
  const frame = $("createModuleTestFrame");
  const title = $("createModuleTestTitle");
  const sub = $("createModuleTestSub");
  if (!frame || !modal) return;
  if (wizard) wizard.classList.remove("hidden");
  if (title) {
    title.textContent = createModuleAudience === "Курсант"
      ? "Тестирование для курсантов"
      : "Тестирование инструкторского состава";
  }
  if (sub) {
    if (createModuleAudience !== "Курсант") {
      sub.textContent = "Создание теста · сохранится в «Мои тесты (для инструкторов)»";
    } else {
      sub.textContent = (k === "mandatory" ? "Обязательное модульное · " : "Промежуточное · ") +
        "для курсантов";
    }
  }
  const qs = new URLSearchParams({
    cabinet: "1",
    wizard: "1",
    kind: k,
    audience: createModuleAudience
  });
  frame.src = "/tools/generator?" + qs.toString();
  modal.classList.remove("hidden");
}

function closeCreateModuleTestModal() {
  const modal = $("createModuleTestModal");
  const frame = $("createModuleTestFrame");
  if (modal) modal.classList.add("hidden");
  if (frame) frame.src = "about:blank";
}

if ($("testingModeBar")) {
  $("testingModeBar").addEventListener("click", e => {
    const btn = e.target.closest("[data-testing-mode]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    setTestingMode(btn.getAttribute("data-testing-mode"));
  });
}
if ($("btnCreateTestInMode")) {
  $("btnCreateTestInMode").onclick = () => openCreateModuleWizard("interim");
}
if ($("btnBranchMandatory")) {
  $("btnBranchMandatory").onclick = () => openCreateModuleWizard("mandatory");
}
if ($("btnBranchInterim")) {
  $("btnBranchInterim").onclick = () => openCreateModuleWizard("interim");
}
if ($("btnCloseCreateModuleTest")) {
  $("btnCloseCreateModuleTest").onclick = closeCreateModuleTestModal;
}
if ($("createModuleTestModal")) {
  $("createModuleTestModal").addEventListener("click", e => {
    if (e.target === $("createModuleTestModal")) closeCreateModuleTestModal();
  });
}
window.addEventListener("message", event => {
  if (event.origin !== location.origin) return;
  const data = event.data || {};
  if (data.type !== "lis-generator-done") return;
  const id = data.id ? String(data.id) : "";
  // После создания всегда остаёмся в текущем режиме; каталог только у курсантов
  if (data.kind === "mandatory" && getTestingMode() === "cadets") {
    setTestingMode("cadets");
  } else if (createModuleAudience !== "Курсант") {
    setTestingMode("staff");
  }
  const openKeys = ["testing", "tests"];
  if (data.kind === "mandatory" && getTestingMode() === "cadets") {
    openKeys.push("upload");
  }
  try {
    const url = new URL(location.href);
    url.searchParams.set("open", openKeys.join(","));
    if (id) url.searchParams.set("highlight", id);
    else url.searchParams.delete("highlight");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (e) {}
  if (typeof setModOpen === "function") {
    try {
      openKeys.forEach(k => setModOpen(k, true));
      if (typeof saveModState === "function") saveModState();
    } catch (e) {}
  }
  const after = typeof refresh === "function" ? refresh().catch(() => {}) : Promise.resolve();
  after.finally(() => {
    setTimeout(() => closeCreateModuleTestModal(), 450);
  });
});
syncTestingModeUi();
document.addEventListener("lis-user-ready", syncTestingModeUi);

