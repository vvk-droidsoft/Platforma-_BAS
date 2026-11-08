const $ = id => document.getElementById(id);
const MAX_OPTS = 6;
let parsed = null;       // объединённый банк для предпросмотра / одиночного файла
let sources = [];        // [{id, fileName, theme, questions, hasDiff, info, guess, pct, take}]
let sourceSeq = 1;
let shareLock = false;   // не пересчитывать проценты при правке «В тест»

const BANK_TPL_URL = "/static/generator/bank-template.xlsx";
const TEST_TPL_URL = "/static/generator/test-template.tpl";
let testTplPromise = null;
function loadTestTemplate(){
  if (!testTplPromise) {
    testTplPromise = fetch(TEST_TPL_URL).then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }
  return testTplPromise;
}
loadTestTemplate().catch(() => {});

function saveBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function say(t, ok){ $("msg").textContent = t; $("msg").className = ok ? "ok" : ""; }

/* ---------- таблица оценок (общая шкала сервера) ---------- */
const DEFAULT_GRADING = [[80,"5"],[70,"4"],[60,"3"],[0,"2"]];
function canEditGradingScale() {
  try {
    const u = JSON.parse(localStorage.getItem("lisAdminUser") || "null");
    const role = String((u && (u.role || u.acl_role)) || "").trim();
    return role === "admin" || role === "senior";
  } catch (e) {
    return false;
  }
}
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/"/g, "&quot;");
}
function renderGradingTable(rules) {
  const t = $("gr");
  if (!t) return;
  const editable = canEditGradingScale();
  const list = (rules && rules.length)
    ? rules.slice().sort((a, b) => Number(b.min) - Number(a.min))
    : DEFAULT_GRADING.map(([min, grade]) => ({ min, grade }));
  t.innerHTML = list.map((rule, idx) => {
    const ro = editable ? "" : " readonly";
    const del = editable
      ? '<td><button class="btn" type="button" data-grade-del="' + idx + '">Удалить</button></td>'
      : "<td></td>";
    return "<tr>" +
      "<td>от</td>" +
      '<td><input type="number" min="0" max="100" value="' + escapeAttr(rule.min) + '"' + ro + "></td>" +
      "<td>% →</td>" +
      '<td><input type="text" value="' + escapeAttr(rule.grade) + '"' + ro + "></td>" +
      del +
      "</tr>";
  }).join("");
  syncGradingControlsUi();
}
function syncGradingControlsUi() {
  const editable = canEditGradingScale();
  if ($("btnAddGradeRule")) $("btnAddGradeRule").hidden = !editable;
  if ($("btnSaveGrading")) $("btnSaveGrading").hidden = !editable;
  if ($("gradingEditHint")) {
    $("gradingEditHint").textContent = editable
      ? "Общая шкала на все тесты. Сохраните — пересчитаются оценки без ручной правки."
      : "Только просмотр. Шкалу меняют администратор и старший инструктор.";
  }
  const t = $("gr");
  if (!t) return;
  t.querySelectorAll("input").forEach(inp => {
    if (editable) inp.removeAttribute("readonly");
    else inp.setAttribute("readonly", "readonly");
  });
  t.querySelectorAll("[data-grade-del]").forEach(btn => {
    btn.hidden = !editable;
  });
}
function readGrading(){
  const t = $("gr");
  if (!t) return null;
  const rows = [...t.querySelectorAll("tr")].map(tr => {
    const i = tr.querySelectorAll("input");
    if (i.length < 2) return null;
    return { min: i[0].value.trim(), grade: i[1].value.trim() };
  }).filter(r => r && r.min !== "" && r.grade !== "");
  const out = rows.map(r => ({ min: Number(r.min), grade: r.grade }));
  if (!out.length || out.some(r => !isFinite(r.min) || r.min < 0 || r.min > 100)) return null;
  return out.sort((a, b) => b.min - a.min);
}
async function loadServerGrading(){
  try {
    const r = await fetch("/api/grading");
    if (!r.ok) {
      renderGradingTable(null);
      return;
    }
    const data = await r.json();
    const rules = (data.rules || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
    renderGradingTable(rules.length ? rules : null);
  } catch (e) {
    renderGradingTable(null);
  }
}
async function saveServerGrading(){
  if (!canEditGradingScale()) {
    say("Шкалу меняют администратор и старший инструктор.");
    return;
  }
  const rules = readGrading();
  if (!rules) {
    say("Проверьте таблицу оценок: процент должен быть числом от 0 до 100.");
    return;
  }
  const token = localStorage.getItem("lisAdminToken") || "";
  if (!token) {
    say("Нет сессии кабинета — войдите снова.");
    return;
  }
  say("Сохранение шкалы…");
  try {
    const r = await fetch("/api/admin/grading", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ rules })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.detail) || ("HTTP " + r.status));
    renderGradingTable(data.rules || rules);
    say("Шкала сохранена, оценки пересчитаны.", true);
  } catch (e) {
    say((e && e.message) || "Не удалось сохранить шкалу.");
  }
}
renderGradingTable(null);
loadServerGrading();
if ($("gr")) {
  $("gr").addEventListener("click", e => {
    const btn = e.target.closest("[data-grade-del]");
    if (!btn || !canEditGradingScale()) return;
    const idx = Number(btn.getAttribute("data-grade-del"));
    const cur = readGrading() || [];
    cur.splice(idx, 1);
    renderGradingTable(cur.length ? cur : [{ min: 0, grade: "2" }]);
  });
}

/* ---------- разбор Excel ---------- */
const cellStr = v => (v === null || v === undefined) ? "" : String(v).trim();

function parseCorrect(raw){
  const s = cellStr(raw).replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) return parseInt(s, 10);
  const L = { "а":1,"б":2,"в":3,"г":4,"a":1,"b":2,"c":3,"d":4 }[s.toLowerCase()];
  return L || NaN;
}

function parseDiff(raw){
  const s = cellStr(raw).toLowerCase();
  if (!s) return "";
  if (/^(с|сложн\S*|hard|h)$/.test(s)) return "h";
  if (/^(п|прост\S*|easy|e)$/.test(s)) return "e";
  return "?";
}

function parseXlsx(buf){
  const wb = XLSX.read(buf, { type: "array" });
  const name = wb.SheetNames.includes("Вопросы") ? "Вопросы" : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: false });

  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cs = rows[i].map(cellStr);
    if (cs.some(c => /^вопрос/i.test(c)) && cs.filter(c => /^вариант/i.test(c)).length >= 2) { h = i; break; }
  }
  if (h < 0) throw new Error("Не найдена строка заголовков с колонкой «Вопрос». Используйте шаблон Excel.");

  const head = rows[h].map(cellStr);
  const info = { num: "", name: "", aud: "" };
  for (let i = 0; i < h; i++) {
    rows[i].forEach((cell, j) => {
      const lab = cellStr(cell).toLowerCase();
      const val = span => { for (let k = j + 1; k <= j + span && k < rows[i].length; k++) { const v = cellStr(rows[i][k]); if (v) return v; } return ""; };
      if (/^номер\s+модул/.test(lab)) info.num = val(1);
      else if (/^название\s+модул/.test(lab)) info.name = val(4);
      else if (/^для\s+кого/.test(lab)) info.aud = val(1);
    });
  }
  const qCol = head.findIndex(c => /^вопрос/i.test(c));
  const oCols = head.map((c, i) => /^вариант/i.test(c) ? i : -1).filter(i => i >= 0);
  const cCol = head.findIndex(c => /правильн/i.test(c));
  const dCol = head.findIndex(c => /сложн/i.test(c));
  if (oCols.length < 2) throw new Error("Не найдены колонки «Вариант 1», «Вариант 2»… Используйте шаблон Excel.");
  if (cCol < 0) throw new Error("Не найдена колонка «Номер правильного ответа». Используйте шаблон Excel.");

  const questions = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    const q = cellStr(row[qCol]);
    const optsRaw = oCols.map(c => cellStr(row[c]));
    if (!q && optsRaw.every(x => !x)) continue;
    const item = { n: questions.length + 1, q, a: [], correct: null, error: "", src: "строка " + (r + 1), d: null, _d: dCol >= 0 ? parseDiff(row[dCol]) : "" };

    if (!q) item.error = "Не заполнен текст вопроса.";
    const filled = optsRaw.map((x, i) => x ? i : -1).filter(i => i >= 0);
    item.a = filled.map(i => optsRaw[i]);
    const corr = parseCorrect(row[cCol]);

    if (!item.error && item.a.length < 2) item.error = "Нужно минимум 2 варианта ответа.";
    if (!item.error && filled.some((v, k) => v !== k)) item.error = "Между вариантами есть пустые ячейки — заполняйте варианты подряд.";
    if (!item.error) {
      if (corr === null) item.error = "Не указан номер правильного ответа.";
      else if (!Number.isInteger(corr) || corr < 1 || corr > optsRaw.length) item.error = "Некорректный номер правильного ответа: «" + cellStr(row[cCol]) + "».";
      else if (corr > item.a.length) item.error = "Правильный ответ № " + corr + ", но такой вариант пуст.";
      else item.correct = corr;
    }
    questions.push(item);
  }
  let hasDiff = false;
  if (dCol >= 0 && questions.some(q => q._d === "e" || q._d === "h")) {
    hasDiff = true;
    questions.forEach(q => {
      if (q._d === "e" || q._d === "h") q.d = q._d;
      else if (!q.error) q.error = q._d === "?"
        ? "Сложность должна быть «Простой» или «Сложный»."
        : "Не указана сложность. Заполните её для всех вопросов или оставьте всю колонку пустой.";
    });
  }
  return { questions, guess: "", hasDiff, info };
}

