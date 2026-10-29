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

function fillTestsAuthorFilter() {
  const sel = $("filterTestsAuthor");
  if (!sel) return;
  const prev = sel.value || "";
  const map = new Map();
  (testsCache || []).forEach(t => {
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
  return (testsCache || []).filter(t => !authorId || testAuthorKey(t) === authorId);
}

function renderTestsHead() {
  if (!$("testsHead")) return;
  $("testsHead").innerHTML =
    thSortHtml(testsSort, "title", "Название") +
    thSortHtml(testsSort, "author", "Автор") +
    "<th>Ссылка / QR</th><th>Действия</th>";
}

function renderTestsTable() {
  fillTestsAuthorFilter();
  const filtered = visibleTests();
  const tests = filtered.slice().sort((a, b) =>
    cmpSortVal(testSortValue(a, testsSort.key), testSortValue(b, testsSort.key), testsSort.dir)
  );
  const total = (testsCache || []).length;
  if (total && tests.length !== total) {
    $("testsMeta").textContent = " · " + tests.length + " из " + total;
  } else {
    $("testsMeta").textContent = total ? (" · " + total) : "";
  }
  renderTestsHead();
  $("testsBody").innerHTML = tests.map(t => {
    const link = originLink("/t/" + t.id);
    const rc = t.roster_count != null ? t.roster_count : 0;
    const author = t.owner_name || t.owner_login || "—";
    const dept = t.department_name ? (" · " + t.department_name) : "";
    const own = canEditOwnTest(t);
    return `<tr class="${own ? "row-click" : ""}" ${own ? `data-edit-full="${esc(t.id)}" title="Открыть полное редактирование"` : ""}>
      <td>
        <b>${esc(t.title)}</b>
        <div class="test-meta">${testHeadlineMeta(t)}
          · курсантов: <b class="${rc ? "ok" : "warn"}">${esc(rc)}</b>
          · мастер-пароль: <b class="${t.has_master_password || t.master_password ? "ok" : "hint"}">${t.has_master_password || t.master_password ? "задан" : "общий"}</b>
          ${t.published_for_all ? ' · <b class="ok">в общем каталоге</b>' : ""}</div>
      </td>
      <td><div class="hint" style="margin:0">${esc(author)}${esc(dept)}</div></td>
      <td>
        <a class="linkbox" href="${link}" target="_blank" rel="noopener">${esc(link)}</a>
        <div class="row" style="margin-top:8px;align-items:flex-start">
          <img class="qr" src="${qrUrl(link)}" alt="QR">
          <p class="hint" style="margin:0;max-width:220px">Один QR на всех · доступ по номеру из списка курсантов</p>
        </div>
      </td>
      <td>
        <div class="test-actions">
          <button class="btn" type="button" data-copy="${encodeURIComponent(link)}">Копировать ссылку</button>
          <button class="btn" type="button" data-roster="${esc(t.id)}" data-title="${esc(t.title)}">Курсанты</button>
          ${canEditOwnTest(t) ? `<button class="btn main" type="button" data-edit-full="${esc(t.id)}">Редактировать</button>` : ""}
          ${canEditTestParams() ? `<button class="btn" type="button" data-edit-test="${esc(t.id)}">Параметры</button>` : ""}
          <button class="btn danger" type="button" data-del="${esc(t.id)}">Удалить</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="hint">${(testsCache || []).length ? "Нет тестов выбранного автора" : "Тестов пока нет"}</td></tr>`;
}

function renderCatalogTable() {
  const list = catalogCache || [];
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
        '» добавлен в ваш кабинет. Откройте «Курсанты» и раздайте ссылку.</span>';
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

