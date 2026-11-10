/* Списание утерянного борта — модалка + скачивание Word */
(function () {
  const state = {
    assetsUrl: "",
    onDone: null,
    assets: [],
    staff: [],
    group: {},
    canManage: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateInput(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function toTimeInput(d) {
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function setMsg(text, bad) {
    const el = $("writeoffMsg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      return;
    }
    el.innerHTML = bad
      ? '<span class="bad">' + esc(text) + "</span>"
      : '<span class="ok">' + esc(text) + "</span>";
  }

  function usableAssets() {
    return (state.assets || []).filter(a => (a.status || "") === "bg");
  }

  function uniqueTypes(list) {
    const seen = {};
    const out = [];
    list.forEach(a => {
      const t = a.board_type || "";
      if (!t || seen[t]) return;
      seen[t] = true;
      out.push(t);
    });
    out.sort((a, b) => a.localeCompare(b, "ru"));
    return out;
  }

  function fillSelect(sel, options, selected) {
    if (!sel) return;
    sel.innerHTML = options.map(o => {
      const val = o.value;
      const label = o.label;
      const selAttr = val === selected ? " selected" : "";
      return '<option value="' + esc(val) + '"' + selAttr + ">" + esc(label) + "</option>";
    }).join("");
  }

  function refreshBoardTypeOptions(keepType) {
    const list = usableAssets();
    const types = uniqueTypes(list);
    const typeSel = $("writeoffBoardType");
    const selected = keepType && types.indexOf(keepType) >= 0
      ? keepType
      : (types[0] || "");
    fillSelect(
      typeSel,
      [{ value: "", label: types.length ? "— выберите —" : "Нет бортов БГ" }].concat(
        types.map(t => ({ value: t, label: t }))
      ),
      selected
    );
    if (selected) typeSel.value = selected;
    refreshBoardNumOptions();
  }

  function refreshBoardNumOptions() {
    const type = ($("writeoffBoardType") && $("writeoffBoardType").value) || "";
    const list = usableAssets().filter(a => (a.board_type || "") === type);
    const numSel = $("writeoffBoardNum");
    const cur = numSel ? numSel.value : "";
    const opts = [{ value: "", label: list.length ? "— выберите —" : "—" }].concat(
      list.map(a => ({ value: a.id, label: a.board_num || a.id }))
    );
    const keep = opts.some(o => o.value === cur) ? cur : (opts[1] ? opts[1].value : "");
    fillSelect(numSel, opts, keep);
    if (numSel) numSel.value = keep;
  }

  function refreshStaffOptions() {
    const role = ($("writeoffRole") && $("writeoffRole").value) || "";
    const filtered = (state.staff || []).filter(s => (s.group_role || "") === role);
    const fioSel = $("writeoffFio");
    const cur = fioSel ? fioSel.value : "";
    let preferred = cur;
    if (!preferred || !filtered.some(s => s.id === preferred)) {
      preferred = filtered[0] ? filtered[0].id : "";
    }
    fillSelect(
      fioSel,
      [{ value: "", label: filtered.length ? "— выберите —" : "Нет сотрудников" }].concat(
        filtered.map(s => ({ value: s.id, label: s.fio || s.id }))
      ),
      preferred
    );
    if (fioSel) fioSel.value = preferred;
  }

  function applyDefaults() {
    const now = new Date();
    const event = new Date(now.getTime() - 30 * 60 * 1000);
    if ($("writeoffEventDate")) $("writeoffEventDate").value = toDateInput(event);
    if ($("writeoffEventTime")) $("writeoffEventTime").value = toTimeInput(event);
    if ($("writeoffSignDate")) $("writeoffSignDate").value = toDateInput(now);
    if ($("writeoffCoords")) $("writeoffCoords").value = "";
    if ($("writeoffNote")) $("writeoffNote").value = "";

    const poly = (state.group && state.group.polygon_name) || "";
    if ($("writeoffPolygon")) $("writeoffPolygon").textContent = poly || "—";

    const roles = [];
    const hasInst = (state.staff || []).some(s => s.group_role === "instructor");
    const hasAsst = (state.staff || []).some(s => s.group_role === "assistant");
    if (hasInst) roles.push({ value: "instructor", label: "Инструктор" });
    if (hasAsst) roles.push({ value: "assistant", label: "Ассистент инструктора" });
    const roleSel = $("writeoffRole");
    fillSelect(roleSel, roles.length ? roles : [{ value: "", label: "Нет роли" }], roles[0] ? roles[0].value : "");
    if (roleSel && roles[0]) roleSel.value = roles[0].value;

    refreshBoardTypeOptions("");
    refreshStaffOptions();
  }

  function closeWriteOffModal() {
    const modal = $("writeoffModal");
    if (modal) modal.classList.add("hidden");
    setMsg("");
    state.onDone = null;
  }

  async function openWriteOffModal(opts) {
    opts = opts || {};
    state.assetsUrl = opts.assetsUrl || "";
    state.onDone = typeof opts.onDone === "function" ? opts.onDone : null;
    if (!state.assetsUrl) {
      throw new Error("Не указан адрес имущества группы");
    }
    setMsg("Загрузка…");
    const modal = $("writeoffModal");
    if (modal) modal.classList.remove("hidden");
    const data = await api(state.assetsUrl);
    state.assets = data.assets || [];
    state.staff = data.staff || [];
    state.group = data.group || {};
    state.canManage = !!data.can_manage;
    if (!state.canManage) {
      closeWriteOffModal();
      throw new Error("Нет прав на списание в этой группе");
    }
    if (!usableAssets().length) {
      closeWriteOffModal();
      throw new Error("Нет бортов со статусом БГ для списания");
    }
    if (!state.staff.length) {
      closeWriteOffModal();
      throw new Error("В группе нет инструктора/ассистента");
    }
    applyDefaults();
    setMsg("");
  }

  async function submitWriteOff() {
    const assetId = ($("writeoffBoardNum") && $("writeoffBoardNum").value) || "";
    const staffId = ($("writeoffFio") && $("writeoffFio").value) || "";
    const coords = ($("writeoffCoords") && $("writeoffCoords").value) || "";
    const eventDate = ($("writeoffEventDate") && $("writeoffEventDate").value) || "";
    const eventTime = ($("writeoffEventTime") && $("writeoffEventTime").value) || "";
    const signDate = ($("writeoffSignDate") && $("writeoffSignDate").value) || "";
    const note = ($("writeoffNote") && $("writeoffNote").value) || "";
    if (!assetId) {
      setMsg("Выберите бортовой номер", true);
      return;
    }
    if (!staffId) {
      setMsg("Выберите ФИО", true);
      return;
    }
    if (!coords.trim()) {
      setMsg("Укажите координаты", true);
      return;
    }
    setMsg("Формирование акта…");
    const btn = $("btnWriteoffSubmit");
    if (btn) btn.disabled = true;
    try {
      const headers = { "Content-Type": "application/json" };
      if (typeof token !== "undefined" && token) headers.Authorization = "Bearer " + token;
      const r = await fetch("/api/admin/assets/write-off", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          asset_id: assetId,
          staff_id: staffId,
          coords: coords.trim(),
          event_date: eventDate,
          event_time: eventTime,
          sign_date: signDate,
          note: note.trim()
        })
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(
          typeof data.detail === "string" ? data.detail : (data.message || ("Ошибка " + r.status))
        );
      }
      const blob = await r.blob();
      let filename = "poterya_borta.docx";
      const cd = r.headers.get("Content-Disposition") || "";
      const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
      const mAscii = /filename\s*=\s*"([^"]+)"/i.exec(cd);
      if (mStar) {
        try { filename = decodeURIComponent(mStar[1]); } catch (_) { filename = mStar[1]; }
      } else if (mAscii) {
        filename = mAscii[1];
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      closeWriteOffModal();
      if (state.onDone) {
        try { await state.onDone(); } catch (_) {}
      }
    } catch (err) {
      setMsg(err.message || String(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.openWriteOffModal = openWriteOffModal;
  window.closeWriteOffModal = closeWriteOffModal;

  function bindWriteOffUi() {
    if ($("btnWriteoffClose")) $("btnWriteoffClose").onclick = () => closeWriteOffModal();
    if ($("btnWriteoffCancel")) $("btnWriteoffCancel").onclick = () => closeWriteOffModal();
    if ($("btnWriteoffSubmit")) $("btnWriteoffSubmit").onclick = () => submitWriteOff();
    if ($("writeoffModal")) {
      $("writeoffModal").addEventListener("click", e => {
        if (e.target === $("writeoffModal")) closeWriteOffModal();
      });
    }
    if ($("writeoffBoardType")) {
      $("writeoffBoardType").addEventListener("change", () => refreshBoardNumOptions());
    }
    if ($("writeoffRole")) {
      $("writeoffRole").addEventListener("change", () => refreshStaffOptions());
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindWriteOffUi);
  } else {
    bindWriteOffUi();
  }
})();