/* ---------- разбор Word ---------- */
function isRedHex(hex){
  if (!/^[0-9a-f]{6}$/i.test(hex || "")) return false;
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return r >= 0xB0 && g <= 0x70 && b <= 0x70;
}

async function parseDocx(buf){
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("Не удалось прочитать документ Word.");
  const xml = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paras = [...xml.getElementsByTagNameNS(W, "body")[0].getElementsByTagNameNS(W, "p")];

  const lines = paras.map(p => {
    let text = "", redLen = 0;
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      let t = "";
      for (const n of r.childNodes) {
        if (n.localName === "t") t += n.textContent;
        else if (n.localName === "tab") t += " ";
      }
      text += t;
      const col = r.getElementsByTagNameNS(W, "color")[0];
      if (col && isRedHex(col.getAttributeNS(W, "val")) ) redLen += t.replace(/\s/g, "").length;
    }
    const clean = text.replace(/\s+/g, " ").trim();
    const total = clean.replace(/\s/g, "").length;
    return { text: clean, red: total > 0 && redLen >= total * 0.5 };
  }).filter(l => l.text);

  const SEP = "(?:\\s*[-–—:=]\\s*|\\s+)";
  const KEYLINE = new RegExp("^(?:\\d+" + SEP + "\\d\\s*[,;]?\\s*)+$");
  const KEYHEAD = /^(?:правильные\s+)?(?:ответы|ключ)\s*:?$/i;
  const stripOpt = s => s.replace(/^[\u2022•*\-–—]\s+/, "").replace(/^(?:[A-Da-dА-Га-г]|[1-6])[.)]\s+/, "").trim();

  const header = [], qs = [], key = {};
  let cur = null, expect = 1;
  for (const l of lines) {
    if (KEYLINE.test(l.text)) {
      for (const m of l.text.matchAll(new RegExp("(\\d+)" + SEP + "(\\d)", "g"))) key[parseInt(m[1], 10)] = parseInt(m[2], 10);
      continue;
    }
    if (KEYHEAD.test(l.text)) continue;
    // формат «1. Текст вопроса»
    const m = /^(\d+)\s*[.)]\s*(.+)$/.exec(l.text);
    if (m && parseInt(m[1], 10) === expect) {
      cur = { n: expect, q: m[2].trim(), a: [], reds: [] };
      qs.push(cur); expect++;
      continue;
    }
    // формат «Вопрос 1» (текст вопроса — в следующей строке) или «Вопрос 1. Текст»
    const m2 = /^вопрос\s*(?:№\s*)?(\d+)\s*[.:)]?\s*(.*)$/i.exec(l.text);
    if (m2 && parseInt(m2[1], 10) === expect) {
      cur = { n: expect, q: m2[2].trim(), a: [], reds: [] };
      qs.push(cur); expect++;
      continue;
    }
    if (!cur) { header.push(l.text); continue; }
    if (!cur.q && !cur.a.length) { cur.q = l.text; continue; }
    cur.a.push(stripOpt(l.text));
    if (l.red) cur.reds.push(cur.a.length);
  }
  if (!qs.length) throw new Error("Не найдены вопросы. В документе вопросы должны начинаться с номера («1. …») или со слов «Вопрос 1».");

  const questions = qs.map(q => {
    const item = { n: q.n, q: q.q, a: q.a, correct: null, error: "", src: "вопрос " + q.n };
    if (q.a.length < 2) item.error = "Нужно минимум 2 варианта ответа.";
    else if (q.a.length > MAX_OPTS) item.error = "Больше " + MAX_OPTS + " вариантов — проверьте, нет ли в конце лишнего текста.";
    else if (q.reds.length > 1) item.error = "Красным выделено несколько вариантов.";
    else if (q.reds.length === 1) item.correct = q.reds[0];
    else if (key[q.n] && key[q.n] >= 1 && key[q.n] <= q.a.length) item.correct = key[q.n];
    else item.error = "Правильный ответ не выделен красным и не указан в списке ответов.";
    return item;
  });

  let guess = "";
  const k = header.findIndex(x => /по модулю/i.test(x));
  if (k >= 0 && header[k + 1] && !/номер|позывн/i.test(header[k + 1])) guess = header[k + 1];
  return { questions, guess, hasDiff: false };
}

/* ---------- предпросмотр / несколько файлов ---------- */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c])); }

function themeFromParsed(data, fileName){
  const inf = (data && data.info) || {};
  if (inf.name && String(inf.name).trim()) return String(inf.name).trim();
  if (data && data.guess && String(data.guess).trim()) return String(data.guess).trim();
  return String(fileName || "Без названия").replace(/\.[^.]+$/, "");
}

function okQuestions(src){
  return (src.questions || []).filter(q => !q.error);
}

function testTotalWanted(){
  let n = parseInt($("cnt").value, 10);
  if (!(n >= 1)) n = 0;
  return n;
}

function equalPcts(n){
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  let rem = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Распределение total по долям pct с учётом лимитов caps (largest remainder). */
function allocateByPct(total, pcts, caps){
  const n = pcts.length;
  if (!n || total < 1) return pcts.map(() => 0);
  const raw = pcts.map(p => total * (Number(p) || 0) / 100);
  let takes = raw.map(v => Math.floor(v));
  let rem = total - takes.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < rem; k++) takes[order[k % n].i]++;
  // ужать до caps и перераспределить остаток
  let spare = 0;
  for (let i = 0; i < n; i++) {
    const cap = caps[i] != null ? caps[i] : Infinity;
    if (takes[i] > cap) { spare += takes[i] - cap; takes[i] = cap; }
  }
  if (spare > 0) {
    const room = takes.map((t, i) => ({ i, free: Math.max(0, (caps[i] != null ? caps[i] : Infinity) - t) }))
      .filter(x => x.free > 0)
      .sort((a, b) => b.free - a.free || a.i - b.i);
    let p = 0;
    while (spare > 0 && room.length) {
      const r = room[p % room.length];
      if (r.free <= 0) { room.splice(p % room.length, 1); if (!room.length) break; continue; }
      takes[r.i]++; r.free--; spare--; p++;
    }
  }
  return takes;
}

function applyEqualShares(){
  if (!sources.length) return;
  const pcts = equalPcts(sources.length);
  sources.forEach((s, i) => { s.pct = pcts[i]; });
  recalcTakesFromPct();
}

function recalcTakesFromPct(){
  if (!sources.length) return;
  const total = testTotalWanted();
  const caps = sources.map(s => okQuestions(s).length);
  const pcts = sources.map(s => Number(s.pct) || 0);
  const takes = allocateByPct(total, pcts, caps);
  sources.forEach((s, i) => { s.take = takes[i]; });
}

