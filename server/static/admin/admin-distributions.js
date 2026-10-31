/* Распределения: документ → потоки (шапка) → сворачиваемые группы */

let distributionsCache = [];
let selectedDistId = "";
let selectedDist = null;
/** streamId -> collapsed groups map groupId -> bool; stream collapsed separately */
let distUiState = { streams: {}, groups: {} };

const distPickers = {
  instructor: [],
  assistants: [],
  seniors: []
};

function peopleNamesBrief(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function formatRuDate(iso) {
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

function periodBrief(s) {
  const a = formatRuDate(s.period_from);
  const b = formatRuDate(s.period_to);
  if (a && b) return "с " + a + " по " + b;
  if (a) return "с " + a;
  if (b) return "по " + b;
  return "сроки не заданы";
}

function setDistMsg(text, bad) {
  const el = $("distDetailMsg");
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function renderPickerChips(key) {
  const root = document.querySelector('.staff-picker[data-picker="' + key + '"]');
  if (!root) return;
  const box = root.querySelector(".staff-chips");
  if (!box) return;
  const list = distPickers[key] || [];
  box.innerHTML = list.map(p =>
    `<span class="staff-chip" data-rm="${esc(p.id)}">${esc(p.fio || p.callsign || p.id)}` +
    `<button type="button" class="staff-chip-x" data-rm="${esc(p.id)}" aria-label="Убрать">×</button></span>`
  ).join("");
}

function setPickerPeople(key, people) {
  distPickers[key] = (people || []).map(p => ({
    id: p.id,
    fio: p.fio || "",
    callsign: p.callsign || "",
    role_label: p.role_label || ""
  }));
  renderPickerChips(key);
}

function addPickerPerson(key, person, multi) {
  if (!person || !person.id) return;
  const cur = distPickers[key] || [];
  if (!multi) {
    setPickerPeople(key, [person]);
    return;
  }
  if (cur.some(p => p.id === person.id)) return;
  setPickerPeople(key, cur.concat([person]));
}

function removePickerPerson(key, id) {
  setPickerPeople(key, (distPickers[key] || []).filter(p => p.id !== id));
}

function clearStreamForm() {
  if ($("editDistStreamId")) $("editDistStreamId").value = "";
  ["dsNum", "dsFrom", "dsTo", "dsPolygon", "dsNote"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  setPickerPeople("seniors", []);
  if ($("btnSaveDistStream")) $("btnSaveDistStream").textContent = "Добавить поток";
  if ($("btnCancelDistStream")) $("btnCancelDistStream").classList.add("hidden");
  if ($("distStreamFormTitle")) $("distStreamFormTitle").textContent = "Добавить поток";
  const root = document.querySelector('.staff-picker[data-picker="seniors"]');
  if (root) {
    const q = root.querySelector(".staff-q");
    const sug = root.querySelector(".staff-suggest");
    if (q) q.value = "";
    if (sug) { sug.classList.add("hidden"); sug.innerHTML = ""; }
  }
}

function clearGroupForm() {
  if ($("editDistGroupId")) $("editDistGroupId").value = "";
  if ($("dgStreamId")) $("dgStreamId").value = "";
  if ($("dgStreamHint")) $("dgStreamHint").textContent = "";
  ["dgGroup", "dgPlan", "dgClassroom", "dgTent", "dgNote"].forEach(id => {
    if ($(id)) $(id).value = "";
  });
  setPickerPeople("instructor", []);
  setPickerPeople("assistants", []);
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Сохранить группу";
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Добавить группу";
  if ($("distGroupForm")) $("distGroupForm").classList.add("hidden");
  document.querySelectorAll(
    '.staff-picker[data-picker="instructor"] .staff-q, .staff-picker[data-picker="assistants"] .staff-q'
  ).forEach(inp => { inp.value = ""; });
  document.querySelectorAll(
    '.staff-picker[data-picker="instructor"] .staff-suggest, .staff-picker[data-picker="assistants"] .staff-suggest'
  ).forEach(el => { el.classList.add("hidden"); el.innerHTML = ""; });
}

function renderDistributionsList() {
  const body = $("distributionsBody");
  if (!body) return;
  const list = distributionsCache || [];
  body.innerHTML = list.map(d => {
    const active = d.id === selectedDistId ? ' style="background:rgba(25,240,240,.08)"' : "";
    return `<tr data-open-dist="${esc(d.id)}"${active} style="cursor:pointer">
      <td><strong>${esc(d.title || "—")}</strong></td>
      <td>${esc(d.dist_date || "—")}</td>
      <td>${esc(d.streams_count || 0)}</td>
      <td>${esc(d.groups_count || 0)}</td>
      <td>${esc(d.planned_total || 0)}</td>
      <td>${esc(d.note || "")}</td>
      <td><button class="btn" type="button" data-open-dist="${esc(d.id)}">Открыть</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="hint">Распределений пока нет</td></tr>`;
}

function isStreamCollapsed(streamId) {
  return !!distUiState.streams[streamId];
}

function isGroupCollapsed(groupId) {
  // по умолчанию группы свёрнуты
  if (!Object.prototype.hasOwnProperty.call(distUiState.groups, groupId)) return true;
  return !!distUiState.groups[groupId];
}

function toggleStreamCollapse(streamId) {
  distUiState.streams[streamId] = !isStreamCollapsed(streamId);
  renderDistStreams();
}

function toggleGroupCollapse(groupId) {
  distUiState.groups[groupId] = !isGroupCollapsed(groupId);
  renderDistStreams();
}

function renderDistStreams() {
  const box = $("distStreamsBox");
  if (!box) return;
  const streams = (selectedDist && selectedDist.streams) || [];
  if (!streams.length) {
    box.innerHTML = '<p class="hint">Потоков пока нет — добавьте шапку потока ниже</p>';
    return;
  }
  box.innerHTML = streams.map(s => {
    const sid = s.id || ("num:" + s.stream_num);
    const streamOpen = !isStreamCollapsed(sid);
    const seniors = peopleNamesBrief(s.seniors) || "не указаны";
    const headSummary =
      "Поток № " + (s.stream_num || "—") +
      ", " + periodBrief(s) +
      ", старшие: " + seniors +
      ", курсантов (план): " + (s.planned_total || 0) +
      ", групп: " + (s.groups_count || 0) +
      (s.polygon_name ? (", полигон " + s.polygon_name) : "");
    const groupsHtml = (s.groups || []).map(g => {
      const gid = g.id;
      const open = !isGroupCollapsed(gid);
      const sub =
        "Группа " + (g.group_num || "—") +
        ", план " + (g.planned_count || 0) +
        ", инструктор: " + (peopleNamesBrief(g.instructors) || "—") +
        ", ассистенты: " + (peopleNamesBrief(g.assistants) || "—") +
        (g.classroom ? (", аудитория " + g.classroom) : "") +
        (g.tent_num ? (", палатка " + g.tent_num) : "");
      return `<div class="dist-group-card${open ? " open" : ""}" data-group-id="${esc(gid)}">
        <button type="button" class="dist-group-head" data-toggle-group="${esc(gid)}" aria-expanded="${open ? "true" : "false"}">
          <span class="dist-chevron">${open ? "▼" : "▶"}</span>
          <span class="dist-group-title">${esc(sub)}</span>
        </button>
        <div class="dist-group-body"${open ? "" : " hidden"}>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-edit-dg="${esc(gid)}" data-stream-id="${esc(s.id || "")}">Изменить</button>
            <button class="btn danger" type="button" data-del-dg="${esc(gid)}">Удалить</button>
          </div>
          ${g.note ? ('<p class="hint" style="margin:8px 0 0">' + esc(g.note) + "</p>") : ""}
        </div>
      </div>`;
    }).join("") || '<p class="hint" style="margin:8px 0">Групп пока нет</p>';

    return `<div class="dist-stream-card${streamOpen ? " open" : ""}" data-stream-id="${esc(sid)}">
      <button type="button" class="dist-stream-head" data-toggle-stream="${esc(sid)}" aria-expanded="${streamOpen ? "true" : "false"}">
        <span class="dist-chevron">${streamOpen ? "▼" : "▶"}</span>
        <span class="dist-stream-title">${esc(headSummary)}</span>
      </button>
      <div class="dist-stream-body"${streamOpen ? "" : " hidden"}>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn" type="button" data-edit-stream="${esc(s.id || "")}" data-stream-num="${esc(s.stream_num || "")}">Изменить шапку</button>
          <button class="btn main" type="button" data-add-group="${esc(s.id || "")}" data-stream-num="${esc(s.stream_num || "")}">Добавить группу</button>
          ${s.id ? ('<button class="btn danger" type="button" data-del-stream="' + esc(s.id) + '">Удалить поток</button>') : ""}
        </div>
        <div class="dist-groups-list">${groupsHtml}</div>
      </div>
    </div>`;
  }).join("");
}

function showDistDetail(dist) {
  const panel = $("distDetailPanel");
  if (!panel || !dist) return;
  selectedDistId = dist.id;
  selectedDist = dist;
  panel.classList.remove("hidden");
  if ($("distDetailTitle")) $("distDetailTitle").textContent = dist.title || "Распределение";
  if ($("distDetailMeta")) {
    $("distDetailMeta").textContent =
      "потоков: " + (dist.streams_count || 0) +
      " · групп: " + (dist.groups_count || 0) +
      " · план: " + (dist.planned_total || 0) +
      (dist.dist_date ? (" · " + dist.dist_date) : "");
  }
  if ($("editDistTitle")) $("editDistTitle").value = dist.title || "";
  if ($("editDistDate")) $("editDistDate").value = dist.dist_date || "";
  if ($("editDistNote")) $("editDistNote").value = dist.note || "";
  clearStreamForm();
  clearGroupForm();
  renderDistStreams();
  renderDistributionsList();
  setDistMsg("");
}

async function refreshDistributions(keepSelected) {
  const data = await api("/api/admin/distributions");
  distributionsCache = data.distributions || [];
  renderDistributionsList();
  if (keepSelected && selectedDistId) {
    const data2 = await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId));
    if (data2.distribution) showDistDetail(data2.distribution);
    else {
      selectedDistId = "";
      selectedDist = null;
      if ($("distDetailPanel")) $("distDetailPanel").classList.add("hidden");
    }
  }
}

async function openDistribution(id) {
  const data = await api("/api/admin/distributions/" + encodeURIComponent(id));
  if (data.distribution) showDistDetail(data.distribution);
}

async function createDistribution() {
  const title = ($("newDistTitle") && $("newDistTitle").value) || "";
  const dist_date = ($("newDistDate") && $("newDistDate").value) || "";
  const note = ($("newDistNote") && $("newDistNote").value) || "";
  const res = await api("/api/admin/distributions", {
    method: "POST",
    json: { title, dist_date, note }
  });
  if ($("newDistTitle")) $("newDistTitle").value = "";
  if ($("newDistDate")) $("newDistDate").value = "";
  if ($("newDistNote")) $("newDistNote").value = "";
  await refreshDistributions(false);
  if (res.distribution) showDistDetail(res.distribution);
}

async function saveDistributionMeta() {
  if (!selectedDistId) return;
  const res = await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId), {
    method: "PUT",
    json: {
      title: ($("editDistTitle") && $("editDistTitle").value) || "",
      dist_date: ($("editDistDate") && $("editDistDate").value) || "",
      note: ($("editDistNote") && $("editDistNote").value) || ""
    }
  });
  if (res.distribution) showDistDetail(res.distribution);
  await refreshDistributions(false);
  setDistMsg("Сохранено");
}

async function deleteDistribution() {
  if (!selectedDistId) return;
  if (!confirm("Удалить распределение и все его потоки?")) return;
  await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId), { method: "DELETE" });
  selectedDistId = "";
  selectedDist = null;
  if ($("distDetailPanel")) $("distDetailPanel").classList.add("hidden");
  await refreshDistributions(false);
}

