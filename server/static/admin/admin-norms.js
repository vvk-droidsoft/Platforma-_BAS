/* Нормативы: вкладки/нативные панели в аккордионе + sync с iframe */
(function () {
  const $ = (id) => document.getElementById(id);
  const NORMS_VIEWS = ["setup", "norm", "accepted", "none", "partial", "cadet", "export"];
  const SUM_VIEWS = ["accepted", "none", "partial"];
  const NATIVE_VIEWS = {
    setup: "normsCadetsPanel",
    norm: "normsByNormPanel",
    accepted: "normsSumPanel",
    none: "normsSumPanel",
    partial: "normsSumPanel",
    cadet: "normsCadetPanel",
    export: "normsExportPanel"
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dash = (v) => {
    const s = String(v == null ? "" : v).trim();
    return s || "—";
  };

  let normsView = "setup";
  let normsCadets = [];
  let normsTable = null;
  let normsCadetMode = "pass";

  function paintNormsViewTabs() {
    document.querySelectorAll("#normsViewTabs [data-norms-view]").forEach((btn) => {
      const on = btn.getAttribute("data-norms-view") === normsView;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setExportMsg(text, ok) {
    const el = $("normsExpMsg");
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
        '<tr><td colspan="7" class="hint">Курсантов пока нет.</td></tr>';
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

  function renderNormsSummary(data) {
    const title = $("normsSumTitle");
    const hint = $("normsSumHint");
    const head = $("normsSumHead");
    const body = $("normsSumBody");
    if (!head || !body) return;
    if (title) title.textContent = (data && data.title) || "";
    if (hint) hint.textContent = (data && data.hint) || "";
    if (data && data.empty) {
      head.innerHTML = "";
      body.innerHTML = '<tr><td class="hint">' + esc(data.empty) + "</td></tr>";
      return;
    }
    const cols = (data && data.columns) || [];
    const rows = (data && data.rows) || [];
    head.innerHTML = "<tr>" + cols.map((c) => "<th>" + esc(c) + "</th>").join("") + "</tr>";
    if (!rows.length) {
      body.innerHTML = '<tr><td class="hint" colspan="' + cols.length + '">Таких нормативов нет.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((r) => {
        const cells = (r.cells || [])
          .map((cell, idx) => {
            const cls = cell.cls ? ' class="' + esc(cell.cls) + '"' : "";
            if (cell.goto != null) {
              return (
                "<td" +
                cls +
                '><a class="lk" href="#" data-goto="' +
                esc(cell.goto) +
                '">' +
                esc(cell.text) +
                "</a></td>"
              );
            }
            return "<td" + cls + ">" + (cell.html != null ? cell.html : esc(cell.text)) + "</td>";
          })
          .join("");
        return "<tr>" + cells + "</tr>";
      })
      .join("");
  }

  function renderNormsCadet(data) {
    const sel = $("filterNormsCadet");
    const modeSel = $("filterNormsCadMode");
    const chips = $("normsCadetChips");
    const head = $("normsCadetHead");
    const body = $("normsCadetBody");
    if (!head || !body) return;

    const options = (data && data.options) || [];
    const selected = String((data && data.selected) || "");
    if (sel) {
      sel.innerHTML = options.length
        ? options.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.callsign) + "</option>").join("")
        : '<option value="">— нет курсантов —</option>';
      if (selected && options.some((o) => String(o.id) === selected)) sel.value = selected;
    }
    if (modeSel && data && data.mode) {
      normsCadetMode = data.mode === "all" ? "all" : "pass";
      modeSel.value = normsCadetMode;
    }

    if (chips) {
      chips.innerHTML = ((data && data.chips) || [])
        .map(
          (c) =>
            '<div class="norms-chip"><b>' +
            esc(c.value) +
            "</b><small>" +
            esc(c.label) +
            "</small></div>"
        )
        .join("");
    }

    if (data && data.empty) {
      head.innerHTML = "";
      body.innerHTML = '<tr><td class="hint">' + esc(data.empty) + "</td></tr>";
      return;
    }

    const cols = (data && data.columns) || [];
    const rows = (data && data.rows) || [];
    head.innerHTML = "<tr>" + cols.map((c) => "<th>" + esc(c) + "</th>").join("") + "</tr>";
    if (!rows.length) {
      body.innerHTML =
        '<tr><td class="hint" colspan="' +
        Math.max(cols.length, 1) +
        '">Сданных нормативов пока нет.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((r) => {
        return (
          "<tr>" +
          (r.cells || [])
            .map((cell) => {
              const cls = cell.cls ? ' class="' + esc(cell.cls) + '"' : "";
              return "<td" + cls + ">" + (cell.html != null ? cell.html : esc(cell.text)) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
  }

  function renderNormsExport(data) {
    const info = $("normsExpInfo");
    const btn = $("btnNormsExport");
    const all = $("normsExpAll");
    if (all && data && data.all != null) all.checked = !!data.all;
    if (info) {
      info.innerHTML =
        (data && data.infoHtml) ||
        "Курсантов в ведомости: <b>0</b> · нормативов: <b>0</b> · листов с результатами: <b>0</b>.";
    }
    if (btn) btn.disabled = !(data && data.canExport);
    if (data && data.message) setExportMsg(data.message, data.ok);
    else if (!(data && data.canExport)) setExportMsg((data && data.warn) || "", false);
    else setExportMsg("");
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
    postToNormsFrame({ type: "lis-norms-set-filters", fs: "", fg: "" });
  }

  function postViewToFrame() {
    postToNormsFrame({ type: "lis-norms-set-view", view: normsView });
  }

  function requestCadetsFromFrame() {
    postToNormsFrame({ type: "lis-norms-request-cadets" });
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

  function requestSummaryFromFrame(kind) {
    const k = kind || normsView;
    if (
      !postToNormsFrame({
        type: "lis-norms-request-summary",
        kind: k
      })
    ) {
      const body = $("normsSumBody");
      if (body) body.innerHTML = '<tr><td class="hint">Загрузка модуля нормативов…</td></tr>';
    }
  }

  function requestCadetFromFrame() {
    const id = ($("filterNormsCadet") && $("filterNormsCadet").value) || "";
    const mode = ($("filterNormsCadMode") && $("filterNormsCadMode").value) || normsCadetMode;
    if (
      !postToNormsFrame({
        type: "lis-norms-request-cadet",
        id,
        mode
      })
    ) {
      const body = $("normsCadetBody");
      if (body) body.innerHTML = '<tr><td class="hint">Загрузка модуля нормативов…</td></tr>';
    }
  }

  function requestExportFromFrame() {
    const all = !!($("normsExpAll") && $("normsExpAll").checked);
    if (
      !postToNormsFrame({
        type: "lis-norms-request-export",
        all
      })
    ) {
      setExportMsg("Загрузка модуля нормативов…", false);
    }
  }

  function requestActiveViewData() {
    if (normsView === "setup") requestCadetsFromFrame();
    else if (normsView === "norm") requestNormTableFromFrame();
    else if (SUM_VIEWS.includes(normsView)) requestSummaryFromFrame(normsView);
    else if (normsView === "cadet") requestCadetFromFrame();
    else if (normsView === "export") requestExportFromFrame();
  }

  function syncPanels() {
    const activeId = NATIVE_VIEWS[normsView] || null;
    ["normsCadetsPanel", "normsByNormPanel", "normsSumPanel", "normsCadetPanel", "normsExportPanel"].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = id !== activeId;
    });
    const frame = $("normsEmbedFrame");
    if (frame) frame.hidden = !!activeId;
    requestActiveViewData();
  }

  function setNormsView(view, { syncFrame } = { syncFrame: true }) {
    const v = NORMS_VIEWS.includes(view) ? view : "setup";
    normsView = v;
    paintNormsViewTabs();
    syncPanels();
    if (syncFrame) postViewToFrame();
  }

  function ingestCadetsPayload(data) {
    normsCadets = Array.isArray(data.cadets) ? data.cadets : [];
    renderNormsCadetsTable();
    const meta = $("normsMeta");
    if (meta) {
      const n = data.total != null ? Number(data.total) : normsCadets.length;
      meta.textContent = n ? " · " + n : "";
    }
  }

  function ensureNormsFrame() {
    const frame = $("normsEmbedFrame");
    if (!frame) return;
    if (frame.dataset.loaded === "1") {
      postFiltersToFrame();
      postViewToFrame();
      requestActiveViewData();
      return;
    }
    const src = frame.getAttribute("data-src") || "/tools/norms?embed=1";
    frame.dataset.loaded = "1";
    frame.addEventListener(
      "load",
      () => {
        postFiltersToFrame();
        postViewToFrame();
        requestActiveViewData();
      },
      { once: true }
    );
    frame.hidden = !!NATIVE_VIEWS[normsView];
    frame.src = src;
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
          syncPanels();
        }, 0);
      });
    }
    if (!mod.classList.contains("collapsed")) {
      ensureNormsFrame();
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

  if ($("filterNormsCadet") && !$("filterNormsCadet")._bound) {
    $("filterNormsCadet")._bound = true;
    $("filterNormsCadet").onchange = () => {
      ensureNormsFrame();
      postToNormsFrame({
        type: "lis-norms-set-cadet",
        id: $("filterNormsCadet").value,
        mode: ($("filterNormsCadMode") && $("filterNormsCadMode").value) || normsCadetMode
      });
    };
  }
  if ($("filterNormsCadMode") && !$("filterNormsCadMode")._bound) {
    $("filterNormsCadMode")._bound = true;
    $("filterNormsCadMode").onchange = () => {
      normsCadetMode = $("filterNormsCadMode").value === "all" ? "all" : "pass";
      ensureNormsFrame();
      postToNormsFrame({
        type: "lis-norms-set-cadet",
        id: ($("filterNormsCadet") && $("filterNormsCadet").value) || "",
        mode: normsCadetMode
      });
    };
  }

  if ($("normsExpAll") && !$("normsExpAll")._bound) {
    $("normsExpAll")._bound = true;
    $("normsExpAll").onchange = () => {
      ensureNormsFrame();
      requestExportFromFrame();
    };
  }
  if ($("btnNormsExport") && !$("btnNormsExport")._bound) {
    $("btnNormsExport")._bound = true;
    $("btnNormsExport").onclick = () => {
      ensureNormsFrame();
      setExportMsg("Формирую файл…");
      const all = !!($("normsExpAll") && $("normsExpAll").checked);
      if (
        !postToNormsFrame({
          type: "lis-norms-do-export",
          all
        })
      ) {
        setExportMsg("Модуль нормативов ещё загружается…", false);
      }
    };
  }

  const sumTable = $("normsSumTable");
  if (sumTable && !sumTable._bound) {
    sumTable._bound = true;
    sumTable.addEventListener("click", (e) => {
      const a = e.target.closest("[data-goto]");
      if (!a || !sumTable.contains(a)) return;
      e.preventDefault();
      const n = Number(a.getAttribute("data-goto"));
      if (!n) return;
      ensureNormsFrame();
      setNormsView("norm");
      postToNormsFrame({
        type: "lis-norms-set-norm",
        norm: n,
        sort: ($("filterNormsSort") && $("filterNormsSort").value) || "order"
      });
    });
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
      if ($("filterNormsCadet")) $("filterNormsCadet").value = id;
      postToNormsFrame({
        type: "lis-norms-set-cadet",
        id,
        mode: ($("filterNormsCadMode") && $("filterNormsCadMode").value) || normsCadetMode
      });
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
    if (data.type === "lis-norms-summary") {
      renderNormsSummary(data);
      return;
    }
    if (data.type === "lis-norms-cadet") {
      renderNormsCadet(data);
      return;
    }
    if (data.type === "lis-norms-export") {
      renderNormsExport(data);
      return;
    }
    if (data.type === "lis-norms-export-status") {
      setExportMsg(data.message || "", data.ok);
      if (data.canExport != null && $("btnNormsExport")) {
        $("btnNormsExport").disabled = !data.canExport;
      }
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