function recalcPctFromTakes(){
  if (!sources.length) return;
  const sum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
  if (sum <= 0) {
    applyEqualShares();
    return;
  }
  const raw = sources.map(s => (Number(s.take) || 0) * 100 / sum);
  let pcts = raw.map(v => Math.floor(v));
  let rem = 100 - pcts.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; k < rem; k++) pcts[order[k % order.length].i]++;
  sources.forEach((s, i) => { s.pct = pcts[i]; });
}

function rebuildCombined(){
  if (!sources.length) {
    parsed = null;
    return;
  }
  const questions = [];
  let hasDiff = sources.length === 1 && !!sources[0].hasDiff;
  sources.forEach(src => {
    src.questions.forEach(q => {
      questions.push(Object.assign({}, q, {
        n: questions.length + 1,
        src: (src.theme || src.fileName) + " · " + (q.src || "")
      }));
    });
  });
  if (sources.length > 1) hasDiff = false;
  parsed = {
    questions,
    guess: sources.map(s => s.theme).filter(Boolean).join(" + "),
    hasDiff,
    info: sources.length === 1 ? (sources[0].info || {}) : {},
    multi: sources.length > 1
  };
}

function sourcesFootHtml(){
  if (!sources.length) return "";
  const want = testTotalWanted();
  const takeSum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
  const pctSum = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0);
  const bankOk = sources.reduce((a, s) => a + okQuestions(s).length, 0);
  const bits = [];
  bits.push("Доли: <b>" + pctSum + "%</b>");
  bits.push("в тест: <b>" + takeSum + "</b> из " + want);
  bits.push("в банках без ошибок: <b>" + bankOk + "</b>");
  if (pctSum !== 100) bits.push('<span class="bad">сумма долей должна быть 100%</span>');
  else if (takeSum !== want && want > 0) bits.push('<span class="bad">сумма «В тест» ≠ числу вопросов теста</span>');
  else bits.push('<span class="ok">доли согласованы</span>');
  return bits.join(" · ");
}

function syncCntFields(fromId){
  const a = $("cnt");
  const b = $("cntStep1");
  if (!a || !b) return;
  if (fromId === "cntStep1") a.value = b.value;
  else b.value = a.value;
}

function syncTimerFields(fromId){
  const a = $("timerMin");
  const b = $("timerStep1");
  if (!a || !b) return;
  if (fromId === "timerStep1") a.value = b.value;
  else b.value = a.value;
}

function applyNoTimerUi(){
  const off = !!($("noTimer") && $("noTimer").checked);
  ["timerMin", "timerStep1"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = off;
    el.style.opacity = off ? "0.45" : "";
  });
}

function audienceRosterLabelLocal(audience) {
  const a = String(audience || "").trim();
  if (a === "Инструктор") return "Инструкторы";
  if (a === "Ассистент инструктора") return "Ассистенты";
  if (a === "Инструкторы и Ассистенты") return "Инструкторы и Ассистенты";
  return "Курсанты";
}

function renderSources(){
  const wrap = $("sourcesWrap");
  const body = $("sourcesBody");
  const clearBtn = $("btnClearSources");
  const cntBox = $("cntStep1Box");
  if (!wrap || !body) return;
  if (!sources.length) {
    wrap.hidden = true;
    if (clearBtn) clearBtn.hidden = true;
    if (cntBox) cntBox.hidden = true;
    body.innerHTML = "";
    if ($("sourcesFoot")) $("sourcesFoot").innerHTML = "";
    return;
  }
  wrap.hidden = false;
  if (clearBtn) clearBtn.hidden = false;
  if (cntBox) cntBox.hidden = false;
  syncCntFields("cnt");
  syncTimerFields("timerMin");
  body.innerHTML = sources.map(s => {
    const ok = okQuestions(s).length;
    const bad = (s.questions || []).length - ok;
    return `<tr data-src="${s.id}">
      <td>${esc(s.fileName)}</td>
      <td><input type="text" class="src-theme" value="${esc(s.theme)}" title="Название темы"></td>
      <td>${ok}${bad ? ' <span class="e">(+ошибок: ' + bad + ")</span>" : ""}</td>
      <td><input type="number" class="src-pct" min="0" max="100" step="1" value="${Number(s.pct) || 0}"></td>
      <td><input type="number" class="src-take" min="0" max="${ok}" step="1" value="${Number(s.take) || 0}"></td>
      <td><button class="btn src-del" type="button" data-del="${s.id}">Удалить</button></td>
    </tr>`;
  }).join("");
  if ($("sourcesFoot")) $("sourcesFoot").innerHTML = sourcesFootHtml();
}

function syncModNameSuggestion(){
  if (!sources.length) return;
  if ($("mod").value.trim() && sources.length > 1 && !$("mod").dataset.auto) return;
  if (sources.length === 1) {
    const s = sources[0];
    const inf = s.info || {};
    if (inf.name) $("mod").value = inf.name;
    else if (s.guess) $("mod").value = s.guess;
    else if (s.theme) $("mod").value = s.theme;
    delete $("mod").dataset.auto;
  } else {
    const name = "Сводный тест · " + sources.map(s => s.theme || s.fileName).join(" + ");
    $("mod").value = name.slice(0, 120);
    $("mod").dataset.auto = "1";
  }
}

function setBankStatus(text, kind){
  const el = $("bankStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "bank-status" + (kind ? (" " + kind) : "");
}

function render(){
  const list = $("list"), sum = $("sum");
  list.innerHTML = "";
  if ($("prevpanel")) $("prevpanel").className = "preview-block";
  renderSources();
  rebuildCombined();
  if (!parsed || !sources.length) {
    sum.textContent = "Файлы ещё не загружены.";
    $("make").disabled = true;
    $("modinfo").textContent = "";
    setBankStatus("Файлы ещё не загружены");
    updateDiff();
    return;
  }
  const qs = parsed.questions;
  const bad = qs.filter(q => q.error).length;
  const takeSum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
  if (sources.length > 1) {
    sum.innerHTML = "Сводный банк: файлов <b>" + sources.length + "</b>, вопросов <b>" + qs.length + "</b>" +
      (bad ? ' · <span class="e">с ошибками: ' + bad + "</span>" : ' · <span class="g">ошибок нет</span>') +
      " · в тест по долям: <b>" + takeSum + "</b>";
  } else {
    sum.innerHTML = "Найдено вопросов: <b>" + qs.length + "</b> · " +
      (bad ? '<span class="e">с ошибками: ' + bad + " — исправьте файл и загрузите снова</span>" : '<span class="g">ошибок нет</span>');
  }
  if ($("prevpanel")) $("prevpanel").className = "preview-block" + (bad ? " bad" : " ok");
  setBankStatus(
    (bad ? ("Ошибок: " + bad + " · ") : "Банк готов · ") + qs.length + " вопр." +
      (takeSum ? (" · в тест: " + takeSum) : ""),
    bad ? "bad" : "ok"
  );
  qs.forEach(q => {
    const d = document.createElement("div");
    d.className = "q" + (q.error ? " err" : "");
    d.innerHTML = '<div class="qt"><span class="qn">№ ' + q.n + "</span>" + esc(q.q || "(пусто)") +
      (q.d ? '<span class="dg ' + q.d + '">' + (q.d === "h" ? "сложный" : "простой") + "</span>" : "") + "</div>" +
      "<ol>" + q.a.map((x, i) => '<li class="' + (q.correct === i + 1 ? "c" : "") + '">' + esc(x) + "</li>").join("") + "</ol>" +
      (q.error ? '<div class="em">⚠ ' + esc(q.src) + ": " + esc(q.error) + "</div>" : "");
    list.appendChild(d);
  });
  const pctOk = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0) === 100;
  const want = testTotalWanted();
  const takesOk = takeSum === want && want > 0;
  const capsOk = sources.every(s => (Number(s.take) || 0) <= okQuestions(s).length);
  $("make").disabled = !qs.length || bad > 0 || !pctOk || !takesOk || !capsOk;
  const bankOk = sources.reduce((a, s) => a + okQuestions(s).length, 0);
  if (want > bankOk && bankOk > 0) {
    $("cnt").value = bankOk;
    syncCntFields("cnt");
    applyEqualShares();
    renderSources();
  }
  updateDiff();
}