function startEditStream(streamId) {
  const s = ((selectedDist && selectedDist.streams) || []).find(x => x.id === streamId);
  if (!s) return;
  if ($("editDistStreamId")) $("editDistStreamId").value = s.id;
  if ($("dsNum")) $("dsNum").value = s.stream_num || "";
  if ($("dsFrom")) $("dsFrom").value = s.period_from || "";
  if ($("dsTo")) $("dsTo").value = s.period_to || "";
  if ($("dsPolygon")) $("dsPolygon").value = s.polygon_name || "";
  if ($("dsNote")) $("dsNote").value = s.note || "";
  setPickerPeople("seniors", s.seniors || []);
  if ($("btnSaveDistStream")) $("btnSaveDistStream").textContent = "Сохранить поток";
  if ($("btnCancelDistStream")) $("btnCancelDistStream").classList.remove("hidden");
  if ($("distStreamFormTitle")) $("distStreamFormTitle").textContent = "Изменить поток № " + (s.stream_num || "");
  if ($("distStreamForm")) $("distStreamForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveDistStream() {
  if (!selectedDistId) {
    setDistMsg("Сначала откройте распределение", true);
    return;
  }
  const sid = ($("editDistStreamId") && $("editDistStreamId").value) || "";
  const payload = {
    stream_num: ($("dsNum") && $("dsNum").value) || "",
    period_from: ($("dsFrom") && $("dsFrom").value) || "",
    period_to: ($("dsTo") && $("dsTo").value) || "",
    polygon_name: ($("dsPolygon") && $("dsPolygon").value) || "",
    note: ($("dsNote") && $("dsNote").value) || "",
    senior_ids: (distPickers.seniors || []).map(p => p.id)
  };
  try {
    const res = sid
      ? await api("/api/admin/distributions/streams/" + encodeURIComponent(sid), {
        method: "PUT",
        json: payload
      })
      : await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId) + "/streams", {
        method: "POST",
        json: payload
      });
    if (res.distribution) showDistDetail(res.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    setDistMsg(sid ? "Поток сохранён" : "Поток добавлен");
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
  }
}

