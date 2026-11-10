/* Нормативы: вкладки + фильтры в аккордионе кабинета, sync с iframe embed */
(function () {
  const $ = (id) => document.getElementById(id);
  const NORMS_VIEWS = ["setup", "norm", "accepted", "none", "partial", "cadet", "export"];

  let normsOpts = { streams: [], groups: [], byStream: {} };
  let normsBusy = false;
  let normsView = "setup";

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
    const stream = streamSel.value;
    fillSelect(streamSel, normsOpts.streams, "Все потоки", stream);
    fillSelect(groupSel, groupsForStream(streamSel.value), "Все группы", groupSel.value);
  }

  function paintNormsViewTabs() {
    document.querySelectorAll("#normsViewTabs [data-norms-view]").forEach((btn) => {
      const on = btn.getAttribute("data-norms-view") === normsView;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function postToNormsFrame(payload) {
    const frame = $("normsEmbedFrame");
    if (!frame || !frame.contentWindow || frame.src === "about:blank") return;
    try {
      frame.contentWindow.postMessage(payload, location.origin);
    } catch (e) {}
  }

  function postFiltersToFrame() {
    const fs = ($("filterNormsStream") && $("filterNormsStream").value) || "";
    const fg = ($("filterNormsGroup") && $("filterNormsGroup").value) || "";
    postToNormsFrame({ type: "lis-norms-set-filters", fs, fg });
  }

  function postViewToFrame() {
    postToNormsFrame({ type: "lis-norms-set-view", view: normsView });
  }

  function setNormsView(view, { syncFrame } = { syncFrame: true }) {
    const v = NORMS_VIEWS.includes(view) ? view : "setup";
    normsView = v;
    paintNormsViewTabs();
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
      const meta = $("normsMeta");
      if (meta) {
        const n = cadets.length;
        meta.textContent = n ? " · " + n : "";
      }
    } catch (e) {
      /* iframe пришлёт опции после загрузки */
    }
  }

  function ensureNormsFrame() {
    const frame = $("normsEmbedFrame");
    if (!frame) return;
    if (frame.dataset.loaded === "1") {
      postFiltersToFrame();
      postViewToFrame();
      return;
    }
    const src = frame.getAttribute("data-src") || "/tools/norms?embed=1";
    frame.dataset.loaded = "1";
    frame.addEventListener(
      "load",
      () => {
        postFiltersToFrame();
        postViewToFrame();
      },
      { once: true }
    );
    frame.src = src;
  }

  function onNormsFilterChange() {
    if (normsBusy) return;
    normsBusy = true;
    try {
      paintNormsFilters();
      postFiltersToFrame();
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
        }, 0);
      });
    }
    if (!mod.classList.contains("collapsed")) {
      ensureNormsFrame();
      loadNormsFilterOptionsFromApi();
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

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return;
    const data = e.data || {};
    if (data.type === "lis-norms-filters") {
      ingestFilterPayload(data);
      return;
    }
    if (data.type === "lis-norms-view") {
      setNormsView(data.view, { syncFrame: false });
    }
  });

  paintNormsViewTabs();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNormsAccordion);
  } else {
    bindNormsAccordion();
  }
  setTimeout(bindNormsAccordion, 400);
})();