async function parseOneFile(file){
  const buf = await file.arrayBuffer();
  const ext = file.name.split(".").pop().toLowerCase();
  let data;
  if (ext === "docx") data = await parseDocx(buf);
  else if (["xlsx", "xls", "xlsm"].includes(ext)) data = parseXlsx(buf);
  else if (ext === "doc") throw new Error(file.name + ": формат .doc не поддерживается. Сохраните как .docx.");
  else throw new Error(file.name + ": неподдерживаемый формат.");
  if (!data.questions || !data.questions.length) throw new Error(file.name + ": в файле нет вопросов.");
  return data;
}

async function handleFiles(fileList){
  const files = [...(fileList || [])].filter(Boolean);
  if (!files.length) return;
  say("");
  $("fileinfo").textContent = "Читаю: " + files.map(f => f.name).join(", ") + " …";
  const errors = [];
  for (const file of files) {
    try {
      const data = await parseOneFile(file);
      const theme = themeFromParsed(data, file.name);
      sources.push({
        id: sourceSeq++,
        fileName: file.name,
        theme,
        questions: data.questions,
        hasDiff: !!data.hasDiff,
        info: data.info || {},
        guess: data.guess || "",
        pct: 0,
        take: 0
      });
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  applyEqualShares();
  syncModNameSuggestion();
  if (sources.length === 1) {
    const s = sources[0];
    const inf = s.info || {};
    if (inf.num) $("modnum").value = inf.num;
    if (inf.aud) {
      const o = [...$("aud").options].find(x => x.value && x.value.toLowerCase() === inf.aud.trim().toLowerCase());
      if (o) $("aud").value = o.value;
    }
    const bits = [];
    if (inf.num) bits.push("модуль № " + inf.num);
    if (inf.name || s.theme) bits.push("«" + (inf.name || s.theme) + "»");
    if (inf.aud) bits.push("для кого: " + inf.aud);
    $("modinfo").textContent = bits.length ? "Из файла: " + bits.join(" · ") : "";
  } else if (sources.length > 1) {
    $("modinfo").textContent = "Сводный тест из " + sources.length + " файлов. Настройте доли и название.";
  }
  $("fileinfo").textContent = sources.length
    ? ("Загружено файлов: " + sources.length + (errors.length ? " · ошибок: " + errors.length : ""))
    : "";
  render();
  if (errors.length) say(errors.join(" · "));
  else if (sources.length) say("Файлы загружены. Проверьте доли и название теста.", true);
}

$("file").addEventListener("change", e => {
  if (e.target.files && e.target.files.length) handleFiles(e.target.files);
  e.target.value = "";
});
const drop = $("drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleFiles(files);
});

if ($("btnClearSources")) {
  $("btnClearSources").addEventListener("click", () => {
    sources = [];
    parsed = null;
    $("fileinfo").textContent = "";
    $("modinfo").textContent = "";
    setBankStatus("Файлы ещё не загружены");
    delete $("mod").dataset.auto;
    render();
    say("");
  });
}

if ($("sourcesBody")) {
  $("sourcesBody").addEventListener("input", e => {
    const tr = e.target.closest("tr[data-src]");
    if (!tr) return;
    const id = Number(tr.getAttribute("data-src"));
    const src = sources.find(s => s.id === id);
    if (!src) return;
    if (e.target.classList.contains("src-theme")) {
      src.theme = e.target.value;
      if ($("mod").dataset.auto) syncModNameSuggestion();
      return;
    }
    if (e.target.classList.contains("src-pct")) {
      src.pct = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      shareLock = true;
      recalcTakesFromPct();
      shareLock = false;
      renderSources();
      rebuildCombined();
      const want = testTotalWanted();
      const takeSum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
      const pctOk = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0) === 100;
      $("make").disabled = !parsed || parsed.questions.some(q => q.error) || !pctOk || takeSum !== want || want < 1;
      return;
    }
    if (e.target.classList.contains("src-take")) {
      const cap = okQuestions(src).length;
      src.take = Math.max(0, Math.min(cap, parseInt(e.target.value, 10) || 0));
      shareLock = true;
      recalcPctFromTakes();
      const sumTake = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
      if (sumTake >= 1) {
        $("cnt").value = String(sumTake);
        syncCntFields("cnt");
      }
      shareLock = false;
      renderSources();
      const want = testTotalWanted();
      const pctOk = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0) === 100;
      $("make").disabled = !parsed || parsed.questions.some(q => q.error) || !pctOk || sumTake !== want || want < 1;
    }
  });
  $("sourcesBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-del"));
    sources = sources.filter(s => s.id !== id);
    if (sources.length) applyEqualShares();
    syncModNameSuggestion();
    render();
  });
}

$("mod").addEventListener("input", () => { delete $("mod").dataset.auto; });

$("tpl").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = BANK_TPL_URL;
  a.download = "Шаблон_банк_вопросов.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
});

/* ---------- состав теста по сложности ---------- */
function diffPools(){
  if (!parsed || !parsed.hasDiff) return null;
  return {
    hp: parsed.questions.filter(q => q.d === "h").length,
    ep: parsed.questions.filter(q => q.d === "e").length
  };
}
function calcMix(){
  const pl = diffPools(); if (!pl) return null;
  let n = parseInt($("cnt").value, 10); if (!(n >= 1)) n = 0;
  const share = Number($("share").value);
  let h = Math.round(n * share / 100), warn = "";
  if (h > pl.hp) { h = pl.hp; warn = "Сложных вопросов в банке всего " + pl.hp + ". "; }
  let e = n - h;
  if (e > pl.ep) { e = pl.ep; warn += "Простых вопросов в банке всего " + pl.ep + ". "; h = Math.min(pl.hp, n - e); }
  const total = h + e;
  if (total < n) warn += "В тест войдёт " + total + " вопр. вместо " + n + ". ";
  return { n: total, h, e, warn };
}
function updateDiff(){
  const box = $("diffbox"), pl = diffPools();
  // сложность только для одного файла
  box.hidden = !pl || sources.length > 1;
  if (!pl || sources.length > 1) return;
  $("diffcnt").textContent = "В банке: простых — " + pl.ep + ", сложных — " + pl.hp + ".";
  const m = calcMix();
  $("mix").innerHTML = "В тесте будет: простых — <b>" + m.e + "</b>, сложных — <b>" + m.h + "</b> (всего " + m.n + ")." +
    (m.warn ? '<span class="w">' + esc(m.warn) + "</span>" : "");
  document.querySelectorAll("#presets .btn").forEach(b => b.classList.toggle("on", Number(b.dataset.v) === Number($("share").value)));
}
$("share").addEventListener("input", updateDiff);
function onCntInput(fromId){
  syncCntFields(fromId);
  if (!shareLock && sources.length) {
    const pctSum = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0);
    if (pctSum === 100) recalcTakesFromPct();
    else applyEqualShares();
    renderSources();
  }
  updateDiff();
  if (sources.length) {
    const want = testTotalWanted();
    const takeSum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
    const pctOk = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0) === 100;
    const bad = parsed && parsed.questions.some(q => q.error);
    $("make").disabled = !parsed || bad || !pctOk || takeSum !== want || want < 1;
  }
}
$("cnt").addEventListener("input", () => onCntInput("cnt"));
if ($("cntStep1")) $("cntStep1").addEventListener("input", () => onCntInput("cntStep1"));
if ($("timerMin")) $("timerMin").addEventListener("input", () => syncTimerFields("timerMin"));
if ($("timerStep1")) $("timerStep1").addEventListener("input", () => syncTimerFields("timerStep1"));
if ($("noTimer")) {
  $("noTimer").addEventListener("change", applyNoTimerUi);
  applyNoTimerUi();
}
$("presets").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  $("share").value = b.dataset.v; updateDiff();
});
$("make").textContent = "Создать тест и получить ссылку";

