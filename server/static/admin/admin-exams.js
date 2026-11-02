/* Экзамены: создание, список, результаты, проверка преподавателем. */
let examsCache = [];
let examCatalogCache = [];
let examAttemptsCache = [];
let examRosterId = "";
let examRosterCache = [];
let examDetailAttempt = null;

function examLinkAbs(id) {
  return location.origin + "/e/" + id;
}

async function refreshExams() {
  const [mine, cat, atts] = await Promise.all([
    api("/api/exams"),
    api("/api/exams/catalog").catch(() => ({ exams: [] })),
    api("/api/admin/exam-attempts").catch(() => ({ attempts: [] }))
  ]);
  examsCache = mine.exams || [];
  examCatalogCache = cat.exams || [];
  examAttemptsCache = atts.attempts || [];
  renderExamCreatePublishVisibility();
  renderMyExams();
  renderExamCatalog();
  renderExamAttempts();
  if ($("examsMeta")) $("examsMeta").textContent = examsCache.length ? (" · " + examsCache.length) : "";
  if ($("examResultsMeta")) {
    const n = examAttemptsCache.filter(a => a.status === "finished").length;
    $("examResultsMeta").textContent = n ? (" · " + n) : "";
  }
}

function renderExamCreatePublishVisibility() {
  const box = $("examPublishWrap");
  if (!box) return;
  const role = currentUser && currentUser.role;
  box.hidden = !(role === "admin" || role === "senior");
}

