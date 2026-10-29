const $ = id => document.getElementById(id);
let token = localStorage.getItem("lisAdminToken") || "";
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem("lisAdminUser") || "null"); } catch (e) { currentUser = null; }
let attemptsCache = [];
let attemptsAllCache = [];
let rosterTestId = "";
let rosterCache = [];
let rosterSelectMode = false;
let retakesCache = [];
let rosterLinkCache = "";
let resultsSort = { key: "when", dir: -1 };
let usersCache = [];
let testsCache = [];
let accSort = { key: "dep", dir: 1 };
let depSort = { key: "name", dir: 1 };
let staffSort = { key: "dep", dir: 1 };
let depModalSort = { key: "role", dir: 1 };
let cadetsSort = { key: "npp", dir: 1 };
let testsSort = { key: "title", dir: 1 };
let rosterSort = { key: "npp", dir: 1 };
let staffCache = [];
let depCache = [];
let cadetsCache = [];
let cadetEditId = "";
const MOD_STATE_KEY = "lisAdminModState";

async function api(path, opts={}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
  if (opts.json) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.message || r.status));
  return data;
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function isFlightSheetUser() {
  if (!currentUser) return false;
  const wanted = "си_тестер";
  const login = String(currentUser.login || "").trim().toLowerCase();
  const name = String(currentUser.display_name || "").trim().toLowerCase();
  return login === wanted || name === wanted;
}
function setCurrentUser(u) {
  currentUser = u || null;
  if (currentUser) localStorage.setItem("lisAdminUser", JSON.stringify(currentUser));
  else localStorage.removeItem("lisAdminUser");
  updateUserBar();
  document.querySelectorAll(".admin-only").forEach(el => {
    el.hidden = !isAdmin();
  });
  document.querySelectorAll(".flight-sheet-only, .library-only").forEach(el => {
    el.hidden = !isFlightSheetUser();
  });
}

function updateUserBar() {
  const bar = $("userBar");
  const btnPw = $("btnChangePw");
  if (!currentUser) {
    bar.classList.add("hidden");
    btnPw.classList.add("hidden");
    bar.textContent = "";
    return;
  }
  const parts = [currentUser.display_name || currentUser.login, currentUser.role_label || currentUser.role];
  bar.textContent = parts.filter(Boolean).join(" · ");
  bar.classList.remove("hidden");
  btnPw.classList.remove("hidden");
}

function goHomeLogin() {
  location.replace("/login");
}

function showApp(ok, forcePw) {
  if (!ok) {
    goHomeLogin();
    return;
  }
  $("pwBox").classList.add("hidden");
  $("app").classList.toggle("hidden", !!forcePw);
  $("btnLogout").classList.toggle("hidden", false);
  $("btnChangePw").classList.toggle("hidden", false);
  if (forcePw) {
    $("pwBox").classList.remove("hidden");
    $("pwHint").textContent = "Задан временный пароль — установите свой, чтобы продолжить.";
    $("btnPwCancel").classList.add("hidden");
  } else if ($("btnPwCancel")) {
    $("btnPwCancel").classList.remove("hidden");
  }
}