/* ---------- создание теста ---------- */
const jsLit = v => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/* ---------- Режим правки существующего теста ---------- */
const editTestId = (function () {
  try {
    return (new URLSearchParams(location.search).get("edit") || "").trim();
  } catch (e) {
    return "";
  }
})();
function applyEditModeUi() {
  if (!editTestId) return;
  $("make").textContent = "Сохранить изменения в тесте";
  if ($("makePub")) $("makePub").textContent = "Сохранить и опубликовать для всех";
  const foot = document.querySelector(".foot");
  if (foot) {
    foot.textContent = "Режим правки: ссылка и список курсантов сохранятся. Загрузите новый банк (XLSX) и нажмите «Сохранить изменения в тесте».";
  }
  const banner = document.createElement("div");
  banner.id = "editModeBanner";
  banner.style.cssText = "margin:0 0 14px;padding:12px 14px;border:1px solid var(--cyan);background:rgba(25,240,240,.08);color:#c9fbfb";
  banner.innerHTML = "<b>Редактирование существующего теста</b><div class=\"hint\" style=\"margin-top:6px\">Ссылка для курсантов не изменится. Можно пополнить банк из другого файла и обновить параметры.</div>";
  const wrap = document.querySelector(".wrap") || document.body;
  wrap.insertBefore(banner, wrap.firstChild);
}
applyEditModeUi();

function generatorQuery() {
  try { return new URLSearchParams(location.search); }
  catch (e) { return new URLSearchParams(); }
}
function isCabinetGenerator() {
  return generatorQuery().get("cabinet") === "1";
}
function isWizardGenerator() {
  return isCabinetGenerator() && generatorQuery().get("wizard") === "1";
}
function wizardKind() {
  const k = (generatorQuery().get("kind") || "interim").trim();
  return k === "mandatory" ? "mandatory" : "interim";
}
function moveEl(id, parent) {
  const el = $(id);
  if (el && parent) parent.appendChild(el);
}
function showWizardTab(name) {
  const main = $("wizardPaneMain");
  const adv = $("wizardPaneAdv");
  const tMain = $("wizardTabMain");
  const tAdv = $("wizardTabAdv");
  const onMain = name !== "adv";
  if (main) main.classList.toggle("on", onMain);
  if (adv) adv.classList.toggle("on", !onMain);
  if (tMain) tMain.classList.toggle("on", onMain);
  if (tAdv) tAdv.classList.toggle("on", !onMain);
}
function applyWizardGeneratorUi() {
  if (!isWizardGenerator()) return;
  document.documentElement.classList.add("cabinet-embed", "wizard-embed");
  document.body.classList.add("cabinet-embed", "wizard-embed");
  const qs = generatorQuery();
  const audience = (qs.get("audience") || "").trim();
  const kind = wizardKind();
  const wrap = document.querySelector(".wrap");
  const oldShell = document.querySelector(".shell");
  if (!wrap || !oldShell || $("wizardShell")) return;
  // Навигация lis-nav («На главную» / «Назад») в iframe кабинета не нужна
  const lisNav = document.getElementById("lisNav");
  if (lisNav) lisNav.remove();
  if ($("btnTabPrev")) $("btnTabPrev").hidden = true;
  if ($("btnTabNext")) $("btnTabNext").hidden = true;
  if ($("makeDl")) $("makeDl").hidden = true;
  const cabLinks = document.querySelectorAll('a.btn[href="/admin"], a.btn[href="/"]');
  cabLinks.forEach(a => { a.hidden = true; });

  if ($("aud") && audience) {
    const opt = [...$("aud").options].find(o => o.value === audience);
    if (opt) $("aud").value = audience;
    $("aud").disabled = true;
  }

  const shell = document.createElement("div");
  shell.className = "shell wizard-shell";
  shell.id = "wizardShell";
  shell.innerHTML =
    '<div class="shell-head">' +
      "<div>" +
        "<h1 id=\"wizardTitle\">Создание теста</h1>" +
        '<div class="sub" id="wizardSub"></div>' +
      "</div>" +
      '<div class="bank-status" id="wizardBankStatusHost"></div>' +
    "</div>" +
    '<div class="wizard-kind" id="wizardKindBadge"></div>' +
    '<div class="tabs wizard-tabs" role="tablist">' +
      '<button class="tab on" type="button" id="wizardTabMain"><span class="n">1</span>Основное</button>' +
      '<button class="tab" type="button" id="wizardTabAdv"><span class="n">2</span>Расширенные настройки</button>' +
    "</div>" +
    '<div class="pane on" id="wizardPaneMain"></div>' +
    '<div class="pane" id="wizardPaneAdv"></div>' +
    '<div class="shell-foot wizard-foot">' +
      '<div class="foot-actions" style="margin-left:0;max-width:none;width:100%">' +
        '<button class="btn main" id="wizardGo" type="button" disabled>Создать и получить ссылку</button>' +
        '<p class="hint" id="wizardGoHint" style="margin:8px 0 0"></p>' +
      "</div>" +
    "</div>";
  wrap.insertBefore(shell, oldShell);
  oldShell.hidden = true;
  const foot = document.querySelector(".foot");
  if (foot) foot.hidden = true;

  const main = $("wizardPaneMain");
  const adv = $("wizardPaneAdv");
  const statusHost = $("wizardBankStatusHost");
  if (statusHost && $("bankStatus")) statusHost.appendChild($("bankStatus"));

  // Основное: банк + ключевые параметры
  const mainBlock = document.createElement("div");
  mainBlock.className = "wizard-main-grid";
  main.appendChild(mainBlock);
  const bankBox = document.createElement("div");
  bankBox.className = "wizard-bank";
  mainBlock.appendChild(bankBox);
  moveEl("drop", bankBox);
  const tplRow = document.createElement("div");
  tplRow.className = "row";
  tplRow.style.marginTop = "10px";
  bankBox.appendChild(tplRow);
  moveEl("tpl", tplRow);
  moveEl("btnClearSources", tplRow);
  moveEl("fileinfo", bankBox);
  moveEl("prevpanel", bankBox);

  const paramsBox = document.createElement("div");
  paramsBox.className = "wizard-params";
  mainBlock.appendChild(paramsBox);
  const field = (forId, labelText) => {
    const box = document.createElement("div");
    const lab = document.createElement("label");
    lab.className = "l";
    lab.htmlFor = forId;
    lab.textContent = labelText;
    box.appendChild(lab);
    const inp = $(forId);
    if (inp) box.appendChild(inp);
    paramsBox.appendChild(box);
    return box;
  };
  field("modnum", "Номер модуля");
  field("mod", "Название");
  const timerBox = field("timerMin", "Установить таймер, мин");
  if ($("noTimer") && timerBox) {
    const noWrap = document.createElement("label");
    noWrap.className = "chk";
    noWrap.style.marginTop = "8px";
    noWrap.appendChild($("noTimer"));
    const sp = document.createElement("span");
    sp.textContent = "Без таймера";
    noWrap.appendChild(sp);
    timerBox.appendChild(noWrap);
  }
  field("cnt", "Количество вопросов в тесте");

  // Расширенные: мультибанк, аудитория, сложность, пароль, критерии оценки
  const advHint = document.createElement("p");
  advHint.className = "hint";
  advHint.textContent =
    "Необязательно для быстрого создания. Мультибанк, сложность, пароль и критерии оценки.";
  adv.appendChild(advHint);
  moveEl("sourcesWrap", adv);
  const audBox = document.createElement("div");
  audBox.style.marginTop = "12px";
  adv.appendChild(audBox);
  const audLab = document.createElement("label");
  audLab.className = "l";
  audLab.htmlFor = "aud";
  audLab.textContent = "Аудитория";
  audBox.appendChild(audLab);
  moveEl("aud", audBox);
  moveEl("audHint", audBox);
  if ($("shuf")) {
    const sh = document.createElement("div");
    sh.style.marginTop = "10px";
    adv.appendChild(sh);
    const lab = $("shuf").closest("label") || $("shuf").parentElement;
    if (lab) sh.appendChild(lab);
  }
  if ($("masterPwd") && $("masterPwd").parentElement) {
    const mpBox = $("masterPwd").parentElement;
    mpBox.style.marginTop = "12px";
    const mpLab = mpBox.querySelector("label.l");
    if (mpLab) mpLab.textContent = "Мастер-пароль";
    adv.appendChild(mpBox);
  }
  moveEl("diffbox", adv);
  const gradeWrap = document.createElement("div");
  gradeWrap.id = "wizardGradingBlock";
  gradeWrap.style.marginTop = "14px";
  gradeWrap.style.paddingTop = "12px";
  gradeWrap.style.borderTop = "1px solid rgba(25,240,240,.18)";
  adv.appendChild(gradeWrap);
  const gLab = document.createElement("label");
  gLab.className = "l";
  gLab.textContent = "Критерии оценки";
  gradeWrap.appendChild(gLab);
  const gHint = document.createElement("p");
  gHint.className = "hint";
  gHint.id = "gradingEditHint";
  gHint.textContent = "Общая шкала на все тесты. Процент = верные / все вопросы; без ответа = неверно.";
  gradeWrap.appendChild(gHint);
  moveEl("gr", gradeWrap);
  const gActions = document.createElement("div");
  gActions.className = "row";
  gActions.style.marginTop = "10px";
  gActions.style.alignItems = "center";
  gradeWrap.appendChild(gActions);
  const btnAdd = document.createElement("button");
  btnAdd.className = "btn";
  btnAdd.type = "button";
  btnAdd.id = "btnAddGradeRule";
  btnAdd.textContent = "Добавить порог";
  btnAdd.hidden = true;
  gActions.appendChild(btnAdd);
  const btnSave = document.createElement("button");
  btnSave.className = "btn main";
  btnSave.type = "button";
  btnSave.id = "btnSaveGrading";
  btnSave.textContent = "Сохранить шкалу";
  btnSave.hidden = true;
  gActions.appendChild(btnSave);
  btnAdd.onclick = () => {
    if (!canEditGradingScale()) return;
    const cur = readGrading() || [];
    cur.push({ min: 0, grade: "" });
    renderGradingTable(cur);
  };
  btnSave.onclick = () => {
    saveServerGrading().catch(err => say((err && err.message) || "Ошибка сохранения"));
  };
  syncGradingControlsUi();

  // CTA / publish box under wizard
  if ($("msg")) shell.appendChild($("msg"));
  if ($("publishBox")) shell.appendChild($("publishBox"));

  const dropB = document.querySelector("#drop b");
  if (dropB) dropB.textContent = "Загрузить банк вопросов";
  if ($("tpl")) $("tpl").textContent = "Скачать шаблон";
  if ($("drop")) {
    const hint = $("drop").querySelector(".hint");
    if (hint) hint.textContent = ".xlsx · .xls · .docx";
  }

  const title = $("wizardTitle");
  const sub = $("wizardSub");
  const badge = $("wizardKindBadge");
  const go = $("wizardGo");
  const goHint = $("wizardGoHint");
  const forStaff = audience !== "Курсант";
  if (title) {
    if (forStaff) title.textContent = "Тест для инструкторов и ассистентов";
    else {
      title.textContent = kind === "mandatory"
        ? "Обязательное модульное тестирование"
        : "Промежуточное тестирование";
    }
  }
  if (sub) {
    sub.textContent = forStaff
      ? "Аудитория: инструкторы и ассистенты"
      : "Аудитория: курсанты";
  }
  if (badge) {
    if (forStaff) {
      badge.textContent = "Куда: «Мои тесты (для инструкторов)». Каталога обязательных модулей нет.";
    } else {
      badge.textContent = kind === "mandatory"
        ? "Куда: каталог «Тесты и модули для обязательного прохождения» + «Мои тесты (для курсантов)»"
        : "Куда: только «Мои тесты (для курсантов)»";
    }
  }
  if (go) {
    go.textContent = (!forStaff && kind === "mandatory")
      ? "Опубликовать и получить ссылку"
      : "Создать и получить ссылку";
  }
  if (goHint) {
    if (forStaff) {
      goHint.textContent = "Тест сохранится в «Мои тесты (для инструкторов)».";
    } else if (kind === "mandatory") {
      goHint.textContent = "Укажите номер модуля. Тест станет общим для всех групп курсантов.";
    } else {
      goHint.textContent = "Тест останется только в «Мои тесты (для курсантов)».";
    }
  }

  if ($("wizardTabMain")) $("wizardTabMain").onclick = () => showWizardTab("main");
  if ($("wizardTabAdv")) $("wizardTabAdv").onclick = () => showWizardTab("adv");
  showWizardTab("main");

  if (go) {
    go.addEventListener("click", () => {
      const run = async () => {
        if (kind === "mandatory") {
          const modnum = (($("modnum") && $("modnum").value) || "").trim();
          if (!modnum) {
            say("Укажите номер модуля для обязательного тестирования.");
            showWizardTab("main");
            if ($("modnum")) $("modnum").focus();
            return;
          }
          let role = currentStoredRole();
          if (!canPublishForAllRole(role)) {
            const token = localStorage.getItem("lisAdminToken") || "";
            if (token) {
              try { role = await refreshPublishForAllUi(token); } catch (e) {}
            }
          }
          if (!canPublishForAllRole(role)) {
            say("Обязательные тесты публикует старший инструктор или администратор.");
            return;
          }
          window.__LIS_PUBLISH_FOR_ALL__ = true;
        } else {
          window.__LIS_PUBLISH_FOR_ALL__ = false;
        }
        if ($("make")) $("make").click();
      };
      run().catch(err => say((err && err.message) || "Не удалось опубликовать."));
    });
  }
  // синхрон disabled с основной кнопкой make
  const syncWizardGo = () => {
    if (go && $("make")) go.disabled = !!$("make").disabled;
  };
  if ($("make")) {
    const mo = new MutationObserver(syncWizardGo);
    mo.observe($("make"), { attributes: true, attributeFilter: ["disabled"] });
    syncWizardGo();
  }
}
function applyCabinetGeneratorUi() {
  if (isWizardGenerator()) {
    applyWizardGeneratorUi();
    return;
  }
  if (!isCabinetGenerator()) return;
  document.documentElement.classList.add("cabinet-embed");
  document.body.classList.add("cabinet-embed");
  const qs = generatorQuery();
  const audience = (qs.get("audience") || "").trim();
  if ($("aud") && audience) {
    const opt = [...$("aud").options].find(o => o.value === audience);
    if (opt) $("aud").value = audience;
    $("aud").disabled = true;
  }
  if ($("makeDl")) $("makeDl").hidden = true;
  const cabLink = document.querySelector('.shell-foot a.btn[href="/admin"]');
  if (cabLink) cabLink.hidden = true;
}
applyCabinetGeneratorUi();

