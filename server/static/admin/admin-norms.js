/* Нормативы: вкладки/фильтры/таблица курсантов в аккордионе + sync с iframe */
(function () {
  const $ = (id) => document.getElementById(id);
  const NORMS_VIEWS = ["setup", "norm", "accepted", "none", "partial", "cadet", "export"];
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
          '<td>' +
          esc(c.npp || i + 1) +
          "</td>" +
          "<td>" +
          esc(dash(c.num)) +
          "</td>" +
          "<td>" +
          esc(dash(c.callsign)) +
          "</td>" +
          "<td>" +
          esc(dash(c.stream)) +
          "</td>" +
          "<td>" +
          esc(dash(c.group)) +
          "</td>" +
          "<td>" +
          esc(avg) +
          "</td>" +
          "<td>" +
          esc(c.passed != null ? c.passed : "—") +
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

  function syncPanels() {
    const isCadets = normsView === "setup";
    const panel = $("normsCadetsPanel");
    const frame = $("normsEmbedFrame");
    if (panel) panel.hidden = !isCadets;
    if (frame) frame.hidden = isCadets;
    if (isCadets) requestCadetsFromFrame();
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
      },
      { once: true }
    );
    // iframe нужен для данных даже на вкладке «Курсанты»
    frame.hidden = normsView === "setup";
    frame.src = src;
  }

  function onNormsFilterChange() {
    if (normsBusy) return;
    normsBusy = true;
    try {
      paintNormsFilters();
      postFiltersToFrame();
      if (normsView === "setup") requestCadetsFromFrame();
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
  if ($("filterNormsGroup")) {
    $("filterNormsGroup").onchange = onNormsFilterChange;
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

  const table = $("normsCadetsTable");
  if (table && !table._bound) {
    table._bound = true;
    table.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-cad-id]");
      if (!tr) return;
      const id = tr.getAttribute("data-cad-id");
      if (!id) return;
      ensureNormsFrame();
      setNormsView("cadet");
      postToNormsFrame({ type: "lis-norms-open-cadet", id });
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
