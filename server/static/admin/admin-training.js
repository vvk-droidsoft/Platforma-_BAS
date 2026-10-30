/* Справочник потоков и групп. Загружается после admin-cadets.js */

let streamsCatalogCache = [];
let selectedStreamId = "";

function peopleNamesBrief(list) {
  return (list || []).map(p => p.fio || p.callsign || "").filter(Boolean).join(", ");
}

function placeBrief(g) {
  const bits = [];
  if (g.classroom) bits.push(g.classroom);
  if (g.polygon_name) bits.push(g.polygon_name);
  if (g.tent_num) bits.push("пал. " + g.tent_num);
  return bits.join(" · ") || "—";
}

function clearGroupEditForm() {
  if ($("editGroupId")) $("editGroupId").value = "";
  ["editGroupNum", "editGroupPlan", "editGroupInstructor", "editGroupAssistants",
    "editGroupClassroom", "editGroupPolygon", "editGroupTent", "editGroupNote"]
    .forEach(id => { if ($(id)) $(id).value = ""; });
  if ($("btnSaveGroup")) $("btnSaveGroup").textContent = "Добавить группу";
  if ($("btnCancelGroupEdit")) $("btnCancelGroupEdit").classList.add("hidden");
}

function setStreamDetailMsg(text, bad) {
  const el = $("streamDetailMsg");
  if (!el) return;
  if (!text) { el.textContent = ""; return; }
  el.innerHTML = bad
    ? ('<span class="bad">' + esc(text) + "</span>")
    : ('<span class="ok">' + esc(text) + "</span>");
}