async function deleteDistStream(streamId) {
  if (!confirm("Удалить поток и все его группы?")) return;
  try {
    const res = await api(
      "/api/admin/distributions/streams/" + encodeURIComponent(streamId),
      { method: "DELETE" }
    );
    if (res.distribution) showDistDetail(res.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    setDistMsg("Поток удалён");
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
  }
}

function openAddGroupForm(streamId, streamNum) {
  clearGroupForm();
  if ($("dgStreamId")) $("dgStreamId").value = streamId || "";
  if ($("dgStreamHint")) {
    $("dgStreamHint").textContent = streamNum
      ? ("Поток № " + streamNum + " — заполните только данные группы")
      : "Выберите поток";
  }
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Добавить группу";
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Добавить группу";
  if ($("distGroupForm")) {
    $("distGroupForm").classList.remove("hidden");
    $("distGroupForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  // развернуть поток
  if (streamId) distUiState.streams[streamId] = false;
  renderDistStreams();
}

function startEditDistGroup(groupId, streamId) {
  let g = null;
  let stream = null;
  for (const s of (selectedDist && selectedDist.streams) || []) {
    const found = (s.groups || []).find(x => x.id === groupId);
    if (found) {
      g = found;
      stream = s;
      break;
    }
  }
  if (!g) return;
  if ($("editDistGroupId")) $("editDistGroupId").value = g.id;
  if ($("dgStreamId")) $("dgStreamId").value = streamId || (stream && stream.id) || "";
  if ($("dgStreamHint")) {
    $("dgStreamHint").textContent = stream
      ? ("Поток № " + (stream.stream_num || "—"))
      : "";
  }
  if ($("dgGroup")) $("dgGroup").value = g.group_num || "";
  if ($("dgPlan")) $("dgPlan").value = g.planned_count || 0;
  if ($("dgClassroom")) $("dgClassroom").value = g.classroom || "";
  if ($("dgTent")) $("dgTent").value = g.tent_num || "";
  if ($("dgNote")) $("dgNote").value = g.note || "";
  setPickerPeople("instructor", g.instructors || []);
  setPickerPeople("assistants", g.assistants || []);
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Сохранить группу";
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Изменить группу " + (g.group_num || "");
  if ($("distGroupForm")) {
    $("distGroupForm").classList.remove("hidden");
    $("distGroupForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  distUiState.groups[groupId] = false;
  if (stream && stream.id) distUiState.streams[stream.id] = false;
  renderDistStreams();
}

async function saveDistGroup() {
  if (!selectedDistId) {
    setDistMsg("Сначала откройте распределение", true);
    return;
  }
  const gid = ($("editDistGroupId") && $("editDistGroupId").value) || "";
  const streamId = ($("dgStreamId") && $("dgStreamId").value) || "";
  if (!gid && !streamId) {
    setDistMsg("Сначала нажмите «Добавить группу» у нужного потока", true);
    return;
  }
  const payload = {
    stream_id: streamId,
    group_num: ($("dgGroup") && $("dgGroup").value) || "",
    planned_count: Number(($("dgPlan") && $("dgPlan").value) || 0),
    classroom: ($("dgClassroom") && $("dgClassroom").value) || "",
    tent_num: ($("dgTent") && $("dgTent").value) || "",
    note: ($("dgNote") && $("dgNote").value) || "",
    instructor_ids: (distPickers.instructor || []).map(p => p.id),
    assistant_ids: (distPickers.assistants || []).map(p => p.id)
  };
  try {
    const res = gid
      ? await api("/api/admin/distributions/groups/" + encodeURIComponent(gid), {
        method: "PUT",
        json: payload
      })
      : await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId) + "/groups", {
        method: "POST",
        json: payload
      });
    if (res.distribution) showDistDetail(res.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    setDistMsg(gid ? "Группа сохранена" : "Группа добавлена");
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
  }
}

async function deleteDistGroup(groupId) {
  if (!confirm("Удалить группу из распределения?")) return;
  try {
    const res = await api(
      "/api/admin/distributions/groups/" + encodeURIComponent(groupId),
      { method: "DELETE" }
    );
    if (res.distribution) showDistDetail(res.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    setDistMsg("Группа удалена");
  } catch (e) {
    setDistMsg(e.message || "Ошибка", true);
  }
}

function bindStaffPickers() {
  document.querySelectorAll(".staff-picker").forEach(root => {
    if (root._lisBound) return;
    root._lisBound = true;
    const key = root.getAttribute("data-picker");
    const multi = root.getAttribute("data-multi") === "1";
    const input = root.querySelector(".staff-q");
    const suggest = root.querySelector(".staff-suggest");
    const chips = root.querySelector(".staff-chips");
    let timer = null;
    let seq = 0;

    if (chips) {
      chips.addEventListener("click", e => {
        const btn = e.target.closest("[data-rm]");
        if (!btn) return;
        removePickerPerson(key, btn.getAttribute("data-rm"));
      });
    }

    if (!input || !suggest) return;

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = (input.value || "").trim();
      if (q.length < 2) {
        suggest.classList.add("hidden");
        suggest.innerHTML = "";
        return;
      }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const rows = await api("/api/admin/staff?q=" + encodeURIComponent(q));
          if (my !== seq) return;
          const list = Array.isArray(rows) ? rows : (rows.staff || []);
          if (!list.length) {
            suggest.innerHTML = '<div class="staff-suggest-empty">Никого не найдено</div>';
            suggest.classList.remove("hidden");
            return;
          }
          suggest.innerHTML = list.map(p =>
            `<button type="button" class="staff-suggest-item" data-id="${esc(p.id)}">` +
            `<strong>${esc(p.fio || "")}</strong>` +
            `<span class="hint">${esc(p.role_label || p.role || "")}` +
            (p.department_name ? (" · " + esc(p.department_name)) : "") +
            (p.callsign ? (" · " + esc(p.callsign)) : "") +
            `</span></button>`
          ).join("");
          suggest.classList.remove("hidden");
        } catch (e) {
          if (my !== seq) return;
          suggest.innerHTML = '<div class="staff-suggest-empty">' + esc(e.message || "Ошибка") + "</div>";
          suggest.classList.remove("hidden");
        }
      }, 220);
    });

    suggest.addEventListener("click", e => {
      const btn = e.target.closest(".staff-suggest-item");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const fio = (btn.querySelector("strong") && btn.querySelector("strong").textContent) || "";
      addPickerPerson(key, { id, fio }, multi);
      input.value = "";
      suggest.classList.add("hidden");
      suggest.innerHTML = "";
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Escape") suggest.classList.add("hidden");
    });
  });
}

