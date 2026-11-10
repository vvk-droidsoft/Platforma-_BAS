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

  /** @type {{ id: string, flightNo: number, date: string, stream: string, group: string, takeoffTime: string, aircraftType: string, aircraftNo: string, status: string, rows: { npp: string, num: string, callsign: string, flightTime: string }[] }[]} */
  let takeoffs = [];
  let seq = 0;

  function todayIso() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function updateMeta() {
    const meta = $("flightSheetMeta");
    if (!meta) return;
    meta.textContent = takeoffs.length ? " · " + takeoffs.length : "";
    const hint = $("flightSheetHint");
    if (hint) {
      hint.textContent = takeoffs.length
        ? "Таблиц «Взлёт»: " + takeoffs.length
        : "Нажмите «+», чтобы добавить таблицу «Взлёт»";
    }
  }

  function renderTakeoffCard(t) {
    const rowsHtml = (t.rows || [])
      .map((r, i) => {
        return (
          "<tr>" +
          '<td class="fs-npp">' +
          esc(r.npp || i + 1) +
          "</td>" +
          '<td><input type="text" data-fs-field="num" value="' +
          esc(r.num || "") +
          '" autocomplete="off"></td>' +
          '<td><input type="text" data-fs-field="callsign" value="' +
          esc(r.callsign || "") +
          '" autocomplete="off"></td>' +
          '<td><input type="text" data-fs-field="flightTime" placeholder="ч:мм" value="' +
          esc(r.flightTime || "") +
          '" autocomplete="off"></td>' +
          "<td></td>" +
          "</tr>"
        );
      })
      .join("");

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
      '<th><label>Дата <input type="date" data-fs-meta="date" value="' +
      esc(t.date || "") +
      '"></label></th>' +
      '<th colspan="2"><label>Поток <input type="text" data-fs-meta="stream" value="' +
      esc(t.stream || "") +
      '" autocomplete="off"></label></th>' +
      '<th colspan="2"><label>Группа <input type="text" data-fs-meta="group" value="' +
      esc(t.group || "") +
      '" autocomplete="off"></label></th>' +
      "</tr>" +
      '<tr class="fs-meta-row">' +
      '<th><span class="fs-meta-label">Номер вылета</span><strong class="fs-flight-no">' +
      esc(t.flightNo) +
      "</strong></th>" +
      '<th><label>Время взлёта <input type="text" data-fs-meta="takeoffTime" placeholder="ч:мм" value="' +
      esc(t.takeoffTime || "") +
      '" autocomplete="off"></label></th>' +
      '<th><label>Тип борта <input type="text" data-fs-meta="aircraftType" value="' +
      esc(t.aircraftType || "") +
      '" autocomplete="off"></label></th>' +
      '<th><label>Номер борта <input type="text" data-fs-meta="aircraftNo" value="' +
      esc(t.aircraftNo || "") +
      '" autocomplete="off"></label></th>' +
      '<th><label>Статус <input type="text" data-fs-meta="status" value="' +
      esc(t.status || "") +
      '" autocomplete="off"></label></th>' +
      "</tr>" +
      '<tr class="fs-col-head">' +
      "<th>№ п/п</th>" +
      "<th>Номер курсанта</th>" +
      "<th>Позывной</th>" +
      "<th>Время налёта</th>" +
      "<th></th>" +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      (rowsHtml ||
        '<tr><td colspan="5" class="hint">Строк пока нет — данные курсантов добавим дальше.</td></tr>') +
      "</tbody>" +
      "</table>" +
      "</div>" +
      "</article>"
    );
  }

  function renderAll() {
    const list = $("flightTakeoffList");
    if (!list) return;
    list.innerHTML = takeoffs.map(renderTakeoffCard).join("");
    updateMeta();
  }

  function addTakeoff() {
    seq += 1;
    takeoffs.push({
      id: "to-" + Date.now() + "-" + seq,
      flightNo: seq,
      date: todayIso(),
      stream: "",
      group: "",
      takeoffTime: "",
      aircraftType: "",
      aircraftNo: "",
      status: "",
      rows: []
    });
    renderAll();
  }

  function findTakeoff(id) {
    return takeoffs.find((t) => t.id === id);
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
        if (!rm || !list.contains(rm)) return;
        const id = rm.getAttribute("data-fs-remove");
        takeoffs = takeoffs.filter((t) => t.id !== id);
        // Номера вылетов по очереди заново
        takeoffs.forEach((t, i) => {
          t.flightNo = i + 1;
        });
        seq = takeoffs.length;
        renderAll();
      });
      list.addEventListener("input", (e) => {
        const card = e.target.closest(".fs-takeoff-card");
        if (!card || !list.contains(card)) return;
        const t = findTakeoff(card.getAttribute("data-takeoff-id"));
        if (!t) return;
        const meta = e.target.getAttribute("data-fs-meta");
        if (meta && Object.prototype.hasOwnProperty.call(t, meta)) {
          t[meta] = e.target.value;
        }
      });
      list.addEventListener("change", (e) => {
        const card = e.target.closest(".fs-takeoff-card");
        if (!card || !list.contains(card)) return;
        const t = findTakeoff(card.getAttribute("data-takeoff-id"));
        if (!t) return;
        const meta = e.target.getAttribute("data-fs-meta");
        if (meta && Object.prototype.hasOwnProperty.call(t, meta)) {
          t[meta] = e.target.value;
        }
      });
    }
  }

  // Совместимость со старым boot: loadFlightSheet остаётся no-op в library-файле.
  window.renderFlightTakeoffs = renderAll;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  setTimeout(bind, 300);
})();
