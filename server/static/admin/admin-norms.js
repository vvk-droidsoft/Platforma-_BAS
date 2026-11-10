/* Нормативы: вкладки/фильтры/Курсанты/По нормативу в аккордионе + sync с iframe */
(function () {
  const $ = (id) => document.getElementById(id);
  const NORMS_VIEWS = ["setup", "norm", "accepted", "none", "partial", "cadet", "export"];
  const NATIVE_VIEWS = { setup: "normsCadetsPanel", norm: "normsByNormPanel" };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dash = (v) => {
    const s = String(v == null ? "" : v).trim();
    return s || "—";
  };

  let normsOpts = { streams: [], groups: [], byStream: {} };
  let normsBusy = false;
  let normsView = "setup";
  let normsCadets = [];
  let normsTable = null;
  let normsEditBusy = false;

  function uniqSorted(vals) {
    return [...new Set((vals || []).map((v) => String(v || "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ru", { numeric: true })
    );
  }

  function fillSelect(sel, values, allLabel, current) {
    if (!sel) return;
    const cur = current != null ? String(current) : sel.value;
    sel.innerHTML =
      '<option value="">' +
      (allLabel || "Все") +
      "</option>" +
      values.map((v) => '<option value="' + String(v).replace(/"/g, "&quot;") + '">' + v + "</option>").join("");
    sel.value = values.includes(cur) ? cur : "";
  }

  function groupsForStream(stream) {
    const s = String(stream || "").trim();
    if (!s) return normsOpts.groups.slice();
    return (normsOpts.byStream[s] || []).slice();
  }

  function paintNormsFilters() {
    const streamSel = $("filterNormsStream");
    const groupSel = $("filterNormsGroup");
    if (!streamSel || !groupSel) return;
    fillSelect(streamSel, normsOpts.streams, "Все потоки", streamSel.value);
    fillSelect(groupSel, groupsForStream(streamSel.value), "Все группы", groupSel.value);
  }

  function paintNormsViewTabs() {
    document.querySelectorAll("#normsViewTabs [data-norms-view]").forEach((btn) => {
      const on = btn.getAttribute("data-norms-view") === normsView;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setCadetsMsg(text, ok) {
    const el = $("normsCadetsMsg");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = ok === false ? "var(--warn)" : ok ? "var(--ok)" : "";
  }

  function renderNormsCadetsTable() {
    const body = $("normsCadetsBody");
    if (!body) return;
    const list = normsCadets || [];
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="hint">Курсантов пока нет. Нажмите «Обновить из Мои группы» или смените фильтр.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map((c, i) => {
        const avg = c.avg != null && c.avg !== "" ? String(c.avg) : "—";
        return (
          '<tr data-cad-id="' +
          esc(c.id) +
          '" title="Открыть карточку">' +
          "<td>" +
          esc(c.npp || i + 1) +
          "</td><td>" +
          esc(dash(c.num)) +
          "</td><td>" +
          esc(dash(c.callsign)) +
          "</td><td>" +
          esc(dash(c.stream)) +
          "</td><td>" +
          esc(dash(c.group)) +
          "</td><td>" +
          esc(avg) +
          "</td><td>" +
          esc(c.passed != null ? c.passed : "—") +
          "</td></tr>"
        );
      })
      .join("");
  }

  function paintNormSelect(data) {
    const sel = $("filterNormsNorm");
    if (!sel) return;
    const list = data.norms || [];
    const cur = String(data.norm != null ? data.norm : sel.value);
    sel.innerHTML = list
      .map((n) => {
        const v = String(n.n);
        return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(n.label) + "</option>";
      })
      .join("");
    if (cur) sel.value = cur;
  }

  function renderNormsByNormTable(data) {
    normsTable = data || null;
    const head = $("normsByNormHead");
    const body = $("normsByNormBody");
    const info = $("normsByNormInfo");
    const sortSel = $("filterNormsSort");
    if (!head || !body) return;
    if (info) info.innerHTML = (data && data.infoHtml) || "";
    if (sortSel && data && data.sort) sortSel.value = data.sort;
    paintNormSelect(data || { norms: [], norm: "" });

    const dl = $("normsEquipList");
    if (dl) {
      dl.innerHTML = (data.equipList || []).map((v) => '<option value="' + esc(v) + '">').join("");
    }

    const cols = (data && data.columns) || [];
    const rows = (data && data.rows) || [];
    const gradeOpts = (data && data.gradeOpts) || [];

    head.innerHTML =
      "<tr><th>№ п/п</th><th>Позывной</th>" +
      cols.map((c) => "<th>" + esc(c.label) + "</th>").join("") +
      "<th>Оценка</th></tr>";

    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="' +
        (3 + cols.length) +
        '" class="hint">Нет курсантов. Добавьте их во вкладке «Курсанты» или смените фильтр.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map((row, i) => {
        const cells = cols
          .map((col) => {
            const val = (row.cells && row.cells[col.key]) || "";
            if (col.type === "select") {
              const opts = (col.options || []).map(
                (o) =>
                  '<option value="' +
                  esc(o) +
                  '"' +
                  (val === o ? " selected" : "") +
                  ">" +
                  esc(o) +
                  "</option>"
              );
              return (
                '<td><select data-c="' +
                esc(row.id) +
                '" data-k="' +
                esc(col.key) +
                '"><option value=""></option>' +
                opts.join("") +
                "</select></td>"
              );
            }
            const listAttr = col.key === "equip" ? ' list="normsEquipList"' : "";
            const ph = col.type === "time" ? ' placeholder="м:сс"' : "";
            const style = col.key === "equip" ? "" : ' style="max-width:130px"';
            return (
              '<td><input type="text" data-c="' +
              esc(row.id) +
              '" data-k="' +
              esc(col.key) +
              '" data-t="' +
              esc(col.type) +
              '" value="' +
              esc(val) +
              '"' +
              listAttr +
              ph +
              style +
              "></td>"
            );
          })
          .join("");
        const gsel =
          '<select data-c="' +
          esc(row.id) +
          '" data-k="g" style="max-width:150px">' +
          gradeOpts
            .map(
              (o) =>
                '<option value="' +
                esc(o[0]) +
                '"' +
                (String(row.grade || "") === String(o[0]) ? " selected" : "") +
                ">" +
                esc(o[1]) +
                "</option>"
            )
            .join("") +
          "</select>";
        return (
          '<tr data-row="' +
          esc(row.id) +
          '"><td>' +
          esc(row.npp || i + 1) +
          "</td><td>" +
          esc(dash(row.callsign)) +
          "</td>" +
          cells +
          '<td><span class="gcell">' +
          (row.gradeBadgeHtml || "—") +
          "</span> " +
          gsel +
          "</td></tr>"
        );
      })
      .join("");
  }

  function postToNormsFrame(payload) {
    const frame = $("normsEmbedFrame");
    if (!frame || !frame.contentWindow || frame.src === "about:blank") return false;
    try {
      frame.contentWindow.postMessage(payload, location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  function postFiltersToFrame() {
    const fs = ($("filterNormsStream") && $("filterNormsStream").value) || "";
    const fg = ($("filterNormsGroup") && $("filterNormsGroup").value) || "";
    postToNormsFrame({ type: "lis-norms-set-filters", fs, fg });
  }

  function postViewToFrame() {
    postToNormsFrame({ type: "lis-norms-set-view", view: normsView });
  }

  function requestCadetsFromFrame() {
    if (!postToNormsFrame({ type: "lis-norms-request-cadets" })) {
      setCadetsMsg("Загрузка модуля нормативов…");
    }
  }

  function requestNormTableFromFrame() {
    const norm = ($("filterNormsNorm") && $("filterNormsNorm").value) || "";
    const sort = ($("filterNormsSort") && $("filterNormsSort").value) || "order";
    if (
      !postToNormsFrame({
        type: "lis-norms-request-table",
        norm: norm ? Number(norm) : undefined,
        sort
      })
    ) {
      const body = $("normsByNormBody");
      if (body) body.innerHTML = '<tr><td class="hint">Загрузка модуля нормативов…</td></tr>';
    }
  }

  function syncPanels() {
    Object.keys(NATIVE_VIEWS).forEach((v) => {
      const el = $(NATIVE_VIEWS[v]);
      if (el) el.hidden = normsView !== v;
    });
    const frame = $("normsEmbedFrame");
    const isNative = !!NATIVE_VIEWS[normsView];
    if (frame) frame.hidden = isNative;
    if (normsView === "setup") requestCadetsFromFrame();
    if (normsView === "norm") requestNormTableFromFrame();
  }

  function setNormsView(view, { syncFrame } = { syncFrame: true }) {
    const v = NORMS_VIEWS.includes(view) ? view : "setup";
    normsView = v;
    paintNormsViewTabs();
    syncPanels();
    if (syncFrame) postViewToFrame();
  }

  function ingestFilterPayload(data) {
    const streams = uniqSorted(data.streams || []);
    const groups = uniqSorted(data.groups || []);
    const byStream = {};
    if (data.byStream && typeof data.byStream === "object") {
      Object.keys(data.byStream).forEach((k) => {
        byStream[k] = uniqSorted(data.byStream[k]);
      });
    } else {
      streams.forEach((s) => {
        byStream[s] = groups.slice();
      });
    }
    normsOpts = { streams, groups, byStream };
    paintNormsFilters();
    if (data.fs != null && $("filterNormsStream")) {
      const fs = String(data.fs || "");
      if (!fs || streams.includes(fs)) $("filterNormsStream").value = fs;
    }
    if (data.fg != null && $("filterNormsGroup")) {
      const fg = String(data.fg || "");
      const allowed = groupsForStream($("filterNormsStream").value);
      if (!fg || allowed.includes(fg)) $("filterNormsGroup").value = fg;
    }
  }

  function ingestCadetsPayload(data) {
    normsCadets = Array.isArray(data.cadets) ? data.cadets : [];
    renderNormsCadetsTable();
    const meta = $("normsMeta");
    if (meta) {
      const n = data.total != null ? Number(data.total) : normsCadets.length;
      meta.textContent = n ? " · " + n : "";
    }
    if (data.message) setCadetsMsg(data.message, data.ok !== false);
    else if (!normsCadets.length) setCadetsMsg("");
    else setCadetsMsg("Показано: " + normsCadets.length, true);
  }

  async function loadNormsFilterOptionsFromApi() {
    if (typeof api !== "function") return;
    try {
      const data = await api("/api/admin/norms/my-cadets");
      const cadets = data.cadets || [];
      const streams = uniqSorted(cadets.map((c) => c.stream));
      const groups = uniqSorted(cadets.map((c) => c.group));
      const byStream = {};
      cadets.forEach((c) => {
        const s = String(c.stream || "").trim();
        const g = String(c.group || "").trim();
        if (!s || !g) return;
        if (!byStream[s]) byStream[s] = [];
        if (!byStream[s].includes(g)) byStream[s].push(g);
      });
      Object.keys(byStream).forEach((k) => {
        byStream[k] = uniqSorted(byStream[k]);
      });
      normsOpts = { streams, groups, byStream };
      paintNormsFilters();
    } catch (e) {
      /* iframe пришлёт опции */
    }
  }

  function ensureNormsFrame() {
    const frame = $("normsEmbedFrame");
    if (!frame) return;
    if (frame.dataset.loaded === "1") {
      postFiltersToFrame();
      postViewToFrame();
      if (normsView === "setup") requestCadetsFromFrame();
      if (normsView === "norm") requestNormTableFromFrame();
      return;
    }
    const src = frame.getAttribute("data-src") || "/tools/norms?embed=1";
    frame.dataset.loaded = "1";
    frame.addEventListener(
      "load",
      () => {
        postFiltersToFrame();
        postViewToFrame();
        if (normsView === "setup") requestCadetsFromFrame();
        if (normsView === "norm") requestNormTableFromFrame();
      },
      { once: true }
    );
    frame.hidden = !!NATIVE_VIEWS[normsView];
    frame.src = src;
  }

  function onNormsFilterChange() {
    if (normsBusy) return;
    normsBusy = true;
    try {
      paintNormsFilters();
      postFiltersToFrame();
      if (normsView === "setup") requestCadetsFromFrame();
      if (normsView === "norm") requestNormTableFromFrame();
    } finally {
      normsBusy = false;
    }
  }

  function bindNormsAccordion() {
    const mod = document.querySelector('#app .mod[data-mod="norms"]');
    if (!mod) return;
    const head = mod.querySelector(":scope > .mod-head");
    if (head && !head._normsBound) {
      head._normsBound = true;
      head.addEventListener("click", () => {
        setTimeout(() => {
          if (mod.classList.contains("collapsed")) return;
          ensureNormsFrame();
          loadNormsFilterOptionsFromApi();
          syncPanels();
        }, 0);
      });
    }
    if (!mod.classList.contains("collapsed")) {
      ensureNormsFrame();
      loadNormsFilterOptionsFromApi();
      syncPanels();
    }
  }

  const tabs = $("normsViewTabs");
  if (tabs && !tabs._normsTabsBound) {
    tabs._normsTabsBound = true;
    tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-norms-view]");
      if (!btn || !tabs.contains(btn)) return;
      e.preventDefault();
      ensureNormsFrame();
      setNormsView(btn.getAttribute("data-norms-view"));
    });
  }

  if ($("filterNormsStream")) {
    $("filterNormsStream").onchange = () => {
      if ($("filterNormsGroup")) $("filterNormsGroup").value = "";
      onNormsFilterChange();
    };
  }
  if ($("filterNormsGroup")) $("filterNormsGroup").onchange = onNormsFilterChange;

  if ($("filterNormsNorm") && !$("filterNormsNorm")._bound) {
    $("filterNormsNorm")._bound = true;
    $("filterNormsNorm").onchange = () => {
      ensureNormsFrame();
      postToNormsFrame({
        type: "lis-norms-set-norm",
        norm: Number($("filterNormsNorm").value),
        sort: ($("filterNormsSort") && $("filterNormsSort").value) || "order"
      });
    };
  }
  if ($("filterNormsSort") && !$("filterNormsSort")._bound) {
    $("filterNormsSort")._bound = true;
    $("filterNormsSort").onchange = () => {
      ensureNormsFrame();
      postToNormsFrame({
        type: "lis-norms-set-norm",
        norm: Number(($("filterNormsNorm") && $("filterNormsNorm").value) || 0),
        sort: $("filterNormsSort").value
      });
    };
  }

  if ($("btnNormsSyncCadets") && !$("btnNormsSyncCadets")._bound) {
    $("btnNormsSyncCadets")._bound = true;
    $("btnNormsSyncCadets").onclick = () => {
      ensureNormsFrame();
      setCadetsMsg("Обновление…");
      if (!postToNormsFrame({ type: "lis-norms-sync-cadets" })) {
        setCadetsMsg("Модуль нормативов ещё загружается…", false);
      }
    };
  }

  const cadetsTable = $("normsCadetsTable");
  if (cadetsTable && !cadetsTable._bound) {
    cadetsTable._bound = true;
    cadetsTable.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-cad-id]");
      if (!tr) return;
      const id = tr.getAttribute("data-cad-id");
      if (!id) return;
      ensureNormsFrame();
      setNormsView("cadet");
      postToNormsFrame({ type: "lis-norms-open-cadet", id });
    });
  }

  function maskTimeLocal(el) {
    const v = el.value;
    if (/[A-Za-zА-Яа-яЁё]/.test(v)) return;
    const digits = v.replace(/\D/g, "").replace(/^0+/, "").slice(0, 5);
    if (!digits) {
      el.value = /\d/.test(v) ? "0:00" : "";
      return;
    }
    el.value = (digits.slice(0, -2) || "0") + ":" + digits.slice(-2).padStart(2, "0");
  }

  function onNormCellEdit(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.c || !el.dataset.k) return;
    if (e.type === "input" && el.tagName === "SELECT") return;
    if (e.type === "input" && el.dataset.t === "time") maskTimeLocal(el);
    ensureNormsFrame();
    postToNormsFrame({
      type: "lis-norms-cell-edit",
      cid: el.dataset.c,
      key: el.dataset.k,
      value: el.value,
      inputType: el.dataset.t || "",
      eventType: e.type
    });
  }

  function applyCellResult(data) {
    const table = $("normsByNormTable");
    if (!table) return;
    const row = table.querySelector('tr[data-row="' + String(data.cid || "") + '"]');
    if (!row) return;
    const gcell = row.querySelector(".gcell");
    if (gcell && data.gradeBadgeHtml) gcell.innerHTML = data.gradeBadgeHtml;
    const field = row.querySelector('[data-k="' + String(data.key || "") + '"]');
    if (field && data.value != null && document.activeElement !== field) {
      field.value = data.value;
    }
    if (field && data.inputType === "time" && data.value != null && document.activeElement === field) {
      // уже замаскировано локально; не трогаем каретку
    }
  }

  const byNormTable = $("normsByNormTable");
  if (byNormTable && !byNormTable._bound) {
    byNormTable._bound = true;
    byNormTable.addEventListener("input", onNormCellEdit);
    byNormTable.addEventListener("change", (e) => {
      if (e.target && (e.target.tagName === "SELECT" || e.target.tagName === "INPUT")) onNormCellEdit(e);
    });
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    const data = e.data || {};
    if (data.type === "lis-norms-filters") {
      ingestFilterPayload(data);
      return;
    }
    if (data.type === "lis-norms-cadets") {
      ingestCadetsPayload(data);
      return;
    }
    if (data.type === "lis-norms-table") {
      renderNormsByNormTable(data);
      return;
    }
    if (data.type === "lis-norms-cell-result") {
      applyCellResult(data);
      return;
    }
    if (data.type === "lis-norms-view") {
      setNormsView(data.view, { syncFrame: false });
    }
  });

  paintNormsViewTabs();
  syncPanels();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNormsAccordion);
  } else {
    bindNormsAccordion();
  }
  setTimeout(bindNormsAccordion, 400);
})();