if ($("distributionsBody")) {
  $("distributionsBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-open-dist]");
    if (!btn) return;
    openDistribution(btn.getAttribute("data-open-dist")).catch(err => alert(err.message));
  });
}

if ($("distStreamsBox")) {
  $("distStreamsBox").addEventListener("click", e => {
    const togS = e.target.closest("[data-toggle-stream]");
    if (togS) {
      toggleStreamCollapse(togS.getAttribute("data-toggle-stream"));
      return;
    }
    const togG = e.target.closest("[data-toggle-group]");
    if (togG) {
      toggleGroupCollapse(togG.getAttribute("data-toggle-group"));
      return;
    }
    const editS = e.target.closest("[data-edit-stream]");
    if (editS) {
      const id = editS.getAttribute("data-edit-stream");
      if (id) startEditStream(id);
      return;
    }
    const addG = e.target.closest("[data-add-group]");
    if (addG) {
      openAddGroupForm(
        addG.getAttribute("data-add-group"),
        addG.getAttribute("data-stream-num")
      );
      return;
    }
    const delS = e.target.closest("[data-del-stream]");
    if (delS) {
      deleteDistStream(delS.getAttribute("data-del-stream")).catch(err => alert(err.message));
      return;
    }
    const editG = e.target.closest("[data-edit-dg]");
    if (editG) {
      startEditDistGroup(
        editG.getAttribute("data-edit-dg"),
        editG.getAttribute("data-stream-id")
      );
      return;
    }
    const delG = e.target.closest("[data-del-dg]");
    if (delG) {
      deleteDistGroup(delG.getAttribute("data-del-dg")).catch(err => alert(err.message));
    }
  });
}

