/* Мои группы — рабочая копия из распределения */

let myGroupsCache = [];
let myGroupsUiOpen = {};

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

/** Заголовок как в детализации распределения: поток + группа + состав + мета. */
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
    '<span class="dist-group-people">' + esc(myPeopleNamesBrief(g.assistants) || "—") + "</span>";
  const meta = myMetaParts([
    periodTxt
      ? ('<span class="dist-meta">Период ' + esc(periodTxt) + "</span>")
      : '<span class="dist-meta">Период не задан</span>',
    '<span class="dist-meta">' + esc(cadetsPhrase) + "</span>",
    g.classroom ? ('<span class="dist-meta">ауд. ' + esc(g.classroom) + "</span>") : "",
    g.tent_num ? ('<span class="dist-meta">палатка ' + esc(g.tent_num) + "</span>") : "",
    g.dist_title
      ? ('<span class="dist-meta">распределение «' + esc(g.dist_title) + '»</span>')
      : ""
  ]);
  return '<span class="dist-title-stack">' +
    '<span class="dist-title-line1">' + line1 + "</span>" +
    (meta ? ('<span class="dist-title-line2">' + meta + "</span>") : "") +
    "</span>";
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
    const empty = ![c.num, c.callsign, c.fio, c.phone, c.note].some(x => String(x || "").trim());
    return `<tr class="row-click" data-edit-myg-cadet="${esc(g.id)}" data-cadet-idx="${i}" title="Нажмите для редактирования">
      <td class="npp center">${esc(npp)}</td>
      <td class="center">${esc(dash(c.num))}</td>
      <td class="center">${empty && !c.callsign ? '<span class="hint">нажмите, чтобы заполнить</span>' : esc(dash(c.callsign))}</td>
      <td class="center">${esc(dash(c.phone))}</td>
      <td>${esc(dash(c.note))}</td>
    </tr>`;
  }).join("");
  return `<div class="scrollx" style="margin-top:8px"><table class="dist-cadets-table">
    <thead><tr>
      <th>№</th><th>Номер</th><th>Позывной</th><th>Телефон</th><th>Примечание</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="5" class="hint">Нет строк — укажите план группы</td></tr>'}</tbody>
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
    const role = g.my_role === "assistant" ? "ассистент" : (g.my_role === "instructor" ? "инструктор" : (g.my_role || ""));
    const roleHint = role ? ("вы: " + role) : "";
    return `<div class="dist-stream-card${open ? " open" : ""}" data-myg="${esc(g.id)}">
      <button type="button" class="dist-stream-head" data-toggle-myg="${esc(g.id)}" aria-expanded="${open ? "true" : "false"}">
        <span class="dist-chevron">${open ? "▼" : "▶"}</span>
        <span class="dist-stream-title">${myGroupTitleHtml(g)}</span>
      </button>
      <div class="dist-stream-body"${open ? "" : " hidden"}>
        <p class="hint" style="margin:0 0 8px">
          ${roleHint ? esc(roleHint) : ""}
          ${roleHint && g.polygon_name ? " · " : ""}
          ${g.polygon_name ? ("полигон " + esc(g.polygon_name)) : ""}
          ${!roleHint && !g.polygon_name ? "Рабочая копия группы из распределения" : ""}
        </p>
        <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <div>
            <label>Аудитория</label>
            <input type="text" data-myg-meta="classroom" data-myg-id="${esc(g.id)}" value="${esc(g.classroom || "")}" style="min-width:120px">
          </div>
          <div>
            <label>Палатка</label>
            <input type="text" data-myg-meta="tent_num" data-myg-id="${esc(g.id)}" value="${esc(g.tent_num || "")}" style="min-width:70px">
          </div>
          <div style="flex:1;min-width:140px">
            <label>Примечание</label>
            <input type="text" data-myg-meta="note" data-myg-id="${esc(g.id)}" value="${esc(g.note || "")}" style="width:100%">
          </div>
          <button class="btn" type="button" data-save-myg-meta="${esc(g.id)}">Сохранить поля</button>
          <button class="btn danger" type="button" data-del-myg="${esc(g.id)}">Убрать</button>
        </div>
        <div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <button class="btn" type="button" data-myg-tpl="${esc(g.id)}">Скачать шаблон</button>
          <button class="btn" type="button" data-myg-import="${esc(g.id)}">Загрузить из файла</button>
          <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-myg-file="${esc(g.id)}" class="hidden" tabindex="-1">
          <span class="hint">Шаблон «Курсанты». Строка таблицы — клик для правки.</span>
        </div>
        <p class="hint" data-myg-import-msg="${esc(g.id)}" style="margin:0 0 8px"></p>
        ${myGroupCadetsTableHtml(g)}
      </div>
    </div>`;
  }).join("");
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

async function saveMyGroupMeta(id) {
  const card = document.querySelector('[data-myg="' + id + '"]');
  if (!card) return;
  const payload = {};
  card.querySelectorAll("[data-myg-meta][data-myg-id='" + id + "']").forEach(inp => {
    payload[inp.getAttribute("data-myg-meta")] = inp.value;
  });
  const res = await api("/api/admin/my-groups/" + encodeURIComponent(id), {
    method: "PUT",
    json: payload
  });
  const idx = myGroupsCache.findIndex(x => x.id === id);
  if (idx >= 0 && res.group) myGroupsCache[idx] = res.group;
  else await refreshMyGroups();
  myGroupsUiOpen[id] = true;
  renderMyGroups();
  setMyGroupsMsg("Поля группы сохранены");
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
  if ($("mygCadetFio")) $("mygCadetFio").value = c.fio || "";
  if ($("mygCadetPhone")) $("mygCadetPhone").value = c.phone || "";
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
      fio: ($("mygCadetFio") && $("mygCadetFio").value) || "",
      phone: ($("mygCadetPhone") && $("mygCadetPhone").value) || "",
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

async function deleteMyGroup(id) {
  if (!confirm("Убрать группу из «Мои группы»? Данные курсантов в этой вкладке будут удалены.")) return;
  const res = await api("/api/admin/my-groups/" + encodeURIComponent(id), { method: "DELETE" });
  myGroupsCache = res.groups || [];
  delete myGroupsUiOpen[id];
  renderMyGroups();
  setMyGroupsMsg("Группа убрана");
  if (typeof refreshDistClaimedIds === "function" && typeof renderDistStreams === "function") {
    refreshDistClaimedIds().then(() => renderDistStreams()).catch(() => {});
  }
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
    const editCadet = e.target.closest("[data-edit-myg-cadet]");
    if (editCadet) {
      openMygCadetModal(
        editCadet.getAttribute("data-edit-myg-cadet"),
        Number(editCadet.getAttribute("data-cadet-idx") || 0)
      );
      return;
    }
    const tog = e.target.closest("[data-toggle-myg]");
    if (tog) {
      const id = tog.getAttribute("data-toggle-myg");
      myGroupsUiOpen[id] = !myGroupsUiOpen[id];
      renderMyGroups();
      return;
    }
    const saveMeta = e.target.closest("[data-save-myg-meta]");
    if (saveMeta) {
      saveMyGroupMeta(saveMeta.getAttribute("data-save-myg-meta")).catch(err => setMyGroupsMsg(err.message, true));
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
    const del = e.target.closest("[data-del-myg]");
    if (del) {
      deleteMyGroup(del.getAttribute("data-del-myg")).catch(err => setMyGroupsMsg(err.message, true));
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
