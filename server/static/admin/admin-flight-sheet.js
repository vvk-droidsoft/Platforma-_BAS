/* Полётная ведомость: таблицы «Взлёт» */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc =
    typeof window.esc === "function"
      ? window.esc
      : (s) =>
          String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
          );

  const STATUS_OPTS = [
    { value: "bg", label: "БГ" },
    { value: "not_bg", label: "НЕ БГ" },
    { value: "written_off", label: "Утерян" }
  ];

  let takeoffs = [];
  let seq = 0;
  /** @type {{ id: string, stream_num: string, group_num: string, cadets: any[] }[]} */
  let myGroups = [];
  /** cache: myGroupId -> assets[] */
  const assetsByGroup = {};
  let openPanel = null;
  let cadetModalTakeoffId = "";
  let cadetModalSelected = new Set();

  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function nowTime() {
    const d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function formatDateRu(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return m[3] + "." + m[2] + "." + m[1];
  }
  function groupKey(stream, group) {
    return String(stream || "").trim() + "::" + String(group || "").trim();
  }
  function parseGroupKey(key) {
    const i = String(key).indexOf("::");
    if (i < 0) return { stream: "", group: "" };
    return { stream: key.slice(0, i), group: key.slice(i + 2) };
  }

  function updateMeta() {
    const meta = $("flightSheetMeta");
    if (meta) meta.textContent = takeoffs.length ? " · " + takeoffs.length : "";
    const hint = $("flightSheetHint");
    if (hint) {
      hint.textContent = takeoffs.length
        ? "Таблиц «Взлёт»: " + takeoffs.length
        : "Нажмите «+», чтобы добавить таблицу «Взлёт»";
    }
  }

  function uniqStreams() {
    return [...new Set(myGroups.map((g) => String(g.stream_num || "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ru", { numeric: true })
    );
  }

  function groupsForTakeoff(t) {
    const streams = new Set(t.streams || []);
    return myGroups.filter((g) => {
      const sn = String(g.stream_num || "").trim();
      const gn = String(g.group_num || "").trim();
      if (!sn || !gn) return false;
      if (streams.size && !streams.has(sn)) return false;
      return true;
    });
  }

  function selectedMyGroups(t) {
    const keys = new Set(t.groups || []);
    if (!keys.size) return groupsForTakeoff(t);
    return myGroups.filter((g) => keys.has(groupKey(g.stream_num, g.group_num)));
  }

  function displayStreams(t) {
    const list = t.streams || [];
    if (!list.length) return "не указан";
    return list.join(", ");
  }
  function displayGroups(t) {
    const list = t.groups || [];
    if (!list.length) return "не указана";
    return list
      .map((k) => {
        const p = parseGroupKey(k);
        return p.group || k;
      })
      .join(", ");
  }
  function displayAircraftType(t) {
    return t.aircraftType ? t.aircraftType : "не указан";
  }
  function displayAircraftNo(t) {
    return t.aircraftNo ? t.aircraftNo : "не указан";
  }

  function statusLabel(code) {
    const hit = STATUS_OPTS.find((o) => o.value === code);
    return hit ? hit.label : "";
  }

  function statusBadgeHtml(code) {
    const label = statusLabel(code);
    if (!label) return "";
    return '<span class="lis-status lis-status-' + esc(code) + '">' + esc(label) + "</span>";
  }

  function clickable(label, kind, text, empty, innerHtml) {
    const isEmpty = !innerHtml && (!text || text === empty);
    return (
      '<span class="fs-meta-label">' +
      esc(label) +
      '</span><button type="button" class="fs-meta-val' +
      (isEmpty ? " is-empty" : "") +
      '" data-fs-pick="' +
      esc(kind) +
      '" title="Нажмите, чтобы выбрать">' +
      (innerHtml || esc(text || empty)) +
      "</button>"
    );
  }

  function statusClickable(t) {
    const code = t.status || "";
    const inner = code ? statusBadgeHtml(code) : esc("не указан");
    return clickable("Статус", "status", statusLabel(code), "не указан", inner);
  }

  function closePanel() {
    if (openPanel && openPanel.parentNode) openPanel.parentNode.removeChild(openPanel);
    openPanel = null;
  }

  function placePanel(anchor, panel) {
    closePanel();
    const host = anchor.closest("th, td, .fs-takeoff-card") || anchor.parentNode;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(panel);
    openPanel = panel;
  }

  function renderCheckPanel(items, selectedSet, { multi, emptyText, onChange }) {
    const panel = document.createElement("div");
    panel.className = "ms-dd-panel fs-dd-panel";
    if (!items.length) {
      panel.innerHTML = '<div class="hint" style="padding:8px">' + esc(emptyText || "Нет данных") + "</div>";
      return panel;
    }
    panel.innerHTML = items
      .map((it) => {
        const checked = selectedSet.has(it.value) ? " checked" : "";
        return (
          '<label class="ms-dd-item">' +
          '<input type="checkbox" value="' +
          esc(it.value) +
          '"' +
          checked +
          ">" +
          "<span>" +
          esc(it.label) +
          "</span></label>"
        );
      })
      .join("");
    panel.addEventListener("click", (e) => e.stopPropagation());
    panel.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        if (!multi) {
          selectedSet.clear();
          if (inp.checked) selectedSet.add(inp.value);
          panel.querySelectorAll('input[type="checkbox"]').forEach((x) => {
            if (x !== inp) x.checked = false;
          });
        } else if (inp.checked) selectedSet.add(inp.value);
        else selectedSet.delete(inp.value);
        onChange(selectedSet);
      });
    });
    return panel;
  }

  async function ensureAssets(myGroupIds) {
    if (typeof api !== "function") return [];
    const all = [];
    for (const id of myGroupIds) {
      if (!id) continue;
      if (!assetsByGroup[id]) {
        try {
          const data = await api("/api/admin/my-groups/" + encodeURIComponent(id) + "/assets");
          assetsByGroup[id] = Array.isArray(data.assets) ? data.assets : [];
        } catch (e) {
          assetsByGroup[id] = [];
        }
      }
      (assetsByGroup[id] || []).forEach((a) => all.push(a));
    }
    return all;
  }

  function assetItems(assets) {
    return (assets || [])
      .filter((a) => {
        const st = String(a.status || "");
        return st === "bg" || st === "not_bg";
      })
      .map((a) => {
        const stLabel = a.status_label || (a.status === "bg" ? "БГ" : "НЕ БГ");
        const type = a.board_type || "";
        const num = a.board_num || "";
        return {
          value: String(a.id || type + "::" + num),
          label: (type || "—") + " · № " + (num || "—") + " · " + stLabel,
          asset: a
        };
      });
  }

  function cadetItems(t) {
    const map = new Map();
    selectedMyGroups(t).forEach((g) => {
      (g.cadets || []).forEach((c) => {
        const num = String(c.num || c.student_num || "").trim();
        const callsign = String(c.callsign || "").trim();
        if (!num && !callsign) return;
        const key = num || "cs:" + callsign.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            value: key,
            label: (num || "—") + (callsign ? " · " + callsign : "") + (c.fio ? " · " + c.fio : ""),
            num,
            callsign,
            fio: c.fio || ""
          });
        }
      });
    });
    return [...map.values()].sort((a, b) =>
      String(a.num || a.label).localeCompare(String(b.num || b.label), "ru", { numeric: true })
    );
  }

  function renderTakeoffCard(t) {
    const rows = t.rows || [];
    const bodyRows = rows
      .map((r, i) => {
        return (
          "<tr>" +
          '<td class="fs-add-cell"></td>' +
          '<td class="fs-npp">' +
          esc(r.npp || i + 1) +
          "</td>" +
          "<td>" +
          esc(r.num || "—") +
          "</td>" +
          "<td>" +
          esc(r.callsign || "—") +
          "</td>" +
          '<td><input type="text" data-fs-row="' +
          i +
          '" data-fs-field="flightTime" placeholder="ч:мм" value="' +
          esc(r.flightTime || "") +
          '" autocomplete="off"></td>' +
          "</tr>"
        );
      })
      .join("");

    const addRow =
      '<tr class="fs-add-row">' +
      '<td class="fs-add-cell">' +
      '<button type="button" class="btn main fs-row-add" data-fs-add-cadets="' +
      esc(t.id) +
      '" title="Добавить курсантов">+</button>' +
      "</td>" +
      '<td colspan="4">' +
      '<button type="button" class="fs-add-row-action" data-fs-add-cadets="' +
      esc(t.id) +
      '">Добавить курсантов</button>' +
      "</td>" +
      "</tr>";

    return (
      '<article class="fs-takeoff-card" data-takeoff-id="' +
      esc(t.id) +
      '">' +
      '<div class="fs-takeoff-head">' +
      "<h3>Взлёт</h3>" +
      '<button type="button" class="btn danger fs-takeoff-remove" data-fs-remove="' +
      esc(t.id) +
      '" title="Удалить таблицу">×</button>' +
      "</div>" +
      '<div class="scrollx">' +
      '<table class="tests-table fs-takeoff-table">' +
      "<thead>" +
      '<tr class="fs-meta-row">' +
      '<th><span class="fs-meta-label">Дата</span><button type="button" class="fs-meta-val" data-fs-edit="date" title="Нажмите, чтобы изменить">' +
      esc(formatDateRu(t.date) || "дата") +
      "</button></th>" +
      '<th colspan="2">' +
      clickable("Поток", "stream", displayStreams(t), "не указан") +
      "</th>" +
      '<th colspan="2">' +
      clickable("Группа", "group", displayGroups(t), "не указана") +
      "</th>" +
      "</tr>" +
      '<tr class="fs-meta-row">' +
      '<th><span class="fs-meta-label">Номер вылета</span><strong class="fs-flight-no">' +
      esc(t.flightNo) +
      "</strong></th>" +
      '<th><span class="fs-meta-label">Время взлёта</span><button type="button" class="fs-meta-val" data-fs-edit="takeoffTime" title="Нажмите, чтобы изменить">' +
      esc(t.takeoffTime || "время") +
      "</button></th>" +
      "<th>" +
      clickable("Тип борта", "aircraftType", displayAircraftType(t), "не указан") +
      "</th>" +
      "<th>" +
      clickable(
        "Номер борта",
        "aircraftNo",
        displayAircraftNo(t),
        "не указан",
        t.aircraftNo
          ? esc(t.aircraftNo) +
              (t.aircraftStatus
                ? " " + statusBadgeHtml(t.aircraftStatus)
                : t.aircraftStatusLabel
                  ? " " + esc(t.aircraftStatusLabel)
                  : "")
          : ""
      ) +
      "</th>" +
      "<th>" +
      statusClickable(t) +
      "</th>" +
      "</tr>" +
      '<tr class="fs-col-head">' +
      "<th></th>" +
      "<th>№ п/п</th>" +
      "<th>Номер курсанта</th>" +
      "<th>Позывной</th>" +
      "<th>Время налёта</th>" +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      bodyRows +
      addRow +
      "</tbody>" +
      "</table>" +
      "</div>" +
      "</article>"
    );
  }

  function renderAll() {
    const list = $("flightTakeoffList");
    if (!list) return;
    closePanel();
    list.innerHTML = takeoffs.map(renderTakeoffCard).join("");
    updateMeta();
  }

  function findTakeoff(id) {
    return takeoffs.find((t) => t.id === id);
  }

  function addTakeoff() {
    seq += 1;
    takeoffs.push({
      id: "to-" + Date.now() + "-" + seq,
      flightNo: seq,
      date: todayIso(),
      takeoffTime: nowTime(),
      status: "",
      streams: [],
      groups: [],
      aircraftId: "",
      aircraftType: "",
      aircraftNo: "",
      aircraftStatus: "",
      aircraftStatusLabel: "",
      rows: []
    });
    renderAll();
  }

  function startTextEdit(btn, t, key) {
    if (key === "status") return;
    if (btn.parentNode.querySelector("input.fs-meta-edit")) return;
    const input = document.createElement("input");
    input.className = "fs-meta-edit";
    if (key === "date") {
      input.type = "date";
      input.value = t.date || todayIso();
    } else if (key === "takeoffTime") {
      input.type = "time";
      input.value = t.takeoffTime || nowTime();
    } else {
      input.type = "text";
      input.value = t[key] || "";
    }
    btn.replaceWith(input);
    input.focus();
    if (input.type === "text") input.select();
    const finish = () => {
      input.removeEventListener("blur", finish);
      let val = String(input.value || "").trim();
      if (key === "takeoffTime") {
        const m = /^(\d{1,2}):(\d{2})$/.exec(val);
        if (m) val = pad2(Math.min(23, parseInt(m[1], 10))) + ":" + pad2(Math.min(59, parseInt(m[2], 10)));
      }
      t[key] = val;
      renderAll();
    };
    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        renderAll();
      }
    });
  }

  function openStreamPicker(anchor, t) {
    const selected = new Set(t.streams || []);
    const items = uniqStreams().map((s) => ({ value: s, label: "Поток " + s }));
    const panel = renderCheckPanel(items, selected, {
      multi: true,
      emptyText: "Нет потоков в «Мои группы» / распределении",
      onChange: (set) => {
        t.streams = [...set];
        // убрать группы вне потоков
        t.groups = (t.groups || []).filter((k) => {
          const p = parseGroupKey(k);
          return !t.streams.length || t.streams.includes(p.stream);
        });
        // обновить подпись без полного перерендера панели
        const btn = anchor.closest("th") && anchor.closest("th").querySelector('[data-fs-pick="stream"]');
        if (btn) {
          btn.textContent = displayStreams(t);
          btn.classList.toggle("is-empty", !(t.streams || []).length);
        }
        const gBtn = anchor.closest("tr") && anchor.closest(".fs-takeoff-card").querySelector('[data-fs-pick="group"]');
        if (gBtn) {
          gBtn.textContent = displayGroups(t);
          gBtn.classList.toggle("is-empty", !(t.groups || []).length);
        }
      }
    });
    placePanel(anchor, panel);
  }

  function openGroupPicker(anchor, t) {
    const selected = new Set(t.groups || []);
    const items = groupsForTakeoff(t).map((g) => ({
      value: groupKey(g.stream_num, g.group_num),
      label: "Поток " + g.stream_num + " · группа " + g.group_num
    }));
    const panel = renderCheckPanel(items, selected, {
      multi: true,
      emptyText: t.streams && t.streams.length ? "Нет групп для выбранных потоков" : "Нет групп в «Мои группы»",
      onChange: (set) => {
        t.groups = [...set];
        if (!t.streams.length) {
          t.streams = [...new Set(t.groups.map((k) => parseGroupKey(k).stream).filter(Boolean))];
        }
        const btn = anchor.closest("th") && anchor.closest("th").querySelector('[data-fs-pick="group"]');
        if (btn) {
          btn.textContent = displayGroups(t);
          btn.classList.toggle("is-empty", !(t.groups || []).length);
        }
        const sBtn = anchor.closest(".fs-takeoff-card").querySelector('[data-fs-pick="stream"]');
        if (sBtn) {
          sBtn.textContent = displayStreams(t);
          sBtn.classList.toggle("is-empty", !(t.streams || []).length);
        }
      }
    });
    placePanel(anchor, panel);
  }

  async function openAircraftPicker(anchor, t, field) {
    const groups = selectedMyGroups(t);
    const ids = groups.map((g) => g.id).filter(Boolean);
    if (!ids.length) {
      const panel = document.createElement("div");
      panel.className = "ms-dd-panel fs-dd-panel";
      panel.innerHTML = '<div class="hint" style="padding:8px">Сначала выберите группу</div>';
      placePanel(anchor, panel);
      return;
    }
    const assets = await ensureAssets(ids);
    let items = assetItems(assets);
    if (field === "aircraftType") {
      const types = [...new Set(items.map((it) => (it.asset && it.asset.board_type) || "").filter(Boolean))];
      const selected = new Set(t.aircraftType ? [t.aircraftType] : []);
      const panel = renderCheckPanel(
        types.map((tp) => ({ value: tp, label: tp })),
        selected,
        {
          multi: false,
          emptyText: "Нет типов борта (БГ / НЕ БГ) в имуществе палатки",
          onChange: (set) => {
            t.aircraftType = [...set][0] || "";
            // сбросить номер, если не подходит к типу
            const still = items.find(
              (it) =>
                it.asset &&
                it.asset.board_type === t.aircraftType &&
                String(it.asset.board_num || "") === String(t.aircraftNo || "")
            );
            if (!still) {
              t.aircraftId = "";
              t.aircraftNo = "";
              t.aircraftStatus = "";
              t.aircraftStatusLabel = "";
            }
            renderAll();
          }
        }
      );
      placePanel(anchor, panel);
      return;
    }
    // номер борта — с учётом выбранного типа, если есть
    if (t.aircraftType) {
      items = items.filter((it) => it.asset && it.asset.board_type === t.aircraftType);
    }
    const selected = new Set(t.aircraftId ? [t.aircraftId] : []);
    const panel = renderCheckPanel(items, selected, {
      multi: false,
      emptyText: "Нет бортов со статусом БГ / НЕ БГ",
      onChange: (set) => {
        const id = [...set][0] || "";
        const hit = items.find((it) => it.value === id);
        if (hit && hit.asset) {
          t.aircraftId = String(hit.asset.id || id);
          t.aircraftType = hit.asset.board_type || "";
          t.aircraftNo = hit.asset.board_num || "";
          t.aircraftStatus = hit.asset.status || "";
          t.aircraftStatusLabel = hit.asset.status_label || statusLabel(t.aircraftStatus);
        } else {
          t.aircraftId = "";
          t.aircraftNo = "";
          t.aircraftStatus = "";
          t.aircraftStatusLabel = "";
        }
        renderAll();
      }
    });
    placePanel(anchor, panel);
  }

  function openStatusPicker(anchor, t) {
    const selected = new Set(t.status ? [t.status] : []);
    const panel = renderCheckPanel(STATUS_OPTS, selected, {
      multi: false,
      emptyText: "Нет вариантов",
      onChange: (set) => {
        t.status = [...set][0] || "";
        renderAll();
      }
    });
    placePanel(anchor, panel);
  }

  function closeCadetModal() {
    const modal = $("fsCadetModal");
    if (modal) modal.classList.add("hidden");
    cadetModalTakeoffId = "";
    cadetModalSelected = new Set();
  }

  function syncCadetModalAddBtn() {
    const btn = $("btnFsCadetModalAdd");
    const msg = $("fsCadetModalMsg");
    if (btn) btn.disabled = !cadetModalSelected.size;
    if (msg) {
      msg.textContent = cadetModalSelected.size
        ? "Выбрано: " + cadetModalSelected.size
        : "";
    }
  }

  function openCadetModal(t) {
    closePanel();
    cadetModalTakeoffId = t.id;
    cadetModalSelected = new Set();
    const modal = $("fsCadetModal");
    const body = $("fsCadetModalBody");
    const hint = $("fsCadetModalHint");
    if (!modal || !body) return;

    const existing = new Set(
      (t.rows || []).map(
        (r) => String(r.num || "").trim() || "cs:" + String(r.callsign || "").toLowerCase()
      )
    );
    const items = cadetItems(t).filter((it) => !existing.has(it.value));
    if (hint) {
      hint.textContent = (t.groups || []).length
        ? "Отметьте курсантов из состава выбранной группы"
        : "Сначала выберите группу — список из личного состава";
    }
    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="hint">' +
        ((t.groups || []).length
          ? "Все курсанты группы уже в таблице или список пуст"
          : "Выберите группу") +
        "</td></tr>";
    } else {
      body.innerHTML = items
        .map((it, i) => {
          return (
            '<tr data-fs-cadet="' +
            esc(it.value) +
            '">' +
            '<td class="fs-check"><input type="checkbox" value="' +
            esc(it.value) +
            '"></td>' +
            "<td>" +
            esc(i + 1) +
            "</td>" +
            "<td>" +
            esc(it.num || "—") +
            "</td>" +
            "<td>" +
            esc(it.callsign || "—") +
            "</td>" +
            "<td>" +
            esc(it.fio || "—") +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
    syncCadetModalAddBtn();
    modal.classList.remove("hidden");
  }

  function applyCadetModal() {
    const t = findTakeoff(cadetModalTakeoffId);
    if (!t || !cadetModalSelected.size) {
      closeCadetModal();
      return;
    }
    const byVal = new Map(cadetItems(t).map((it) => [it.value, it]));
    const existing = new Set(
      (t.rows || []).map(
        (r) => String(r.num || "").trim() || "cs:" + String(r.callsign || "").toLowerCase()
      )
    );
    [...cadetModalSelected].forEach((val) => {
      if (existing.has(val)) return;
      const it = byVal.get(val);
      if (!it) return;
      t.rows.push({
        npp: t.rows.length + 1,
        num: it.num || "",
        callsign: it.callsign || "",
        flightTime: ""
      });
      existing.add(val);
    });
    t.rows.forEach((r, i) => {
      r.npp = i + 1;
    });
    closeCadetModal();
    renderAll();
  }

  async function loadCatalog() {
    if (typeof api !== "function") return;
    try {
      const data = await api("/api/admin/my-groups");
      myGroups = Array.isArray(data.groups) ? data.groups : [];
    } catch (e) {
      myGroups = [];
    }
  }

  function bind() {
    const btn = $("btnFlightAddTakeoff");
    if (btn && !btn._fsBound) {
      btn._fsBound = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        addTakeoff();
      });
    }

    const list = $("flightTakeoffList");
    if (list && !list._fsBound) {
      list._fsBound = true;
      list.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-fs-remove]");
        if (rm && list.contains(rm)) {
          closePanel();
          const id = rm.getAttribute("data-fs-remove");
          takeoffs = takeoffs.filter((x) => x.id !== id);
          takeoffs.forEach((x, i) => {
            x.flightNo = i + 1;
          });
          seq = takeoffs.length;
          renderAll();
          return;
        }

        const addCadets = e.target.closest("[data-fs-add-cadets]");
        if (addCadets && list.contains(addCadets)) {
          e.preventDefault();
          e.stopPropagation();
          const t = findTakeoff(addCadets.getAttribute("data-fs-add-cadets"));
          if (t) openCadetModal(t);
          return;
        }

        const pick = e.target.closest("[data-fs-pick]");
        if (pick && list.contains(pick)) {
          e.preventDefault();
          e.stopPropagation();
          const card = pick.closest(".fs-takeoff-card");
          const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
          if (!t) return;
          const kind = pick.getAttribute("data-fs-pick");
          if (kind === "stream") openStreamPicker(pick, t);
          else if (kind === "group") openGroupPicker(pick, t);
          else if (kind === "status") openStatusPicker(pick, t);
          else if (kind === "aircraftType" || kind === "aircraftNo") openAircraftPicker(pick, t, kind);
          return;
        }

        const edit = e.target.closest("[data-fs-edit]");
        if (edit && list.contains(edit)) {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          const card = edit.closest(".fs-takeoff-card");
          const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
          if (!t) return;
          startTextEdit(edit, t, edit.getAttribute("data-fs-edit"));
        }
      });

      list.addEventListener("input", (e) => {
        const inp = e.target.closest("input[data-fs-row][data-fs-field]");
        if (!inp || !list.contains(inp)) return;
        const card = inp.closest(".fs-takeoff-card");
        const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
        if (!t) return;
        const idx = Number(inp.getAttribute("data-fs-row"));
        const field = inp.getAttribute("data-fs-field");
        if (!t.rows[idx] || !field) return;
        t.rows[idx][field] = inp.value;
      });
    }

    if (!document._fsPanelCloseBound) {
      document._fsPanelCloseBound = true;
      document.addEventListener("click", () => closePanel());
    }

    const modal = $("fsCadetModal");
    if (modal && !modal._fsBound) {
      modal._fsBound = true;
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeCadetModal();
      });
      const closeBtn = $("btnFsCadetModalClose");
      if (closeBtn) closeBtn.onclick = () => closeCadetModal();
      const addBtn = $("btnFsCadetModalAdd");
      if (addBtn) addBtn.onclick = () => applyCadetModal();
      const body = $("fsCadetModalBody");
      if (body) {
        body.addEventListener("click", (e) => {
          const tr = e.target.closest("tr[data-fs-cadet]");
          if (!tr || !body.contains(tr)) return;
          const inp = tr.querySelector('input[type="checkbox"]');
          if (!inp) return;
          if (e.target !== inp) inp.checked = !inp.checked;
          const val = inp.value;
          if (inp.checked) cadetModalSelected.add(val);
          else cadetModalSelected.delete(val);
          syncCadetModalAddBtn();
        });
      }
    }
  }

  function bindAccordionReload() {
    const mod = document.querySelector('#app .mod[data-mod="flight-sheet"]');
    if (!mod || mod._fsReloadBound) return;
    mod._fsReloadBound = true;
    const head = mod.querySelector(":scope > .mod-head");
    if (!head) return;
    head.addEventListener("click", () => {
      setTimeout(() => {
        if (mod.classList.contains("collapsed")) return;
        loadCatalog();
      }, 0);
    });
  }

  async function boot() {
    bind();
    bindAccordionReload();
    await loadCatalog();
  }

  window.renderFlightTakeoffs = renderAll;
  window.reloadFlightSheetCatalog = loadCatalog;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot();
    });
  } else {
    boot();
  }
  setTimeout(() => {
    bind();
    bindAccordionReload();
  }, 300);
})();