if ($("btnAddDistribution")) {
  $("btnAddDistribution").onclick = () => createDistribution().catch(e => alert(e.message));
}
if ($("btnCloseDistDetail")) {
  $("btnCloseDistDetail").onclick = () => {
    selectedDistId = "";
    selectedDist = null;
    if ($("distDetailPanel")) $("distDetailPanel").classList.add("hidden");
    renderDistributionsList();
  };
}
if ($("btnSaveDistribution")) {
  $("btnSaveDistribution").onclick = () => saveDistributionMeta().catch(e => setDistMsg(e.message, true));
}
if ($("btnDeleteDistribution")) {
  $("btnDeleteDistribution").onclick = () => deleteDistribution().catch(e => setDistMsg(e.message, true));
}
if ($("btnSaveDistStream")) {
  $("btnSaveDistStream").onclick = () => saveDistStream().catch(e => setDistMsg(e.message, true));
}
if ($("btnCancelDistStream")) {
  $("btnCancelDistStream").onclick = () => clearStreamForm();
}
if ($("btnSaveDistGroup")) {
  $("btnSaveDistGroup").onclick = () => saveDistGroup().catch(e => setDistMsg(e.message, true));
}
if ($("btnCancelDistGroup")) {
  $("btnCancelDistGroup").onclick = () => clearGroupForm();
}

bindStaffPickers();
setTimeout(() => {
  refreshDistributions(false).catch(() => {});
}, 0);