/* ---------- Публикация на сервер ЛИС ---------- */
function isServerMode(){
  return location.protocol.startsWith("http") && !/^(localhost|127\.0\.0\.1)$/.test("") && true;
}
function canPublishForAllRole(role) {
  return role === "admin" || role === "senior";
}
/** Роль из объекта пользователя или обёртки {user} (ответ /api/admin/me). */
function userRoleFrom(obj) {
  if (!obj || typeof obj !== "object") return "";
  const u = obj.user && typeof obj.user === "object" ? obj.user : obj;
  return String(u.role || u.acl_role || "").trim();
}
function currentStoredRole() {
  try {
    const u = JSON.parse(localStorage.getItem("lisAdminUser") || "null");
    return userRoleFrom(u);
  } catch (e) {
    return "";
  }
}
function storeAdminUser(payload) {
  if (!payload || typeof payload !== "object") return;
  const user = payload.user && typeof payload.user === "object" ? payload.user : payload;
  if (!userRoleFrom(user) && payload.ok && !payload.user) return;
  try { localStorage.setItem("lisAdminUser", JSON.stringify(user)); } catch (e) {}
}
function syncPublishForAllUi(role) {
  const allowed = canPublishForAllRole(role != null ? role : currentStoredRole());
  if (isWizardGenerator()) {
    if ($("makePubWrap")) $("makePubWrap").hidden = true;
    if ($("makePubHint")) $("makePubHint").hidden = true;
    if ($("make")) $("make").hidden = true;
    if ($("makeDl")) $("makeDl").hidden = true;
  } else if (isCabinetGenerator()) {
    if ($("makePubWrap")) $("makePubWrap").hidden = !allowed;
    if ($("makePubHint")) $("makePubHint").hidden = !allowed;
    if ($("make")) $("make").hidden = true;
    if ($("makeDl")) $("makeDl").hidden = true;
  } else {
    if ($("makePubWrap")) $("makePubWrap").hidden = !allowed;
    if ($("makePubHint")) $("makePubHint").hidden = !allowed;
  }
  if (!allowed && wizardKind() === "mandatory") window.__LIS_PUBLISH_FOR_ALL__ = false;
  else if (!allowed && !isWizardGenerator()) window.__LIS_PUBLISH_FOR_ALL__ = false;
  syncGradingControlsUi();
}
async function refreshPublishForAllUi(token) {
  let role = currentStoredRole();
  if (token) {
    try {
      const me = await fetch("/api/admin/me", { headers: { Authorization: "Bearer " + token } });
      const md = await me.json().catch(() => ({}));
      if (me.ok && md) {
        storeAdminUser(md);
        role = userRoleFrom(md) || role;
      }
    } catch (e) {}
  }
  syncPublishForAllUi(role);
  // После роли — перерисовать шкалу (readonly ↔ редактирование)
  const cur = readGrading();
  if (cur) renderGradingTable(cur);
  else syncGradingControlsUi();
  return role;
}
syncPublishForAllUi();
async function ensureAdminToken(){
  let token = localStorage.getItem("lisAdminToken") || "";
  if (token) {
    try {
      const r = await fetch("/api/tests", { headers: { Authorization: "Bearer " + token } });
      if (r.ok) {
        await refreshPublishForAllUi(token);
        return token;
      }
    } catch (e) {}
  }
  const login = prompt("Логин (как в кабинете):", "admin");
  if (login == null) throw new Error("Публикация отменена");
  const password = prompt("Пароль:", "");
  if (password == null) throw new Error("Публикация отменена");
  const r = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: login || "admin", password })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Неверный логин или пароль");
  token = data.token;
  localStorage.setItem("lisAdminToken", token);
  if (data.user) localStorage.setItem("lisAdminUser", JSON.stringify(data.user));
  await refreshPublishForAllUi(token);
  return token;
}
async function publishHtml(html, title, opts){
  opts = opts || {};
  const token = await ensureAdminToken();
  if (opts.publishedForAll) {
    let role = currentStoredRole();
    if (!canPublishForAllRole(role)) {
      try {
        const me = await fetch("/api/admin/me", { headers: { Authorization: "Bearer " + token } });
        const md = await me.json().catch(() => ({}));
        if (me.ok && md) {
          storeAdminUser(md);
          role = userRoleFrom(md) || role;
        }
      } catch (e) {}
    }
    if (!canPublishForAllRole(role)) {
      throw new Error("Публиковать для всех могут только старший инструктор и администратор");
    }
  }
  const fd = new FormData();
  fd.append("file", new Blob([html], { type: "text/html;charset=utf-8" }), "test.html");
  if (title) fd.append("title", title);
  const noTimer = !!($("noTimer") && $("noTimer").checked);
  if (noTimer) {
    fd.append("no_timer", "1");
    fd.append("timer_minutes", "");
  } else {
    const tm = parseInt(($("timerMin") && $("timerMin").value) || "40", 10);
    if (tm >= 1) fd.append("timer_minutes", String(tm));
  }
  const aud = (($("aud") && $("aud").value) || "").trim();
  if (aud) fd.append("audience", aud);
  const mp = (($("masterPwd") && $("masterPwd").value) || "").trim();
  if (mp) fd.append("master_password", mp);
  if (opts.publishedForAll) fd.append("published_for_all", "1");
  const url = editTestId
    ? ("/api/tests/" + encodeURIComponent(editTestId) + "/replace")
    : "/api/tests/upload";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.detail;
    const msg = typeof detail === "string" ? detail
      : (Array.isArray(detail) ? detail.map(function (x) { return x.msg || x; }).join("; ") : null);
    throw new Error(msg || ("Ошибка публикации " + r.status));
  }
  return data;
}
async function loadEditTestMeta(){
  if (!editTestId) return;
  try {
    const token = await ensureAdminToken();
    const r = await fetch("/api/admin/tests/" + encodeURIComponent(editTestId), {
      headers: { Authorization: "Bearer " + token }
    });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(t.detail || ("Не удалось открыть тест " + r.status));
    if ($("mod") && t.title) $("mod").value = t.title;
    if ($("noTimer")) {
      $("noTimer").checked = t.timer_minutes == null;
      applyNoTimerUi();
    }
    if ($("timerMin") && t.timer_minutes != null) {
      $("timerMin").value = String(t.timer_minutes);
      if ($("timerStep1")) $("timerStep1").value = String(t.timer_minutes);
    }
    if ($("aud") && t.audience) {
      const o = [...$("aud").options].find(x => x.value === t.audience);
      if (o) $("aud").value = t.audience;
    }
    if ($("masterPwd") && t.master_password) $("masterPwd").value = t.master_password;
    say("Открыт тест «" + (t.title || editTestId) + "». Загрузите банк вопросов (можно из другого файла) и сохраните изменения.", true);
  } catch (e) {
    say((e && e.message) || "Не удалось загрузить параметры теста для правки.");
  }
}
if (editTestId) {
  loadEditTestMeta();
}
function showPublishLink(linkPath){
  const abs = location.origin + linkPath;
  const box = $("publishBox");
  const el = $("publishLink");
  const open = $("btnOpenTest");
  if (!box || !el) return abs;
  el.textContent = abs;
  box.hidden = false;
  if (open) open.href = abs;
  const copy = $("btnCopyLink");
  if (copy && !copy._lisBound) {
    copy._lisBound = true;
    copy.addEventListener("click", () => {
      const text = ($("publishLink").textContent || "").trim();
      const label = copy.textContent;
      const fallback = () => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          if (ok) {
            copy.textContent = "Скопировано";
            setTimeout(() => { copy.textContent = label; }, 1200);
            return;
          }
        } catch (e) {}
        prompt("Скопируйте ссылку:", text);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          copy.textContent = "Скопировано";
          setTimeout(() => { copy.textContent = label; }, 1200);
        }).catch(fallback);
      } else {
        fallback();
      }
    });
  }
  return abs;
}

