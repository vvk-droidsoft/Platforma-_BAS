/* Распределения: документ → строки групп. После admin-cadets.js */

let distributionsCache = [];
let selectedDistId = "";
let selectedDist = null;

const distPickers = {
  instructor: [],
  assistants: [],
  seniors: []
};

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

function periodBrief(g) {
  const a = (g.period_from || "").trim();
  const b = (g.period_to || "").trim();
  if (a && b) return a + " — " + b;
  return a || b || "—";
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

function clearGroupForm() {
  if ($("editDistGroupId")) $("editDistGroupId").value = "";
  ["dgStream", "dgGroup", "dgFrom", "dgTo", "dgPlan", "dgClassroom", "dgPolygon", "dgTent", "dgNote"]
    .forEach(id => { if ($(id)) $(id).value = ""; });
  setPickerPeople("instructor", []);
  setPickerPeople("assistants", []);
  setPickerPeople("seniors", []);
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Добавить группу";
  if ($("btnCancelDistGroup")) $("btnCancelDistGroup").classList.add("hidden");
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Добавить группу";
  document.querySelectorAll(".staff-picker .staff-q").forEach(inp => { inp.value = ""; });
  document.querySelectorAll(".staff-picker .staff-suggest").forEach(el => {
    el.classList.add("hidden");
    el.innerHTML = "";
  });
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

function renderDistGroups() {
  const body = $("distGroupsBody");
  if (!body) return;
  const groups = (selectedDist && selectedDist.groups) || [];
  body.innerHTML = groups.map(g => `<tr>
    <td><strong>№ ${esc(g.stream_num || "—")}</strong></td>
    <td>${esc(periodBrief(g))}</td>
    <td><strong>№ ${esc(g.group_num || "—")}</strong></td>
    <td>${esc(g.planned_count || 0)}</td>
    <td>${esc(peopleNamesBrief(g.instructors) || "—")}</td>
    <td>${esc(peopleNamesBrief(g.assistants) || "—")}</td>
    <td>${esc(peopleNamesBrief(g.stream_seniors) || "—")}</td>
    <td>${esc(placeBrief(g))}</td>
    <td class="row">
      <button class="btn" type="button" data-edit-dg="${esc(g.id)}">Изменить</button>
      <button class="btn danger" type="button" data-del-dg="${esc(g.id)}">Удалить</button>
    </td>
  </tr>`).join("") || `<tr><td colspan="9" class="hint">Строк пока нет — добавьте группу</td></tr>`;
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
  clearGroupForm();
  renderDistGroups();
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
  if (!confirm("Удалить распределение и все его строки?")) return;
  await api("/api/admin/distributions/" + encodeURIComponent(selectedDistId), { method: "DELETE" });
  selectedDistId = "";
  selectedDist = null;
  if ($("distDetailPanel")) $("distDetailPanel").classList.add("hidden");
  await refreshDistributions(false);
}

function startEditDistGroup(groupId) {
  const g = ((selectedDist && selectedDist.groups) || []).find(x => x.id === groupId);
  if (!g) return;
  if ($("editDistGroupId")) $("editDistGroupId").value = g.id;
  if ($("dgStream")) $("dgStream").value = g.stream_num || "";
  if ($("dgGroup")) $("dgGroup").value = g.group_num || "";
  if ($("dgFrom")) $("dgFrom").value = g.period_from || "";
  if ($("dgTo")) $("dgTo").value = g.period_to || "";
  if ($("dgPlan")) $("dgPlan").value = g.planned_count || 0;
  if ($("dgClassroom")) $("dgClassroom").value = g.classroom || "";
  if ($("dgPolygon")) $("dgPolygon").value = g.polygon_name || "";
  if ($("dgTent")) $("dgTent").value = g.tent_num || "";
  if ($("dgNote")) $("dgNote").value = g.note || "";
  setPickerPeople("instructor", g.instructors || []);
  setPickerPeople("assistants", g.assistants || []);
  setPickerPeople("seniors", g.stream_seniors || []);
  if ($("btnSaveDistGroup")) $("btnSaveDistGroup").textContent = "Сохранить группу";
  if ($("btnCancelDistGroup")) $("btnCancelDistGroup").classList.remove("hidden");
  if ($("distGroupFormTitle")) $("distGroupFormTitle").textContent = "Изменить группу";
  const formTitle = $("distGroupFormTitle");
  if (formTitle) formTitle.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function groupPayloadFromForm() {
  return {
    stream_num: ($("dgStream") && $("dgStream").value) || "",
    group_num: ($("dgGroup") && $("dgGroup").value) || "",
    period_from: ($("dgFrom") && $("dgFrom").value) || "",
    period_to: ($("dgTo") && $("dgTo").value) || "",
    planned_count: Number(($("dgPlan") && $("dgPlan").value) || 0),
    classroom: ($("dgClassroom") && $("dgClassroom").value) || "",
    polygon_name: ($("dgPolygon") && $("dgPolygon").value) || "",
    tent_num: ($("dgTent") && $("dgTent").value) || "",
    note: ($("dgNote") && $("dgNote").value) || "",
    instructor_ids: (distPickers.instructor || []).map(p => p.id),
    assistant_ids: (distPickers.assistants || []).map(p => p.id),
    senior_ids: (distPickers.seniors || []).map(p => p.id)
  };
}

async function saveDistGroup() {
  if (!selectedDistId) {
    setDistMsg("Сначала откройте распределение", true);
    return;
  }
  const gid = ($("editDistGroupId") && $("editDistGroupId").value) || "";
  const payload = groupPayloadFromForm();
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
  if (!confirm("Удалить строку группы из распределения?")) return;
  try {
    const res = await api(
      "/api/admin/distributions/groups/" + encodeURIComponent(groupId),
      { method: "DELETE" }
    );
    if (res.distribution) showDistDetail(res.distribution);
    else await openDistribution(selectedDistId);
    await refreshDistributions(false);
    setDistMsg("Строка удалена");
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
      if (e.key === "Escape") {
        suggest.classList.add("hidden");
      }
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
if ($("distGroupsBody")) {
  $("distGroupsBody").addEventListener("click", e => {
    const edit = e.target.closest("[data-edit-dg]");
    if (edit) {
      startEditDistGroup(edit.getAttribute("data-edit-dg"));
      return;
    }
    const del = e.target.closest("[data-del-dg]");
    if (del) {
      deleteDistGroup(del.getAttribute("data-del-dg")).catch(err => alert(err.message));
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
if ($("btnSaveDistGroup")) {
  $("btnSaveDistGroup").onclick = () => saveDistGroup().catch(e => setDistMsg(e.message, true));
}
if ($("btnCancelDistGroup")) {
  $("btnCancelDistGroup").onclick = () => clearGroupForm();
}

// подтянуть старших потока при вводе номера потока (если уже есть в документе)
if ($("dgStream")) {
  $("dgStream").addEventListener("change", () => {
    if (($("editDistGroupId") && $("editDistGroupId").value)) return;
    const stream = (($("dgStream") && $("dgStream").value) || "").trim();
    if (!stream || !selectedDist) return;
    const same = ((selectedDist.groups) || []).find(
      g => String(g.stream_num || "") === stream && (g.stream_seniors || []).length
    );
    if (same) setPickerPeople("seniors", same.stream_seniors || []);
  });
}

bindStaffPickers();
setTimeout(() => {
  refreshDistributions(false).catch(() => {});
}, 0);
