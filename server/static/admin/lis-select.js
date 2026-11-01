/* Custom select: native OS popup cannot be restyled; mirror <select> with styled menu. */
(function () {
  /* Фон списка = RGB фона триггера, без прозрачности (alpha 1). */
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

  function dropdownBgFromTrigger(el) {
    try {
      const cssColor = getComputedStyle(el).backgroundColor;
      if (!cssColor || cssColor === "transparent") return "rgb(0,0,0)";
      const m = String(cssColor).match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i
      );
      if (!m) return "rgb(0,0,0)";
      return "rgb(" + m[1] + "," + m[2] + "," + m[3] + ")";
    } catch (e) {
      return "rgb(0,0,0)";
    }
  }

  window.lisDropdownBgFrom = dropdownBgFromTrigger;

  function closeAll(except) {
    document.querySelectorAll(".lis-select.open").forEach(w => {
      if (except && w === except) return;
      w.classList.remove("open");
      const menu = w.querySelector(".lis-select-menu");
      if (menu) menu.classList.add("hidden");
    });
  }

  function enhanceSelect(sel) {
    if (!sel || sel.tagName !== "SELECT" || sel.dataset.lisSelect === "1") return;
    if (sel.closest(".lis-select")) return;
    sel.dataset.lisSelect = "1";

    const wrap = document.createElement("div");
    wrap.className = "lis-select";
    if (sel.style.width === "100%" || sel.getAttribute("style") && /width:\s*100%/.test(sel.getAttribute("style"))) {
      wrap.classList.add("lis-select-block");
    }
    ["minWidth", "maxWidth", "width", "flex"].forEach(k => {
      if (sel.style[k]) wrap.style[k] = sel.style[k];
    });
    if (!wrap.style.minWidth && sel.getAttribute("style")) {
      const mm = sel.getAttribute("style").match(/min-width:\s*([^;]+)/i);
      if (mm) wrap.style.minWidth = mm[1].trim();
    }
    if (!wrap.style.maxWidth && sel.getAttribute("style")) {
      const mm = sel.getAttribute("style").match(/max-width:\s*([^;]+)/i);
      if (mm) wrap.style.maxWidth = mm[1].trim();
    }

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add("lis-select-native");
    sel.setAttribute("tabindex", "-1");
    sel.setAttribute("aria-hidden", "true");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "lis-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    if (sel.id) {
      trigger.id = sel.id + "__trigger";
      document.querySelectorAll('label[for="' + sel.id + '"]').forEach(lab => {
        lab.setAttribute("for", trigger.id);
      });
    }
    if (sel.disabled) trigger.disabled = true;
    if (sel.title) trigger.title = sel.title;

    const menu = document.createElement("div");
    menu.className = "lis-select-menu hidden";
    menu.setAttribute("role", "listbox");

    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    function syncDisabled() {
      trigger.disabled = !!sel.disabled;
      wrap.classList.toggle("is-disabled", !!sel.disabled);
    }

    function syncLabel() {
      const opt = sel.options[sel.selectedIndex];
      trigger.textContent = opt ? (opt.textContent || "") : "";
    }

    function rebuildMenu() {
      const frag = document.createDocumentFragment();
      Array.from(sel.options).forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lis-select-option" + (opt.selected ? " is-selected" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", opt.selected ? "true" : "false");
        if (opt.disabled) btn.disabled = true;
        btn.textContent = opt.textContent || "";
        btn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          if (opt.disabled) return;
          if (valueDesc && valueDesc.set) valueDesc.set.call(sel, opt.value);
          else sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          syncLabel();
          rebuildMenu();
          closeMenu();
        });
        frag.appendChild(btn);
      });
      menu.innerHTML = "";
      menu.appendChild(frag);
      syncLabel();
      syncDisabled();
    }

    function openMenu() {
      if (sel.disabled) return;
      closeAll(wrap);
      menu.style.backgroundColor = dropdownBgFromTrigger(trigger);
      menu.classList.remove("hidden");
      wrap.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      menu.classList.add("hidden");
      wrap.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      if (wrap.classList.contains("open")) closeMenu();
      else openMenu();
    });

    trigger.addEventListener("keydown", e => {
      if (e.key === "Escape") closeMenu();
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
    });

    sel.addEventListener("change", () => {
      syncLabel();
      rebuildMenu();
    });

    if (valueDesc && valueDesc.get && valueDesc.set) {
      Object.defineProperty(sel, "value", {
        configurable: true,
        enumerable: true,
        get() { return valueDesc.get.call(this); },
        set(v) {
          valueDesc.set.call(this, v);
          syncLabel();
          rebuildMenu();
        }
      });
    }

    const mo = new MutationObserver(() => rebuildMenu());
    mo.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });

    rebuildMenu();
  }

  function enhanceAllSelects(root) {
    (root || document).querySelectorAll("select").forEach(enhanceSelect);
  }

  window.enhanceSelect = enhanceSelect;
  window.enhanceAllSelects = enhanceAllSelects;

  function boot() {
    enhanceAllSelects(document);
    if (!document.body) return;
    const mo = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (!n || n.nodeType !== 1) return;
          if (n.matches && n.matches("select")) enhanceSelect(n);
          if (n.querySelectorAll) n.querySelectorAll("select").forEach(enhanceSelect);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", () => closeAll());
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeAll();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