async function savePassword() {
  $("pwMsg").textContent = "";
  if ($("pwNew").value !== $("pwNew2").value) {
    $("pwMsg").innerHTML = '<span class="bad">Пароли не совпадают</span>';
    return;
  }
  try {
    const res = await api("/api/admin/change-password", {
      method: "POST",
      json: { old_password: $("pwOld").value, new_password: $("pwNew").value }
    });
    token = res.token;
    localStorage.setItem("lisAdminToken", token);
    setCurrentUser(res.user);
    $("pwOld").value = "";
    $("pwNew").value = "";
    $("pwNew2").value = "";
    showApp(true);
    initModules();
    await refresh();
    if (isAdmin()) await refreshOrg().catch(() => {});
  } catch (e) {
    $("pwMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

function loadModState() {
  try { return JSON.parse(localStorage.getItem(MOD_STATE_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function saveModState() {
  const st = {};
  document.querySelectorAll("#app .mod[data-mod]").forEach(mod => {
    st[mod.dataset.mod] = !mod.classList.contains("collapsed");
  });
  try { localStorage.setItem(MOD_STATE_KEY, JSON.stringify(st)); } catch (e) {}
}
function applyModState() {
  const st = loadModState();
  document.querySelectorAll("#app .mod[data-mod]").forEach(mod => {
    const key = mod.dataset.mod;
    if (Object.prototype.hasOwnProperty.call(st, key)) {
      mod.classList.toggle("collapsed", !st[key]);
    }
    const head = mod.querySelector(".mod-head");
    if (head) head.setAttribute("aria-expanded", mod.classList.contains("collapsed") ? "false" : "true");
  });
}
function initModules() {
  applyModState();
  document.querySelectorAll("#app .mod-head").forEach(head => {
    if (head._lisModBound) return;
    head._lisModBound = true;
    head.addEventListener("click", () => {
      const mod = head.closest(".mod");
      if (!mod) return;
      mod.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", mod.classList.contains("collapsed") ? "false" : "true");
      saveModState();
    });
  });
}

function attemptStatusHtml(a) {
  if (!a || a._phantom) {
    return '<span class="hint">не проходил тестирование</span>';
  }
  // Таймер важнее оценки: неотвеченные вопросы = не уложился по времени
  const unanswered = attemptUnanswered(a);
  if (unanswered > 0) {
    return '<span class="badge-timeout">не успел ответить на ' + esc(questionsCountPhrase(unanswered)) + "</span>";
  }
  if (a.status === "continue") {
    return '<span class="warn">разрешена досдача</span>';
  }
  if (a.status === "unlocked") {
    return '<span class="warn">разрешена пересдача</span>';
  }
  const g = Number(String(a.grade || "").replace(",", "."));
  if (Number.isFinite(g) && g >= 3) return '<span class="badge-ok">сдан</span>';
  if (String(a.grade || "").trim() === "2" || g === 2) return '<span class="badge-fail">не сдал</span>';
  if (a.status === "finished") {
    return g >= 3 ? '<span class="badge-ok">сдан</span>' : '<span class="badge-fail">не сдал</span>';
  }
  return '<span class="hint">' + esc(a.status || "—") + "</span>";
}

function attemptSortValue(a, key) {
  const total = (a.total != null && a.total > 0) ? a.total
    : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : 0);
  switch (key) {
    case "test": return (a.test_title || "").toString().toLowerCase();
    case "num": {
      const n = Number(a.student_num);
      return Number.isFinite(n) ? n : (a.student_num || "").toString().toLowerCase();
    }
    case "call": return (a.callsign || "").toString().toLowerCase();
    case "score": return a.score != null ? Number(a.score) : -1;
    case "percent": return a.percent != null ? Number(a.percent) : -1;
    case "duration": return a.duration_sec != null ? Number(a.duration_sec) : -1;
    case "grade": return (a.grade || "").toString().toLowerCase();
    case "status": return (a.status || "").toString().toLowerCase();
    case "when": return (a.finished_at || a.created_at || "");
    case "total": return total;
    default: return "";
  }
}

function normFilterLabel(v) {
  return String(v == null ? "" : v).trim();
}

function uniqueFilterLabels(items, getter) {
  const set = new Set();
  (items || []).forEach(item => {
    const v = normFilterLabel(getter(item));
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" }));
}

function fillFilterSelect(selId, values, allLabel) {
  const sel = $(selId);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>` +
    (values || []).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  sel.value = (values || []).indexOf(cur) >= 0 ? cur : "";
}

function matchStreamGroup(item, streamSelId, groupSelId) {
  const streamF = normFilterLabel($(streamSelId) && $(streamSelId).value);
  const groupF = normFilterLabel($(groupSelId) && $(groupSelId).value);
  const stream = normFilterLabel(item.stream_num);
  const group = normFilterLabel(item.group_num);
  if (streamF && stream !== streamF) return false;
  if (groupF && group !== groupF) return false;
  return true;
}

function syncResultsFilters() {
  const testId = ($("filterTest") && $("filterTest").value) || "";
  let base = attemptsAllCache || [];
  if (testId) base = base.filter(a => a.test_id === testId);
  const streamF = normFilterLabel($("filterResultsStream") && $("filterResultsStream").value);
  fillFilterSelect("filterResultsStream", uniqueFilterLabels(base, x => x.stream_num), "Все потоки");
  if (streamF && base.some(a => normFilterLabel(a.stream_num) === streamF)) {
    $("filterResultsStream").value = streamF;
  }
  const forGroups = streamF
    ? base.filter(a => normFilterLabel(a.stream_num) === streamF)
    : base;
  fillFilterSelect("filterResultsGroup", uniqueFilterLabels(forGroups, x => x.group_num), "Все группы");
}

let resultsRosterCache = [];
let resultsSearchQ = "";

function attemptSearchBlob(a) {
  const c = cadetLookupByNum(a.student_num);
  const parts = [
    a.student_num,
    a.callsign,
    a.full_name,
    a.group_num,
    a.stream_num,
    a.test_title,
    c && c.student_num,
    c && c.callsign,
    c && c.full_name,
    c && c.group_num,
    c && c.stream_num
  ];
  return parts
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase())
    .join("\n");
}

function attemptMatchesSearch(a, q) {
  if (!q) return true;
  const blob = attemptSearchBlob(a);
  if (blob.includes(q)) return true;
  // совпадение по отдельным полям целиком (номер / позывной)
  const fields = [
    cadetKey(a),
    String(a.callsign || "").trim().toLowerCase(),
    String(a.full_name || "").trim().toLowerCase()
  ];
  const c = cadetLookupByNum(a.student_num);
  if (c) {
    fields.push(
      cadetKey(c),
      String(c.callsign || "").trim().toLowerCase(),
      String(c.full_name || "").trim().toLowerCase()
    );
  }
  return fields.some(f => f && (f === q || f.includes(q)));
}

function applyResultsSearch() {
  resultsSearchQ = (($("resultsSearch") && $("resultsSearch").value) || "").trim().toLowerCase();
  const hint = $("resultsSearchHint");
  renderAttempts();
  if (hint) {
    if (!resultsSearchQ) {
      hint.textContent = "";
    } else {
      const n = (attemptsCache || []).length;
      hint.textContent = n ? ("Найдено: " + n) : "Совпадений нет";
    }
  }
}

function filteredAttempts() {
  let list = (attemptsAllCache || []).slice();
  const testId = ($("filterTest") && $("filterTest").value) || "";
  const cadet = ($("filterCadet") && $("filterCadet").value) || "";
  const searching = !!resultsSearchQ;

  // при поиске показываем все тесты/попытки по идентификатору
  if (!searching) {
    if (testId) list = list.filter(a => a.test_id === testId);
    if (cadet) list = list.filter(a => cadetKey(a) === cadet);
  }
  list = list.filter(a => matchStreamGroup(a, "filterResultsStream", "filterResultsGroup"));

  // при фильтре по тесту (без поиска) — добавить курсантов из roster без попытки
  if (!searching && testId && resultsRosterCache && resultsRosterCache.length) {
    const have = new Set(list.map(a => cadetKey(a)));
    const t = (testsCache || []).find(x => x.id === testId);
    resultsRosterCache.forEach(r => {
      const num = cadetKey(r);
      if (!num || have.has(num)) return;
      const phantom = {
        _phantom: true,
        id: "roster:" + testId + ":" + num,
        test_id: testId,
        test_title: t ? t.title : "",
        student_num: r.student_num,
        callsign: r.roster_callsign || r.callsign || "",
        full_name: r.full_name || "",
        group_num: r.group_num || "",
        stream_num: r.stream_num || "",
        status: "",
        grade: "",
        score: null,
        percent: null,
        duration_sec: null,
        answers: []
      };
      if (cadet && cadetKey(phantom) !== cadet) return;
      if (!matchStreamGroup(phantom, "filterResultsStream", "filterResultsGroup")) return;
      list.push(phantom);
    });
  }

  if (searching) {
    // номера/позывные/ФИО из справочника курсантов, подходящие под запрос
    const matchedNums = new Set();
    (cadetsCache || []).forEach(c => {
      const blob = [
        c.student_num, c.callsign, c.full_name, c.group_num, c.stream_num
      ].filter(Boolean).map(v => String(v).trim().toLowerCase()).join("\n");
      if (blob.includes(resultsSearchQ)) matchedNums.add(cadetKey(c));
    });
    list = list.filter(a =>
      attemptMatchesSearch(a, resultsSearchQ) || matchedNums.has(cadetKey(a))
    );
  }
  return list;
}

function fillCadetFilter() {
  const sel = $("filterCadet");
  if (!sel) return;
  const testId = ($("filterTest") && $("filterTest").value) || "";
  let source = attemptsAllCache || [];
  if (testId) source = source.filter(a => a.test_id === testId);
  const map = new Map();
  source.forEach(a => {
    const k = cadetKey(a);
    if (!k || map.has(k)) return;
    const call = (a.callsign || "").trim();
    map.set(k, call ? ("№" + k + " · " + call) : ("№" + k));
  });
  const cur = sel.value;
  const opts = Array.from(map.entries()).sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]), "ru", { numeric: true })
  );
  sel.innerHTML = '<option value="">Все курсанты</option>' +
    opts.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join("");
  sel.value = map.has(cur) ? cur : "";
}

function renderAttemptsHead(hideTest) {
  const cols = [
    { key: "test", label: "Тест", hide: hideTest, cls: "th-test" },
    { key: "num", label: "Номер", cls: "th-num" },
    { key: "call", label: "Позывной", cls: "th-call" },
    { key: "score", label: "Баллы", cls: "th-score" },
    { key: "percent", label: "%" },
    { key: "duration", label: '<span class="th-stack">Время<br>прохождения</span>', cls: "th-duration" },
    { key: "grade", label: "Оценка", cls: "th-grade" },
    { key: "status", label: "Статус" },
    { key: "when", label: "Когда" },
    { key: "", label: "" }
  ];
  $("attemptsHead").innerHTML = cols.map(c => {
    if (c.hide) return "";
    if (!c.key) return "<th></th>";
    const extra = ["center", c.cls].filter(Boolean).join(" ");
    return thSortHtml(resultsSort, c.key, c.label).replace(
      'class="sortable"',
      'class="sortable ' + extra + '"'
    );
  }).join("");
}

function sortedAttempts(list) {
  const arr = (list || []).slice();
  const { key, dir } = resultsSort;
  arr.sort((a, b) => cmpSortVal(attemptSortValue(a, key), attemptSortValue(b, key), dir));
  return arr;
}

function renderAttempts() {
  syncResultsFilters();
  const hideTest = !resultsSearchQ && !!($("filterTest") && $("filterTest").value);
  renderAttemptsHead(hideTest);
  const rows = sortedAttempts(filteredAttempts());
  attemptsCache = rows;
  $("resultsMeta").textContent = rows.length ? (" · " + rows.length) : "";
  const colCount = hideTest ? 9 : 10;
  $("attemptsBody").innerHTML = rows.map(a => {
    const st = attemptStatusHtml(a);
    const unlockBtn = a.status === "finished" && !a._phantom
      ? `<button class="btn" type="button" data-unlock="${esc(a.test_id)}" data-num="${esc(a.student_num)}" data-call="${esc(a.callsign)}">Пароль пересдачи</button>`
      : "";
    const total = (a.total != null && a.total > 0) ? a.total
      : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : a.total);
    const gCls = gradeClass(a.grade);
    const detailBtn = a._phantom ? ""
      : `<button class="linkish" type="button" data-detail="${esc(a.id)}" title="${esc(a.test_title || "Подробнее")}">${esc(a.test_title || "Подробнее")}</button>`;
    const testCell = hideTest ? ""
      : `<td class="td-test">${a._phantom ? esc(a.test_title || "—") : detailBtn}</td>`;
    const timeoutMark = (a.timed_out || attemptUnanswered(a) > 0)
      ? ' <span class="badge-timeout" title="Не уложился по времени">⏱</span>' : "";
    return `<tr>
      ${testCell}
      <td class="td-num center">${esc(a.student_num)}</td>
      <td class="td-call center">${esc(a.callsign || "—")}</td>
      <td class="td-score center">${a.score != null ? a.score + "/" + (total != null ? total : "—") : "—"}</td>
      <td class="center">${a.percent != null ? a.percent + "%" : "—"}</td>
      <td class="td-duration center">${esc(formatDuration(a.duration_sec))}</td>
      <td class="td-grade center"><b class="${gCls}">${esc(a.grade || "—")}</b>${timeoutMark}</td>
      <td class="center">${st}</td>
      <td class="center">${esc((a.finished_at || a.created_at || "").replace("T"," ").slice(0,19) || "—")}</td>
      <td>${unlockBtn || (!a._phantom && hideTest ? `<button class="linkish" type="button" data-detail="${esc(a.id)}">Подробнее</button>` : "")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="${colCount}" class="hint">${(attemptsAllCache || []).length ? "Нет результатов по фильтру" : "Результатов пока нет"}</td></tr>`;
}

async function refresh() {
  await loadGrading().catch(() => {});
  testsCache = await api("/api/tests");
  renderTestsTable();
  await refreshCatalog().catch(() => {});

  const sel = $("filterTest");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Все тесты</option>` + (testsCache || []).map(t =>
    `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("");
  sel.value = cur;

  attemptsAllCache = await api("/api/admin/attempts");
  fillCadetFilter();
  renderAttempts();
  try { await refreshCadets(); } catch (e) {}
  if (isFlightSheetUser()) {
    try { await loadFlightSheet(); } catch (e) {}
    try { await loadLibrary(); } catch (e) {}
  }
}

let detailAttempt = null;

function renderAnswerBlock(ans, idx) {
  const ok = answerIsCorrect(ans);
  const none = ans.pick == null;
  const cls = ok ? "ok" : (none ? "" : "bad");
  const mark = ok ? '<span class="ok">верно</span>'
    : (none ? '<span class="hint">нет ответа</span>' : '<span class="bad">неверно</span>');
  const opts = Array.isArray(ans.a) ? ans.a : [];
  let list = "";
  if (opts.length) {
    list = "<ul>" + opts.map((text, j) => {
      const n = j + 1;
      let liCls = "";
      if (ans.correct != null && n === Number(ans.correct)) liCls = "right";
      if (ans.pick != null && n === Number(ans.pick)) {
        liCls = (ans.correct != null && n === Number(ans.correct)) ? "right" : "wrongpick";
      }
      const prefix = (ans.pick != null && n === Number(ans.pick)) ? "→ " : "";
      const suffix = (ans.correct != null && n === Number(ans.correct)) ? " ✓" : "";
      return `<li class="${liCls}">${prefix}${esc(text)}${suffix}</li>`;
    }).join("") + "</ul>";
  } else {
    const bits = [];
    if (ans.pickText) bits.push("Ответ курсанта: " + esc(ans.pickText));
    else if (ans.pick != null) bits.push("Ответ курсанта: вариант " + esc(ans.pick));
    if (ans.correctText) bits.push("Верный: " + esc(ans.correctText));
    else if (ans.correct != null) bits.push("Верный: вариант " + esc(ans.correct));
    list = bits.length ? `<p class="hint">${bits.join(" · ")}</p>` : '<p class="hint">Текст вариантов не сохранён</p>';
  }
  return `<div class="ans ${cls}">
    <div class="qi">Вопрос ${esc(ans.i != null ? ans.i : idx + 1)} · ${mark}</div>
    <div class="qt">${esc(ans.q || "—")}</div>
    ${list}
  </div>`;
}

function openAnsList(kind) {
  if (!detailAttempt) return;
  const parts = classifyDetailAnswers(detailAttempt.answers);
  let title = "";
  let items = [];
  if (kind === "answered") {
    title = "Успел ответить · " + questionsCountPhrase(parts.answered.length);
    items = parts.answered;
  } else if (kind === "unanswered") {
    title = "Не успел ответить · " + questionsCountPhrase(parts.unanswered.length);
    items = parts.unanswered;
  } else if (kind === "correct") {
    title = "Правильных ответов · " + parts.correct.length;
    items = parts.correct;
  } else if (kind === "wrong") {
    title = "Неправильных ответов · " + parts.wrong.length;
    items = parts.wrong;
  }
  $("ansListTitle").textContent = title;
  $("ansListBody").innerHTML = items.length
    ? items.map((a, i) => renderAnswerBlock(a, i)).join("")
    : '<p class="hint">Список пуст</p>';
  $("ansListModal").classList.remove("hidden");
}

function closeAnsList() {
  $("ansListModal").classList.add("hidden");
}

async function openDetail(id) {
  let a = attemptsCache.find(x => x.id === id);
  try {
    a = await api("/api/admin/attempts/" + encodeURIComponent(id));
  } catch (e) {
    if (!a) { alert(e.message); return; }
  }
  detailAttempt = a;
  $("detailTitle").textContent = a.test_title || "Подробности теста";
  $("detailSub").textContent = "Номер " + (a.student_num || "—") + " · Позывной " + (a.callsign || "—");
  const when = (a.finished_at || a.created_at || "").replace("T", " ").slice(0, 19);
  const total = (a.total != null && a.total > 0) ? a.total
    : (Array.isArray(a.answers) && a.answers.length ? a.answers.length : "—");
  const parts = classifyDetailAnswers(a.answers);
  const okN = parts.correct.length;
  const badAnsweredN = parts.wrong.length;
  const unansweredN = parts.unanswered.length;
  const badWithSkipN = badAnsweredN + unansweredN;
  const totalForGrade = okN + badWithSkipN;
  const percentWithSkip = totalForGrade > 0 ? Math.round(okN / totalForGrade * 100) : null;
  const gradeWithSkip = percentWithSkip != null ? gradeForPercent(percentWithSkip) : "–";
  const statusNode = document.createElement("div");
  statusNode.innerHTML = attemptStatusHtml(a);
  $("detailMeta").innerHTML = [
    ["Баллы", a.score != null ? (a.score + " / " + total) : "—"],
    ["Процент", percentWithSkip != null ? percentWithSkip + "%" : (a.percent != null ? a.percent + "%" : "—")],
    ["Время прохождения", formatDuration(a.duration_sec)],
    ["Когда", when || "—"]
  ].map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join("") +
    `<div><b>Статус</b>${statusNode.innerHTML}</div>` +
    (a.timed_out || unansweredN > 0
      ? '<div><b>Пометка</b><span class="badge-timeout">Не уложился по времени</span></div>' : "") +
    (a.grade_manual ? '<div><b>Оценка</b><span class="hint">изменена преподавателем</span></div>' : "");

  const shownGrade = a.grade_manual ? (a.grade || gradeWithSkip) : (gradeWithSkip !== "–" ? gradeWithSkip : (a.grade || "–"));
  const gradeEditAllowed = canEditGrade();
  if ($("detailGradeEdit")) {
    $("detailGradeEdit").value = shownGrade === "–" ? "" : shownGrade;
    $("detailGradeEdit").readOnly = !gradeEditAllowed;
    $("detailGradeEdit").disabled = !gradeEditAllowed;
    $("detailGradeEdit").title = gradeEditAllowed ? "" : "Менять оценку могут администратор и старший инструктор";
  }
  if ($("btnSaveDetailGrade")) $("btnSaveDetailGrade").hidden = !gradeEditAllowed;
  if ($("detailGradeMsg")) $("detailGradeMsg").textContent = "";
  if ($("detailContinueMsg")) $("detailContinueMsg").textContent = "";
  const contBox = $("detailContinueBox");
  if (contBox) {
    contBox.style.display = unansweredN > 0 ? "flex" : "none";
    if ($("detailContinueMin")) {
      $("detailContinueMin").value = a.continue_minutes || 10;
    }
  }

  if ($("detailStats")) {
    const ratioAnswered = formatRatioPct(okN, badAnsweredN);
    const ratioWithSkip = formatRatioPct(okN, badWithSkipN);
    const gradeCls = /^[2-5]$/.test(String(shownGrade)) ? ("grade-" + shownGrade) : "";
    $("detailStats").innerHTML =
      `<button type="button" class="stat-chip" data-ans-list="answered"><b>Успел ответить</b><span>на ${esc(questionsCountPhrase(parts.answered.length))}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="unanswered"><b>Не успел ответить</b><span>на ${esc(questionsCountPhrase(unansweredN))}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="correct"><b>Правильных ответов</b><span>${esc(okN)}</span></button>` +
      `<button type="button" class="stat-chip" data-ans-list="wrong"><b>Неправильных ответов</b><span>${esc(badAnsweredN)}</span></button>` +
      `<div class="stat-chip-break" aria-hidden="true"></div>` +
      `<div class="stat-chip stat-ratio">` +
        `<div class="stat-ratio-dual">` +
          `<div class="ratio-title">Соотношение правильных и неправильных ответов</div>` +
          `<div class="ratio-cols">` +
            `<div class="ratio-col left">` +
              `<div class="ratio-label">С учётом неотвеченных</div>` +
              `<div class="ratio-vals">${ratioWithSkip}</div>` +
            `</div>` +
            `<div class="ratio-col center">` +
              `<div class="ratio-grade-big ${gradeCls}">${esc(shownGrade)}</div>` +
            `</div>` +
            `<div class="ratio-col right">` +
              `<div class="ratio-label">Из отвеченных</div>` +
              `<div class="ratio-vals">${ratioAnswered}</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>`;
  }

  const answers = Array.isArray(a.answers) ? a.answers : [];
  if (!answers.length) {
    $("detailAnswers").innerHTML = '<p class="hint">Подробные ответы не сохранены для этой попытки.</p>';
  } else {
    $("detailAnswers").innerHTML = '<h2 style="margin-top:8px">Все вопросы</h2>' +
      answers.map((ans, idx) => renderAnswerBlock(ans, idx)).join("");
  }
  $("detailModal").classList.remove("hidden");
}

async function saveDetailGrade() {
  if (!detailAttempt || !detailAttempt.id) return;
  if (!canEditGrade()) {
    $("detailGradeMsg").innerHTML = '<span class="bad">Менять оценку могут администратор и старший инструктор</span>';
    return;
  }
  const grade = ($("detailGradeEdit") && $("detailGradeEdit").value || "").trim();
  if (!grade) {
    $("detailGradeMsg").innerHTML = '<span class="bad">Укажите оценку</span>';
    return;
  }
  $("detailGradeMsg").textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/attempts/" + encodeURIComponent(detailAttempt.id) + "/grade", {
      method: "PUT",
      json: { grade }
    });
    detailAttempt = res.attempt || detailAttempt;
    $("detailGradeMsg").innerHTML = '<span class="ok">Оценка сохранена</span>';
    await refresh();
    openDetail(detailAttempt.id);
  } catch (e) {
    $("detailGradeMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

async function allowContinueRemaining() {
  if (!detailAttempt || !detailAttempt.id) return;
  const minutes = parseInt(($("detailContinueMin") && $("detailContinueMin").value) || "10", 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    $("detailContinueMsg").innerHTML = '<span class="bad">Укажите минуты</span>';
    return;
  }
  $("detailContinueMsg").textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/attempts/" + encodeURIComponent(detailAttempt.id) + "/continue", {
      method: "POST",
      json: { minutes }
    });
    detailAttempt = res.attempt || detailAttempt;
    $("detailContinueMsg").innerHTML = '<span class="ok">Досдача разрешена · ' + minutes + " мин. Курсант входит тем же номером и позывным.</span>";
    await refresh();
  } catch (e) {
    $("detailContinueMsg").innerHTML = '<span class="bad">' + e.message + "</span>";
  }
}

$("btnLogout").onclick = async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } catch (e) {}
  token = "";
  setCurrentUser(null);
  localStorage.removeItem("lisAdminToken");
  goHomeLogin();
};
$("btnChangePw").onclick = () => {
  $("pwBox").classList.remove("hidden");
  $("btnPwCancel").classList.remove("hidden");
  $("pwHint").textContent = "Смена пароля учётной записи.";
};
$("btnPwSave").onclick = () => savePassword().catch(e => alert(e.message));
$("btnPwCancel").onclick = () => $("pwBox").classList.add("hidden");

$("btnRefresh").onclick = () => refresh().catch(e => alert(e.message));
if ($("btnResultsSearch")) $("btnResultsSearch").onclick = () => applyResultsSearch();
if ($("resultsSearch")) {
  $("resultsSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyResultsSearch();
    }
  });
}
$("filterTest").onchange = async () => {
  resultsSort = { key: "when", dir: -1 };
  if ($("filterResultsStream")) $("filterResultsStream").value = "";
  if ($("filterResultsGroup")) $("filterResultsGroup").value = "";
  const testId = ($("filterTest") && $("filterTest").value) || "";
  resultsRosterCache = [];
  if (testId) {
    try {
      const data = await api("/api/admin/tests/" + encodeURIComponent(testId) + "/roster");
      resultsRosterCache = data.roster || [];
    } catch (e) { resultsRosterCache = []; }
  }
  fillCadetFilter();
  renderAttempts();
};
$("filterCadet").onchange = () => {
  renderAttempts();
};
if ($("filterResultsStream")) $("filterResultsStream").onchange = () => {
  if ($("filterResultsGroup")) $("filterResultsGroup").value = "";
  renderAttempts();
};
if ($("filterResultsGroup")) $("filterResultsGroup").onchange = () => renderAttempts();
bindTableSort("attemptsHead", resultsSort, renderAttempts);

function closeDetail() {
  detailAttempt = null;
  $("detailModal").classList.add("hidden");
  closeAnsList();
}

$("btnCloseDetail").onclick = closeDetail;
$("detailModal").addEventListener("click", e => { if (e.target === $("detailModal")) closeDetail(); });
if ($("btnCloseAnsList")) $("btnCloseAnsList").onclick = closeAnsList;
if ($("ansListModal")) $("ansListModal").addEventListener("click", e => {
  if (e.target === $("ansListModal")) closeAnsList();
});
if ($("detailStats")) $("detailStats").addEventListener("click", e => {
  const chip = e.target.closest("[data-ans-list]");
  if (!chip) return;
  openAnsList(chip.getAttribute("data-ans-list"));
});
if ($("btnSaveDetailGrade")) $("btnSaveDetailGrade").onclick = () => saveDetailGrade().catch(err => alert(err.message));
if ($("btnAllowContinue")) $("btnAllowContinue").onclick = () => allowContinueRemaining().catch(err => alert(err.message));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeDetail(); closeRoster(); closeDepWindow();
    closeCadetDupModal(); closeCadetImportModal(); closeRosterDupModal();
  }
});

$("btnCopyRetake").onclick = () => {
  const code = ($("lastRetakeCode").value || "").trim();
  if (!code) { alert("Сначала сгенерируйте пароль пересдачи"); return; }
  const b = $("btnCopyRetake");
  copyText(code).then(() => flashCopied(b)).catch(() => {
    try { $("lastRetakeCode").select(); } catch (e) {}
    prompt("Скопируйте пароль:", code);
  });
};

document.addEventListener("click", async e => {
  const editDepRow = e.target.closest("[data-edit-dep]");
  if (editDepRow && !e.target.closest("[data-del-dep]")) {
    if (isAdmin()) openEditDep(editDepRow.getAttribute("data-edit-dep"));
    return;
  }
  const editStaffRow = e.target.closest("[data-edit-staff]");
  if (editStaffRow && !e.target.closest("[data-del-staff]")) {
    if (isAdmin()) openEditStaff(editStaffRow.getAttribute("data-edit-staff"));
    return;
  }
  const editUserRow = e.target.closest("[data-edit-user]");
  if (editUserRow && !e.target.closest("[data-del-user],[data-reset-pw],[data-toggle-user]")) {
    if (isAdmin()) openEditUser(editUserRow.getAttribute("data-edit-user"));
    return;
  }
  const editFullEl = e.target.closest("[data-edit-full]");
  if (editFullEl && editFullEl.dataset.editFull) {
    const otherCtl = e.target.closest("a,button,input,select,textarea");
    if (!otherCtl || otherCtl.hasAttribute("data-edit-full")) {
      openFullTestEditor(editFullEl.dataset.editFull);
      return;
    }
  }
  const t = e.target.closest("[data-detail],[data-copy],[data-del],[data-unlock],[data-roster],[data-retake],[data-rm-roster],[data-show-retake],[data-del-dep],[data-del-staff],[data-del-user],[data-reset-pw],[data-toggle-user],[data-del-cadet],[data-edit-cadet],[data-edit-test],[data-adopt]") || e.target;
  if (t.dataset && t.dataset.editTest) {
    openEditTest(t.dataset.editTest).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.adopt) {
    adoptCatalogTest(t.dataset.adopt).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.delCadet) {
    if (!confirm("Удалить курсанта из списка?")) return;
    try {
      const res = await api("/api/admin/cadets/" + encodeURIComponent(t.dataset.delCadet), { method: "DELETE" });
      cadetsCache = res.cadets || [];
      renderCadetsTable();
      if (cadetEditId === t.dataset.delCadet) clearCadetForm();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.editCadet) {
    startCadetEdit(t.dataset.editCadet);
    return;
  }
  if (t.dataset && t.dataset.delDep) {
    e.stopPropagation();
    if (!confirm("Удалить отдел и его личный состав?")) return;
    try { await api("/api/admin/departments/" + encodeURIComponent(t.dataset.delDep), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delStaff) {
    if (!confirm("Удалить сотрудника из базы?")) return;
    try { await api("/api/admin/staff/" + encodeURIComponent(t.dataset.delStaff), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.delUser) {
    if (!confirm("Удалить учётную запись?")) return;
    try { await api("/api/admin/users/" + encodeURIComponent(t.dataset.delUser), { method: "DELETE" }); await refreshOrg(); }
    catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.resetPw) {
    try {
      const res = await api("/api/admin/users/" + encodeURIComponent(t.dataset.resetPw) + "/password", {
        method: "POST", json: { password: "", must_change_password: true }
      });
      alert("Новый временный пароль:\n\n" + res.temp_password);
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.toggleUser) {
    try {
      await api("/api/admin/users/" + encodeURIComponent(t.dataset.toggleUser) + "/active", {
        method: "POST", json: { active: t.dataset.active === "1" }
      });
      await refreshOrg();
    } catch (err) { alert(err.message); }
    return;
  }
  if (t.dataset && t.dataset.showRetake) {
    showLastRetake(t.dataset.showRetake, t.dataset.showNum || "");
    try { $("lastRetakeCode").focus(); $("lastRetakeCode").select(); } catch (err) {}
    return;
  }
  if (t.dataset && t.dataset.roster) {
    openRoster(t.dataset.roster, t.dataset.title).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.rmRoster) {
    removeRosterEntry(t.dataset.rmRoster).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.retake) {
    issueRetake(t.dataset.retake).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.detail) {
    openDetail(t.dataset.detail).catch(err => alert(err.message));
    return;
  }
  if (t.dataset && t.dataset.copy) {
    let text = t.dataset.copy;
    try { text = decodeURIComponent(text); } catch (err) {}
    copyText(text).then(() => flashCopied(t)).catch(() => prompt("Скопируйте:", text));
  }
  if (t.dataset && t.dataset.del) {
    if (!confirm("Удалить тест, список номеров и все результаты?")) return;
    await api("/api/tests/" + encodeURIComponent(t.dataset.del), { method: "DELETE" });
    await refresh();
  }
  if (t.dataset && t.dataset.unlock) {
    if (!confirm("Выдать пароль пересдачи для №" + t.dataset.num + "?")) return;
    const res = await api("/api/admin/unlock", {
      method: "POST",
      json: { test_id: t.dataset.unlock, num: t.dataset.num, call: t.dataset.call, issue_invite: true }
    });
    const code = (res.retake && res.retake.code) || (res.invite && res.invite.code);
    if (rosterTestId === t.dataset.unlock) {
      showLastRetake(code || "", t.dataset.num);
      const data = await api("/api/admin/tests/" + encodeURIComponent(rosterTestId) + "/roster");
      rosterCache = data.roster || [];
      retakesCache = data.retakes || [];
      setRosterMeta(data.access);
      renderRoster();
    } else if (code) {
      alert("Пароль пересдачи для №" + t.dataset.num + ":\n\n" + code);
    }
    await refresh();
  }
});
