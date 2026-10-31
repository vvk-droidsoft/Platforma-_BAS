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

function periodBriefMy(g) {
  const a = (g.period_from || "").trim();
  const b = (g.period_to || "").trim();
  if (a && b) return a + " — " + b;
  return a || b || "";
}

function myGroupCadetsTableHtml(g) {
  const cadets = g.cadets || [];
  const planned = Number(g.planned_count) || 0;
  const rows = (cadets.length ? cadets : Array.from({ length: planned }, (_, i) => ({ npp: i + 1 })));
  const body = rows.map((c, i) => {
    const npp = c.npp || (i + 1);
    return `<tr data-cadet-row>
      <td class="npp">${esc(npp)}</td>
      <td><input type="text" class="dist-cadet-inp" data-field="num" value="${esc(c.num || "")}" autocomplete="off"></td>
      <td><input type="text" class="dist-cadet-inp" data-field="callsign" value="${esc(c.callsign || "")}" autocomplete="off"></td>
      <td><input type="text" class="dist-cadet-inp" data-field="fio" value="${esc(c.fio || "")}" autocomplete="off"></td>
      <td><input type="text" class="dist-cadet-inp" data-field="phone" value="${esc(c.phone || "")}" autocomplete="off"></td>
      <td><input type="text" class="dist-cadet-inp" data-field="note" value="${esc(c.note || "")}" autocomplete="off"></td>
    </tr>`;
  }).join("");
  return `<div class="scrollx" style="margin-top:8px"><table class="dist-cadets-table">
    <thead><tr>
      <th>№</th><th>Номер</th><th>Позывной</th><th>ФИО</th><th>Телефон</th><th>Примечание</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="6" class="hint">Нет строк — укажите план</td></tr>'}</tbody>
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
    const title =
      "Поток " + (g.stream_num || "—") +
      " · группа " + (g.group_num || "—") +
      (g.dist_title ? (" · " + g.dist_title) : "") +
      (role ? (" · вы: " + role) : "") +
      " · план " + (g.planned_count || 0) +
      (g.cadets_filled != null ? (" · заполнено " + g.cadets_filled) : "");
    return `<div class="dist-stream-card${open ? " open" : ""}" data-myg="${esc(g.id)}">
      <button type="button" class="dist-stream-head" data-toggle-myg="${esc(g.id)}" aria-expanded="${open ? "true" : "false"}">
        <span class="dist-chevron">${open ? "▼" : "▶"}</span>
        <span class="dist-stream-title">${esc(title)}</span>
      </button>
      <div class="dist-stream-body"${open ? "" : " hidden"}>
        <p class="hint" style="margin:0 0 8px">
          ${esc(periodBriefMy(g) || "сроки не заданы")}
          ${g.polygon_name ? (" · полигон " + esc(g.polygon_name)) : ""}
          ${g.classroom ? (" · ауд. " + esc(g.classroom)) : ""}
          ${g.tent_num ? (" · палатка " + esc(g.tent_num)) : ""}
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
          <button class="btn main" type="button" data-save-myg-cadets="${esc(g.id)}">Сохранить курсантов</button>
          <button class="btn danger" type="button" data-del-myg="${esc(g.id)}">Убрать</button>
        </div>
        <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <button class="btn" type="button" data-myg-tpl="${esc(g.id)}">Скачать шаблон</button>
          <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-myg-file="${esc(g.id)}" style="max-width:240px">
          <button class="btn main" type="button" data-myg-import="${esc(g.id)}">Загрузить из файла</button>
          <span class="hint">Шаблон «Курсанты». Пустые строки таблицы заполняются из файла.</span>
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

function collectCadetsFromCard(card) {
  return Array.from(card.querySelectorAll("tr[data-cadet-row]")).map(tr => {
    const get = field => {
      const inp = tr.querySelector('[data-field="' + field + '"]');
      return inp ? inp.value : "";
    };
    return {
      num: get("num"),
      callsign: get("callsign"),
      fio: get("fio"),
      phone: get("phone"),
      note: get("note")
    };
  });
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
  const idx = myGroupsCache.findIndex(g => g.id === id);
  if (idx >= 0 && res.group) myGroupsCache[idx] = res.group;
  else await refreshMyGroups();
  renderMyGroups();
  setMyGroupsMsg("Поля группы сохранены");
}

async function saveMyGroupCadets(id) {
  const card = document.querySelector('[data-myg="' + id + '"]');
  if (!card) return;
  const cadets = collectCadetsFromCard(card);
  const res = await api(
    "/api/admin/my-groups/" + encodeURIComponent(id) + "/cadets",
    { method: "PUT", json: { cadets } }
  );
  const idx = myGroupsCache.findIndex(g => g.id === id);
  if (idx >= 0 && res.group) myGroupsCache[idx] = res.group;
  else await refreshMyGroups();
  myGroupsUiOpen[id] = true;
  renderMyGroups();
  setMyGroupsMsg("Курсанты сохранены");
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

async function downloadMyGroupCadetsTemplate() {
  if (typeof downloadXlsx === "function") {
    await downloadXlsx("/api/admin/cadets-template.xlsx", "lis-cadets-template.xlsx");
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
  a.download = "lis-cadets-template.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importMyGroupCadetsFile(id) {
  const card = document.querySelector('[data-myg="' + id + '"]');
  const inp = card && card.querySelector('[data-myg-file="' + id + '"]');
  const msg = card && card.querySelector('[data-myg-import-msg="' + id + '"]');
  const f = inp && inp.files && inp.files[0];
  if (!f) {
    if (msg) msg.innerHTML = '<span class="bad">Выберите файл Excel</span>';
    throw new Error("Выберите файл Excel");
  }
  if (msg) msg.textContent = "Загрузка…";
  const fd = new FormData();
  fd.append("file", f);
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

if ($("myGroupsBox")) {
  $("myGroupsBox").addEventListener("click", e => {
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
    const saveCad = e.target.closest("[data-save-myg-cadets]");
    if (saveCad) {
      saveMyGroupCadets(saveCad.getAttribute("data-save-myg-cadets")).catch(err => setMyGroupsMsg(err.message, true));
      return;
    }
    const tpl = e.target.closest("[data-myg-tpl]");
    if (tpl) {
      downloadMyGroupCadetsTemplate().catch(err => setMyGroupsMsg(err.message, true));
      return;
    }
    const imp = e.target.closest("[data-myg-import]");
    if (imp) {
      importMyGroupCadetsFile(imp.getAttribute("data-myg-import")).catch(err => {
        setMyGroupsMsg(err.message, true);
        const id = imp.getAttribute("data-myg-import");
        const msg = document.querySelector('[data-myg-import-msg="' + id + '"]');
        if (msg) msg.innerHTML = '<span class="bad">' + esc(err.message || "Ошибка") + "</span>";
      });
      return;
    }
    const del = e.target.closest("[data-del-myg]");
    if (del) {
      deleteMyGroup(del.getAttribute("data-del-myg")).catch(err => setMyGroupsMsg(err.message, true));
    }
  });
}

setTimeout(() => {
  refreshMyGroups().catch(() => {});
}, 0);
