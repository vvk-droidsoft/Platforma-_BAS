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

  const META_FIELDS = {
    date: { type: "date", empty: "дата" },
    stream: { type: "text", empty: "не указан" },
    group: { type: "text", empty: "не указана" },
    takeoffTime: { type: "time", empty: "время" },
    aircraftType: { type: "text", empty: "не указан" },
    aircraftNo: { type: "text", empty: "не указан" },
    status: { type: "text", empty: "не указан" }
  };

  /** @type {{ id: string, flightNo: number, date: string, stream: string, group: string, takeoffTime: string, aircraftType: string, aircraftNo: string, status: string, rows: { npp: string, num: string, callsign: string, flightTime: string }[] }[]} */
  let takeoffs = [];
  let seq = 0;

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

  function displayMeta(key, value) {
    const conf = META_FIELDS[key];
    const v = String(value == null ? "" : value).trim();
    if (!v) return conf ? conf.empty : "—";
    if (key === "date") return formatDateRu(v) || conf.empty;
    return v;
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

  function metaCell(label, key, value, colspan) {
    const conf = META_FIELDS[key] || { type: "text", empty: "—" };
    const shown = displayMeta(key, value);
    const empty = !String(value == null ? "" : value).trim();
    const col = colspan ? ' colspan="' + colspan + '"' : "";
    return (
      "<th" +
      col +
      '><span class="fs-meta-label">' +
      esc(label) +
      '</span><button type="button" class="fs-meta-val' +
      (empty ? " is-empty" : "") +
      '" data-fs-meta="' +
      esc(key) +
      '" data-fs-type="' +
      esc(conf.type) +
      '" title="Нажмите, чтобы изменить">' +
      esc(shown) +
      "</button></th>"
    );
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
      metaCell("Дата", "date", t.date) +
      metaCell("Поток", "stream", t.stream, 2) +
      metaCell("Группа", "group", t.group, 2) +
      "</tr>" +
      '<tr class="fs-meta-row">' +
      '<th><span class="fs-meta-label">Номер вылета</span><strong class="fs-flight-no">' +
      esc(t.flightNo) +
      "</strong></th>" +
      metaCell("Время взлёта", "takeoffTime", t.takeoffTime) +
      metaCell("Тип борта", "aircraftType", t.aircraftType) +
      metaCell("Номер борта", "aircraftNo", t.aircraftNo) +
      metaCell("Статус", "status", t.status) +
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
      takeoffTime: nowTime(),
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

  function commitMetaEdit(input) {
    const card = input.closest(".fs-takeoff-card");
    if (!card) return;
    const t = findTakeoff(card.getAttribute("data-takeoff-id"));
    const key = input.getAttribute("data-fs-meta");
    if (!t || !key || !Object.prototype.hasOwnProperty.call(t, key)) return;
    let val = String(input.value || "").trim();
    if (key === "takeoffTime") {
      const m = /^(\d{1,2}):(\d{2})$/.exec(val);
      if (m) val = pad2(Math.min(23, parseInt(m[1], 10))) + ":" + pad2(Math.min(59, parseInt(m[2], 10)));
    }
    t[key] = val;
    renderAll();
  }

  function startMetaEdit(btn) {
    const card = btn.closest(".fs-takeoff-card");
    if (!card) return;
    const t = findTakeoff(card.getAttribute("data-takeoff-id"));
    const key = btn.getAttribute("data-fs-meta");
    const type = btn.getAttribute("data-fs-type") || "text";
    if (!t || !key) return;
    if (card.querySelector("input.fs-meta-edit")) return;

    const input = document.createElement("input");
    input.className = "fs-meta-edit";
    input.setAttribute("data-fs-meta", key);
    input.autocomplete = "off";
    if (type === "date") {
      input.type = "date";
      input.value = t.date || todayIso();
    } else if (type === "time") {
      input.type = "time";
      input.value = t.takeoffTime || nowTime();
    } else {
      input.type = "text";
      input.value = t[key] || "";
      input.placeholder = (META_FIELDS[key] && META_FIELDS[key].empty) || "";
    }
    btn.replaceWith(input);
    input.focus();
    if (input.type === "text") input.select();

    const finish = () => {
      input.removeEventListener("blur", finish);
      commitMetaEdit(input);
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
          const id = rm.getAttribute("data-fs-remove");
          takeoffs = takeoffs.filter((x) => x.id !== id);
          takeoffs.forEach((x, i) => {
            x.flightNo = i + 1;
          });
          seq = takeoffs.length;
          renderAll();
          return;
        }
        const metaBtn = e.target.closest(".fs-meta-val");
        if (metaBtn && list.contains(metaBtn)) {
          e.preventDefault();
          startMetaEdit(metaBtn);
        }
      });
    }
  }

  window.renderFlightTakeoffs = renderAll;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  setTimeout(bind, 300);
})();
