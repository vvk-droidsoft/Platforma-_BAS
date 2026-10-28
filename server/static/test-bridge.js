/* LIS: список номеров · один раз · пароль пересдачи · мастер-пароль */
(function () {
  if (!window.LIS_SERVER || !window.LIS_SERVER.testId) return;
  const CFG = window.LIS_SERVER;
  const API = (CFG.apiBase || "") + "/api";
  const SKEY = "lisSession:" + CFG.testId;
  const ACCESS_KEY = "lisAccessOk:" + CFG.testId;
  let finishedThisPage = false;
  let lisStartTs = 0;
  let continueState = null;

  function $(id) { return document.getElementById(id); }
  function getSession() {
    try { return sessionStorage.getItem(SKEY) || ""; } catch (e) { return ""; }
  }
  function setSession(tok) {
    try { sessionStorage.setItem(SKEY, tok || ""); } catch (e) {}
  }
  function isAccessOk() {
    try { return sessionStorage.getItem(ACCESS_KEY) === "1"; } catch (e) { return false; }
  }
  function isFinished() { return finishedThisPage; }
  function setAccessOk(ok) {
    try {
      if (ok) sessionStorage.setItem(ACCESS_KEY, "1");
      else sessionStorage.removeItem(ACCESS_KEY);
    } catch (e) {}
    document.documentElement.classList.toggle("lis-access-ok", !!ok);
    document.body && document.body.classList.toggle("lis-access-ok", !!ok);
  }
  function markFinished() {
    finishedThisPage = true;
    setAccessOk(true);
    document.documentElement.classList.add("lis-finished");
    document.body && document.body.classList.add("lis-finished");
    // после сдачи показываем только #htmlResults (см. CSS), не экран теста
    const testBody = $("testbody");
    if (testBody) testBody.classList.remove("show");
  }
  window.__lisMarkFinished = markFinished;

  function returnToGate() {
    finishedThisPage = false;
    try {
      sessionStorage.removeItem(SKEY);
      sessionStorage.removeItem(ACCESS_KEY);
    } catch (e) {}
    // полная перезагрузка — снова форма номера/позывного
    location.reload();
  }
  window.__lisReturnToGate = returnToGate;

  function ensureLockStyle() {
    if (document.getElementById("lisAccessLockStyle")) return;
    const st = document.createElement("style");
    st.id = "lisAccessLockStyle";
    st.textContent =
      "html:not(.lis-access-ok):not(.lis-finished) #testbody," +
      "html:not(.lis-access-ok):not(.lis-finished) #testbody.show," +
      "body:not(.lis-access-ok):not(.lis-finished) #testbody," +
      "body:not(.lis-access-ok):not(.lis-finished) #testbody.show{" +
      "display:none!important;visibility:hidden!important;pointer-events:none!important}" +
      "html.lis-finished #head,body.lis-finished #head," +
      "html.lis-finished #testbody,html.lis-finished #testbody.show," +
      "body.lis-finished #testbody,body.lis-finished #testbody.show{" +
      "display:none!important;visibility:hidden!important;pointer-events:none!important}" +
      "html.lis-finished #htmlResults,body.lis-finished #htmlResults{" +
      "display:grid!important;visibility:visible!important;pointer-events:auto!important}" +
      "#lisServerOverlay{position:fixed;inset:0;z-index:99999}" +
      "#lisTimerHint{display:none!important}" +
      "#head.top{display:grid!important;" +
      "grid-template-columns:minmax(120px,1fr) minmax(120px,1fr) minmax(110px,160px) minmax(200px,1.1fr)!important;" +
      "gap:14px;align-items:stretch}" +
      "#head.top > .title-panel{grid-column:1 / -1!important}" +
      "#head.top .title-panel .panel-in{display:flex;flex-direction:column;justify-content:center;" +
      "align-items:center;gap:8px;text-align:center;width:100%;box-sizing:border-box;padding:16px 18px}" +
      "#head.top .title,#head.top .subtitle{width:100%;text-align:center;white-space:normal}" +
      "#head.top .title{font-size:18px;line-height:1.3}" +
      "#head.top .subtitle{font-size:13px;line-height:1.4}" +
      "#head.top #startrow{display:flex;flex-direction:row;flex-wrap:wrap;align-items:stretch;gap:8px}" +
      "#head.top #start{flex:1 1 auto;min-height:52px}" +
      "#head.top #gatemsg{flex:1 0 100%}" +
      "#head.top #lisMasterHint{flex:0 0 auto;margin:0!important;align-self:stretch;" +
      "display:flex;align-items:center;justify-content:center;white-space:nowrap;" +
      "font:inherit;font-size:12px;letter-spacing:.08em;text-transform:uppercase;" +
      "color:#6fd5d9;background:transparent;border:1px solid #0b7f86;padding:10px 12px;cursor:pointer}" +
      "#head.top.started{grid-template-columns:1fr 220px 220px 220px!important}" +
      "#head.top.started > .title-panel{grid-column:1 / -1!important}" +
      "@media(max-width:900px){#head.top{grid-template-columns:1fr 1fr 1fr!important}" +
      "#head.top > .title-panel{grid-column:1 / -1!important}}" +
      "@media(max-width:640px){#head.top{grid-template-columns:1fr!important}}";
    document.head.appendChild(st);
  }

  /** Вернуть UI на экран ввода, если тест уже успели открыть без доступа. */
  function forceBackToGate() {
    if (isFinished()) return;
    setAccessOk(false);
    const testBody = $("testbody");
    if (testBody) testBody.classList.remove("show");
    const head = $("head");
    if (head) head.classList.remove("started");
    const startrow = $("startrow");
    if (startrow) startrow.classList.remove("done");
    const start = $("start");
    if (start) {
      start.classList.remove("done");
      start.disabled = false;
    }
    ["num", "call", "mins"].forEach(function (id) {
      const el = $(id);
      if (el) el.disabled = false;
    });
    try {
      if (typeof window.__lisResetStarted === "function") window.__lisResetStarted();
    } catch (e) {}
    const gateMsg = $("gatemsg");
    if (gateMsg && /Проверка доступа/.test(gateMsg.textContent || "")) {
      gateMsg.textContent = "";
    }
  }

  function overlay(html) {
    ensureLockStyle();
    let el = document.getElementById("lisServerOverlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "lisServerOverlay";
      el.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;color:#c9fbfb;";
      document.body.appendChild(el);
    }
    el.innerHTML = '<div style="max-width:520px;width:100%;border:1px solid #19f0f0;background:#021018;padding:22px;text-align:left">' + html + "</div>";
    el.style.display = "flex";
  }
  function hideOverlay() {
    const el = document.getElementById("lisServerOverlay");
    if (el) el.style.display = "none";
  }

  function lisGradeFor(percent) {
    const rules = (window.__LIS_GRADING__ || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
    const p = Number(percent);
    for (let i = 0; i < rules.length; i++) {
      if (p >= Number(rules[i].min)) return String(rules[i].grade);
    }
    return rules.length ? String(rules[rules.length - 1].grade) : "";
  }

  function applyServerGrading(rules) {
    const list = (rules || []).map(r => ({ min: Number(r.min), grade: String(r.grade) }))
      .filter(r => Number.isFinite(r.min) && r.grade);
    list.sort((a, b) => b.min - a.min);
    if (!list.length) return;
    window.__LIS_GRADING__ = list;
    window.gradeFor = function (percent) {
      return lisGradeFor(percent);
    };
  }

  async function loadServerGrading() {
    try {
      const data = await api("/grading");
      applyServerGrading(data.rules || []);
    } catch (e) {
      console.warn("grading", e);
    }
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const sess = getSession();
    if (sess) headers["X-Lis-Session"] = sess;
    const r = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : (data.message || ("Ошибка " + r.status)));
    }
    return data;
  }

  function showRetakeGate(message, attempt) {
    forceBackToGate();
    const a = attempt || {};
    overlay(
      "<div style='color:#19f0f0;margin-bottom:10px;text-transform:uppercase;letter-spacing:.08em;text-align:center'>Доступ ограничен</div>" +
      "<p style='color:#8fe6e8;font-size:14px'>" + (message || "Этот номер уже использован.") + "</p>" +
      (a.grade != null
        ? "<p>Оценка: <b style='color:#ffc83d'>" + a.grade + "</b>" +
          (a.score != null ? (" · баллов: " + a.score + (a.total != null ? " / " + a.total : "")) : "") + "</p>"
        : "") +
      "<label style='display:block;font-size:12px;color:#6fd5d9;margin:12px 0 4px'>ПАРОЛЬ ПЕРЕСДАЧИ ОТ ПРЕПОДАВАТЕЛЯ (4 ЦИФРЫ)</label>" +
      "<input id='lisRetakeCode' type='text' inputmode='numeric' pattern='[0-9]{4}' maxlength='4' autocomplete='off' spellcheck='false' " +
      "style='width:100%;box-sizing:border-box;padding:10px;background:#000;border:1px solid #0b7f86;color:#19f0f0;font:inherit;letter-spacing:.35em;text-align:center;font-size:22px' placeholder='0000'>" +
      "<button id='lisRetakeBtn' type='button' style='width:100%;margin-top:10px;padding:12px;background:#19f0f0;color:#001014;border:0;font:inherit;text-transform:uppercase;cursor:pointer'>Продолжить</button>" +
      "<details style='margin-top:12px'><summary style='cursor:pointer;color:#6fd5d9;font-size:13px'>Мастер-пароль преподавателя</summary>" +
      "<input id='lisMasterPwd' type='password' style='width:100%;box-sizing:border-box;padding:10px;margin:8px 0;background:#000;border:1px solid #0b7f86;color:#19f0f0;font:inherit'>" +
      "<button id='lisMasterBtn' type='button' style='width:100%;padding:10px;background:transparent;color:#19f0f0;border:1px solid #19f0f0;font:inherit;cursor:pointer'>Открыть как преподаватель</button></details>" +
      "<p id='lisGateMsg' style='color:#ff9aa6;font-size:13px;min-height:18px;margin:10px 0 0'></p>" +
      "<p style='text-align:center;margin-top:12px'><button type='button' id='lisGateClose' style='background:none;border:0;color:#6fd5d9;cursor:pointer;font:inherit'>Вернуться к вводу</button></p>"
    );
    const redeem = async function (useMaster) {
      const msg = $("lisGateMsg");
      if (msg) msg.textContent = "";
      try {
        const body = useMaster
          ? { master_password: ($("lisMasterPwd") && $("lisMasterPwd").value) || "" }
          : { code: ($("lisRetakeCode") && $("lisRetakeCode").value) || "" };
        const res = await api("/tests/" + encodeURIComponent(CFG.testId) + "/redeem", {
          method: "POST",
          body: JSON.stringify(body)
        });
        setSession(res.session);
        setAccessOk(true);
        hideOverlay();
        if (res.is_master) {
          const m = $("msg");
          if (m) m.textContent = "Режим преподавателя.";
        } else if (res.for_num) {
          if ($("num") && !$("num").value) $("num").value = res.for_num;
        }
        // после пароля пересдачи — запускаем тест
        const start = $("start");
        if (start) runNativeStart(start);
      } catch (e) {
        if (msg) msg.textContent = e.message || String(e);
      }
    };
    if ($("lisRetakeBtn")) $("lisRetakeBtn").onclick = function () { redeem(false); };
    if ($("lisMasterBtn")) $("lisMasterBtn").onclick = function () { redeem(true); };
    if ($("lisGateClose")) $("lisGateClose").onclick = function () {
      hideOverlay();
      forceBackToGate();
    };
    const inp = $("lisRetakeCode");
    if (inp) inp.addEventListener("keydown", function (e) { if (e.key === "Enter") redeem(false); });
  }

  function addMasterHint() {
    if (document.getElementById("lisMasterHint")) return;
    const start = $("start");
    if (!start || !start.parentNode) return;
    const b = document.createElement("button");
    b.id = "lisMasterHint";
    b.type = "button";
    b.textContent = "Преподаватель";
    b.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      showRetakeGate("Вход преподавателя (мастер-пароль).", null);
    };
    const row = $("startrow") || start.parentNode;
    const msg = $("gatemsg");
    if (msg && msg.parentNode === row) row.insertBefore(b, msg);
    else row.appendChild(b);
  }

  async function checkAccess() {
    const num = ($("num") && $("num").value || "").trim();
    const call = ($("call") && $("call").value || "").trim();
    if (!num || !call) return { allowed: false, reason: "Заполните номер и позывной." };
    const q = new URLSearchParams({ num: num, call: call });
    return api("/tests/" + encodeURIComponent(CFG.testId) + "/can-start?" + q.toString());
  }

  function getQuestions() {
    if (window.QUESTIONS && window.QUESTIONS.length) return window.QUESTIONS;
    try {
      if (typeof QUESTIONS !== "undefined" && QUESTIONS && QUESTIONS.length) {
        window.QUESTIONS = QUESTIONS;
        return QUESTIONS;
      }
    } catch (e) {}
    return null;
  }

  function collectFromDom() {
    const form = $("quiz") || document.querySelector("form#quiz, #quiz");
    if (!form) return [];
    const panels = form.querySelectorAll(":scope > .panel, section.panel");
    const out = [];
    panels.forEach(function (panel, i) {
      const qEl = panel.querySelector(".qtext");
      const opts = [];
      panel.querySelectorAll("label.opt").forEach(function (lab) {
        const spans = lab.querySelectorAll("span");
        let text = "";
        spans.forEach(function (s) {
          if (!s.classList.contains("box")) text = s.textContent.trim();
        });
        if (!text) text = lab.textContent.trim();
        opts.push(text);
      });
      const r = panel.querySelector('input[type="radio"]:checked');
      const pick = r ? Number(r.value) : null;
      const ok = panel.classList.contains("ok");
      const bad = panel.classList.contains("bad");
      out.push({
        i: i + 1,
        q: qEl ? qEl.textContent.trim() : ("Вопрос " + (i + 1)),
        a: opts,
        pick: pick,
        pickText: pick && opts[pick - 1] ? opts[pick - 1] : null,
        correct: ok && pick != null ? pick : null,
        correctText: ok && pick && opts[pick - 1] ? opts[pick - 1] : null,
        ok: ok ? true : (bad ? false : null)
      });
    });
    return out;
  }

  function collectAnswers() {
    const qs = getQuestions();
    if (!qs || !qs.length) return collectFromDom();
    const answers = [];
    qs.forEach(function (item, i) {
      const r = document.querySelector('input[name="q' + i + '"]:checked');
      const pick = r ? Number(r.value) : null;
      const opts = item.a || [];
      answers.push({
        i: i + 1,
        q: item.q || "",
        a: opts.slice(),
        pick: pick,
        pickText: pick != null && opts[pick - 1] != null ? opts[pick - 1] : null,
        correct: item.correct,
        correctText: item.correct != null && opts[item.correct - 1] != null ? opts[item.correct - 1] : null,
        ok: pick != null && pick === item.correct
      });
    });
    return answers;
  }

  function readScoreTotal(answers) {
    const scoreEl = document.getElementById("score");
    const score = scoreEl ? Number(scoreEl.textContent) || 0 : 0;
    const qs = getQuestions();
    let total = qs ? qs.length : 0;
    if (!total) {
      total = document.querySelectorAll("#quiz > .panel, #quiz section.panel").length || (answers ? answers.length : 0);
    }
    if (!total && answers && answers.length) total = answers.length;
    return { score: score, total: total, percent: total ? Math.round(score / total * 100) : 0 };
  }

  function durationSec() {
    if (!lisStartTs) return null;
    return Math.max(0, Math.round((Date.now() - lisStartTs) / 1000));
  }

  function applyContinueUi() {
    if (!continueState || !continueState.continue_mode) return;
    const keep = {};
    (continueState.unanswered_indices || []).forEach(function (i) {
      keep[Number(i)] = true;
    });
    const panels = document.querySelectorAll("#quiz > .panel, #quiz section.panel, #quiz .q");
    if (panels && panels.length) {
      panels.forEach(function (p, idx) {
        const n = idx + 1;
        if (!keep[n]) {
          p.style.display = "none";
          p.setAttribute("data-lis-hidden", "1");
        } else {
          p.style.display = "";
          p.removeAttribute("data-lis-hidden");
        }
      });
    }
    const nav = document.querySelectorAll("#nav li, .nav li");
    if (nav && nav.length) {
      nav.forEach(function (li, idx) {
        const n = idx + 1;
        if (!keep[n]) li.style.display = "none";
      });
    }
    const msg = $("msg") || $("gatemsg");
    if (msg) {
      msg.textContent = "Досдача: только вопросы без ответа (" +
        (continueState.unanswered_indices || []).length + ").";
    }
  }

  function mergeContinueAnswers(answers) {
    if (!continueState || !continueState.previous_answers) return answers || [];
    const prev = continueState.previous_answers || [];
    const byI = {};
    (answers || []).forEach(function (a) {
      if (a && a.i != null) byI[Number(a.i)] = a;
    });
    const merged = [];
    const seen = {};
    prev.forEach(function (a) {
      const i = a && a.i != null ? Number(a.i) : null;
      if (i == null) { merged.push(a); return; }
      seen[i] = true;
      if (a.pick == null && byI[i]) merged.push(byI[i]);
      else merged.push(a);
    });
    (answers || []).forEach(function (a) {
      const i = a && a.i != null ? Number(a.i) : null;
      if (i != null && !seen[i]) merged.push(a);
    });
    return merged;
  }

  function runNativeStart(startBtn) {
    setAccessOk(true);
    if (typeof window.__lisResetStarted === "function") {
      try { window.__lisResetStarted(); } catch (e) {}
    }
    const mins = Math.round(Number(($("mins") && $("mins").value || "").trim()));
    // прямой старт через хук страницы — без повторного click()
    if (typeof window.__lisForceStart === "function") {
      try {
        if (window.__lisForceStart(mins)) return;
      } catch (e) {
        console.error("lisForceStart", e);
      }
    }
    // запасной путь: снять перехватчик и кликнуть
    const handler = startBtn && startBtn._lisStartHandler;
    if (startBtn && handler) startBtn.removeEventListener("click", handler, true);
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.classList.remove("done");
      try { startBtn.click(); } catch (e) {}
    }
    if (startBtn && handler) {
      setTimeout(function () { startBtn.addEventListener("click", handler, true); }, 0);
    }
  }

  function patchStart() {
    const startBtn = $("start");
    if (!startBtn || startBtn._lisPatched) return;
    startBtn._lisPatched = true;
    ensureLockStyle();
    addMasterHint();

    let busy = false;

    function onStartClick(ev) {
      // capture: блокируем ДО синхронного обработчика страницы
      ev.preventDefault();
      ev.stopImmediatePropagation();

      if (busy || isFinished()) return;

      const num = ($("num") && $("num").value || "").trim();
      const call = ($("call") && $("call").value || "").trim();
      const minsEl = $("mins");
      const minsRaw = (minsEl && minsEl.value || "").trim();
      const gateMsg = $("gatemsg");

      if (!num) {
        if (gateMsg) gateMsg.textContent = "Заполните поле «Номер».";
        if ($("num")) $("num").focus();
        return;
      }
      if (!call) {
        if (gateMsg) gateMsg.textContent = "Заполните поле «Позывной».";
        if ($("call")) $("call").focus();
        return;
      }
      if (!minsRaw || !Number.isFinite(Number(minsRaw)) || Number(minsRaw) < 1) {
        if (gateMsg) {
          gateMsg.textContent = "Таймер не задан. Установите его в кабинете преподавателя или укажите минуты.";
        }
        if (minsEl && !minsEl.readOnly) minsEl.focus();
        return;
      }

      busy = true;
      if (gateMsg) gateMsg.textContent = "Проверка доступа…";

      checkAccess().then(function (res) {
        busy = false;
        if (!res.allowed) {
          if (gateMsg) gateMsg.textContent = res.reason || "Доступ запрещён.";
          forceBackToGate();
          showRetakeGate(res.reason || "Доступ запрещён.", res.attempt);
          return;
        }
        if (gateMsg) gateMsg.textContent = "";
        continueState = res.continue_mode ? res : null;
        if (continueState && continueState.continue_minutes && minsEl) {
          minsEl.value = String(continueState.continue_minutes);
          minsEl.readOnly = true;
        }
        runNativeStart(startBtn);
        lisStartTs = Date.now();
        setTimeout(function () {
          applyContinueUi();
          const tb = $("testbody");
          if (!tb || !tb.classList.contains("show")) {
            if (gateMsg) {
              gateMsg.textContent = "Не удалось открыть тест. Обновите страницу (Ctrl+F5) и попробуйте снова.";
            }
          }
        }, 100);
      }).catch(function (e) {
        busy = false;
        if (gateMsg) gateMsg.textContent = "";
        forceBackToGate();
        overlay(
          "<p style='color:#ff3d52;text-align:center'>Нет связи с сервером.</p>" +
          "<p style='text-align:center'>" + (e.message || e) + "</p>" +
          "<p style='text-align:center'><button type='button' id='lisNetClose' style='margin-top:10px;background:none;border:1px solid #19f0f0;color:#19f0f0;padding:8px 12px;font:inherit;cursor:pointer'>Закрыть</button></p>"
        );
        const b = $("lisNetClose");
        if (b) b.onclick = function () { hideOverlay(); forceBackToGate(); };
      });
    }

    startBtn._lisStartHandler = onStartClick;
    startBtn.addEventListener("click", onStartClick, true);
  }

  let submitting = false;
  async function submitResults(payload) {
    if (submitting) return;
    submitting = true;
    try {
      const res = await api("/tests/" + encodeURIComponent(CFG.testId) + "/submit", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const saved = res && res.attempt;
      if (saved && saved.grade != null) {
        const gradeEl = document.getElementById("grade");
        if (gradeEl) gradeEl.textContent = String(saved.grade);
        if (window.__LIS_GRADING__) window.gradeFor = function () { return String(saved.grade); };
        try { if (typeof showHtmlResults === "function") showHtmlResults(); } catch (e2) {}
      }
      markFinished();
      const msg = $("msg");
      if (msg) msg.textContent = ((msg.textContent || "") + " · Результат отправлен преподавателю.").trim();
    } catch (e) {
      alert("Не удалось отправить результат: " + (e.message || e));
    } finally {
      submitting = false;
    }
  }

  function patchFinish() {
    if (typeof window.finishTest !== "function" || window.finishTest._lisPatched) return;
    const orig = window.finishTest;
    function wrapped(opts) {
      const saveBtn = $("save");
      const wasDone = !!(saveBtn && saveBtn.disabled);
      const result = document.getElementById("result");
      const wasShown = !!(result && result.classList.contains("show"));
      orig(opts);
      try { if (typeof QUESTIONS !== "undefined" && QUESTIONS) window.QUESTIONS = QUESTIONS; } catch (e) {}
      const nowDone = !!(saveBtn && saveBtn.disabled);
      const nowShown = !!(result && result.classList.contains("show"));
      if ((!wasDone && nowDone) || (!wasShown && nowShown)) {
        markFinished();
        const gradeEl = document.getElementById("grade");
        let answers = collectAnswers();
        const isCont = !!(continueState && continueState.continue_mode);
        if (isCont) answers = mergeContinueAnswers(answers);
        let st = readScoreTotal(answers);
        if (isCont && answers && answers.length) {
          let sc = 0;
          answers.forEach(function (a) {
            if (a.ok === true || (a.pick != null && a.correct != null && Number(a.pick) === Number(a.correct))) sc++;
          });
          st = {
            score: sc,
            total: answers.length,
            percent: answers.length ? Math.round(sc / answers.length * 100) : 0
          };
        }
        submitResults({
          num: ($("num") && $("num").value || "").trim(),
          call: ($("call") && $("call").value || "").trim(),
          score: st.score,
          total: st.total,
          percent: st.percent,
          grade: (window.__FORCE_GRADE__ != null) ? String(window.__FORCE_GRADE__) : (gradeEl ? gradeEl.textContent.trim() : ""),
          answers: answers,
          forced: !!(opts && (opts.forceGrade != null || opts.allowIncomplete)),
          duration_sec: durationSec(),
          is_continue: isCont
        });
      }
    }
    wrapped._lisPatched = true;
    window.finishTest = wrapped;
  }

  /** Если страница уже в режиме теста без доступа — закрыть. */
  function guardVisibleQuiz() {
    if (isFinished()) {
      markFinished();
      return;
    }
    if (isAccessOk()) {
      setAccessOk(true);
      return;
    }
    const testBody = $("testbody");
    if (testBody && testBody.classList.contains("show")) {
      forceBackToGate();
    }
  }

  async function applyTeacherTimer() {
    try {
      const st = await api("/tests/" + encodeURIComponent(CFG.testId) + "/access");
      const mins = st && st.timer_minutes != null ? Number(st.timer_minutes) : null;
      const el = $("mins");
      if (!el) return;
      const wrap = el.closest(".field") || el.closest(".panel-in") || el.parentNode;
      if (mins && mins >= 1) {
        el.value = String(mins);
        el.readOnly = true;
        el.tabIndex = -1;
        el.style.opacity = "0.85";
        el.setAttribute("data-lis-timer", String(mins));
        const lab = document.querySelector('label[for="mins"]');
        if (lab) lab.textContent = "Таймер (мин)";
      }
      const oldHint = document.getElementById("lisTimerHint");
      if (oldHint) oldHint.remove();
    } catch (e) {
      console.warn("timer", e);
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    ensureLockStyle();
    setAccessOk(false);
    loadServerGrading();
    applyTeacherTimer();

    let tries = 0;
    const t = setInterval(function () {
      tries++;
      try { if (typeof QUESTIONS !== "undefined" && QUESTIONS) window.QUESTIONS = QUESTIONS; } catch (e) {}
      patchStart();
      patchFinish();
      guardVisibleQuiz();
      if ((typeof window.finishTest === "function" && window.finishTest._lisPatched && $("start") && $("start")._lisPatched) || tries > 80) {
        clearInterval(t);
        guardVisibleQuiz();
      }
    }, 50);

    // страховка: если кто-то добавил .show без доступа — убрать (кроме finished)
    const mo = new MutationObserver(function () {
      if (!isAccessOk() && !isFinished()) {
        const tb = $("testbody");
        if (tb && tb.classList.contains("show")) tb.classList.remove("show");
      }
    });
    const watch = function () {
      const tb = $("testbody");
      if (tb) mo.observe(tb, { attributes: true, attributeFilter: ["class"] });
    };
    watch();
    setTimeout(watch, 500);
  });
})();
