/* Мои группы — рабочая копия из распределения */

let myGroupsCache = [];
let myGroupsUiOpen = {};
/** Вложенные аккордеоны: { [myGroupId]: { cadets: bool, assets: bool } } */
let myGroupsSecOpen = {};

function setMyGroupsMsg(text, bad) {
  const el = $("myGroupsMsg");
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function formatRuDateMy(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const months = [
    "", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  const d = parseInt(m[3], 10);
  const mo = parseInt(m[2], 10);
  return d + " " + (months[mo] || m[2]) + " " + m[1];
}

function periodBriefMy(g) {
  const a = formatRuDateMy(g.period_from);
  const b = formatRuDateMy(g.period_to);
  if (a && b) return "с " + a + " по " + b;
  if (a) return "с " + a;
  if (b) return "по " + b;
  return "";
}

function myPeopleNamesBrief(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function myMetaParts(parts) {
  return (parts || []).filter(Boolean).join('<span class="dist-sep">·</span>');
}

function myGroupEditableMeta(g, field, label, value, emptyText) {
  const shown = String(value || "").trim();
  // span, не button: шапка уже <button>, вложенные button браузер выносит на новую строку
  return (
    '<span class="dist-meta myg-meta-edit" role="button" tabindex="0" ' +
    'data-edit-myg-meta="' + esc(field) + '" data-myg-id="' + esc(g.id) + '" ' +
    'title="Нажмите, чтобы изменить">' +
    esc(label) + " " + esc(shown || emptyText) +
    "</span>"
  );
}

/** Заголовок: поток + группа + состав + аудитория/палатка/примечание (клик → правка). */
function myGroupTitleHtml(g) {
  const filledN = Number(g.cadets_filled) || 0;
  const cadetsPhrase = typeof cadetsCountPhrase === "function"
    ? cadetsCountPhrase(filledN)
    : (filledN + " курсантов");
  const periodTxt = periodBriefMy(g);
  const line1 =
    '<span class="dist-stream-key">Поток № ' + esc(g.stream_num || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-group-key">Группа ' + esc(g.group_num || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-group-lbl">инструктор:</span> ' +
    '<span class="dist-group-people">' + esc(myPeopleNamesBrief(g.instructors) || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    '<span class="dist-group-lbl">ассистенты:</span> ' +
    '<span class="dist-group-people">' + esc(myPeopleNamesBrief(g.assistants) || "—") + "</span>" +
    '<span class="dist-sep">·</span>' +
    myGroupEditableMeta(g, "classroom", "ауд.", g.classroom, "—") +
    '<span class="dist-sep">·</span>' +
    myGroupEditableMeta(g, "tent_num", "палатка", g.tent_num, "—") +
    '<span class="dist-sep">·</span>' +
    myGroupEditableMeta(g, "note", "прим.", g.note, "—");
  const meta = myMetaParts([
    periodTxt
      ? ('<span class="dist-meta">Период ' + esc(periodTxt) + "</span>")
      : '<span class="dist-meta">Период не задан</span>',
    '<span class="dist-meta">' + esc(cadetsPhrase) + "</span>",
    g.polygon_name ? ('<span class="dist-meta">полигон ' + esc(g.polygon_name) + "</span>") : "",
    g.dist_title
      ? ('<span class="dist-meta">распределение «' + esc(g.dist_title) + '»</span>')
      : ""
  ]);
  return '<span class="dist-title-stack">' +
    '<span class="dist-title-line1">' + line1 + "</span>" +
    (meta ? ('<span class="dist-title-line2">' + meta + "</span>") : "") +
    "</span>";
}

function myGroupSecOpen(id, sec) {
  const st = myGroupsSecOpen[id] || {};
  return !!st[sec];
}

function setMyGroupSecOpen(id, sec, open) {
  if (!myGroupsSecOpen[id]) myGroupsSecOpen[id] = {};
  myGroupsSecOpen[id][sec] = !!open;
}

function dash(v) {
  const s = String(v == null ? "" : v).trim();
  return s || "—";
}

function myGroupCadetsRows(g) {
  const cadets = g.cadets || [];
  const planned = Number(g.planned_count) || 0;
  if (cadets.length) return cadets;
  return Array.from({ length: planned }, (_, i) => ({ npp: i + 1 }));
}

function myGroupCadetsTableHtml(g) {
  const rows = myGroupCadetsRows(g);
  const body = rows.map((c, i) => {
    const npp = c.npp || (i + 1);
    const empty = ![c.num, c.callsign, c.note].some(x => String(x || "").trim());
    return `<tr class="row-click" data-edit-myg-cadet="${esc(g.id)}" data-cadet-idx="${i}" title="Нажмите для редактирования">
      <td class="npp center">${esc(npp)}</td>
      <td class="center">${esc(dash(c.num))}</td>
      <td class="center">${empty && !c.callsign ? '<span class="hint">нажмите, чтобы заполнить</span>' : esc(dash(c.callsign))}</td>
      <td>${esc(dash(c.note))}</td>
    </tr>`;
  }).join("");
  return `<div class="scrollx"><table class="dist-cadets-table">
    <thead><tr>
      <th>№</th><th>Номер</th><th>Позывной</th><th>Примечание</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="4" class="hint">Нет строк — укажите план группы</td></tr>'}</tbody>
  </table></div>`;
}

function renderMyGroups() {
  const box = $("myGroupsBox");
  if (!box) return;
  const list = myGroupsCache || [];
  if ($("myGroupsMeta")) {
    $("myGroupsMeta").textContent = list.length ? (" · " + list.length) : "";
  }
  if (!list.length) {
    box.innerHTML = '<p class="hint">Пока пусто. Откройте «Распределение» и нажмите «Добавить мою группу» у своей группы.</p>';
    return;
  }
  box.innerHTML = list.map(g => {
    const open = !!myGroupsUiOpen[g.id];
    const cadetsOpen = myGroupSecOpen(g.id, "cadets");
    const assetsOpen = myGroupSecOpen(g.id, "assets");
    const role = g.my_role === "assistant" ? "ассистент" : (g.my_role === "instructor" ? "инструктор" : (g.my_role || ""));
    const roleHint = role ? ("вы: " + role) : "";
    return `<div class="dist-stream-card${open ? " open" : ""}" data-myg="${esc(g.id)}">
      <button type="button" class="dist-stream-head" data-toggle-myg="${esc(g.id)}" aria-expanded="${open ? "true" : "false"}">
        <span class="dist-chevron">${open ? "▼" : "▶"}</span>
        <span class="dist-stream-title">${myGroupTitleHtml(g)}</span>
      </button>
      <div class="dist-stream-body"${open ? "" : " hidden"}>
        ${roleHint ? ('<p class="hint" style="margin:0 0 10px">' + esc(roleHint) + "</p>") : ""}

        <div class="dist-group-card${cadetsOpen ? " open" : ""}" data-myg-sec="cadets">
          <button type="button" class="dist-group-head" data-toggle-myg-sec="cadets" data-myg-id="${esc(g.id)}" aria-expanded="${cadetsOpen ? "true" : "false"}">
            <span class="dist-chevron">${cadetsOpen ? "▼" : "▶"}</span>
            <span class="dist-group-title"><span class="dist-group-key">Личный состав группы</span></span>
          </button>
          <div class="dist-group-body"${cadetsOpen ? "" : " hidden"}>
            <p class="hint" style="margin:0 0 8px">Строка таблицы — клик для правки. Шаблон «Курсанты».</p>
            ${myGroupCadetsTableHtml(g)}
            <div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px">
              <button class="btn" type="button" data-myg-tpl="${esc(g.id)}">Скачать шаблон</button>
              <button class="btn" type="button" data-myg-import="${esc(g.id)}">Загрузить из файла</button>
              <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-myg-file="${esc(g.id)}" class="hidden" tabindex="-1">
              <button class="btn danger" type="button" data-clear-myg-cadets="${esc(g.id)}">Очистить таблицу</button>
            </div>
            <p class="hint" data-myg-import-msg="${esc(g.id)}" style="margin:8px 0 0"></p>
          </div>
        </div>

        <div class="dist-group-card${assetsOpen ? " open" : ""}" data-myg-sec="assets" style="margin-top:10px">
          <button type="button" class="dist-group-head" data-toggle-myg-sec="assets" data-myg-id="${esc(g.id)}" aria-expanded="${assetsOpen ? "true" : "false"}">
            <span class="dist-chevron">${assetsOpen ? "▼" : "▶"}</span>
            <span class="dist-group-title"><span class="dist-group-key">Имущество палатки</span></span>
          </button>
          <div class="dist-group-body"${assetsOpen ? "" : " hidden"}>
            <p class="hint" style="margin:0 0 8px">БГ — можно использовать. НЕ БГ — на балансе, в полётку/списание/перемещение не берётся. Списан — только через акт утери.</p>
            <div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
              <button class="btn" type="button" data-myg-assets-tpl="${esc(g.id)}">Скачать шаблон имущества</button>
              <button class="btn" type="button" data-myg-assets-import="${esc(g.id)}">Загрузить имущество</button>
              <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-myg-assets-file="${esc(g.id)}" class="hidden" tabindex="-1">
              <button class="btn" type="button" data-myg-assets-add="${esc(g.id)}">Добавить борт</button>
            </div>
            <p class="hint" data-myg-assets-msg="${esc(g.id)}" style="margin:0 0 8px"></p>
            <div class="scrollx"><table class="tent-assets-table">
              <thead>
                <tr><th>Тип</th><th>Номер</th><th>Статус</th><th>Примечание</th><th></th></tr>
              </thead>
              <tbody data-myg-assets-body="${esc(g.id)}"><tr><td colspan="5" class="hint">Загрузка…</td></tr></tbody>
            </table></div>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
  list.forEach(g => {
    if (myGroupsUiOpen[g.id] && myGroupSecOpen(g.id, "assets")) {
      loadMyGroupAssets(g.id).catch(() => {});
    }
  });
}

const myGroupAssetsCache = {};

function setMyGroupAssetsMsg(id, text, bad) {
  const el = document.querySelector('[data-myg-assets-msg="' + id + '"]');
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function renderMyGroupAssets(id, assets, canManage) {
  const body = document.querySelector('[data-myg-assets-body="' + id + '"]');
  if (!body) return;
  const list = assets || [];
  myGroupAssetsCache[id] = list;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="5" class="hint">Бортов пока нет</td></tr>';
    return;
  }
  body.innerHTML = list.map(a => {
    const st = a.status || "";
    const actions = [];
    if (canManage && st === "bg") {
      actions.push(
        '<button class="btn" type="button" data-asset-not-bg="' + esc(a.id) +
        '" data-myg-id="' + esc(id) + '">НЕ БГ</button>'
      );
    }
    if (canManage && st === "not_bg") {
      actions.push(
        '<button class="btn" type="button" data-asset-restore-bg="' + esc(a.id) +
        '" data-myg-id="' + esc(id) + '">Восстановить БГ</button>'
      );
    }
    if (canManage && st !== "written_off") {
      actions.push(
        '<button class="btn danger" type="button" data-asset-del="' + esc(a.id) +
        '" data-myg-id="' + esc(id) + '">Удалить</button>'
      );
    }
    const stClass = st === "bg" ? "ok" : (st === "not_bg" ? "warn" : "hint");
    return (
      "<tr>" +
        "<td>" + esc(a.board_type || "—") + "</td>" +
        "<td>" + esc(a.board_num || "—") + "</td>" +
        '<td><span class="' + stClass + '">' + esc(a.status_label || st) + "</span></td>" +
        "<td>" + esc(a.note || "") + "</td>" +
        '<td><div class="row" style="gap:6px;flex-wrap:wrap">' + actions.join("") + "</div></td>" +
      "</tr>"
    );
  }).join("");
}

async function loadMyGroupAssets(id) {
  const data = await api(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/assets"
  );
  renderMyGroupAssets(id, data.assets || [], !!data.can_manage);
}

async function downloadMyGroupAssetsTemplate() {
  const filename = "Шаблон_Имущество_Палатки.xlsx";
  if (typeof downloadXlsx === "function") {
    await downloadXlsx("/api/admin/tent-assets-template.xlsx", filename);
    return;
  }
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/tent-assets-template.xlsx", {
    headers, credentials: "same-origin"
  });
  if (!r.ok) throw new Error("Не удалось скачать шаблон");
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importMyGroupAssetsFromFile(id, file) {
  setMyGroupAssetsMsg(id, "Загрузка…");
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/assets/import",
    { method: "POST", headers, body: fd, credentials: "same-origin" }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : (data.message || r.status)
    );
  }
  renderMyGroupAssets(id, data.assets || [], true);
  const errN = (data.errors || []).length;
  const text =
    "Добавлено: " + (data.added || 0) +
    (data.skipped ? (", уже были: " + data.skipped) : "") +
    (errN ? (", ошибок: " + errN) : "");
  setMyGroupAssetsMsg(id, text, !!errN);
  if (errN) {
    setMyGroupAssetsMsg(
      id,
      text + ". " + (data.errors || []).slice(0, 3).join("; "),
      true
    );
  }
}

function pickAndImportMyGroupAssets(id) {
  const card = document.querySelector('[data-myg="' + id + '"]');
  const inp = card && card.querySelector('[data-myg-assets-file="' + id + '"]');
  if (!inp) return;
  inp.value = "";
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    importMyGroupAssetsFromFile(id, f).catch(err => setMyGroupAssetsMsg(id, err.message, true));
  };
  inp.click();
}

async function addMyGroupAssetManual(id) {
  const board_type = prompt("Тип борта (напр. ЛИС-1.0У):", "ЛИС-1.0У");
  if (board_type == null) return;
  const board_num = prompt("Бортовой номер (напр. НН-8955):", "");
  if (board_num == null) return;
  const data = await api(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/assets",
    { method: "POST", json: { board_type, board_num, status: "bg", note: "" } }
  );
  renderMyGroupAssets(id, data.assets || [], true);
  setMyGroupAssetsMsg(id, "Борт добавлен");
}

async function setAssetStatusFromUi(mygId, assetId, status) {
  let note = "";
  if (status === "not_bg") {
    note = prompt("Характер / обстоятельства повреждений (необязательно):", "") || "";
  }
  const data = await api(
    "/api/admin/assets/" + encodeURIComponent(assetId) + "/status",
    { method: "PUT", json: { status, note } }
  );
  renderMyGroupAssets(mygId, data.assets || [], true);
  setMyGroupAssetsMsg(
    mygId,
    status === "not_bg" ? "Статус: НЕ БГ" : "Статус: БГ (восстановлен)"
  );
}

async function deleteAssetFromUi(mygId, assetId) {
  if (!confirm("Удалить борт из имущества палатки?")) return;
  const data = await api(
    "/api/admin/assets/" + encodeURIComponent(assetId),
    { method: "DELETE" }
  );
  renderMyGroupAssets(mygId, data.assets || [], true);
  setMyGroupAssetsMsg(mygId, "Борт удалён");
}

async function refreshMyGroups() {
  const data = await api("/api/admin/my-groups");
  myGroupsCache = data.groups || [];
  renderMyGroups();
}

function getMyGroupCadetsList(g) {
  return myGroupCadetsRows(g).map(c => ({
    num: c.num || "",
    callsign: c.callsign || "",
    fio: c.fio || "",
    phone: c.phone || "",
    passport: c.passport || "",
    note: c.note || ""
  }));
}

async function saveMyGroupMetaField(id, field, value) {
  const payload = {};
  payload[field] = value;
  const res = await api("/api/admin/my-groups/" + encodeURIComponent(id), {
    method: "PUT",
    json: payload
  });
  const idx = myGroupsCache.findIndex(x => x.id === id);
  if (idx >= 0 && res.group) myGroupsCache[idx] = res.group;
  else await refreshMyGroups();
  myGroupsUiOpen[id] = true;
  renderMyGroups();
  setMyGroupsMsg("Сохранено");
}

async function editMyGroupMetaField(id, field) {
  const g = (myGroupsCache || []).find(x => x.id === id);
  if (!g) return;
  const labels = {
    classroom: "Аудитория",
    tent_num: "Палатка",
    note: "Примечание"
  };
  const cur = g[field] || "";
  const next = prompt(labels[field] || field, cur);
  if (next == null) return;
  await saveMyGroupMetaField(id, field, next);
}

async function persistMyGroupCadets(id, cadets) {
  const res = await api(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/cadets",
    { method: "PUT", json: { cadets } }
  );
  const idx = myGroupsCache.findIndex(x => x.id === id);
  if (idx >= 0 && res.group) myGroupsCache[idx] = res.group;
  else await refreshMyGroups();
  myGroupsUiOpen[id] = true;
  renderMyGroups();
  return res.group;
}

function openMygCadetModal(groupId, rowIdx) {
  const g = (myGroupsCache || []).find(x => x.id === groupId);
  if (!g) return;
  const rows = getMyGroupCadetsList(g);
  const c = rows[rowIdx] || {};
  if ($("mygCadetGroupId")) $("mygCadetGroupId").value = groupId;
  if ($("mygCadetIdx")) $("mygCadetIdx").value = String(rowIdx);
  if ($("mygCadetNum")) $("mygCadetNum").value = c.num || "";
  if ($("mygCadetCall")) $("mygCadetCall").value = c.callsign || "";
  if ($("mygCadetNote")) $("mygCadetNote").value = c.note || "";
  if ($("mygCadetModalTitle")) {
    $("mygCadetModalTitle").textContent = "Курсант · строка " + (rowIdx + 1);
  }
  if ($("mygCadetModalSub")) {
    $("mygCadetModalSub").textContent =
      "Поток " + (g.stream_num || "—") + " · группа " + (g.group_num || "—");
  }
  if ($("mygCadetModalMsg")) $("mygCadetModalMsg").textContent = "";
  if ($("mygCadetModal")) $("mygCadetModal").classList.remove("hidden");
  if ($("mygCadetNum")) $("mygCadetNum").focus();
}

function closeMygCadetModal() {
  if ($("mygCadetModal")) $("mygCadetModal").classList.add("hidden");
}

async function saveMygCadetModal(clear) {
  const groupId = ($("mygCadetGroupId") && $("mygCadetGroupId").value) || "";
  const rowIdx = Number(($("mygCadetIdx") && $("mygCadetIdx").value) || -1);
  const g = (myGroupsCache || []).find(x => x.id === groupId);
  if (!g || rowIdx < 0) return;
  const cadets = getMyGroupCadetsList(g);
  while (cadets.length <= rowIdx) {
    cadets.push({ num: "", callsign: "", fio: "", phone: "", passport: "", note: "" });
  }
  if (clear) {
    cadets[rowIdx] = { num: "", callsign: "", fio: "", phone: "", passport: "", note: "" };
  } else {
    cadets[rowIdx] = {
      num: ($("mygCadetNum") && $("mygCadetNum").value) || "",
      callsign: ($("mygCadetCall") && $("mygCadetCall").value) || "",
      fio: "",
      phone: "",
      passport: "",
      note: ($("mygCadetNote") && $("mygCadetNote").value) || ""
    };
  }
  try {
    await persistMyGroupCadets(groupId, cadets);
    closeMygCadetModal();
    setMyGroupsMsg(clear ? "Строка очищена" : "Курсант сохранён");
  } catch (e) {
    if ($("mygCadetModalMsg")) {
      $("mygCadetModalMsg").innerHTML = '<span class="bad">' + esc(e.message || "Ошибка") + "</span>";
    }
  }
}

async function clearMyGroupCadetsTable(id) {
  if (!confirm("Очистить таблицу личного состава? Номера и позывные будут удалены.")) return;
  const g = (myGroupsCache || []).find(x => x.id === id) || {};
  const planned = Number(g.planned_count) || 0;
  const empty = Array.from({ length: planned }, () => ({
    num: "", callsign: "", fio: "", phone: "", passport: "", note: ""
  }));
  await persistMyGroupCadets(id, empty);
  myGroupsUiOpen[id] = true;
  setMyGroupSecOpen(id, "cadets", true);
  renderMyGroups();
  setMyGroupsMsg("Таблица личного состава очищена");
}

function myGroupCadetsTemplateFileName(g) {
  const parts = ["Шаблон", "Курсанты"];
  if (g && g.group_num) parts.push("Группа", g.group_num);
  if (g && g.stream_num) parts.push("Поток", g.stream_num);
  if (typeof buildTemplateFileName === "function") return buildTemplateFileName(parts);
  return parts.map(p => String(p).replace(/\s+/g, "_")).filter(Boolean).join("_") + ".xlsx";
}

async function downloadMyGroupCadetsTemplate(id) {
  const g = (myGroupsCache || []).find(x => x.id === id) || {};
  const filename = myGroupCadetsTemplateFileName(g);
  if (typeof downloadXlsx === "function") {
    await downloadXlsx("/api/admin/cadets-template.xlsx", filename);
    return;
  }
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch("/api/admin/cadets-template.xlsx", {
    headers,
    credentials: "same-origin"
  });
  if (!r.ok) throw new Error("Не удалось скачать шаблон");
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importMyGroupCadetsFromFile(id, file) {
  const msg = document.querySelector('[data-myg-import-msg="' + id + '"]');
  if (msg) msg.textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
  const r = await fetch(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/import-cadets",
    { method: "POST", headers, body: fd, credentials: "same-origin" }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      typeof data.detail === "string" ? data.detail : (data.message || r.status)
    );
  }
  const idx = myGroupsCache.findIndex(g => g.id === id);
  if (idx >= 0 && data.group) myGroupsCache[idx] = data.group;
  else await refreshMyGroups();
  myGroupsUiOpen[id] = true;
  setMyGroupSecOpen(id, "cadets", true);
  renderMyGroups();
  const skipN = (data.skipped_nums || []).length;
  const text =
    "Добавлено: " + (data.added || 0) +
    (skipN ? (", пропущено (уже есть): " + skipN) : "") +
    (data.file_duplicates ? (", дубли в файле: " + data.file_duplicates) : "");
  setMyGroupsMsg(text);
  const msg2 = document.querySelector('[data-myg-import-msg="' + id + '"]');
  if (msg2) msg2.innerHTML = '<span class="ok">' + esc(text) + "</span>";
}

function pickAndImportMyGroupFile(id) {
  const card = document.querySelector('[data-myg="' + id + '"]');
  const inp = card && card.querySelector('[data-myg-file="' + id + '"]');
  if (!inp) return;
  inp.value = "";
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    importMyGroupCadetsFromFile(id, f).catch(err => {
      setMyGroupsMsg(err.message, true);
      const msg = document.querySelector('[data-myg-import-msg="' + id + '"]');
      if (msg) msg.innerHTML = '<span class="bad">' + esc(err.message || "Ошибка") + "</span>";
    });
  };
  inp.click();
}

if ($("myGroupsBox")) {
  $("myGroupsBox").addEventListener("click", e => {
    const editMeta = e.target.closest("[data-edit-myg-meta]");
    if (editMeta) {
      e.preventDefault();
      e.stopPropagation();
      editMyGroupMetaField(
        editMeta.getAttribute("data-myg-id"),
        editMeta.getAttribute("data-edit-myg-meta")
      ).catch(err => setMyGroupsMsg(err.message, true));
      return;
    }
    const editCadet = e.target.closest("[data-edit-myg-cadet]");
    if (editCadet) {
      openMygCadetModal(
        editCadet.getAttribute("data-edit-myg-cadet"),
        Number(editCadet.getAttribute("data-cadet-idx") || 0)
      );
      return;
    }
    const togSec = e.target.closest("[data-toggle-myg-sec]");
    if (togSec) {
      const id = togSec.getAttribute("data-myg-id");
      const sec = togSec.getAttribute("data-toggle-myg-sec");
      setMyGroupSecOpen(id, sec, !myGroupSecOpen(id, sec));
      myGroupsUiOpen[id] = true;
      renderMyGroups();
      return;
    }
    const tog = e.target.closest("[data-toggle-myg]");
    if (tog) {
      const id = tog.getAttribute("data-toggle-myg");
      myGroupsUiOpen[id] = !myGroupsUiOpen[id];
      renderMyGroups();
      return;
    }
    const tpl = e.target.closest("[data-myg-tpl]");
    if (tpl) {
      downloadMyGroupCadetsTemplate(tpl.getAttribute("data-myg-tpl"))
        .catch(err => setMyGroupsMsg(err.message, true));
      return;
    }
    const imp = e.target.closest("[data-myg-import]");
    if (imp) {
      pickAndImportMyGroupFile(imp.getAttribute("data-myg-import"));
      return;
    }
    const clearCadets = e.target.closest("[data-clear-myg-cadets]");
    if (clearCadets) {
      clearMyGroupCadetsTable(clearCadets.getAttribute("data-clear-myg-cadets"))
        .catch(err => setMyGroupsMsg(err.message, true));
      return;
    }
    const assetsTpl = e.target.closest("[data-myg-assets-tpl]");
    if (assetsTpl) {
      downloadMyGroupAssetsTemplate().catch(err =>
        setMyGroupAssetsMsg(assetsTpl.getAttribute("data-myg-assets-tpl"), err.message, true)
      );
      return;
    }
    const assetsImp = e.target.closest("[data-myg-assets-import]");
    if (assetsImp) {
      pickAndImportMyGroupAssets(assetsImp.getAttribute("data-myg-assets-import"));
      return;
    }
    const assetsAdd = e.target.closest("[data-myg-assets-add]");
    if (assetsAdd) {
      addMyGroupAssetManual(assetsAdd.getAttribute("data-myg-assets-add"))
        .catch(err => setMyGroupAssetsMsg(assetsAdd.getAttribute("data-myg-assets-add"), err.message, true));
      return;
    }
    const notBg = e.target.closest("[data-asset-not-bg]");
    if (notBg) {
      setAssetStatusFromUi(
        notBg.getAttribute("data-myg-id"),
        notBg.getAttribute("data-asset-not-bg"),
        "not_bg"
      ).catch(err => setMyGroupAssetsMsg(notBg.getAttribute("data-myg-id"), err.message, true));
      return;
    }
    const restoreBg = e.target.closest("[data-asset-restore-bg]");
    if (restoreBg) {
      setAssetStatusFromUi(
        restoreBg.getAttribute("data-myg-id"),
        restoreBg.getAttribute("data-asset-restore-bg"),
        "bg"
      ).catch(err => setMyGroupAssetsMsg(restoreBg.getAttribute("data-myg-id"), err.message, true));
      return;
    }
    const assetDel = e.target.closest("[data-asset-del]");
    if (assetDel) {
      deleteAssetFromUi(
        assetDel.getAttribute("data-myg-id"),
        assetDel.getAttribute("data-asset-del")
      ).catch(err => setMyGroupAssetsMsg(assetDel.getAttribute("data-myg-id"), err.message, true));
    }
  });
}

if ($("btnMygCadetClose")) $("btnMygCadetClose").onclick = () => closeMygCadetModal();
if ($("btnMygCadetSave")) $("btnMygCadetSave").onclick = () => saveMygCadetModal(false);
if ($("btnMygCadetClear")) $("btnMygCadetClear").onclick = () => saveMygCadetModal(true);
if ($("mygCadetModal")) {
  $("mygCadetModal").addEventListener("click", e => {
    if (e.target === $("mygCadetModal")) closeMygCadetModal();
  });
}

setTimeout(() => {
  refreshMyGroups().catch(() => {});
}, 0);
