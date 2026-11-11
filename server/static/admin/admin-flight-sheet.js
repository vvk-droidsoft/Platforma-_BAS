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
  let boardModalTakeoffId = "";
  let boardModalField = "";
  /** @type {{ value: string, label: string, cols?: string[], asset?: any }[]} */
  let boardModalItems = [];
  let boardModalSelected = "";
  let canCreateTakeoffs =
    typeof currentUser !== "undefined" &&
    currentUser &&
    (currentUser.role === "instructor" || currentUser.role === "assistant");
  const saveTimers = {};
  const collapsedDays = {};
  let completeTakeoffId = "";
  let pendingCompleteAfterWriteoff = "";
  let summarySort = { key: "date", dir: -1 };
  let summaryFilter = { date: "", group: "", board: "", status: "" };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** Канон: налёт хранится только в минутах (целое число). */
  function parseFlightMinutes(raw) {
    if (raw == null || raw === "") return 0;
    if (typeof raw === "number") {
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    }
    const s = String(raw).trim().replace(",", ".");
    if (!s) return 0;
    // Legacy «ч:мм» / «ч.мм» — один раз переводим в минуты, дальше только минуты.
    const hm = /^(\d+)\s*[:\.]\s*(\d{1,2})$/.exec(s);
    if (hm) {
      const h = parseInt(hm[1], 10);
      const m = parseInt(hm[2], 10);
      if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) return 0;
      return h * 60 + m;
    }
    const n = parseInt(s.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeFlightMinutesInput(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    const mins = parseFlightMinutes(s);
    return mins > 0 ? String(mins) : "";
  }

  function rowFlightMinutes(row) {
    if (!row) return 0;
    if (row.flightMinutes != null && row.flightMinutes !== "") {
      return parseFlightMinutes(row.flightMinutes);
    }
    return parseFlightMinutes(row.flightTime);
  }

  /** Сумма минут → «2 ч 10 мин» без смешения часов и минут в одно число. */
  function formatMinutesHm(totalMin) {
    const total = Math.max(0, Math.floor(Number(totalMin) || 0));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours <= 0) return total + " мин";
    if (minutes === 0) return hours + " ч (" + total + " мин)";
    return hours + " ч " + minutes + " мин (" + total + " мин)";
  }

  /** Общий налёт курсанта: часы:минуты (например 2:10). */
  function formatMinutesClock(totalMin) {
    const total = Math.max(0, Math.floor(Number(totalMin) || 0));
    return Math.floor(total / 60) + ":" + pad2(total % 60);
  }

  function cadetKeyFromRow(row) {
    if (!row) return "";
    const num = String(row.num || "").trim();
    if (num) return num;
    const callsign = String(row.callsign || "").trim().toLowerCase();
    return callsign ? "cs:" + callsign : "";
  }

  function buildCadetMinutesMap() {
    const map = Object.create(null);
    takeoffs.forEach((t) => {
      (t.rows || []).forEach((row) => {
        const key = cadetKeyFromRow(row);
        if (!key) return;
        map[key] = (map[key] || 0) + rowFlightMinutes(row);
      });
    });
    return map;
  }

  function sumTakeoffMinutes(t) {
    return (t.rows || []).reduce((sum, row) => sum + rowFlightMinutes(row), 0);
  }

  function refreshAllCadetTotals() {
    const map = buildCadetMinutesMap();
    document.querySelectorAll("[data-fs-cadet-total]").forEach((el) => {
      const key = el.getAttribute("data-fs-cadet-total") || "";
      el.textContent = formatMinutesClock(map[key] || 0);
    });
    takeoffs.forEach((t) => {
      const el = document.querySelector('[data-fs-minutes-total="' + t.id + '"]');
      if (el) el.textContent = formatMinutesHm(sumTakeoffMinutes(t));
    });
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
    const addBtn = $("btnFlightAddTakeoff");
    if (addBtn) addBtn.hidden = !canCreateTakeoffs;
    if (hint) {
      if (!canCreateTakeoffs && takeoffs.length) {
        hint.textContent = "Просмотр: таблиц «Взлёт»: " + takeoffs.length;
      } else {
        hint.textContent = takeoffs.length
          ? "Таблиц «Взлёт»: " + takeoffs.length
          : "Нажмите «Добавить взлёт», чтобы создать таблицу";
      }
    }
  }

  function isCompleted(t) {
    return String((t && t.status) || "") === "completed";
  }

  function canEditTakeoff(t) {
    if (!t || isCompleted(t)) return false;
    if (t.canEdit === false) return false;
    if (t.canEdit === true) return true;
    return false;
  }

  function takeoffDistGroupId(t) {
    if (t && t.distributionGroupId) return String(t.distributionGroupId);
    const g = selectedMyGroups(t)[0];
    return (g && g.distribution_group_id) || "";
  }

  function activeTakeoffsForGroup(gid) {
    const id = String(gid || "");
    if (!id) return takeoffs.filter((t) => !isCompleted(t));
    return takeoffs.filter((t) => !isCompleted(t) && takeoffDistGroupId(t) === id);
  }

  function nextFlightNoForDate(date) {
    let max = 0;
    takeoffs.forEach((t) => {
      if (String(t.date || "") !== String(date || "")) return;
      const n = Number(t.flightNo);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  function cadetPayload(t) {
    return (t.rows || []).map((r, i) => ({
      id: r.id || "",
      npp: i + 1,
      num: r.num || "",
      callsign: r.callsign || "",
      fio: r.fio || "",
      flight_minutes: rowFlightMinutes(r)
    }));
  }

  function toServerPayload(t) {
    const g = selectedMyGroups(t)[0];
    return {
      my_group_id: (g && g.id) || t.myGroupId || t.aircraftMyGroupId || "",
      distribution_group_id: takeoffDistGroupId(t),
      stream_num: primaryStream(t),
      group_num: primaryGroup(t),
      flight_date: t.date || todayIso(),
      flight_no: Number(t.flightNo) || 1,
      takeoff_time: t.takeoffTime || "",
      board_asset_id: t.aircraftId || "",
      board_type: t.aircraftType || "",
      board_number: t.aircraftNo || "",
      cadets: cadetPayload(t)
    };
  }

  function fromServer(d, prev) {
    const stream = String((d && d.stream_num) || "").trim();
    const group = String((d && d.group_num) || "").trim();
    const prevMap = {};
    ((prev && prev.rows) || []).forEach((r) => {
      const key = cadetKeyFromRow(r);
      if (key) prevMap[key] = r;
    });
    return {
      id: d.id,
      flightNo: d.flight_no,
      date: d.flight_date || "",
      takeoffTime: d.takeoff_time || "",
      streams: stream ? [stream] : [],
      groups: stream && group ? [groupKey(stream, group)] : [],
      distributionGroupId: d.distribution_group_id || "",
      myGroupId: d.my_group_id || "",
      aircraftId: d.board_asset_id || "",
      aircraftMyGroupId: d.my_group_id || "",
      aircraftType: d.board_type || "",
      aircraftNo: d.board_number || "",
      aircraftStatus: d.board_status || "",
      aircraftStatusLabel: d.board_status_label || statusLabel(d.board_status),
      status: d.status || "active",
      statusAfter: d.status_after || "",
      canEdit: !!d.can_edit,
      collapsed: prev ? !!prev.collapsed : false,
      rows: (d.cadets || []).map((c, i) => {
        const row = {
          id: c.id || "",
          npp: c.npp || i + 1,
          num: c.num || "",
          callsign: c.callsign || "",
          fio: c.fio || "",
          flightMinutes: c.flight_minutes ? String(c.flight_minutes) : ""
        };
        const old = prevMap[cadetKeyFromRow(row)];
        if (old && old.flightMinutes && !row.flightMinutes) row.flightMinutes = old.flightMinutes;
        return row;
      })
    };
  }

  function mergeServerTakeoff(row) {
    if (!row || !row.id) return;
    const i = takeoffs.findIndex((t) => t.id === row.id);
    const mapped = fromServer(row, i >= 0 ? takeoffs[i] : null);
    if (i >= 0) takeoffs[i] = mapped;
    else takeoffs.push(mapped);
  }

  function showFsError(err) {
    const msg = (err && err.message) || String(err || "Ошибка");
    alert(msg);
  }

  function scheduleSave(t) {
    if (!canEditTakeoff(t) || !t || !t.id) return;
    if (String(t.id).indexOf("to-") === 0) return;
    clearTimeout(saveTimers[t.id]);
    saveTimers[t.id] = setTimeout(() => {
      persistTakeoff(t);
    }, 600);
  }

  async function persistTakeoff(t) {
    if (!canEditTakeoff(t) || typeof api !== "function") return;
    try {
      const data = await api("/api/admin/flight-takeoffs/" + encodeURIComponent(t.id), {
        method: "PATCH",
        json: toServerPayload(t)
      });
      if (data && data.takeoff) mergeServerTakeoff(data.takeoff);
    } catch (err) {
      showFsError(err);
    }
  }

  function openLimitModal(active) {
    const modal = $("fsLimitModal");
    const list = $("fsLimitModalList");
    if (list) {
      const items = active && active.length ? active : [];
      list.innerHTML = items.length
        ? items
            .map((t) => {
              return (
                "<li>Взлёт № " +
                esc(t.flightNo) +
                (t.date ? " · " + esc(formatDateRu(t.date)) : "") +
                (t.aircraftNo ? " · борт " + esc(t.aircraftNo) : "") +
                "</li>"
              );
            })
            .join("")
        : "<li>Два взлёта уже открыты</li>";
    }
    if (modal) modal.classList.remove("hidden");
  }

  function closeLimitModal() {
    const modal = $("fsLimitModal");
    if (modal) modal.classList.add("hidden");
  }

  function selectedCompleteStatus() {
    const box = $("fsCompleteStatusBox");
    if (!box) return "";
    const inp = box.querySelector('input[name="fsCompleteStatus"]:checked');
    return inp ? String(inp.value || "") : "";
  }

  function syncCompleteModalOk() {
    const btn = $("btnFsCompleteModalOk");
    const msg = $("fsCompleteModalMsg");
    const st = selectedCompleteStatus();
    if (btn) btn.disabled = !st;
    if (msg) {
      msg.textContent = st
        ? "Статус борта после полёта: " + (statusLabel(st) || st)
        : "Нельзя завершить полёт, не указав статус борта";
    }
  }

  function closeCompleteModal() {
    const modal = $("fsCompleteModal");
    if (modal) modal.classList.add("hidden");
    completeTakeoffId = "";
    const box = $("fsCompleteStatusBox");
    if (box) {
      box.querySelectorAll("input[type=radio]").forEach((inp) => {
        inp.checked = false;
      });
    }
    syncCompleteModalOk();
  }

  function openCompleteModal(t) {
    if (!canEditTakeoff(t)) return;
    if (!t.aircraftId) {
      alert("Сначала выберите борт");
      return;
    }
    completeTakeoffId = t.id;
    const hint = $("fsCompleteModalHint");
    if (hint) {
      hint.textContent =
        "Взлёт № " +
        t.flightNo +
        (t.aircraftNo ? " · борт " + t.aircraftNo : "") +
        ". Укажите статус борта после полёта.";
    }
    syncCompleteModalOk();
    const modal = $("fsCompleteModal");
    if (modal) modal.classList.remove("hidden");
  }

  async function confirmCompleteFlight() {
    const t = findTakeoff(completeTakeoffId);
    const statusAfter = selectedCompleteStatus();
    if (!t || !statusAfter) {
      syncCompleteModalOk();
      return;
    }
    if (statusAfter === "written_off") {
      const cur = liveAircraftStatus(t);
      if (cur !== "written_off") {
        pendingCompleteAfterWriteoff = t.id;
        closeCompleteModal();
        await changeAircraftStatus(t, "written_off");
        return;
      }
    }
    try {
      const data = await api(
        "/api/admin/flight-takeoffs/" + encodeURIComponent(t.id) + "/complete",
        { method: "POST", json: { status_after: statusAfter } }
      );
      if (data && data.takeoff) mergeServerTakeoff(data.takeoff);
      closeCompleteModal();
      renderAll();
    } catch (err) {
      showFsError(err);
    }
  }

  function uniqueFilterValues(keyFn) {
    const set = new Set();
    takeoffs.forEach((t) => {
      const v = String(keyFn(t) || "").trim();
      if (v) set.add(v);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
  }

  function renderSummary() {
    const wrap = $("fsSummaryWrap");
    const body = $("fsSummaryBody");
    const filters = $("fsSummaryFilters");
    if (!wrap || !body) return;
    wrap.hidden = !takeoffs.length;
    if (!takeoffs.length) return;

    if (filters && !filters._fsBuilt) {
      filters._fsBuilt = true;
      filters.innerHTML =
        '<label>Дата <input type="date" id="fsSumDate"></label>' +
        '<label>Группа <select id="fsSumGroup"><option value="">все</option></select></label>' +
        '<label>Борт <select id="fsSumBoard"><option value="">все</option></select></label>' +
        '<label>Статус <select id="fsSumStatus">' +
        '<option value="">все</option>' +
        '<option value="active">активный</option>' +
        '<option value="completed">завершён</option>' +
        "</select></label>";
      filters.addEventListener("change", (e) => {
        const el = e.target;
        if (el.id === "fsSumDate") summaryFilter.date = el.value || "";
        if (el.id === "fsSumGroup") summaryFilter.group = el.value || "";
        if (el.id === "fsSumBoard") summaryFilter.board = el.value || "";
        if (el.id === "fsSumStatus") summaryFilter.status = el.value || "";
        renderSummary();
      });
    }
    const groupSel = $("fsSumGroup");
    const boardSel = $("fsSumBoard");
    if (groupSel) {
      const cur = summaryFilter.group;
      const groups = uniqueFilterValues((t) => primaryGroup(t));
      groupSel.innerHTML =
        '<option value="">все</option>' +
        groups.map((g) => '<option value="' + esc(g) + '">' + esc(g) + "</option>").join("");
      groupSel.value = cur;
    }
    if (boardSel) {
      const cur = summaryFilter.board;
      const boards = uniqueFilterValues((t) => t.aircraftNo);
      boardSel.innerHTML =
        '<option value="">все</option>' +
        boards.map((g) => '<option value="' + esc(g) + '">' + esc(g) + "</option>").join("");
      boardSel.value = cur;
    }
    const dateInp = $("fsSumDate");
    if (dateInp) dateInp.value = summaryFilter.date || "";
    const stSel = $("fsSumStatus");
    if (stSel) stSel.value = summaryFilter.status || "";

    let rows = takeoffs.slice();
    if (summaryFilter.date) rows = rows.filter((t) => t.date === summaryFilter.date);
    if (summaryFilter.group) rows = rows.filter((t) => primaryGroup(t) === summaryFilter.group);
    if (summaryFilter.board) rows = rows.filter((t) => String(t.aircraftNo || "") === summaryFilter.board);
    if (summaryFilter.status) {
      rows = rows.filter((t) => (isCompleted(t) ? "completed" : "active") === summaryFilter.status);
    }
    const key = summarySort.key;
    const dir = summarySort.dir;
    rows.sort((a, b) => {
      const va =
        key === "minutes"
          ? sumTakeoffMinutes(a)
          : key === "cadets"
            ? (a.rows || []).length
            : key === "status"
              ? isCompleted(a)
                ? 1
                : 0
              : key === "flightNo"
                ? Number(a.flightNo) || 0
                : String(
                    {
                      date: a.date,
                      stream: primaryStream(a),
                      group: primaryGroup(a),
                      boardType: a.aircraftType,
                      boardNo: a.aircraftNo,
                      statusAfter: a.statusAfter || a.aircraftStatus
                    }[key] || ""
                  );
      const vb =
        key === "minutes"
          ? sumTakeoffMinutes(b)
          : key === "cadets"
            ? (b.rows || []).length
            : key === "status"
              ? isCompleted(b)
                ? 1
                : 0
              : key === "flightNo"
                ? Number(b.flightNo) || 0
                : String(
                    {
                      date: b.date,
                      stream: primaryStream(b),
                      group: primaryGroup(b),
                      boardType: b.aircraftType,
                      boardNo: b.aircraftNo,
                      statusAfter: b.statusAfter || b.aircraftStatus
                    }[key] || ""
                  );
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    document.querySelectorAll("#fsSummaryTable th[data-fs-sum-sort]").forEach((th) => {
      th.classList.toggle("is-sort", th.getAttribute("data-fs-sum-sort") === key);
    });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10" class="hint">Нет строк по фильтру</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((t) => {
        const st = isCompleted(t) ? "завершён" : "активный";
        const after = statusLabel(t.statusAfter || (!isCompleted(t) ? t.aircraftStatus : "")) || "—";
        return (
          "<tr>" +
          "<td>" +
          esc(formatDateRu(t.date) || "—") +
          "</td>" +
          "<td>" +
          esc(t.flightNo) +
          "</td>" +
          "<td>" +
          esc(primaryStream(t) || "—") +
          "</td>" +
          "<td>" +
          esc(primaryGroup(t) || "—") +
          "</td>" +
          "<td>" +
          esc(t.aircraftType || "—") +
          "</td>" +
          "<td>" +
          esc(t.aircraftNo || "—") +
          "</td>" +
          "<td>" +
          esc(st) +
          "</td>" +
          "<td>" +
          esc(after) +
          "</td>" +
          "<td>" +
          esc(sumTakeoffMinutes(t)) +
          "</td>" +
          "<td>" +
          esc((t.rows || []).length) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
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

  function primaryStream(t) {
    return String((t.streams && t.streams[0]) || "").trim();
  }

  function primaryGroup(t) {
    const key = (t.groups && t.groups[0]) || "";
    return parseGroupKey(key).group || "";
  }

  function defaultStreamGroup() {
    const streams = uniqStreams();
    const stream = streams[0] || "";
    if (!stream) return { streams: [], groups: [] };
    const groups = myGroups
      .filter((g) => String(g.stream_num || "").trim() === stream)
      .slice()
      .sort((a, b) =>
        String(a.group_num || "").localeCompare(String(b.group_num || ""), "ru", { numeric: true })
      );
    const g = groups[0];
    return {
      streams: [stream],
      groups: g ? [groupKey(g.stream_num, g.group_num)] : []
    };
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

  function prefixedNumBtn(kind, prefix, num, emptyNum) {
    const has = !!String(num || "").trim();
    return (
      '<button type="button" class="fs-meta-val" data-fs-pick="' +
      esc(kind) +
      '" title="Нажмите, чтобы выбрать">' +
      esc(prefix) +
      ' <span class="fs-meta-num' +
      (has ? "" : " is-empty") +
      '">' +
      esc(has ? num : emptyNum || "—") +
      "</span></button>"
    );
  }

  function flightNoBtnHtml(t) {
    return (
      '<button type="button" class="fs-meta-val" data-fs-edit="flightNo" title="Нажмите, чтобы изменить номер вылета">' +
      "Вылет № <span class=\"fs-meta-num\">" +
      esc(t.flightNo) +
      "</span></button>"
    );
  }

  function dateBtnHtml(t) {
    return (
      '<button type="button" class="fs-meta-val" data-fs-edit="date" title="Нажмите, чтобы изменить">' +
      esc(formatDateRu(t.date) || "дата") +
      "</button>"
    );
  }

  function timeBtnHtml(t) {
    return (
      '<button type="button" class="fs-meta-val" data-fs-edit="takeoffTime" title="Нажмите, чтобы изменить">' +
      esc(t.takeoffTime || nowTime()) +
      "</button>"
    );
  }

  function aircraftTypeBtnHtml(t) {
    if (t.aircraftType) {
      return (
        '<button type="button" class="fs-meta-val" data-fs-pick="aircraftType" title="Нажмите, чтобы выбрать">' +
        esc(t.aircraftType) +
        "</button>"
      );
    }
    return (
      '<button type="button" class="fs-meta-val is-need" data-fs-pick="aircraftType" title="Выберите тип борта">' +
      "Выбрать борт</button>"
    );
  }

  function aircraftNoBtnHtml(t) {
    if (t.aircraftNo) {
      return (
        '<button type="button" class="fs-meta-val" data-fs-pick="aircraftNo" title="Нажмите, чтобы выбрать">' +
        esc(t.aircraftNo) +
        "</button>"
      );
    }
    return (
      '<button type="button" class="fs-meta-val is-need" data-fs-pick="aircraftNo" title="Выберите номер борта">' +
      "Выбрать номер борта</button>"
    );
  }

  function liveAircraftStatus(t) {
    return String(t.aircraftStatus || "").trim();
  }

  function statusClickable(t) {
    if (!t.aircraftId) {
      return (
        '<button type="button" class="fs-meta-val is-empty" data-fs-pick="status" title="Сначала выберите номер борта">' +
        esc("не указан") +
        "</button>"
      );
    }
    const code = liveAircraftStatus(t);
    if (!code) {
      return (
        '<button type="button" class="fs-meta-val is-empty" data-fs-pick="status" title="Нажмите, чтобы выбрать">' +
        esc("не указан") +
        "</button>"
      );
    }
    return (
      '<button type="button" class="fs-meta-val" data-fs-pick="status" title="Нажмите, чтобы выбрать">' +
      statusBadgeHtml(code) +
      "</button>"
    );
  }

  function sortTakeoffs() {
    takeoffs.sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      const na = Number(a.flightNo);
      const nb = Number(b.flightNo);
      const aOk = Number.isFinite(na);
      const bOk = Number.isFinite(nb);
      if (aOk && bOk && na !== nb) return na - nb;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function reassignFlightNo(t, rawNew) {
    const day = String(t.date || "");
    const peers = takeoffs.filter((x) => String(x.date || "") === day);
    const max = peers.length;
    let newNo = parseInt(String(rawNew || "").trim(), 10);
    if (!Number.isFinite(newNo)) return false;
    if (newNo < 1) newNo = 1;
    if (newNo > max) newNo = max;
    const oldNo = Number(t.flightNo);
    if (!Number.isFinite(oldNo) || oldNo === newNo) {
      t.flightNo = newNo;
      sortTakeoffs();
      return true;
    }
    peers.forEach((x) => {
      if (x === t) return;
      const n = Number(x.flightNo);
      if (!Number.isFinite(n)) return;
      if (newNo < oldNo && n >= newNo && n < oldNo) x.flightNo = n + 1;
      if (newNo > oldNo && n > oldNo && n <= newNo) x.flightNo = n - 1;
    });
    t.flightNo = newNo;
    sortTakeoffs();
    return true;
  }

  function renumberAfterDelete(date) {
    const day = String(date || "");
    const peers = takeoffs
      .filter((x) => String(x.date || "") === day)
      .sort((a, b) => (Number(a.flightNo) || 0) - (Number(b.flightNo) || 0));
    peers.forEach((x, i) => {
      x.flightNo = i + 1;
    });
    seq = takeoffs.length;
  }

  function invalidateAssetCache(myGroupId) {
    if (myGroupId) delete assetsByGroup[myGroupId];
    else Object.keys(assetsByGroup).forEach((k) => delete assetsByGroup[k]);
  }

  function applyAssetUpdate(asset) {
    if (!asset || !asset.id) return;
    const id = String(asset.id);
    Object.keys(assetsByGroup).forEach((gid) => {
      const list = assetsByGroup[gid];
      if (!Array.isArray(list)) return;
      const i = list.findIndex((a) => String(a.id) === id);
      if (i >= 0) assetsByGroup[gid][i] = Object.assign({}, list[i], asset);
    });
    takeoffs.forEach((t) => {
      if (String(t.aircraftId || "") !== id) return;
      t.aircraftType = asset.board_type || t.aircraftType || "";
      t.aircraftNo = asset.board_num || t.aircraftNo || "";
      t.aircraftStatus = asset.status || "";
      t.aircraftStatusLabel = asset.status_label || statusLabel(t.aircraftStatus);
    });
    renderAll();
  }

  function rememberAircraftGroup(t, assetId, candidateGroupIds) {
    const id = String(assetId || "");
    for (let i = 0; i < candidateGroupIds.length; i++) {
      const gid = candidateGroupIds[i];
      const list = assetsByGroup[gid] || [];
      if (list.some((a) => String(a.id) === id)) {
        t.aircraftMyGroupId = gid;
        return gid;
      }
    }
    return t.aircraftMyGroupId || "";
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

  function renderTakeoffCard(t, cadetMinutesMap) {
    const totals = cadetMinutesMap || buildCadetMinutesMap();
    const rows = t.rows || [];
    const bodyRows = rows
      .map((r, i) => {
        const mins = rowFlightMinutes(r);
        const shown = mins > 0 ? String(mins) : "";
        const ckey = cadetKeyFromRow(r);
        const totalAll = ckey ? totals[ckey] || 0 : 0;
        return (
          "<tr>" +
          '<td class="fs-npp">' +
          esc(r.npp || i + 1) +
          "</td>" +
          "<td>" +
          esc(r.num || "—") +
          "</td>" +
          "<td>" +
          esc(r.callsign || "—") +
          "</td>" +
          '<td class="fs-total-cell" data-fs-cadet-total="' +
          esc(ckey) +
          '" title="Суммарный налёт курсанта по всем взлётам">' +
          esc(formatMinutesClock(totalAll)) +
          "</td>" +
          '<td class="fs-min-cell"><input type="number" min="0" step="1" inputmode="numeric" data-fs-row="' +
          i +
          '" data-fs-field="flightMinutes" placeholder="мин" title="Время налёта в минутах" value="' +
          esc(shown) +
          '" autocomplete="off"' +
          (canEditTakeoff(t) ? "" : " disabled") +
          "></td>" +
          "</tr>"
        );
      })
      .join("");

    const totalMin = sumTakeoffMinutes(t);
    const totalRow =
      '<tr class="fs-total-row">' +
      '<td colspan="4">Суммарный налёт</td>' +
      '<td class="fs-min-total" data-fs-minutes-total="' +
      esc(t.id) +
      '">' +
      esc(formatMinutesHm(totalMin)) +
      "</td>" +
      "</tr>";

    const editable = canEditTakeoff(t);
    const addCadetBtn = editable
      ? '<button type="button" class="btn btn-style-1 fs-add-cadets" data-fs-add-cadets="' +
        esc(t.id) +
        '">Добавить курсанта</button>'
      : "";
    const completeBtn = editable
      ? '<button type="button" class="btn btn-style-2 fs-complete-flight" data-fs-complete="' +
        esc(t.id) +
        '">Завершить полёт и обновить статус борта</button>'
      : "";

    const collapsed = !!t.collapsed;
    const metaBits = [];
    if (t.date) metaBits.push(formatDateRu(t.date));
    if (t.takeoffTime) metaBits.push(t.takeoffTime);
    if (t.aircraftNo) metaBits.push("№ " + t.aircraftNo);
    const headMeta = metaBits.length ? " · " + metaBits.join(" · ") : "";

    const doneBadge = isCompleted(t)
      ? '<span class="fs-takeoff-badge">завершён</span>'
      : "";
    const removeBtn = editable
      ? '<button type="button" class="btn danger fs-takeoff-remove" data-fs-remove="' +
        esc(t.id) +
        '" title="Удалить таблицу">×</button>'
      : "";
    return (
      '<section class="mod fs-takeoff-card' +
      (collapsed ? " collapsed" : "") +
      (isCompleted(t) ? " is-completed" : "") +
      (editable ? "" : " is-readonly") +
      '" data-takeoff-id="' +
      esc(t.id) +
      '">' +
      '<div class="fs-takeoff-bar">' +
      '<button type="button" class="mod-head" data-fs-toggle="' +
      esc(t.id) +
      '" aria-expanded="' +
      (collapsed ? "false" : "true") +
      '">' +
      "<span>" +
      '<span class="mod-title">Взлёт · № ' +
      esc(t.flightNo) +
      "</span>" +
      doneBadge +
      '<span class="mod-meta">' +
      esc(headMeta) +
      "</span>" +
      "</span>" +
      '<span class="mod-chevron" aria-hidden="true">▼</span>' +
      "</button>" +
      removeBtn +
      "</div>" +
      '<div class="mod-body">' +
      '<div class="scrollx fs-takeoff-scroll">' +
      '<table class="tests-table fs-takeoff-meta">' +
      "<tbody>" +
      '<tr class="fs-meta-row">' +
      "<th>" +
      dateBtnHtml(t) +
      "</th>" +
      "<th>" +
      prefixedNumBtn("stream", "Поток №", primaryStream(t), "—") +
      "</th>" +
      "<th>" +
      prefixedNumBtn("group", "Группа №", primaryGroup(t), "—") +
      "</th>" +
      "</tr>" +
      '<tr class="fs-meta-row">' +
      "<th>" +
      flightNoBtnHtml(t) +
      "</th>" +
      "<th>" +
      timeBtnHtml(t) +
      "</th>" +
      "<th>" +
      aircraftTypeBtnHtml(t) +
      "</th>" +
      "<th>" +
      aircraftNoBtnHtml(t) +
      "</th>" +
      "<th>" +
      statusClickable(t) +
      "</th>" +
      "</tr>" +
      "</tbody>" +
      "</table>" +
      '<div class="fs-takeoff-main">' +
      '<div class="fs-takeoff-data-wrap">' +
      '<table class="tests-table fs-takeoff-table">' +
      "<thead>" +
      '<tr class="fs-col-head">' +
      "<th>№ п/п</th>" +
      "<th>Номер курсанта</th>" +
      "<th>Позывной</th>" +
      "<th>Общий налёт</th>" +
      "<th>Время налёта, мин</th>" +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      bodyRows +
      "</tbody>" +
      "<tfoot>" +
      totalRow +
      "</tfoot>" +
      "</table>" +
      "</div>" +
      '<div class="fs-takeoff-art" aria-hidden="true">' +
      '<img src="/static/admin/fs-takeoff-art.png" alt="" width="800" height="343" decoding="async">' +
      "</div>" +
      "</div>" +
      addCadetBtn +
      completeBtn +
      "</div>" +
      "</div>" +
      "</section>"
    );
  }

  function renderAll() {
    const list = $("flightTakeoffList");
    if (!list) return;
    closePanel();
    sortTakeoffs();
    const cadetMinutesMap = buildCadetMinutesMap();
    const byDate = [];
    const map = Object.create(null);
    takeoffs.forEach((t) => {
      const day = t.date || "без-даты";
      if (!map[day]) {
        map[day] = [];
        byDate.push(day);
      }
      map[day].push(t);
    });
    byDate.sort((a, b) => String(b).localeCompare(String(a)));
    const today = todayIso();
    list.innerHTML = byDate
      .map((day) => {
        if (collapsedDays[day] == null) collapsedDays[day] = day !== today;
        const collapsed = !!collapsedDays[day];
        const items = map[day] || [];
        items.sort((a, b) => (Number(a.flightNo) || 0) - (Number(b.flightNo) || 0));
        const title = day === "без-даты" ? "Без даты" : formatDateRu(day) || day;
        return (
          '<section class="mod fs-day-card' +
          (collapsed ? " collapsed" : "") +
          '" data-fs-day="' +
          esc(day) +
          '">' +
          '<button type="button" class="mod-head" data-fs-day-toggle="' +
          esc(day) +
          '" aria-expanded="' +
          (collapsed ? "false" : "true") +
          '">' +
          "<span>" +
          '<span class="mod-title">' +
          esc(title) +
          "</span>" +
          '<span class="mod-meta"> · взлётов: ' +
          items.length +
          "</span>" +
          "</span>" +
          '<span class="mod-chevron" aria-hidden="true">▼</span>' +
          "</button>" +
          '<div class="mod-body"><div class="fs-takeoff-list">' +
          items.map((t) => renderTakeoffCard(t, cadetMinutesMap)).join("") +
          "</div></div></section>"
        );
      })
      .join("");
    updateMeta();
    renderSummary();
  }

  function findTakeoff(id) {
    return takeoffs.find((t) => t.id === id);
  }

  async function addTakeoff() {
    if (!canCreateTakeoffs) {
      alert("Добавлять взлёты могут только инструктор и ассистент палатки");
      return;
    }
    const defs = defaultStreamGroup();
    const draft = {
      id: "",
      flightNo: nextFlightNoForDate(todayIso()),
      date: todayIso(),
      takeoffTime: nowTime(),
      streams: defs.streams.slice(),
      groups: defs.groups.slice(),
      aircraftId: "",
      aircraftMyGroupId: "",
      aircraftType: "",
      aircraftNo: "",
      aircraftStatus: "",
      aircraftStatusLabel: "",
      status: "active",
      canEdit: true,
      collapsed: false,
      rows: []
    };
    const gid = takeoffDistGroupId(draft);
    if (!gid) {
      alert("Сначала нужна группа в «Мои группы»");
      return;
    }
    const active = activeTakeoffsForGroup(gid);
    if (active.length >= 2) {
      openLimitModal(active);
      return;
    }
    if (typeof api !== "function") {
      alert("API недоступен");
      return;
    }
    try {
      const data = await api("/api/admin/flight-takeoffs", {
        method: "POST",
        json: toServerPayload(draft)
      });
      if (data && data.takeoff) {
        const mapped = fromServer(data.takeoff, { collapsed: false });
        takeoffs.push(mapped);
        seq = takeoffs.length;
        collapsedDays[mapped.date || todayIso()] = false;
        renderAll();
      }
    } catch (err) {
      if (String((err && err.message) || "").indexOf("два незавершённых") >= 0) {
        openLimitModal(activeTakeoffsForGroup(gid));
        return;
      }
      showFsError(err);
    }
  }

  function startTextEdit(btn, t, key) {
    if (!canEditTakeoff(t)) return;
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
    } else if (key === "flightNo") {
      const dayPeers = takeoffs.filter((x) => String(x.date || "") === String(t.date || "")).length;
      input.type = "number";
      input.min = "1";
      input.max = String(dayPeers || 1);
      input.step = "1";
      input.value = String(t.flightNo || "");
    } else {
      input.type = "text";
      input.value = t[key] || "";
    }
    btn.replaceWith(input);
    input.focus();
    if (input.type === "text" || input.type === "number") input.select();
    const finish = () => {
      input.removeEventListener("blur", finish);
      let val = String(input.value || "").trim();
      if (key === "takeoffTime") {
        const m = /^(\d{1,2}):(\d{2})$/.exec(val);
        if (m) val = pad2(Math.min(23, parseInt(m[1], 10))) + ":" + pad2(Math.min(59, parseInt(m[2], 10)));
        t[key] = val;
      } else if (key === "flightNo") {
        reassignFlightNo(t, val);
      } else {
        t[key] = val;
      }
      scheduleSave(t);
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
    const cur = primaryStream(t);
    const selected = new Set(cur ? [cur] : []);
    const items = uniqStreams().map((s) => ({ value: s, label: "Поток № " + s }));
    const panel = renderCheckPanel(items, selected, {
      multi: false,
      emptyText: "Нет потоков в «Мои группы» / распределении",
      onChange: (set) => {
        const stream = [...set][0] || "";
        t.streams = stream ? [stream] : [];
        t.groups = (t.groups || []).filter((k) => parseGroupKey(k).stream === stream);
        if (!t.groups.length && stream) {
          const first = groupsForTakeoff(t)[0];
          if (first) t.groups = [groupKey(first.stream_num, first.group_num)];
        }
        closePanel();
        scheduleSave(t);
        renderAll();
      }
    });
    placePanel(anchor, panel);
  }

  function openGroupPicker(anchor, t) {
    const cur = (t.groups && t.groups[0]) || "";
    const selected = new Set(cur ? [cur] : []);
    const items = groupsForTakeoff(t).map((g) => ({
      value: groupKey(g.stream_num, g.group_num),
      label: "Группа № " + g.group_num + " · поток " + g.stream_num
    }));
    const panel = renderCheckPanel(items, selected, {
      multi: false,
      emptyText: t.streams && t.streams.length ? "Нет групп для выбранного потока" : "Нет групп в «Мои группы»",
      onChange: (set) => {
        const key = [...set][0] || "";
        t.groups = key ? [key] : [];
        if (key) {
          const p = parseGroupKey(key);
          if (p.stream) t.streams = [p.stream];
        }
        closePanel();
        scheduleSave(t);
        renderAll();
      }
    });
    placePanel(anchor, panel);
  }

  function closeBoardModal() {
    const modal = $("fsBoardModal");
    if (modal) modal.classList.add("hidden");
    boardModalTakeoffId = "";
    boardModalField = "";
    boardModalItems = [];
    boardModalSelected = "";
  }

  function syncBoardModalApplyBtn() {
    const btn = $("btnFsBoardModalApply");
    const msg = $("fsBoardModalMsg");
    if (btn) btn.disabled = !boardModalSelected;
    if (msg) {
      const hit = boardModalItems.find((it) => it.value === boardModalSelected);
      msg.textContent = hit ? "Выбрано: " + hit.label : "";
    }
  }

  function renderBoardModalRows(colsCount) {
    const body = $("fsBoardModalBody");
    if (!body) return;
    const span = Math.max(2, colsCount + 1);
    if (!boardModalItems.length) {
      body.innerHTML =
        '<tr><td colspan="' +
        span +
        '" class="hint">Нет данных</td></tr>';
      return;
    }
    body.innerHTML = boardModalItems
      .map((it) => {
        const checked = boardModalSelected === it.value ? " checked" : "";
        const extra = (it.cols || []).map((c) => "<td>" + esc(c) + "</td>").join("");
        return (
          '<tr data-fs-board="' +
          esc(it.value) +
          '">' +
          '<td class="fs-check"><input type="radio" name="fsBoardPick" value="' +
          esc(it.value) +
          '"' +
          checked +
          "></td>" +
          (extra || "<td>" + esc(it.label) + "</td>") +
          "</tr>"
        );
      })
      .join("");
  }

  async function openAircraftPicker(t, field) {
    closePanel();
    closeCadetModal();
    const groups = selectedMyGroups(t);
    const ids = groups.map((g) => g.id).filter(Boolean);
    const modal = $("fsBoardModal");
    const title = $("fsBoardModalTitle");
    const hint = $("fsBoardModalHint");
    const head = $("fsBoardModalHead");
    if (!modal || !head) return;

    boardModalTakeoffId = t.id;
    boardModalField = field;
    boardModalItems = [];
    boardModalSelected = "";

    if (!ids.length) {
      if (title) title.textContent = field === "aircraftType" ? "Тип борта" : "Номер борта";
      if (hint) hint.textContent = "Сначала выберите группу";
      head.innerHTML = '<th class="fs-check"></th><th>Значение</th>';
      boardModalItems = [];
      renderBoardModalRows(1);
      syncBoardModalApplyBtn();
      modal.classList.remove("hidden");
      return;
    }

    const assets = await ensureAssets(ids);
    let items = assetItems(assets);

    if (field === "aircraftType") {
      const types = [...new Set(items.map((it) => (it.asset && it.asset.board_type) || "").filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "ru", { numeric: true })
      );
      boardModalItems = types.map((tp) => ({ value: tp, label: tp, cols: [tp] }));
      boardModalSelected = t.aircraftType || "";
      if (title) title.textContent = "Тип борта";
      if (hint) {
        hint.textContent = types.length
          ? "Выберите тип борта из имущества палатки"
          : "Нет типов борта (БГ / НЕ БГ) в имуществе палатки";
      }
      head.innerHTML = '<th class="fs-check"></th><th>Тип</th>';
      renderBoardModalRows(1);
      syncBoardModalApplyBtn();
      modal.classList.remove("hidden");
      return;
    }

    if (t.aircraftType) {
      items = items.filter((it) => it.asset && it.asset.board_type === t.aircraftType);
    }
    boardModalItems = items.map((it) => {
      const a = it.asset || {};
      const stLabel = a.status_label || statusLabel(a.status) || "";
      return {
        value: it.value,
        label: it.label,
        cols: [a.board_type || "—", a.board_num || "—", stLabel || "—"],
        asset: a,
        groupIds: ids
      };
    });
    boardModalSelected = t.aircraftId ? String(t.aircraftId) : "";
    if (title) title.textContent = "Номер борта";
    if (hint) {
      hint.textContent = boardModalItems.length
        ? t.aircraftType
          ? "Борты типа «" + t.aircraftType + "» со статусом БГ / НЕ БГ"
          : "Выберите борт со статусом БГ / НЕ БГ"
        : "Нет бортов со статусом БГ / НЕ БГ";
    }
    head.innerHTML =
      '<th class="fs-check"></th><th>Тип</th><th>Номер</th><th>Статус</th>';
    renderBoardModalRows(3);
    syncBoardModalApplyBtn();
    modal.classList.remove("hidden");
  }

  function clearAircraft(t) {
    t.aircraftId = "";
    t.aircraftMyGroupId = "";
    t.aircraftNo = "";
    t.aircraftStatus = "";
    t.aircraftStatusLabel = "";
  }

  function aircraftMatchesType(t, type) {
    const id = String(t.aircraftId || "");
    if (!id || !type) return false;
    let match = false;
    Object.keys(assetsByGroup).forEach((gid) => {
      const list = assetsByGroup[gid] || [];
      const a = list.find((x) => String(x.id) === id);
      if (a && String(a.board_type || "") === String(type)) match = true;
    });
    return match;
  }

  function applyBoardModal() {
    const t = findTakeoff(boardModalTakeoffId);
    const field = boardModalField;
    const selected = boardModalSelected;
    const hit = boardModalItems.find((it) => it.value === selected);
    if (!t || !field || !selected) {
      closeBoardModal();
      return;
    }
    if (field === "aircraftType") {
      t.aircraftType = selected;
      if (!aircraftMatchesType(t, selected)) clearAircraft(t);
      closeBoardModal();
      scheduleSave(t);
      renderAll();
      return;
    }
    if (hit && hit.asset) {
      const ids = hit.groupIds || selectedMyGroups(t).map((g) => g.id).filter(Boolean);
      t.aircraftId = String(hit.asset.id || hit.value);
      t.aircraftType = hit.asset.board_type || "";
      t.aircraftNo = hit.asset.board_num || "";
      t.aircraftStatus = hit.asset.status || "";
      t.aircraftStatusLabel = hit.asset.status_label || statusLabel(t.aircraftStatus);
      rememberAircraftGroup(t, t.aircraftId, ids);
    } else {
      clearAircraft(t);
    }
    closeBoardModal();
    scheduleSave(t);
    renderAll();
  }

  async function changeAircraftStatus(t, nextStatus) {
    const assetId = String(t.aircraftId || "").trim();
    const cur = liveAircraftStatus(t);
    const next = String(nextStatus || "").trim();
    if (!assetId) {
      alert("Сначала выберите номер борта");
      return;
    }
    if (!next || next === cur) return;
    if (typeof api !== "function") {
      alert("API недоступен");
      return;
    }

    const gid =
      t.aircraftMyGroupId ||
      (selectedMyGroups(t)[0] && selectedMyGroups(t)[0].id) ||
      "";

    try {
      if (next === "written_off") {
        if (cur !== "bg") {
          alert("Списать можно только борт со статусом БГ");
          return;
        }
        if (typeof openWriteOffModal !== "function") {
          alert("Модуль списания не загружен");
          return;
        }
        if (!gid) {
          alert("Не найдена группа имущества для списания");
          return;
        }
        await openWriteOffModal({
          assetsUrl: "/api/admin/my-groups/" + encodeURIComponent(gid) + "/assets",
          preselectAssetId: assetId,
          onDone: async () => {
            invalidateAssetCache(gid);
            const assets = await ensureAssets([gid]);
            const asset = assets.find((a) => String(a.id) === assetId);
            if (asset) applyAssetUpdate(asset);
            else renderAll();
            if (pendingCompleteAfterWriteoff) {
              const id = pendingCompleteAfterWriteoff;
              pendingCompleteAfterWriteoff = "";
              try {
                const data = await api(
                  "/api/admin/flight-takeoffs/" + encodeURIComponent(id) + "/complete",
                  { method: "POST", json: { status_after: "written_off" } }
                );
                if (data && data.takeoff) mergeServerTakeoff(data.takeoff);
                renderAll();
              } catch (err) {
                showFsError(err);
              }
            } else {
              const curT = findTakeoff(t.id);
              if (curT) scheduleSave(curT);
            }
          }
        });
        return;
      }

      if (next === "bg" && cur === "written_off") {
        if (!confirm("Вернуть борт в строй (статус БГ)?")) return;
        const data = await api("/api/admin/assets/" + encodeURIComponent(assetId) + "/restore", {
          method: "POST"
        });
        if (gid && Array.isArray(data.assets)) assetsByGroup[gid] = data.assets;
        else if (gid) invalidateAssetCache(gid);
        if (data.asset) applyAssetUpdate(data.asset);
        else renderAll();
        return;
      }

      if ((cur === "bg" && next === "not_bg") || (cur === "not_bg" && next === "bg")) {
        const data = await api("/api/admin/assets/" + encodeURIComponent(assetId) + "/status", {
          method: "PUT",
          json: { status: next }
        });
        if (gid && Array.isArray(data.assets)) assetsByGroup[gid] = data.assets;
        else if (gid) invalidateAssetCache(gid);
        if (data.asset) applyAssetUpdate(data.asset);
        else renderAll();
        return;
      }

      alert("Такой переход статуса недоступен");
    } catch (err) {
      alert((err && err.message) || String(err));
    }
  }

  function openStatusPicker(anchor, t) {
    if (!t.aircraftId) {
      const panel = document.createElement("div");
      panel.className = "ms-dd-panel fs-dd-panel";
      panel.innerHTML =
        '<div class="hint" style="padding:8px">Сначала выберите номер борта — статус берётся из имущества палатки</div>';
      placePanel(anchor, panel);
      return;
    }
    const cur = liveAircraftStatus(t);
    let items = [];
    if (cur === "bg") {
      items = [
        { value: "bg", label: "БГ" },
        { value: "not_bg", label: "НЕ БГ" },
        { value: "written_off", label: "Утерян (через акт списания)" }
      ];
    } else if (cur === "not_bg") {
      items = [
        { value: "not_bg", label: "НЕ БГ" },
        { value: "bg", label: "БГ" }
      ];
    } else if (cur === "written_off") {
      items = [
        { value: "written_off", label: "Утерян" },
        { value: "bg", label: "Вернуть в строй (БГ)" }
      ];
    } else {
      items = STATUS_OPTS.slice();
    }
    const selected = new Set(cur ? [cur] : []);
    const panel = renderCheckPanel(items, selected, {
      multi: false,
      emptyText: "Нет вариантов",
      onChange: (set) => {
        const next = [...set][0] || "";
        closePanel();
        changeAircraftStatus(t, next);
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
    closeBoardModal();
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
        flightMinutes: ""
      });
      existing.add(val);
    });
    t.rows.forEach((r, i) => {
      r.npp = i + 1;
    });
    closeCadetModal();
    scheduleSave(t);
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

  async function loadTakeoffs() {
    if (typeof api !== "function") return;
    try {
      const data = await api("/api/admin/flight-takeoffs");
      canCreateTakeoffs = !!data.can_create;
      const keepCollapsed = {};
      takeoffs.forEach((t) => {
        keepCollapsed[t.id] = !!t.collapsed;
      });
      takeoffs = (data.takeoffs || []).map((row) =>
        fromServer(row, { collapsed: !!keepCollapsed[row.id] })
      );
      seq = takeoffs.length;
      renderAll();
    } catch (e) {
      canCreateTakeoffs = false;
      takeoffs = [];
      renderAll();
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
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          closeBoardModal();
          const id = rm.getAttribute("data-fs-remove");
          const doomed = findTakeoff(id);
          if (!canEditTakeoff(doomed)) return;
          const day = doomed && doomed.date;
          (async () => {
            try {
              await api("/api/admin/flight-takeoffs/" + encodeURIComponent(id), { method: "DELETE" });
              takeoffs = takeoffs.filter((x) => x.id !== id);
              renumberAfterDelete(day);
              const peers = takeoffs.filter((x) => String(x.date || "") === String(day || "") && canEditTakeoff(x));
              peers.forEach((p) => scheduleSave(p));
              renderAll();
            } catch (err) {
              showFsError(err);
            }
          })();
          return;
        }

        const dayToggle = e.target.closest("[data-fs-day-toggle]");
        if (dayToggle && list.contains(dayToggle)) {
          e.preventDefault();
          e.stopPropagation();
          const day = dayToggle.getAttribute("data-fs-day-toggle") || "";
          collapsedDays[day] = !collapsedDays[day];
          const card = dayToggle.closest(".fs-day-card");
          if (card) {
            card.classList.toggle("collapsed", !!collapsedDays[day]);
            dayToggle.setAttribute("aria-expanded", collapsedDays[day] ? "false" : "true");
          }
          return;
        }

        const complete = e.target.closest("[data-fs-complete]");
        if (complete && list.contains(complete)) {
          e.preventDefault();
          e.stopPropagation();
          const t = findTakeoff(complete.getAttribute("data-fs-complete"));
          if (t) openCompleteModal(t);
          return;
        }

        const toggle = e.target.closest("[data-fs-toggle]");
        if (toggle && list.contains(toggle)) {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          const t = findTakeoff(toggle.getAttribute("data-fs-toggle"));
          if (!t) return;
          t.collapsed = !t.collapsed;
          const card = toggle.closest(".fs-takeoff-card");
          if (card) {
            card.classList.toggle("collapsed", !!t.collapsed);
            toggle.setAttribute("aria-expanded", t.collapsed ? "false" : "true");
          }
          return;
        }

        const addCadets = e.target.closest("[data-fs-add-cadets]");
        if (addCadets && list.contains(addCadets)) {
          e.preventDefault();
          e.stopPropagation();
          const t = findTakeoff(addCadets.getAttribute("data-fs-add-cadets"));
          if (t && canEditTakeoff(t)) openCadetModal(t);
          return;
        }

        const pick = e.target.closest("[data-fs-pick]");
        if (pick && list.contains(pick)) {
          e.preventDefault();
          e.stopPropagation();
          const card = pick.closest(".fs-takeoff-card");
          const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
          if (!t || !canEditTakeoff(t)) return;
          const kind = pick.getAttribute("data-fs-pick");
          if (kind === "stream") openStreamPicker(pick, t);
          else if (kind === "group") openGroupPicker(pick, t);
          else if (kind === "status") openStatusPicker(pick, t);
          else if (kind === "aircraftType" || kind === "aircraftNo") openAircraftPicker(t, kind);
          return;
        }

        const edit = e.target.closest("[data-fs-edit]");
        if (edit && list.contains(edit)) {
          e.preventDefault();
          e.stopPropagation();
          closePanel();
          const card = edit.closest(".fs-takeoff-card");
          const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
          if (!t || !canEditTakeoff(t)) return;
          startTextEdit(edit, t, edit.getAttribute("data-fs-edit"));
        }
      });

      list.addEventListener("input", (e) => {
        const inp = e.target.closest("input[data-fs-row][data-fs-field]");
        if (!inp || !list.contains(inp)) return;
        const card = inp.closest(".fs-takeoff-card");
        const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
        if (!t || !canEditTakeoff(t)) return;
        const idx = Number(inp.getAttribute("data-fs-row"));
        const field = inp.getAttribute("data-fs-field");
        if (!t.rows[idx] || !field) return;
        if (field === "flightMinutes" || field === "flightTime") {
          const digits = String(inp.value || "").replace(/[^\d]/g, "");
          t.rows[idx].flightMinutes = digits;
          delete t.rows[idx].flightTime;
          refreshAllCadetTotals();
          scheduleSave(t);
          return;
        }
        t.rows[idx][field] = inp.value;
        scheduleSave(t);
      });

      list.addEventListener("change", (e) => {
        const inp = e.target.closest('input[data-fs-field="flightMinutes"], input[data-fs-field="flightTime"]');
        if (!inp || !list.contains(inp)) return;
        const card = inp.closest(".fs-takeoff-card");
        const t = findTakeoff(card && card.getAttribute("data-takeoff-id"));
        if (!t || !canEditTakeoff(t)) return;
        const idx = Number(inp.getAttribute("data-fs-row"));
        if (!t.rows[idx]) return;
        const normalized = normalizeFlightMinutesInput(inp.value);
        inp.value = normalized;
        t.rows[idx].flightMinutes = normalized;
        delete t.rows[idx].flightTime;
        refreshAllCadetTotals();
        scheduleSave(t);
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

    const boardModal = $("fsBoardModal");
    if (boardModal && !boardModal._fsBound) {
      boardModal._fsBound = true;
      boardModal.addEventListener("click", (e) => {
        if (e.target === boardModal) closeBoardModal();
      });
      const closeBtn = $("btnFsBoardModalClose");
      if (closeBtn) closeBtn.onclick = () => closeBoardModal();
      const applyBtn = $("btnFsBoardModalApply");
      if (applyBtn) applyBtn.onclick = () => applyBoardModal();
      const body = $("fsBoardModalBody");
      if (body) {
        body.addEventListener("click", (e) => {
          const tr = e.target.closest("tr[data-fs-board]");
          if (!tr || !body.contains(tr)) return;
          const inp = tr.querySelector('input[type="radio"]');
          if (!inp) return;
          inp.checked = true;
          boardModalSelected = inp.value;
          body.querySelectorAll('input[type="radio"]').forEach((x) => {
            if (x !== inp) x.checked = false;
          });
          syncBoardModalApplyBtn();
        });
      }
    }

    const completeModal = $("fsCompleteModal");
    if (completeModal && !completeModal._fsBound) {
      completeModal._fsBound = true;
      completeModal.addEventListener("click", (e) => {
        if (e.target === completeModal) closeCompleteModal();
      });
      const closeBtn = $("btnFsCompleteModalClose");
      if (closeBtn) closeBtn.onclick = () => closeCompleteModal();
      const cancelBtn = $("btnFsCompleteModalCancel");
      if (cancelBtn) cancelBtn.onclick = () => closeCompleteModal();
      const okBtn = $("btnFsCompleteModalOk");
      if (okBtn) okBtn.onclick = () => confirmCompleteFlight();
      const box = $("fsCompleteStatusBox");
      if (box) box.addEventListener("change", () => syncCompleteModalOk());
    }

    const limitModal = $("fsLimitModal");
    if (limitModal && !limitModal._fsBound) {
      limitModal._fsBound = true;
      limitModal.addEventListener("click", (e) => {
        if (e.target === limitModal) closeLimitModal();
      });
      const closeBtn = $("btnFsLimitModalClose");
      if (closeBtn) closeBtn.onclick = () => closeLimitModal();
      const okBtn = $("btnFsLimitModalOk");
      if (okBtn) okBtn.onclick = () => closeLimitModal();
    }

    const sumTable = $("fsSummaryTable");
    if (sumTable && !sumTable._fsBound) {
      sumTable._fsBound = true;
      sumTable.addEventListener("click", (e) => {
        const th = e.target.closest("th[data-fs-sum-sort]");
        if (!th || !sumTable.contains(th)) return;
        const key = th.getAttribute("data-fs-sum-sort");
        if (!key) return;
        if (summarySort.key === key) summarySort.dir *= -1;
        else {
          summarySort.key = key;
          summarySort.dir = key === "date" ? -1 : 1;
        }
        renderSummary();
      });
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
        loadCatalog().then(() => loadTakeoffs());
      }, 0);
    });
  }

  async function boot() {
    bind();
    bindAccordionReload();
    await loadCatalog();
    await loadTakeoffs();
  }

  window.renderFlightTakeoffs = renderAll;
  window.reloadFlightSheetCatalog = loadCatalog;
  window.fsParseFlightMinutes = parseFlightMinutes;
  window.fsFormatMinutesHm = formatMinutesHm;
  window.fsFormatMinutesClock = formatMinutesClock;
  window.fsSumTakeoffMinutes = sumTakeoffMinutes;
  window.fsBuildCadetMinutesMap = buildCadetMinutesMap;

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