function shuffleArr(a){
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Выборка по долям из каждого файла. */
function sampleFromSources(){
  const out = [];
  sources.forEach(src => {
    const ok = okQuestions(src).map(q => {
      const item = { q: q.q, a: q.a.slice(), correct: q.correct };
      if (q.d) item.d = q.d;
      return item;
    });
    const take = Math.min(Number(src.take) || 0, ok.length);
    out.push(...shuffleArr(ok).slice(0, take));
  });
  return shuffleArr(out);
}

$("make").addEventListener("click", async () => {
  say("");
  if (!sources.length || !parsed || parsed.questions.some(q => q.error)) {
    if (typeof showGeneratorTab === "function") showGeneratorTab(1);
    return say("Сначала загрузите файл(ы) без ошибок.");
  }
  const name = $("mod").value.trim();
  if (!name) {
    if (typeof showGeneratorTab === "function") showGeneratorTab(2);
    $("mod").focus();
    return say("Введите название теста.");
  }
  let n = parseInt($("cnt").value, 10);
  if (!(n >= 1)) {
    if (typeof showGeneratorTab === "function") showGeneratorTab(2);
    $("cnt").focus();
    return say("Укажите число вопросов в тесте (1 или больше).");
  }

  const multi = sources.length > 1;
  const pctSum = sources.reduce((a, s) => a + (Number(s.pct) || 0), 0);
  const takeSum = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
  if (multi || sources.length === 1) {
    if (pctSum !== 100) return say("Сумма долей по файлам должна быть 100%.");
    if (takeSum !== n) {
      recalcTakesFromPct();
      renderSources();
      const takeSum2 = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
      if (takeSum2 !== n) return say("Не удалось согласовать доли с числом вопросов теста.");
    }
    for (const src of sources) {
      if ((Number(src.take) || 0) > okQuestions(src).length) {
        return say("Из «" + (src.theme || src.fileName) + "» нельзя взять больше, чем есть вопросов без ошибок.");
      }
    }
  }

  const bankSize = sources.reduce((a, s) => a + okQuestions(s).length, 0);
  let note = "";
  if (!multi && n > bankSize) { n = bankSize; $("cnt").value = n; note = " В банке меньше вопросов, чем нужно, — в тест войдут все " + n + "."; }
  const grading = readGrading();
  if (!grading) return say("Проверьте таблицу оценок: процент должен быть числом от 0 до 100.");

  const useDiff = !multi && !!parsed.hasDiff;
  let hardCount = null;
  if (useDiff) {
    const m = calcMix();
    if (!m.n) { $("cnt").focus(); return say("Укажите число вопросов в тесте."); }
    n = m.n; hardCount = m.h;
    $("cnt").value = String(n);
    syncCntFields("cnt");
  }

  // один файл — полный банк (случайная выборка при старте теста);
  // несколько — банк = выборка по долям, QUESTIONS_PER_TEST = все из банка
  let bank;
  if (multi) {
    n = sources.reduce((a, s) => a + (Number(s.take) || 0), 0);
    $("cnt").value = String(n);
    syncCntFields("cnt");
    bank = sampleFromSources();
    note = (note || "") + " Доли: " + sources.map(s => (s.theme || s.fileName) + " " + (s.take || 0) + " (" + (s.pct || 0) + "%)").join("; ") + ".";
  } else {
    bank = okQuestions(sources[0]).map(q => useDiff
      ? { q: q.q, a: q.a, correct: q.correct, d: q.d }
      : { q: q.q, a: q.a, correct: q.correct });
  }

  let tpl;
  try {
    tpl = await loadTestTemplate();
  } catch (err) {
    console.error(err);
    return say("Не удалось загрузить шаблон теста. Обновите страницу (Ctrl+F5).");
  }
  const A = "/*__CONFIG_START__*/", B = "/*__CONFIG_END__*/";
  const s = tpl.indexOf(A), e = tpl.indexOf(B);
  if (s < 0 || e < 0) return say("Внутренняя ошибка шаблона теста.");
  const orderFlag = useDiff && $("ordr").checked;
  const num = $("modnum").value.trim();
  const title = (num ? "Модуль " + num + " · " : "") + name;
  const qPerTest = multi ? bank.length : n;

  const mkHtml = o => {
    const cfg = A + "\n" +
      "const MODULE_NAME = " + jsLit(title) + ";\n" +
      "const AUDIENCE = " + jsLit($("aud").value) + ";\n" +
      "const QUESTIONS_PER_TEST = " + (o.qPer != null ? o.qPer : qPerTest) + ";\n" +
      "const SHUFFLE_OPTIONS = " + (o.shuffle ? "true" : "false") + ";\n" +
      "const HARD_COUNT = " + (o.hard === null || o.hard === undefined ? "null" : o.hard) + ";\n" +
      "const ORDER_BY_DIFFICULTY = " + (o.order ? "true" : "false") + ";\n" +
      "const VARIANT_LABEL = " + jsLit(o.label || "") + ";\n" +
      "const FIXED_QUESTIONS = " + (o.fixed ? jsLit(o.fixed) : "null") + ";\n" +
      "const GRADING = " + jsLit(grading) + ";\n" +
      "const BANK = " + jsLit(o.bank) + ";\n" + B;
    return tpl.slice(0, s) + cfg + tpl.slice(e + B.length);
  };
  const base = "Тест_" + title.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 50);
  const mixTxt = useDiff ? ": простых " + (n - hardCount) + ", сложных " + hardCount : "";

  const html = mkHtml({ shuffle: $("shuf").checked, hard: hardCount, order: orderFlag, bank, qPer: qPerTest });
  const file = base + ".html";
  const doDl = window.__LIS_FORCE_DOWNLOAD__;
  window.__LIS_FORCE_DOWNLOAD__ = false;
  if (doDl || !location.protocol.startsWith("http")) {
    saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), file);
    return say("Тест скачан: " + file + " (банк — " + bankSize + " вопр., в тесте — " + qPerTest + mixTxt + ")." + note, true);
  }
  $("make").disabled = true;
  if ($("makeDl")) $("makeDl").disabled = true;
  if ($("makePub")) $("makePub").disabled = true;
  const forAll = !!window.__LIS_PUBLISH_FOR_ALL__;
  window.__LIS_PUBLISH_FOR_ALL__ = false;
  say(editTestId
    ? (forAll ? "Сохраняю изменения и публикую для всех…" : "Сохраняю изменения теста…")
    : (forAll ? "Публикую тест для общего пользования…" : "Публикую тест на сервер…"), true);
  publishHtml(html, title, { publishedForAll: forAll }).then(data => {
    const savedId = data.id || editTestId;
    // Кабинет / wizard: iframe сообщает родителю и не уводит вложенную страницу
    if (!editTestId && !doDl && isCabinetGenerator() && window.parent && window.parent !== window) {
      showPublishLink(data.link);
      say(
        wizardKind() === "mandatory"
          ? "Тест опубликован в каталог. Окно можно закрыть."
          : "Тест создан и появится в «Мои тесты». Окно можно закрыть.",
        true
      );
      try {
        window.parent.postMessage({
          type: "lis-generator-done",
          id: savedId || "",
          kind: wizardKind(),
          open: wizardKind() === "mandatory" ? "testing,upload" : "testing,tests"
        }, location.origin);
      } catch (e) {}
      return;
    }
    // После создания нового теста — сразу в кабинет → Тестирование → Мои тесты
    if (!editTestId && !doDl) {
      location.assign("/admin?open=testing,tests" + (savedId ? ("&highlight=" + encodeURIComponent(savedId)) : ""));
      return;
    }
    showPublishLink(data.link);
    const who = data.roster_label || audienceRosterLabelLocal(($("aud") && $("aud").value) || "");
    say((editTestId
      ? (forAll
        ? "Изменения сохранены, тест в общем каталоге. Ссылка та же. "
        : "Изменения сохранены. Ссылка и список допуска без изменений. ")
      : (forAll
        ? "Тест опубликован для общего пользования и появится в каталоге кабинета. "
        : "Тест опубликован. Отправьте ссылку. ")) +
      (data.roster_filled ? ("Допуск из штатки: " + data.roster_filled + " (" + who + "). ") : "") +
      "Банк — " + bankSize + " вопр., в тесте — " + qPerTest + mixTxt + "." + note, true);
    // URL старого генератора не трогаем — он снят с доступа
  }).catch(err => {
    console.error(err);
    say((err && err.message) || "Не удалось опубликовать. Проверьте пароль и что сервер запущен.");
  }).finally(() => {
    $("make").disabled = false;
    if ($("makeDl")) $("makeDl").disabled = false;
    if ($("makePub")) $("makePub").disabled = false;
  });
});