function renderMyExams() {
  const body = $("examsBody");
  const head = $("examsHead");
  if (!body || !head) return;
  head.innerHTML = "<th>Название</th><th>Вопросы</th><th>Таймер</th><th>Допуск</th><th>Сдано</th><th></th>";
  if (!examsCache.length) {
    body.innerHTML = '<tr><td colspan="6" class="hint">Пока нет экзаменов. Создайте в блоке выше.</td></tr>';
    if ($("myExamsMeta")) $("myExamsMeta").textContent = "";
    return;
  }
  if ($("myExamsMeta")) $("myExamsMeta").textContent = " · " + examsCache.length;
  body.innerHTML = examsCache.map(e => {
    const link = examLinkAbs(e.id);
    return `<tr>
      <td>${esc(e.title || "—")}</td>
      <td class="center">${esc(e.questions_count || 0)}</td>
      <td class="center">${esc(e.timer_minutes != null ? (e.timer_minutes + " мин") : "—")}</td>
      <td class="center">${esc(e.roster_count || 0)}</td>
      <td class="center">${esc(e.finished_count || 0)}</td>
      <td>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn" type="button" data-exam-copy="${esc(encodeURIComponent(link))}">Ссылка</button>
          <button class="btn" type="button" data-exam-roster="${esc(e.id)}" data-title="${esc(e.title || "")}">Курсанты</button>
          <button class="btn" type="button" data-exam-edit="${esc(e.id)}">Править</button>
          <button class="btn danger" type="button" data-exam-del="${esc(e.id)}">Удалить</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function renderExamCatalog() {
  const body = $("examCatalogBody");
  if (!body) return;
  if ($("examCatalogMeta")) {
    $("examCatalogMeta").textContent = examCatalogCache.length ? (" · " + examCatalogCache.length) : "";
  }
  if (!examCatalogCache.length) {
    body.innerHTML = '<tr><td colspan="5" class="hint">Опубликованных экзаменов пока нет.</td></tr>';
    return;
  }
  body.innerHTML = examCatalogCache.map(e => `<tr>
    <td>${esc(e.title || "—")}</td>
    <td>${esc(e.owner_name || e.owner_login || "—")}</td>
    <td>${esc(e.department_name || "—")}</td>
    <td class="center">${esc(e.questions_count || 0)}</td>
    <td><button class="btn" type="button" data-exam-adopt="${esc(e.id)}">Взять себе</button></td>
  </tr>`).join("");
}

function examStatusHtml(a) {
  if (!a || a.status !== "finished") return '<span class="hint">' + esc(a && a.status || "—") + "</span>";
  if (!(a.grade || "").trim()) return '<span class="warn">ожидает проверки</span>';
  const g = Number(String(a.grade || "").replace(",", "."));
  if (Number.isFinite(g) && g >= 3) return '<span class="badge-ok">сдан · ' + esc(a.grade) + "</span>";
  if (String(a.grade).trim() === "2" || g === 2) return '<span class="badge-fail">не сдан · ' + esc(a.grade) + "</span>";
  return '<span class="hint">оценка: ' + esc(a.grade) + "</span>";
}

function renderExamAttempts() {
  const body = $("examAttemptsBody");
  const head = $("examAttemptsHead");
  if (!body || !head) return;
  head.innerHTML = "<th>Экзамен</th><th>№</th><th>Позывной</th><th>Отвечено</th><th>Оценка</th><th>Статус</th><th>Когда</th>";
  const list = (examAttemptsCache || []).filter(a => a.status === "finished" || a.status === "started");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" class="hint">Результатов пока нет.</td></tr>';
    return;
  }
  body.innerHTML = list.map(a => {
    const when = a.finished_at || a.created_at || "";
    return `<tr class="row-click" data-exam-detail="${esc(a.id)}" title="Открыть проверку">
      <td>${esc(a.exam_title || "—")}</td>
      <td class="center">${esc(a.student_num || "—")}</td>
      <td class="center">${esc(a.callsign || "—")}</td>
      <td class="center">${esc((a.answered_count != null ? a.answered_count : "—") + " / " + (a.questions_count != null ? a.questions_count : "—"))}</td>
      <td class="center">${esc(a.grade || "—")}</td>
      <td>${examStatusHtml(a)}</td>
      <td class="center">${esc(when ? String(when).replace("T", " ").slice(0, 19) : "—")}</td>
    </tr>`;
  }).join("");
}

async function createExamFromForm() {
  const title = ($("examTitle") && $("examTitle").value || "").trim();
  const raw = ($("examQuestions") && $("examQuestions").value) || "";
  const questions = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const timer = Number(($("examTimer") && $("examTimer").value) || 40);
  const master = ($("examMaster") && $("examMaster").value) || "";
  const pub = !!($("examPublish") && $("examPublish").checked);
  const msg = $("examCreateMsg");
  if (msg) msg.textContent = "Сохранение…";
  try {
    const res = await api("/api/exams", {
      method: "POST",
      json: {
        title,
        questions,
        timer_minutes: timer,
        master_password: master,
        published_for_all: pub
      }
    });
    if ($("examTitle")) $("examTitle").value = "";
    if ($("examQuestions")) $("examQuestions").value = "";
    if ($("examMaster")) $("examMaster").value = "";
    if ($("examPublish")) $("examPublish").checked = false;
    if (msg) msg.textContent = "Создано. Ссылка: " + examLinkAbs(res.exam.id);
    await refreshExams();
  } catch (e) {
    if (msg) msg.textContent = e.message || String(e);
  }
}

async function openExamEditor(id) {
  const data = await api("/api/exams/" + encodeURIComponent(id));
  const e = data.exam || {};
  const qs = (e.questions || []).map(q => q.text || "").join("\n");
  const title = prompt("Название экзамена", e.title || "");
  if (title == null) return;
  const timerRaw = prompt("Таймер (минуты)", String(e.timer_minutes != null ? e.timer_minutes : 40));
  if (timerRaw == null) return;
  const qRaw = prompt("Вопросы (по одному в строке)", qs);
  if (qRaw == null) return;
  const questions = qRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  await api("/api/exams/" + encodeURIComponent(id), {
    method: "PUT",
    json: {
      title: title.trim(),
      timer_minutes: Number(timerRaw) || 40,
      questions
    }
  });
  await refreshExams();
}

async function openExamRoster(id, title) {
  examRosterId = id;
  const data = await api("/api/admin/exams/" + encodeURIComponent(id) + "/roster");
  examRosterCache = data.roster || [];
  if ($("examRosterTitle")) $("examRosterTitle").textContent = "Курсанты · " + (title || id);
  if ($("examRosterModal")) $("examRosterModal").classList.remove("hidden");
  renderExamRosterTable();
}

function renderExamRosterTable() {
  const body = $("examRosterBody");
  if (!body) return;
  if (!examRosterCache.length) {
    body.innerHTML = '<tr><td colspan="5" class="hint">Список пуст</td></tr>';
    return;
  }
  body.innerHTML = examRosterCache.map(r => `<tr>
    <td class="center">${esc(r.student_num)}</td>
    <td class="center">${esc(r.callsign || "—")}</td>
    <td>${esc(r.full_name || "—")}</td>
    <td class="center">${esc(r.group_num || "—")} / ${esc(r.stream_num || "—")}</td>
    <td><button class="btn danger" type="button" data-exam-rm-roster="${esc(r.student_num)}">Удалить</button></td>
  </tr>`).join("");
}

async function openExamDetail(id) {
  const data = await api("/api/admin/exam-attempts/" + encodeURIComponent(id));
  examDetailAttempt = data.attempt || null;
  const a = examDetailAttempt;
  if (!a) return;
  if ($("examDetailTitle")) $("examDetailTitle").textContent = a.exam_title || "Проверка экзамена";
  if ($("examDetailSub")) {
    $("examDetailSub").textContent =
      "№ " + (a.student_num || "—") +
      (a.callsign ? (" · " + a.callsign) : "") +
      (a.full_name ? (" · " + a.full_name) : "");
  }
  if ($("examDetailGrade")) $("examDetailGrade").value = a.grade || "";
  if ($("examDetailComment")) $("examDetailComment").value = a.teacher_comment || "";
  if ($("examDetailMsg")) $("examDetailMsg").textContent = "";
  const answers = a.answers || [];
  const qById = {};
  (a.questions || []).forEach(q => { qById[q.id] = q; });
  const box = $("examDetailAnswers");
  if (box) {
    if (!answers.length && !(a.questions || []).length) {
      box.innerHTML = '<p class="hint">Нет ответов</p>';
    } else {
      const rows = answers.length
        ? answers
        : (a.questions || []).map(q => ({ npp: q.npp, q: q.text, answer_text: "" }));
      box.innerHTML = rows.map((ans, i) => {
        const title = ans.q || (qById[ans.question_id] && qById[ans.question_id].text) || ("Вопрос " + (ans.npp || i + 1));
        return `<div class="ans">
          <div class="hint" style="margin-bottom:6px">Вопрос ${esc(ans.npp || i + 1)}</div>
          <div style="margin-bottom:8px;color:#e8ffff">${esc(title)}</div>
          <div class="hint">Ответ курсанта</div>
          <div style="white-space:pre-wrap;margin-top:4px">${esc(ans.answer_text || "—")}</div>
        </div>`;
      }).join("");
    }
  }
  if ($("examDetailModal")) $("examDetailModal").classList.remove("hidden");
}

async function saveExamGrade() {
  if (!examDetailAttempt) return;
  const grade = ($("examDetailGrade") && $("examDetailGrade").value || "").trim();
  const comment = ($("examDetailComment") && $("examDetailComment").value || "").trim();
  const msg = $("examDetailMsg");
  if (msg) msg.textContent = "Сохранение…";
  try {
    const res = await api("/api/admin/exam-attempts/" + encodeURIComponent(examDetailAttempt.id) + "/grade", {
      method: "PUT",
      json: { grade, comment }
    });
    examDetailAttempt = res.attempt || examDetailAttempt;
    if (msg) msg.textContent = "Сохранено.";
    await refreshExams();
  } catch (e) {
    if (msg) msg.textContent = e.message || String(e);
  }
}

document.addEventListener("click", async e => {
  const t = e.target.closest(
    "[data-exam-copy],[data-exam-roster],[data-exam-edit],[data-exam-del],[data-exam-adopt],[data-exam-detail],[data-exam-rm-roster]"
  );
  if (!t) return;
  if (t.dataset.examCopy) {
    let text = t.dataset.examCopy;
    try { text = decodeURIComponent(text); } catch (err) {}
    copyText(text).then(() => flashCopied(t)).catch(() => prompt("Скопируйте:", text));
    return;
  }
  if (t.dataset.examRoster) {
    openExamRoster(t.dataset.examRoster, t.dataset.title || "").catch(err => alert(err.message));
    return;
  }
  if (t.dataset.examEdit) {
    openExamEditor(t.dataset.examEdit).catch(err => alert(err.message));
    return;
  }
  if (t.dataset.examDel) {
    if (!confirm("Удалить экзамен, список допуска и все результаты?")) return;
    await api("/api/exams/" + encodeURIComponent(t.dataset.examDel), { method: "DELETE" });
    await refreshExams();
    return;
  }
  if (t.dataset.examAdopt) {
    await api("/api/exams/" + encodeURIComponent(t.dataset.examAdopt) + "/adopt", { method: "POST" });
    await refreshExams();
    return;
  }
  if (t.dataset.examDetail) {
    openExamDetail(t.dataset.examDetail).catch(err => alert(err.message));
    return;
  }
  if (t.dataset.examRmRoster && examRosterId) {
    await api(
      "/api/admin/exams/" + encodeURIComponent(examRosterId) + "/roster/" + encodeURIComponent(t.dataset.examRmRoster),
      { method: "DELETE" }
    );
    const data = await api("/api/admin/exams/" + encodeURIComponent(examRosterId) + "/roster");
    examRosterCache = data.roster || [];
    renderExamRosterTable();
  }
});

if ($("btnExamCreate")) {
  $("btnExamCreate").onclick = () => createExamFromForm();
}
if ($("btnExamRefreshResults")) {
  $("btnExamRefreshResults").onclick = () => refreshExams().catch(err => alert(err.message));
}
if ($("btnExamRosterAdd")) {
  $("btnExamRosterAdd").onclick = async () => {
    if (!examRosterId) return;
    try {
      const res = await api("/api/admin/exams/" + encodeURIComponent(examRosterId) + "/roster/entry", {
        method: "POST",
        json: {
          student_num: ($("examRosterNum") && $("examRosterNum").value) || "",
          callsign: ($("examRosterCall") && $("examRosterCall").value) || "",
          full_name: ($("examRosterFio") && $("examRosterFio").value) || "",
          group_num: ($("examRosterGroup") && $("examRosterGroup").value) || "",
          stream_num: ($("examRosterStream") && $("examRosterStream").value) || ""
        }
      });
      examRosterCache = res.roster || [];
      renderExamRosterTable();
      ["examRosterNum", "examRosterCall", "examRosterFio", "examRosterGroup", "examRosterStream"].forEach(id => {
        if ($(id)) $(id).value = "";
      });
    } catch (err) { alert(err.message); }
  };
}
if ($("btnExamRosterClose")) {
  $("btnExamRosterClose").onclick = () => {
    if ($("examRosterModal")) $("examRosterModal").classList.add("hidden");
    examRosterId = "";
  };
}
if ($("btnExamDetailClose")) {
  $("btnExamDetailClose").onclick = () => {
    if ($("examDetailModal")) $("examDetailModal").classList.add("hidden");
    examDetailAttempt = null;
  };
}
if ($("btnExamDetailSave")) {
  $("btnExamDetailSave").onclick = () => saveExamGrade();
}