function renderStreamsCatalog() {
  const body = $("streamsCatalogBody");
  if (!body) return;
  const list = streamsCatalogCache || [];
  body.innerHTML = list.map(s => {
    const active = s.id === selectedStreamId ? ' style="background:rgba(25,240,240,.08)"' : "";
    return `<tr data-open-stream="${esc(s.id)}"${active} style="cursor:pointer">
      <td><strong>№ ${esc(s.stream_num || "—")}</strong></td>
      <td>${esc(s.groups_count || 0)}</td>
      <td>${esc(s.cadets_count || 0)}</td>
      <td>${esc(s.staff_count || 0)}</td>
      <td>${esc(s.note || "")}</td>
      <td><button class="btn" type="button" data-open-stream="${esc(s.id)}">Открыть</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="hint">Потоков пока нет — добавьте или загрузите распределение</td></tr>`;
}

function renderStreamGroups(stream) {
  const body = $("streamGroupsBody");
  if (!body) return;
  const groups = (stream && stream.groups) || [];
  body.innerHTML = groups.map(g => {
    const n = Number(g.cadets_count) || 0;
    return `<tr>
      <td><strong>№ ${esc(g.group_num || "—")}</strong></td>
      <td>${esc(n)}${g.planned_count ? (" / " + esc(g.planned_count)) : ""}</td>
      <td>${esc(g.planned_count || 0)}</td>
      <td>${esc(peopleNamesBrief(g.instructors) || "—")}</td>
      <td>${esc(peopleNamesBrief(g.assistants) || "—")}</td>
      <td>${esc(placeBrief(g))}</td>
      <td class="row">
        <button class="btn" type="button" data-edit-group="${esc(g.id)}">Изменить</button>
        <button class="btn danger" type="button" data-del-group="${esc(g.id)}" data-cadets="${esc(n)}">Удалить</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="hint">Групп нет</td></tr>`;
}

function showStreamDetail(stream) {
  const panel = $("streamDetailPanel");
  if (!panel || !stream) return;
  selectedStreamId = stream.id;
  panel.classList.remove("hidden");
  if ($("streamDetailTitle")) $("streamDetailTitle").textContent = "Поток № " + (stream.stream_num || "—");
  if ($("streamDetailMeta")) {
    $("streamDetailMeta").textContent =
      "групп: " + (stream.groups_count || 0) +
      " · курсантов: " + (stream.cadets_count || 0) +
      " · состав: " + (stream.staff_count || 0);
  }
  if ($("editStreamNum")) $("editStreamNum").value = stream.stream_num || "";
  if ($("editStreamNote")) $("editStreamNote").value = stream.note || "";
  if ($("editStreamSeniors")) {
    $("editStreamSeniors").value = peopleNamesBrief(stream.stream_seniors || []);
  }
  clearGroupEditForm();
  renderStreamGroups(stream);
  renderStreamsCatalog();
  setStreamDetailMsg("");
}

async function refreshStreamsCatalog(keepSelected) {
  const data = await api("/api/admin/training/streams?summary=1");
  streamsCatalogCache = data.streams || [];
  renderStreamsCatalog();
  if (keepSelected && selectedStreamId) {
    const s = streamsCatalogCache.find(x => x.id === selectedStreamId);
    if (s) showStreamDetail(s);
    else {
      selectedStreamId = "";
      if ($("streamDetailPanel")) $("streamDetailPanel").classList.add("hidden");
    }
  }
}

async function openStreamById(id) {
  const data = await api("/api/admin/training/streams/" + encodeURIComponent(id));
  if (data.stream) showStreamDetail(data.stream);
}

function startGroupEdit(groupId) {
  const stream = streamsCatalogCache.find(s => s.id === selectedStreamId);
  const g = ((stream && stream.groups) || []).find(x => x.id === groupId);
  if (!g) return;
  if ($("editGroupId")) $("editGroupId").value = g.id;
  if ($("editGroupNum")) $("editGroupNum").value = g.group_num || "";
  if ($("editGroupPlan")) $("editGroupPlan").value = g.planned_count || 0;
  if ($("editGroupInstructor")) $("editGroupInstructor").value = peopleNamesBrief(g.instructors);
  if ($("editGroupAssistants")) $("editGroupAssistants").value = peopleNamesBrief(g.assistants);
  if ($("editGroupClassroom")) $("editGroupClassroom").value = g.classroom || "";
  if ($("editGroupPolygon")) $("editGroupPolygon").value = g.polygon_name || "";
  if ($("editGroupTent")) $("editGroupTent").value = g.tent_num || "";
  if ($("editGroupNote")) $("editGroupNote").value = g.note || "";
  if ($("btnSaveGroup")) $("btnSaveGroup").textContent = "Сохранить группу";
  if ($("btnCancelGroupEdit")) $("btnCancelGroupEdit").classList.remove("hidden");
  const form = $("groupEditForm");
  if (form) form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveStreamDetail() {
  if (!selectedStreamId) return;
  const res = await api("/api/admin/training/streams/" + encodeURIComponent(selectedStreamId), {
    method: "PUT",
    json: {
      stream_num: ($("editStreamNum") && $("editStreamNum").value) || "",
      note: ($("editStreamNote") && $("editStreamNote").value) || "",
      seniors_text: ($("editStreamSeniors") && $("editStreamSeniors").value) || ""
    }
  });
  if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
  if (typeof renderCadetsTable === "function") renderCadetsTable();
  await refreshStreamsCatalog(true);
  const warn = (res.warnings || []).join("; ");
  setStreamDetailMsg(warn ? ("Сохранено. " + warn) : "Поток сохранён", !!warn);
}

async function deleteSelectedStream() {
  if (!selectedStreamId) return;
  if (!confirm("Удалить поток и все его пустые группы?")) return;
  try {
    const res = await api(
      "/api/admin/training/streams/" + encodeURIComponent(selectedStreamId) + "?force_empty_groups=true",
      { method: "DELETE" }
    );
    if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
    if (typeof renderCadetsTable === "function") renderCadetsTable();
    selectedStreamId = "";
    if ($("streamDetailPanel")) $("streamDetailPanel").classList.add("hidden");
    await refreshStreamsCatalog(false);
  } catch (e) {
    setStreamDetailMsg(e.message || "Ошибка", true);
  }
}

async function saveGroupDetail() {
  if (!selectedStreamId) {
    setStreamDetailMsg("Сначала откройте поток", true);
    return;
  }
  const gid = ($("editGroupId") && $("editGroupId").value) || "";
  const payload = {
    stream_id: selectedStreamId,
    group_num: ($("editGroupNum") && $("editGroupNum").value) || "",
    planned_count: Number(($("editGroupPlan") && $("editGroupPlan").value) || 0),
    classroom: ($("editGroupClassroom") && $("editGroupClassroom").value) || "",
    polygon_name: ($("editGroupPolygon") && $("editGroupPolygon").value) || "",
    tent_num: ($("editGroupTent") && $("editGroupTent").value) || "",
    note: ($("editGroupNote") && $("editGroupNote").value) || "",
    instructor_text: ($("editGroupInstructor") && $("editGroupInstructor").value) || "",
    assistants_text: ($("editGroupAssistants") && $("editGroupAssistants").value) || ""
  };
  try {
    const res = gid
      ? await api("/api/admin/training/groups/" + encodeURIComponent(gid), { method: "PUT", json: payload })
      : await api("/api/admin/training/groups", { method: "POST", json: payload });
    if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
    if (typeof renderCadetsTable === "function") renderCadetsTable();
    clearGroupEditForm();
    await refreshStreamsCatalog(true);
    const warn = (res.warnings || []).join("; ");
    setStreamDetailMsg(warn ? ("Группа сохранена. " + warn) : "Группа сохранена", !!warn);
  } catch (e) {
    setStreamDetailMsg(e.message || "Ошибка", true);
  }
}

async function deleteGroupById(groupId, cadetsCount) {
  const n = Number(cadetsCount) || 0;
  let url = "/api/admin/training/groups/" + encodeURIComponent(groupId);
  if (n > 0) {
    if (!confirm("В группе курсантов: " + n + ". Отвязать их от группы и удалить группу?")) return;
    url += "?detach_cadets=true";
  } else if (!confirm("Удалить пустую группу?")) {
    return;
  }
  try {
    const res = await api(url, { method: "DELETE" });
    if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
    if (typeof renderCadetsTable === "function") renderCadetsTable();
    await refreshStreamsCatalog(true);
    setStreamDetailMsg("Группа удалена");
  } catch (e) {
    setStreamDetailMsg(e.message || "Ошибка", true);
  }
}

async function addNewStream() {
  const num = ($("newStreamNum") && $("newStreamNum").value) || "";
  const note = ($("newStreamNote") && $("newStreamNote").value) || "";
  try {
    const res = await api("/api/admin/training/streams", {
      method: "POST",
      json: { stream_num: num, note: note }
    });
    if (typeof applyCadetsPayload === "function") applyCadetsPayload(res);
    if (typeof renderCadetsTable === "function") renderCadetsTable();
    if ($("newStreamNum")) $("newStreamNum").value = "";
    if ($("newStreamNote")) $("newStreamNote").value = "";
    await refreshStreamsCatalog(false);
    if (res.stream && res.stream.id) await openStreamById(res.stream.id);
  } catch (e) {
    alert(e.message || "Ошибка");
  }
}

// подмешиваем обновление каталога в applyCadetsPayload / refreshCadets
(function hookCadetsRefresh() {
  if (typeof applyCadetsPayload === "function") {
    const prev = applyCadetsPayload;
    window.applyCadetsPayload = function (data) {
      prev(data);
      if (data && Array.isArray(data.streams) && data.tree) {
        refreshStreamsCatalog(!!selectedStreamId).catch(() => {});
      }
    };
  }
  if (typeof refreshCadets === "function") {
    const prevR = refreshCadets;
    window.refreshCadets = async function () {
      await prevR();
      await refreshStreamsCatalog(!!selectedStreamId).catch(() => {});
    };
  }
})();

if ($("streamsCatalogBody")) {
  $("streamsCatalogBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-open-stream]");
    if (!btn) return;
    openStreamById(btn.getAttribute("data-open-stream")).catch(err => alert(err.message));
  });
}
if ($("streamGroupsBody")) {
  $("streamGroupsBody").addEventListener("click", e => {
    const edit = e.target.closest("[data-edit-group]");
    if (edit) {
      startGroupEdit(edit.getAttribute("data-edit-group"));
      return;
    }
    const del = e.target.closest("[data-del-group]");
    if (del) {
      deleteGroupById(del.getAttribute("data-del-group"), del.getAttribute("data-cadets"))
        .catch(err => alert(err.message));
    }
  });
}
if ($("btnAddStream")) $("btnAddStream").onclick = () => addNewStream().catch(e => alert(e.message));
if ($("btnCloseStreamDetail")) $("btnCloseStreamDetail").onclick = () => {
  selectedStreamId = "";
  if ($("streamDetailPanel")) $("streamDetailPanel").classList.add("hidden");
  renderStreamsCatalog();
};
if ($("btnSaveStream")) $("btnSaveStream").onclick = () => saveStreamDetail().catch(e => setStreamDetailMsg(e.message, true));
if ($("btnDeleteStream")) $("btnDeleteStream").onclick = () => deleteSelectedStream().catch(e => setStreamDetailMsg(e.message, true));
if ($("btnSaveGroup")) $("btnSaveGroup").onclick = () => saveGroupDetail().catch(e => setStreamDetailMsg(e.message, true));
if ($("btnCancelGroupEdit")) $("btnCancelGroupEdit").onclick = () => clearGroupEditForm();

// первичная загрузка после boot cadets
setTimeout(() => {
  refreshStreamsCatalog(false).catch(() => {});
}, 0);