(function(){
  const syncDl = () => {
    if ($("makeDl")) $("makeDl").disabled = $("make").disabled;
    if ($("makePub") && $("makePubWrap") && !$("makePubWrap").hidden) {
      $("makePub").disabled = $("make").disabled;
    }
  };
  const mo = new MutationObserver(syncDl);
  mo.observe($("make"), { attributes: true, attributeFilter: ["disabled"] });
  syncDl();
  if ($("makePub")) {
    $("makePub").addEventListener("click", () => {
      if (!canPublishForAllRole(currentStoredRole())) {
        syncPublishForAllUi("");
        return;
      }
      window.__LIS_PUBLISH_FOR_ALL__ = true;
      $("make").click();
    });
  }
  if ($("makeDl")) {
    $("makeDl").addEventListener("click", () => {
      window.__LIS_FORCE_DOWNLOAD__ = true;
      $("make").click();
    });
  }
  const token = localStorage.getItem("lisAdminToken") || "";
  if (token) refreshPublishForAllUi(token).catch(() => {});
})();

/* ---------- вкладки (вариант C) ---------- */
let generatorTab = 1;
function showGeneratorTab(n) {
  generatorTab = Math.max(1, Math.min(3, Number(n) || 1));
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("on", Number(t.dataset.tab) === generatorTab);
  });
  ["pane1", "pane2", "pane3"].forEach((id, i) => {
    const el = $(id);
    if (el) el.classList.toggle("on", i + 1 === generatorTab);
  });
}
(function initGeneratorTabs(){
  if (!$("pane1") || !$("tab1")) return;
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => showGeneratorTab(t.dataset.tab));
  });
  if ($("btnTabPrev")) $("btnTabPrev").onclick = () => showGeneratorTab(generatorTab - 1);
  if ($("btnTabNext")) $("btnTabNext").onclick = () => showGeneratorTab(generatorTab + 1);
  showGeneratorTab(1);
})();
