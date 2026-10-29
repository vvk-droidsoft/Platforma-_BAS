/* Shared pure helpers for admin cabinet. Loaded before admin-app.js. */

const CYR_TO_LAT = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"z",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",
  н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"c",ш:"s",щ:"s",ъ:"",
  ы:"y",ь:"",э:"e",ю:"y",я:"y"
};

const ROLE_LABEL_RU = {
  admin: "Администратор",
  senior: "Старший инструктор",
  instructor: "Инструктор",
  assistant: "Ассистент инструктора"
};

function cmpSortVal(a, b, dir) {
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) return (a - b) * dir;
    return 0;
  }
  return String(a ?? "").localeCompare(String(b ?? ""), "ru", { numeric: true, sensitivity: "base" }) * dir;
}

function sortMarkHtml(state, key) {
  return state.key === key ? (state.dir > 0 ? "▲" : "▼") : "";
}

function thSortHtml(state, key, label) {
  if (!key) return "<th></th>";
  return `<th class="sortable" data-sort="${key}">${label}<span class="sort-mark">${sortMarkHtml(state, key)}</span></th>`;
}

function bindTableSort(headId, state, redraw) {
  const el = document.getElementById(headId);
  if (!el || el._lisSortBound) return;
  el._lisSortBound = true;
  el.addEventListener("click", e => {
    const th = e.target.closest("[data-sort]");
    if (!th || !th.dataset.sort) return;
    const key = th.dataset.sort;
    if (state.key === key) state.dir = -state.dir;
    else {
      state.key = key;
      state.dir = key === "when" ? -1 : 1;
    }
    redraw();
  });
}

/** Копирование работает и по HTTP (не только HTTPS/localhost). */
function copyText(text) {
  const value = String(text ?? "");
  if (!value) return Promise.reject(new Error("Пусто"));
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(value).catch(function () {
      return copyTextFallback(value);
    });
  }
  return copyTextFallback(value);
}

function copyTextFallback(value) {
  return new Promise(function (resolve, reject) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("copy failed"));
    } catch (e) {
      reject(e);
    }
  });
}

function flashCopied(btn, ms) {
  if (!btn) return;
  const label = btn.textContent;
  btn.textContent = "Скопировано";
  setTimeout(function () { btn.textContent = label; }, ms || 1200);
}

function originLink(path) {
  return location.origin + path;
}

function qrUrl(data) {
  return "/api/qr.png?data=" + encodeURIComponent(data);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function questionsWord(n) {
  const num = Math.abs(Number(n) || 0);
  const n100 = num % 100;
  const n10 = num % 10;
  if (n100 > 10 && n100 < 20) return "вопросов";
  if (n10 === 1) return "вопрос";
  if (n10 >= 2 && n10 <= 4) return "вопроса";
  return "вопросов";
}

function questionsCountPhrase(n) {
  const num = Number(n) || 0;
  if (num === 1) return "один вопрос";
  return num + " " + questionsWord(num);
}

function testQuestionsLabel(t) {
  const n = t && t.questions_count != null ? Number(t.questions_count) : NaN;
  if (!Number.isFinite(n) || n < 1) return "";
  return n + " " + questionsWord(n);
}

function testTimerLabel(t, empty) {
  if (t && t.timer_minutes != null) return t.timer_minutes + " мин";
  return empty != null ? empty : "таймер не задан";
}

function testHeadlineMeta(t) {
  const parts = [];
  const q = testQuestionsLabel(t);
  if (q) parts.push('<b class="ok">' + esc(q) + "</b>");
  else parts.push('<b class="warn">вопросы: —</b>');
  const tm = testTimerLabel(t, "");
  if (tm) parts.push('<b class="' + (t.timer_minutes ? "ok" : "warn") + '">' + esc(tm) + "</b>");
  else parts.push('<b class="warn">таймер не задан</b>');
  return parts.join(" · ");
}

function formatRatioPct(ok, bad) {
  const total = (Number(ok) || 0) + (Number(bad) || 0);
  if (total <= 0) return '<span class="hint">—</span>';
  const okPct = Math.round((Number(ok) || 0) / total * 100);
  const badPct = Math.round((Number(bad) || 0) / total * 100);
  return (
    `<span class="ratio-ok">${okPct}%</span>` +
    `<span class="ratio-sep">/</span>` +
    `<span class="ratio-bad">${badPct}%</span>`
  );
}

function formatDuration(sec) {
  if (sec == null || sec === "" || !Number.isFinite(Number(sec)) || Number(sec) < 0) return "—";
  const s = Math.floor(Number(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  return m + ":" + String(r).padStart(2, "0");
}

function gradeClass(g) {
  const s = String(g || "").trim();
  if (s === "5") return "grade-5";
  if (s === "4") return "grade-4";
  if (s === "3") return "grade-3";
  if (s === "2") return "grade-2";
  return "";
}

function attemptUnanswered(a) {
  if (a.unanswered_count != null) return Number(a.unanswered_count) || 0;
  const answers = Array.isArray(a.answers) ? a.answers : [];
  return answers.filter(x => x.pick == null).length;
}

function answerIsCorrect(ans) {
  if (!ans) return false;
  if (ans.ok === true) return true;
  return ans.pick != null && ans.correct != null && Number(ans.pick) === Number(ans.correct);
}

function classifyDetailAnswers(answers) {
  const list = Array.isArray(answers) ? answers : [];
  const answered = list.filter(a => a.pick != null);
  const unanswered = list.filter(a => a.pick == null);
  const correct = answered.filter(answerIsCorrect);
  const wrong = answered.filter(a => !answerIsCorrect(a));
  return { answered, unanswered, correct, wrong };
}

function firstLatinLetter(ch) {
  if (!ch) return "";
  const low = String(ch[0]).toLowerCase();
  if (low >= "a" && low <= "z") return low;
  const m = CYR_TO_LAT[low];
  return m ? m[0] : "";
}

function credentialsFromStaffFio(fio, role) {
  const parts = String(fio || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const surname = parts[0] || "";
  const login = surname ? (surname[0].toUpperCase() + surname.slice(1)) : "";
  const initials = [];
  for (let i = 0; i < Math.min(3, parts.length); i++) {
    const lat = firstLatinLetter(parts[i]);
    if (lat) initials.push(lat);
  }
  while (initials.length < 3) initials.push(initials.length ? initials[initials.length - 1] : "x");
  const roleLabel = ROLE_LABEL_RU[role] || role || "";
  const roleCh = firstLatinLetter(roleLabel) || "x";
  return { login, password: initials.slice(0, 3).join("") + roleCh };
}

