(function () {
  const STATE = {
    universe: "company",
    meta: null,
    rows: [],
    summary: null,
    view: [],
    selected: null,
    sortKey: "coverage",
    sortDir: 1,
    covFilter: "all",
    search: "",
    colWidths: {},
    colFilters: {},
    openFilter: null,
    openPicker: null,
    openGroups: {},
    booted: false,
  };

  const COLS = [
    { key: "name", title: "Карточка" },
    { key: "mop", title: "Отв. за компанию" },
    { key: "contact_responsibles", title: "Отв. по контактам" },
    { key: "rfm", title: "RFM" },
    { key: "coverage_title", title: "Проработка" },
    { key: "event_types", title: "Тип" },
    { key: "last_subject", title: "Тема / суть" },
    { key: "events_count", title: "Дел" },
    { key: "has_planned", title: "План" },
    { key: "has_overdue", title: "Просроч." },
    { key: "has_deal", title: "Сделка" },
    { key: "deal_links", title: "Открытые сделки" },
    { key: "has_sp", title: "СП" },
    { key: "sp_links", title: "Открытые СП" },
    { key: "list_label", title: "Список обзвона" },
  ];
  const COL_DEFAULT_W = {
    name: 220, mop: 140, contact_responsibles: 160, rfm: 90, coverage_title: 120, event_types: 160,
    last_subject: 220, events_count: 64, has_planned: 64, has_overdue: 72,
    has_deal: 72, deal_links: 160, has_sp: 56, sp_links: 160, list_label: 170,
  };
  const MULTI_FILTER_COLS = { event_types: true, contact_responsibles: true };
  const EVENT_TYPE_ORDER = [
    "Открытая сделка", "Открытое СП", "Звонок", "Встреча", "Zoom",
    "Открытая линия", "Живой контакт", "Письмо", "Комментарий", "Дело", "Задача",
  ];

  function $(id) {
    return document.getElementById(id);
  }
  function must(id) {
    const el = $(id);
    if (!el) throw new Error("Нет элемента #" + id);
    return el;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showMsg(text, ok) {
    const msg = $("cov-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = text ? ("msg show " + (ok ? "ok" : "err")) : "msg";
  }
  function monthBounds() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    function iso(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }
    return { from: iso(from), to: iso(now) };
  }
  function checks(root, name, items, checkedIds) {
    if (!root) return;
    const list = items || [];
    const all = !(checkedIds && checkedIds.length);
    const set = {};
    (checkedIds || []).forEach(function (id) { set[String(id)] = true; });
    if (!list.length) {
      root.innerHTML = "<p class='empty'>Нет значений в складе</p>";
      return;
    }
    root.innerHTML = list.map(function (item) {
      const on = all || set[String(item.id)];
      const meta = item.cards != null ? " <span class=\"meta\">· " + item.cards + "</span>" : "";
      return "<label><input type=\"checkbox\" name=\"" + name + "\" value=\"" +
        escapeHtml(item.id) + "\"" + (on ? " checked" : "") + " /> " +
        escapeHtml(item.title) + meta + "</label>";
    }).join("");
  }
  function pickerStore(name) {
    return document.querySelector(".cov-picker-store[data-name=\"" + name + "\"]");
  }
  function pickerSummaryFromList(list, all, set) {
    const total = list.length;
    if (!total) return "—";
    if (all) return "Все · " + total;
    const picked = list.filter(function (item) { return set[String(item.id)]; });
    if (picked.length === total) return "Все · " + total;
    if (!picked.length) return "Ничего не выбрано";
    if (picked.length <= 2) return picked.map(function (item) { return item.title; }).join(", ");
    return picked.length + " из " + total;
  }
  function pickerSummaryText(name) {
    const inputs = document.querySelectorAll("input[name=\"" + name + "\"]");
    const total = inputs.length;
    if (!total) return "—";
    const picked = [];
    inputs.forEach(function (inp) {
      if (!inp.checked) return;
      const label = inp.closest("label");
      const textEl = label ? label.querySelector("span") : null;
      picked.push(textEl ? textEl.textContent.replace(/\s+/g, " ").trim() : inp.value);
    });
    if (picked.length === total) return "Все · " + total;
    if (!picked.length) return "Ничего не выбрано";
    if (picked.length <= 2) return picked.join(", ");
    return picked.length + " из " + total;
  }
  function updatePickerSummary(name) {
    document.querySelectorAll(".cov-picker[data-name=\"" + name + "\"] .cov-picker-summary").forEach(function (el) {
      el.textContent = pickerSummaryText(name);
    });
    const btn = document.querySelector(".cov-picker[data-name=\"" + name + "\"] .cov-picker-btn");
    if (btn) btn.classList.toggle("cov-picker-btn-empty", pickerSummaryText(name) === "Ничего не выбрано");
  }
  function updatePickerLabels() {
    document.querySelectorAll(".cov-picker-host").forEach(function (host) {
      const name = host.getAttribute("data-name");
      const label = host.getAttribute("data-label") || name;
      const el = host.querySelector(".cov-picker-label");
      if (el) el.textContent = label;
    });
  }
  function mountPicker(host, name, items, checkedIds) {
    if (!host) return;
    const list = items || [];
    const label = host.getAttribute("data-label") || name;
    host.setAttribute("data-name", name);
    if (!list.length) {
      host.innerHTML = "<p class=\"empty\">Нет значений</p>";
      return;
    }
    const all = !(checkedIds && checkedIds.length);
    const set = {};
    (checkedIds || []).forEach(function (id) { set[String(id)] = true; });
    const storeHtml = list.map(function (item) {
      const on = all || set[String(item.id)];
      const meta = item.cards != null ? " <span class=\"meta\">" + item.cards + "</span>" : "";
      return "<label><input type=\"checkbox\" name=\"" + escapeHtml(name) + "\" value=\"" +
        escapeHtml(item.id) + "\"" + (on ? " checked" : "") + " /> " +
        "<span>" + escapeHtml(item.title) + meta + "</span></label>";
    }).join("");
    host.innerHTML =
      "<div class=\"cov-picker\" data-name=\"" + escapeHtml(name) + "\">" +
      "<button type=\"button\" class=\"cov-picker-btn\" aria-haspopup=\"listbox\">" +
      "<span class=\"cov-picker-label\">" + escapeHtml(label) + "</span>" +
      "<span class=\"cov-picker-summary\">" + escapeHtml(pickerSummaryFromList(list, all, set)) + "</span>" +
      "<span class=\"cov-picker-chev\">▾</span></button>" +
      "<div class=\"cov-picker-store\" data-name=\"" + escapeHtml(name) + "\" hidden>" + storeHtml + "</div></div>";
    const btn = host.querySelector(".cov-picker-btn");
    if (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPickerPop(name, btn);
      });
    }
    updatePickerSummary(name);
  }
  function closePickerPop() {
    STATE.openPicker = null;
    const pop = $("cov-picker-pop");
    if (pop) pop.hidden = true;
    document.querySelectorAll(".cov-picker-btn.on").forEach(function (btn) {
      btn.classList.remove("on");
    });
  }
  function openPickerPop(name, anchor) {
    const store = pickerStore(name);
    if (!store) return;
    if (STATE.openPicker === name) {
      closePickerPop();
      return;
    }
    closeColFilter();
    let pop = $("cov-picker-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "cov-picker-pop";
      pop.className = "cov-picker-pop";
      document.body.appendChild(pop);
    }
    STATE.openPicker = name;
    anchor.classList.add("on");
    const title = anchor.querySelector(".cov-picker-label");
    pop.hidden = false;
    pop.innerHTML =
      "<div class=\"cov-picker-pop-head\">" + escapeHtml(title ? title.textContent : name) + "</div>" +
      "<input type=\"search\" class=\"cov-picker-pop-q\" placeholder=\"Поиск…\" />" +
      "<div class=\"cov-picker-pop-actions\">" +
      "<button type=\"button\" data-act=\"all\">Все</button>" +
      "<button type=\"button\" data-act=\"none\">Сбросить</button>" +
      "<button type=\"button\" data-act=\"done\" class=\"primary\">Готово</button></div>" +
      "<div class=\"cov-picker-pop-list\">" + store.innerHTML + "</div>";
    const listEl = pop.querySelector(".cov-picker-pop-list");
    listEl.querySelectorAll("input").forEach(function (inp, idx) {
      const src = store.querySelectorAll("input")[idx];
      if (src) inp.checked = src.checked;
      // копия в окне не должна считаться вторым набором галок: иначе «Все · 8» вместо «Все · 4»
      inp.removeAttribute("name");
    });
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    pop.style.width = width + "px";
    pop.style.left = left + "px";
    pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 320) + "px";
    const q = pop.querySelector(".cov-picker-pop-q");
    if (q) {
      q.addEventListener("input", function () {
        const needle = q.value.trim().toLowerCase();
        listEl.querySelectorAll("label").forEach(function (lab) {
          const text = (lab.textContent || "").toLowerCase();
          lab.style.display = !needle || text.indexOf(needle) >= 0 ? "" : "none";
        });
      });
      setTimeout(function () { q.focus(); }, 0);
    }
    pop.onclick = function (e) {
      e.stopPropagation();
      const btn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "all") {
        listEl.querySelectorAll("label").forEach(function (lab) {
          if (lab.style.display === "none") return;
          const inp = lab.querySelector("input");
          if (inp) inp.checked = true;
        });
        return;
      }
      if (act === "none") {
        listEl.querySelectorAll("input").forEach(function (inp) {
          if (inp.closest("label").style.display === "none") return;
          inp.checked = false;
        });
        return;
      }
      if (act === "done") {
        listEl.querySelectorAll("input").forEach(function (inp, idx) {
          const src = store.querySelectorAll("input")[idx];
          if (src) src.checked = inp.checked;
        });
        updatePickerSummary(name);
        closePickerPop();
      }
    };
  }
  function selected(name) {
    return Array.prototype.slice.call(document.querySelectorAll("input[name=\"" + name + "\"]:checked"))
      .map(function (el) { return el.value; });
  }
  function setChecks(name, ids) {
    const set = {};
    (ids || []).forEach(function (id) { set[String(id)] = true; });
    document.querySelectorAll("input[name=\"" + name + "\"]").forEach(function (el) {
      el.checked = !!set[el.value];
    });
    updatePickerSummary(name);
  }
  function checkAll(name, on) {
    document.querySelectorAll("input[name=\"" + name + "\"]").forEach(function (el) {
      el.checked = on;
    });
    updatePickerSummary(name);
  }
  function fillPresets() {
    const select = $("cov-preset");
    if (!select || !STATE.meta) return;
    const current = select.value;
    const builtin = (STATE.meta.presets || []).filter(function (p) {
      return p.universe === STATE.universe;
    });
    const user = (STATE.meta.user_presets || []).filter(function (p) {
      return p.universe === STATE.universe;
    });
    let html = "<option value=\"\">Без пресета</option>";
    if (builtin.length) {
      html += "<optgroup label=\"Встроенные\">" + builtin.map(function (p) {
        return "<option value=\"" + escapeHtml(p.id) + "\">" + escapeHtml(p.title) + "</option>";
      }).join("") + "</optgroup>";
    }
    if (user.length) {
      html += "<optgroup label=\"Мои срезы\">" + user.map(function (p) {
        return "<option value=\"" + escapeHtml(p.id) + "\">" + escapeHtml(p.title) + "</option>";
      }).join("") + "</optgroup>";
    }
    select.innerHTML = html;
    const valid = Array.prototype.some.call(select.options, function (o) { return o.value === current; });
    select.value = valid ? current : "";
    syncPresetActions();
  }
  function findUserPreset(id) {
    return (STATE.meta && STATE.meta.user_presets || []).filter(function (p) {
      return p.id === id;
    })[0] || null;
  }
  function syncPresetActions() {
    const select = $("cov-preset");
    const del = $("cov-preset-delete");
    if (!del || !select) return;
    const id = select.value || "";
    del.hidden = !id.startsWith("user:");
  }
  function restorePicker(name, ids) {
    const inputs = document.querySelectorAll("input[name=\"" + name + "\"]");
    const total = inputs.length;
    if (!total) return;
    const list = ids || [];
    if (!list.length) {
      checkAll(name, false);
      return;
    }
    if (list.length >= total) {
      checkAll(name, true);
      return;
    }
    setChecks(name, list);
  }
  function applyUserPreset(preset) {
    if (!preset) return;
    setUniverse(preset.universe || "company", false);
    if ($("cov-period-from")) $("cov-period-from").value = preset.period_from || "";
    if ($("cov-period-to")) $("cov-period-to").value = preset.period_to || "";
    if ($("cov-created-from")) $("cov-created-from").value = preset.created_from || "";
    if ($("cov-created-to")) $("cov-created-to").value = preset.created_to || "";
    restorePicker("cov-company-mop", preset.mop_ids);
    restorePicker("cov-other-mop", preset.other_assignee_ids);
    restorePicker("cov-activity-mop", preset.activity_mop_ids);
    restorePicker("cov-planned", preset.planned);
    restorePicker("cov-rfm", preset.rfm);
    restorePicker("cov-work", preset.work_status);
    restorePicker("cov-type", preset.client_type);
    restorePicker("cov-dir", preset.direction);
    restorePicker("cov-lead-sem", preset.lead_semantic);
    setUniverse(STATE.universe);
  }
  function applySelectedPreset(id) {
    if (!id) {
      applyPreset("");
      return;
    }
    if (id.indexOf("user:") === 0) {
      applyUserPreset(findUserPreset(id));
      return;
    }
    applyPreset(id);
  }
  function contactMopColTitle(universe) {
    if (universe === "contact") return "Отв. в делах";
    return "Отв. по контактам";
  }
  function cardMopCopy(universe) {
    if (universe === "lead") {
      return {
        label: "Ответственный за лид",
        hint: "Кого берём в срез лидов (ASSIGNED лида).",
        col: "Отв. за лид",
        detail: "Отв. за лид",
      };
    }
    if (universe === "contact") {
      return {
        label: "Ответственный за контакт",
        hint: "Кого берём в срез контактов (ASSIGNED контакта).",
        col: "Отв. за контакт",
        detail: "Отв. за контакт",
      };
    }
    return {
      label: "Ответственный за компанию",
      hint: "Кого берём в срез компаний (ASSIGNED компании).",
      col: "Отв. за компанию",
      detail: "Отв. за компанию",
    };
  }
  function setUniverse(universe, syncUi) {
    STATE.universe = universe || "company";
    if (syncUi !== false) {
      document.querySelectorAll("#cov-universe .sub-pill").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-universe") === STATE.universe);
      });
    }
    const listRow = $("cov-list-row");
    const listOk = STATE.universe === "company" || STATE.universe === "contact";
    if (listRow) listRow.hidden = !listOk;
    if (!listOk && $("cov-list") && $("cov-list").value) {
      $("cov-list").value = "";
      onCallListChange();
    }
    const company = $("cov-company-fields");
    const lead = $("cov-lead-fields");
    if (company) company.hidden = STATE.universe !== "company";
    if (lead) lead.hidden = STATE.universe !== "lead";
    const copy = cardMopCopy(STATE.universe);
    const companyHost = $("cov-mops-company");
    if (companyHost) companyHost.setAttribute("data-label", copy.label);
    updatePickerLabels();
    const mopCol = COLS.filter(function (c) { return c.key === "mop"; })[0];
    if (mopCol) mopCol.title = copy.col;
    const contactCol = COLS.filter(function (c) { return c.key === "contact_responsibles"; })[0];
    if (contactCol) contactCol.title = contactMopColTitle(STATE.universe);
    fillPresets();
  }
  function applyPreset(id) {
    const enums = (STATE.meta && STATE.meta.enums) || {};
    if (!id) {
      checkAll("cov-company-mop", true);
      checkAll("cov-other-mop", true);
      checkAll("cov-activity-mop", true);
      checkAll("cov-planned", true);
      checkAll("cov-rfm", true);
      checkAll("cov-work", true);
      checkAll("cov-type", true);
      checkAll("cov-dir", true);
      checkAll("cov-lead-sem", true);
      return;
    }
    if (id === "rfm_work") {
      setUniverse("company");
      checkAll("cov-company-mop", true);
      checkAll("cov-other-mop", true);
      checkAll("cov-activity-mop", true);
      checkAll("cov-planned", true);
      checkAll("cov-work", true);
      checkAll("cov-type", true);
      checkAll("cov-dir", true);
      setChecks("cov-rfm", (enums.rfm || []).map(function (x) { return x.id; })
        .filter(function (x) { return x !== "8538" && x !== "9026"; }));
    } else if (id === "no_purchases") {
      setUniverse("company");
      checkAll("cov-company-mop", true);
      checkAll("cov-other-mop", true);
      checkAll("cov-activity-mop", true);
      checkAll("cov-planned", true);
      checkAll("cov-work", true);
      checkAll("cov-type", true);
      checkAll("cov-dir", true);
      setChecks("cov-rfm", ["9026"]);
    } else if (id === "leads_open") {
      setUniverse("lead");
      checkAll("cov-company-mop", true);
      checkAll("cov-other-mop", true);
      checkAll("cov-activity-mop", true);
      checkAll("cov-planned", true);
      setChecks("cov-lead-sem", ["P"]);
    } else if (id === "contacts_solo") {
      setUniverse("contact");
      checkAll("cov-company-mop", true);
      checkAll("cov-other-mop", true);
      checkAll("cov-activity-mop", true);
      checkAll("cov-planned", true);
    }
  }
  function payload() {
    return {
      universe: STATE.universe,
      preset: "",
      period_from: must("cov-period-from").value || null,
      period_to: must("cov-period-to").value || null,
      created_from: ($("cov-created-from") && $("cov-created-from").value) || null,
      created_to: ($("cov-created-to") && $("cov-created-to").value) || null,
      rfm: selected("cov-rfm"),
      work_status: selected("cov-work"),
      client_type: selected("cov-type"),
      direction: selected("cov-dir"),
      lead_semantic: selected("cov-lead-sem"),
      mop_ids: selected("cov-company-mop"),
      other_assignee_ids: selected("cov-other-mop"),
      activity_mop_ids: selected("cov-activity-mop"),
      planned: selected("cov-planned"),
      call_list: callListPayload(),
    };
  }
  function allChecked(name) {
    const boxes = document.querySelectorAll("input[name=\"" + name + "\"]");
    return !boxes.length || Array.prototype.every.call(boxes, function (el) { return el.checked; });
  }
  function callListPayload() {
    const sel = $("cov-list");
    if (!sel || !sel.value || (STATE.universe !== "company" && STATE.universe !== "contact")) return null;
    return {
      id: sel.value,
      mode: must("cov-list-mode").value,
      managers: allChecked("cov-list-mgr") ? [] : selected("cov-list-mgr"),
      priorities: allChecked("cov-list-prio") ? [] : selected("cov-list-prio"),
    };
  }
  function fillCallLists(items) {
    const sel = $("cov-list");
    if (!sel) return;
    const prev = sel.value;
    STATE.meta.call_lists = items || [];
    sel.innerHTML = "<option value=\"\">— не отбирать —</option>" + (items || []).map(function (it) {
      return "<option value=\"" + escapeHtml(it.id) + "\">" + escapeHtml(it.title) + "</option>";
    }).join("");
    sel.value = (items || []).some(function (it) { return it.id === prev; }) ? prev : "";
  }
  async function onCallListChange() {
    const sel = must("cov-list");
    const on = !!sel.value;
    must("cov-list-mode-field").hidden = !on;
    must("cov-list-filters").hidden = !on;
    if (!on) return;
    const item = ((STATE.meta && STATE.meta.call_lists) || []).filter(function (it) { return it.id === sel.value; })[0];
    if (item && item.issued && $("cov-period-from")) {
      // касания считаем с даты выдачи списка — иначе старые звонки зачтутся как работа по нему
      $("cov-period-from").value = item.issued;
      if ($("cov-period-to")) $("cov-period-to").value = monthBounds().to || $("cov-period-to").value;
    }
    try {
      const res = await window.rtlFetch("api/coverage/call-lists/" + encodeURIComponent(sel.value) + "/options");
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "не загрузились менеджеры списка");
      mountPicker($("cov-list-mgr"), "cov-list-mgr", (body.managers || []).map(function (m) { return { id: m, title: m }; }));
      mountPicker($("cov-list-prio"), "cov-list-prio", (body.priorities || []).map(function (m) { return { id: m, title: m }; }));
    } catch (err) {
      showMsg("Список обзвона: " + ((err && err.message) || err), false);
    }
  }
  function labelListRows(rows, summary) {
    const withList = !!(summary && summary.call_list);
    rows.forEach(function (row) {
      row.list_label = !withList ? "" : (row.in_list
        ? ((row.list_priority || "в списке") + (row.list_manager ? " · " + row.list_manager.split(" ")[0] : ""))
        : "вне списка");
    });
  }
  function badge(row) {
    const cls = row.coverage === "touched" ? "ok"
      : row.coverage === "partial" ? "partial"
      : "bad";
    return "<span class=\"cov-badge " + cls + "\">" + escapeHtml(row.coverage_title) + "</span>";
  }
  function linkList(items) {
    const list = items || [];
    if (!list.length) return "—";
    return list.map(function (link) {
      return "<a class=\"file-link\" href=\"" + escapeHtml(link.url) +
        "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(link.title || link.id) + "</a>";
    }).join("<br>");
  }
  function matchesCovFilter(row) {
    const f = STATE.covFilter;
    if (f === "all") return true;
    if (f === "touched" || f === "partial" || f === "none") return row.coverage === f;
    if (f === "email") {
      return row.coverage === "partial" && (row.emails || 0) > 0 &&
        !(row.weak_calls || 0) && !(row.comments_count || 0);
    }
    return true;
  }
  function sortValue(row, key) {
    if (key === "coverage" || key === "coverage_title") {
      return ({ none: 0, partial: 1, touched: 2 })[row.coverage] || 9;
    }
    if (key === "has_deal" || key === "has_sp" || key === "has_planned" || key === "has_overdue") return row[key] ? 1 : 0;
    if (key === "deal_links" || key === "sp_links") return (row[key] || []).length;
    if (key === "events_count") return row.events_count || (row.events || []).length || 0;
    if (key === "event_types") return String(row.event_types || row.last_kind || "").toLowerCase();
    if (key === "contact_responsibles") return String(row.contact_responsibles || "").toLowerCase();
    return String(row[key] == null ? "" : row[key]).toLowerCase();
  }
  function cellFilterText(row, key) {
    if (key === "has_deal" || key === "has_sp" || key === "has_planned" || key === "has_overdue") {
      return row[key] ? "да" : "нет";
    }
    if (key === "deal_links" || key === "sp_links") {
      const list = row[key] || [];
      if (!list.length) return "нет";
      return list.map(function (l) { return l.title || l.id; }).join("; ");
    }
    if (key === "events_count") {
      return String(row.events_count || (row.events || []).length || 0);
    }
    if (key === "event_types") {
      return String(row.event_types || row.last_kind || "—");
    }
    if (key === "contact_responsibles") {
      return String(row.contact_responsibles || "—");
    }
    if (key === "last_subject") {
      return String(row.last_subject || row.last_text || "—");
    }
    if (key === "coverage_title") return String(row.coverage_title || "");
    const raw = row[key];
    const text = String(raw == null || raw === "" ? "—" : raw);
    return text;
  }
  function colFilterActive(key) {
    return Object.prototype.hasOwnProperty.call(STATE.colFilters, key);
  }
  function splitFilterTokens(text) {
    return String(text || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== "—"; });
  }
  function cellFilterTokens(row, key) {
    return splitFilterTokens(cellFilterText(row, key));
  }
  function rowMatchesColFilter(row, key, allowed) {
    if (!allowed.length) return false;
    if (MULTI_FILTER_COLS[key]) {
      const tokens = cellFilterTokens(row, key);
      if (!tokens.length) return false;
      return allowed.some(function (v) { return tokens.indexOf(v) >= 0; });
    }
    return allowed.indexOf(cellFilterText(row, key)) >= 0;
  }
  function sortMultiFilterValues(key, list) {
    if (key === "event_types") {
      return list.slice().sort(function (a, b) {
        const ia = EVENT_TYPE_ORDER.indexOf(a);
        const ib = EVENT_TYPE_ORDER.indexOf(b);
        const ka = ia >= 0 ? ia : EVENT_TYPE_ORDER.length;
        const kb = ib >= 0 ? ib : EVENT_TYPE_ORDER.length;
        if (ka !== kb) return ka - kb;
        return String(a).localeCompare(String(b), "ru", { numeric: true });
      });
    }
    return list.slice().sort(function (a, b) {
      return String(a).localeCompare(String(b), "ru", { numeric: true });
    });
  }
  function hasColFilters() {
    return Object.keys(STATE.colFilters).some(function (k) {
      return colFilterActive(k);
    });
  }
  function baseFilteredRows() {
    const q = (STATE.search || "").trim().toLowerCase();
    let rows = STATE.rows.slice();
    if (STATE.covFilter !== "all") {
      rows = rows.filter(matchesCovFilter);
    }
    if (q) {
      rows = rows.filter(function (r) {
        const eventBlob = (r.events || []).map(function (e) {
          return [e.label, e.subject, e.text, e.mop, e.author, e.duration, e.call_status, e.status, e.direction].join(" ");
        }).join(" ");
        return [r.name, r.mop, r.contact_responsibles, r.rfm, r.work_status, r.client_type, r.direction,
          r.coverage_title, r.event_types, r.last_kind, r.last_subject, r.last_text, eventBlob]
          .join(" ").toLowerCase().indexOf(q) >= 0;
      });
    }
    return rows;
  }
  function applyColFilters(rows, skipKey) {
    return rows.filter(function (r) {
      for (let i = 0; i < COLS.length; i++) {
        const key = COLS[i].key;
        if (skipKey && key === skipKey) continue;
        if (!colFilterActive(key)) continue;
        const allowed = STATE.colFilters[key];
        if (!rowMatchesColFilter(r, key, allowed)) return false;
      }
      return true;
    });
  }
  function uniqueColValues(key) {
    const rows = applyColFilters(baseFilteredRows(), key);
    if (MULTI_FILTER_COLS[key]) {
      const seen = {};
      const out = [];
      rows.forEach(function (r) {
        cellFilterTokens(r, key).forEach(function (v) {
          if (seen[v]) return;
          seen[v] = true;
          out.push(v);
        });
      });
      return sortMultiFilterValues(key, out);
    }
    const seen = {};
    const out = [];
    rows.forEach(function (r) {
      const v = cellFilterText(r, key);
      if (seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort(function (a, b) {
      return String(a).localeCompare(String(b), "ru", { numeric: true });
    });
    return out;
  }
  function visibleRows() {
    let rows = applyColFilters(baseFilteredRows());
    const dir = STATE.sortDir;
    const key = STATE.sortKey;
    rows.sort(function (a, b) {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return String(a.name || "").localeCompare(String(b.name || ""), "ru") * dir;
    });
    return rows;
  }
  function closeColFilter() {
    STATE.openFilter = null;
    const pop = $("cov-col-filter-pop");
    if (pop) pop.hidden = true;
  }
  function openColFilter(key, anchor) {
    let pop = $("cov-col-filter-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "cov-col-filter-pop";
      pop.className = "cov-col-filter-pop";
      document.body.appendChild(pop);
    }
    STATE.openFilter = key;
    const values = uniqueColValues(key);
    const hasFilter = colFilterActive(key);
    const selected = hasFilter ? (STATE.colFilters[key] || []) : null;
    const allOn = !hasFilter;
    const set = {};
    (selected || []).forEach(function (v) { set[v] = true; });
    pop.hidden = false;
    pop.innerHTML =
      "<div class=\"cov-col-filter-head\">Фильтр: " + escapeHtml(
        (COLS.filter(function (c) { return c.key === key; })[0] || {}).title || key
      ) + "</div>" +
      "<input type=\"search\" class=\"cov-col-filter-q\" placeholder=\"Найти значение…\" />" +
      "<div class=\"cov-col-filter-actions\">" +
      "<button type=\"button\" data-act=\"all\">Выделить все</button>" +
      "<button type=\"button\" data-act=\"clear\">Снять все</button>" +
      "<button type=\"button\" data-act=\"none\">Сбросить</button>" +
      "<button type=\"button\" data-act=\"apply\" class=\"primary\">Ок</button></div>" +
      "<div class=\"cov-col-filter-list\">" +
      (values.length ? values.map(function (v) {
        const on = allOn || set[v];
        return "<label><input type=\"checkbox\" value=\"" + escapeHtml(v) + "\"" +
          (on ? " checked" : "") + " /> <span>" + escapeHtml(v) + "</span></label>";
      }).join("") : "<p class=\"hint\" style=\"margin:8px\">Нет значений</p>") +
      "</div>";
    const rect = anchor.getBoundingClientRect();
    const width = 280;
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    pop.style.left = left + "px";
    pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 320) + "px";
    const q = pop.querySelector(".cov-col-filter-q");
    if (q) {
      q.addEventListener("input", function () {
        const needle = q.value.trim().toLowerCase();
        pop.querySelectorAll(".cov-col-filter-list label").forEach(function (lab) {
          const text = (lab.textContent || "").toLowerCase();
          lab.style.display = !needle || text.indexOf(needle) >= 0 ? "" : "none";
        });
      });
      setTimeout(function () { q.focus(); }, 0);
    }
    pop.onclick = function (e) {
      e.stopPropagation();
      const btn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "all") {
        pop.querySelectorAll(".cov-col-filter-list input").forEach(function (el) {
          if (el.closest("label").style.display === "none") return;
          el.checked = true;
        });
        return;
      }
      if (act === "clear") {
        pop.querySelectorAll(".cov-col-filter-list input").forEach(function (el) {
          el.checked = false;
        });
        return;
      }
      if (act === "none") {
        delete STATE.colFilters[key];
        closeColFilter();
        paintTable();
        return;
      }
      if (act === "apply") {
        const picked = Array.prototype.slice.call(pop.querySelectorAll(".cov-col-filter-list input:checked"))
          .map(function (el) { return el.value; });
        if (!picked.length) STATE.colFilters[key] = [];
        else if (picked.length === values.length) delete STATE.colFilters[key];
        else STATE.colFilters[key] = picked;
        closeColFilter();
        paintTable();
      }
    };
  }
  function bindColResize(tableRoot) {
    tableRoot.querySelectorAll(".cov-col-resize").forEach(function (handle) {
      handle.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const key = handle.getAttribute("data-resize");
        const th = handle.closest("th");
        if (!th || !key) return;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        function onMove(ev) {
          const w = Math.max(56, Math.round(startW + (ev.clientX - startX)));
          STATE.colWidths[key] = w;
          th.style.width = w + "px";
          th.style.minWidth = w + "px";
          th.style.maxWidth = w + "px";
          const idx = COLS.findIndex(function (c) { return c.key === key; });
          if (idx < 0) return;
          tableRoot.querySelectorAll("tbody tr").forEach(function (tr) {
            const td = tr.children[idx];
            if (!td) return;
            td.style.width = w + "px";
            td.style.maxWidth = w + "px";
          });
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.classList.remove("cov-resizing");
        }
        document.body.classList.add("cov-resizing");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }
  function renderSummary(summary) {
    const box = $("cov-summary");
    if (!box) return;
    summary = summary || {};
    const items = [
      ["all", "В срезе", summary.total],
      ["touched", "Потроганы", summary.touched],
      ["partial", "Неполное касание", summary.partial],
      ["email", "Только письмо", summary.email],
      ["none", "Тишина", summary.none],
      ["deal", "Со сделкой", summary.with_deal],
      ["sp", "С СП", summary.with_sp],
    ];
    const cl = summary.call_list;
    if (cl) {
      items.push(["", "Из списка потроганы", cl.in_list_touched + " из " + cl.in_list_rows]);
      if (cl.mode !== "in") items.push(["", "Вне списка потроганы", cl.out_list_touched + " из " + cl.out_list_rows]);
      items.push(["", "Клиентов в списке (1С)", cl.list_groups, "list"]);
      items.push(["", cl.kind === "contact" ? "Найдены как компании" : "Найдены как контакты", cl.list_elsewhere, "elsewhere"]);
      items.push(["", "Не найдены в Битриксе нигде", cl.list_missing, "missing"]);
      if (cl.list_filtered) items.push(["", "Срезаны фильтрами среза", cl.list_filtered]);
    }
    box.innerHTML = items.map(function (item) {
      const key = item[0];
      const label = item[1];
      const val = item[2] == null ? 0 : item[2];
      const clickable = key === "all" || key === "touched" || key === "partial" || key === "email" || key === "none";
      const on = clickable && ((key === "all" && STATE.covFilter === "all") || key === STATE.covFilter);
      const tone = item[3] ? " cov-kpi--" + item[3] : "";
      return "<div class=\"cov-kpi" + tone + (on ? " on" : "") + "\" data-cov=\"" +
        (clickable ? key : "") + "\"" + (item[3] ? " data-tone=\"" + item[3] + "\"" : "") +
        "><span>" + label + "</span><b>" + val + "</b></div>";
    }).join("");
    box.querySelectorAll(".cov-kpi[data-tone]").forEach(function (el) {
      el.addEventListener("click", function () {
        toggleListPanel(el.getAttribute("data-tone"));
      });
    });
    box.querySelectorAll(".cov-kpi[data-cov]").forEach(function (el) {
      if (!el.getAttribute("data-cov")) return;
      el.addEventListener("click", function () {
        STATE.covFilter = el.getAttribute("data-cov");
        syncChips();
        paintTable();
        renderSummary(STATE.summary);
      });
    });
  }
  function toggleListPanel(tone) {
    const cl = STATE.summary && STATE.summary.call_list;
    let panel = $("cov-list-panel");
    if (!cl) return;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "cov-list-panel";
      panel.className = "cov-list-panel";
      $("cov-summary").insertAdjacentElement("afterend", panel);
    }
    if (STATE.listPanel === tone) {
      STATE.listPanel = null;
      panel.hidden = true;
      return;
    }
    STATE.listPanel = tone;
    const pick = { list: null, elsewhere: cl.list_elsewhere_rows, missing: cl.list_missing_rows }[tone];
    if (!pick) {
      STATE.listPanel = null;
      panel.hidden = true;
      return;
    }
    const title = tone === "missing"
      ? "Клиенты списка, которых нет в Битриксе ни как компании, ни как контакта"
      : (cl.kind === "contact" ? "Клиенты списка, найденные как компании" : "Клиенты списка, найденные как контакты");
    panel.className = "cov-list-panel cov-list-panel--" + tone;
    panel.hidden = false;
    panel.innerHTML = "<b>" + escapeHtml(title) + " · " + pick.length + "</b>" +
      (pick.length ? "<ul>" + pick.map(function (r) {
        return "<li>" + escapeHtml(r.name) + " <span>" + escapeHtml(r.priority) +
          (r.manager ? " · " + escapeHtml(r.manager) : "") + "</span></li>";
      }).join("") + "</ul>" : "<p class=\"hint\" style=\"margin:4px 0 0\">Пусто.</p>");
  }
  function syncChips() {
    document.querySelectorAll("#cov-chips .cov-chip").forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-cov") === STATE.covFilter);
    });
  }
  function paintDetail(row) {
    const panel = $("cov-detail");
    if (!panel) return;
    if (!row) {
      panel.innerHTML = "<p class=\"hint\" style=\"margin:0\">Кликните строку в таблице ниже — здесь откроется полный список дел, звонков и описаний за период.</p>";
      return;
    }
    const events = row.events || [];
    const timeline = events.length
      ? "<div class=\"cov-timeline\">" + events.map(function (ev) {
          const head = escapeHtml(ev.label || ev.kind || "Событие") +
            (ev.at ? " · " + escapeHtml(ev.at) : "") +
            (ev.company_name ? " · " + escapeHtml(ev.company_name) : "");
          const people = [];
          if (ev.mop) people.push("Ответственный: " + escapeHtml(ev.mop));
          if (ev.author) people.push("Создал: " + escapeHtml(ev.author));
          if (ev.direction) people.push(escapeHtml(ev.direction));
          if (ev.duration) people.push("Длительность: " + escapeHtml(ev.duration));
          const st = ev.status || ev.call_status || "";
          const stId = ev.status_id || ev.call_status_id || "";
          if (st) {
            const stCls = stId === "ok" || stId === "opened" || stId === "inbound" ? "ok"
              : stId === "missed" || stId === "error" ? "bad"
              : stId === "short" || stId === "no_read" || stId === "comment" ? "mail" : "";
            people.push("Статус: <span class=\"cov-call-st " + stCls + "\">" +
              escapeHtml(st) + "</span>");
          }
          const meta = people.length
            ? "<div class=\"cov-event-meta\">" + people.join(" · ") + "</div>"
            : "";
          const title = ev.url
            ? "<a class=\"file-link\" href=\"" + escapeHtml(ev.url) +
              "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(ev.subject || "Без темы") + "</a>"
            : escapeHtml(ev.subject || "Без темы");
          const body = ev.text
            ? "<div class=\"cov-quote\">" + escapeHtml(ev.text) + "</div>"
            : "<p class=\"hint\" style=\"margin:4px 0 0\">Без описания в деле</p>";
          return "<div class=\"cov-event\"><div class=\"cov-event-head\">" + head +
            "</div>" + meta + "<div class=\"cov-event-title\">" + title + "</div>" + body + "</div>";
        }).join("") + "</div>"
      : "<p class=\"hint\" style=\"margin:8px 0 0\">В периоде нет дел/звонков/писем и нет открытых сделок/СП</p>";
    panel.innerHTML =
      "<div class=\"cov-detail-top\">" +
      "<div class=\"cov-detail-head\">" +
      "<h3><a class=\"file-link\" href=\"" + escapeHtml(row.url) +
      "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(row.name) + "</a></h3>" +
      "<span class=\"cov-detail-count\">" + (row.events_count || events.length) + " событий</span>" +
      "</div>" +
      "<button type=\"button\" class=\"cov-detail-close\" title=\"Закрыть\">✕</button>" +
      "</div>" +
      "<div class=\"cov-detail-meta\">" +
      "<span>" + badge(row) + "</span>" +
      "<span>" + escapeHtml(cardMopCopy(row.universe || STATE.universe).detail) + ": " + escapeHtml(row.mop) + "</span>" +
      "<span>" + escapeHtml(contactMopColTitle(row.universe || STATE.universe)) + ": " +
      escapeHtml(row.contact_responsibles || "—") + "</span>" +
      "<span>RFM: " + escapeHtml(row.rfm) + "</span>" +
      "<span>Типы за период: " + escapeHtml(row.event_types || row.last_kind || "—") + "</span>" +
      "<span>Касаний: " + (row.touches || 0) + " · Писем: " + (row.emails || 0) +
      ((row.weak_calls || 0) ? " · Попыток звонка: " + row.weak_calls : "") + "</span>" +
      "<span>Сделка: " + (row.has_deal ? "да" : "нет") + " · СП: " +
      (row.has_sp ? "да" : "нет") + "</span></div>" +
      ((row.deal_links && row.deal_links.length)
        ? "<div class=\"cov-detail-meta\" style=\"margin-top:8px\"><span>Открытые сделки:</span> " +
          linkList(row.deal_links) + "</div>"
        : "") +
      ((row.sp_links && row.sp_links.length)
        ? "<div class=\"cov-detail-meta\" style=\"margin-top:8px\"><span>Открытые СП:</span> " +
          linkList(row.sp_links) + "</div>"
        : "") +
      "<h4 class=\"cov-events-title\">Лента дел за период</h4>" + timeline;
    const closeBtn = panel.querySelector(".cov-detail-close");
    if (closeBtn) closeBtn.addEventListener("click", function () { selectRow(null); });
  }
  function selectRow(row) {
    if (row && STATE.selected && STATE.selected.id === row.id) {
      row = null;
    }
    STATE.selected = row || null;
    paintTable();
    paintDetail(STATE.selected);
    const panel = $("cov-detail");
    if (panel && STATE.selected) {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  function paintTable() {
    // .cov-wrap has its own max-height + overflow:auto scrollbar (long tables
    // don't scroll the whole page). Rebuilding replaces that div outright, so
    // its scrollTop resets to 0 — save/restore it, not window.scrollY.
    const oldWrap = document.querySelector("#cov-table .cov-wrap");
    const wrapScrollTop = oldWrap ? oldWrap.scrollTop : 0;
    const wrapScrollLeft = oldWrap ? oldWrap.scrollLeft : 0;
    _paintTableInner();
    const newWrap = document.querySelector("#cov-table .cov-wrap");
    if (newWrap) {
      newWrap.scrollTop = wrapScrollTop;
      newWrap.scrollLeft = wrapScrollLeft;
    }
  }
  function _paintTableInner() {
    STATE.view = visibleRows();
    const meta = $("cov-view-meta");
    if (meta) {
      const filt = hasColFilters() ? " · есть фильтры по столбцам" : "";
      meta.textContent = "На экране " + STATE.view.length + " из " + STATE.rows.length +
        filt +
        ". Тяните край заголовка — ширина колонки. ▾ в заголовке — фильтр по значениям. «Сформировать файл» — Excel видимого среза.";
    }
    const clearBtn = $("cov-clear-col-filters");
    if (clearBtn) clearBtn.hidden = !hasColFilters();
    const table = $("cov-table");
    if (!table) return;
    if (!STATE.rows.length) {
      table.innerHTML = "<p class='empty'>Нет строк.</p>";
      if (!STATE.selected) paintDetail(null);
      return;
    }
    function arrow(key) {
      if (STATE.sortKey !== key && !(key === "coverage_title" && STATE.sortKey === "coverage")) return "";
      return STATE.sortDir > 0 ? " ↑" : " ↓";
    }
    function colStyle(key) {
      const w = STATE.colWidths[key] || COL_DEFAULT_W[key] || 120;
      return "width:" + w + "px;min-width:" + w + "px;max-width:" + w + "px";
    }
    const bodyPieces = [];
    if (!STATE.view.length) {
      bodyPieces.push("<tr><td colspan=\"" + COLS.length + "\" class=\"empty\">Нет строк под текущий поиск и фильтры столбцов.</td></tr>");
    } else {
      STATE.view.forEach(function (row, i) {
        const on = STATE.selected && STATE.selected.id === row.id ? " on" : "";
        const subject = row.last_subject || row.last_text || "—";
        const short = subject.length > 70 ? subject.slice(0, 69) + "…" : subject;
        const n = row.events_count || (row.events || []).length || 0;
        const multi = (row.members_count || 1) > 1;
        const gid = row.group_id;
        const open = multi && STATE.openGroups[gid];
        const exp = multi
          ? "<button type=\"button\" class=\"cov-exp\" data-gid=\"" + escapeHtml(gid) +
            "\" aria-expanded=\"" + (open ? "true" : "false") + "\" title=\"Состав группы компаний (" +
            row.members_count + ")\">" + (open ? "−" : "+") + "</button>"
          : "";
        bodyPieces.push(
          "<tr class=\"cov-row" + on + "\" data-i=\"" + i + "\">" +
          "<td style=\"" + colStyle("name") + "\"><span class=\"cov-name-row\"><a class=\"file-link\" href=\"" + escapeHtml(row.url) +
          "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(row.name) + "</a>" + exp + "</span></td>" +
          "<td style=\"" + colStyle("mop") + "\">" + escapeHtml(row.mop) + "</td>" +
          "<td style=\"" + colStyle("contact_responsibles") + "\">" +
          escapeHtml(row.contact_responsibles || "—") + "</td>" +
          "<td style=\"" + colStyle("rfm") + "\">" + escapeHtml(row.rfm) + "</td>" +
          "<td style=\"" + colStyle("coverage_title") + "\">" + badge(row) + "</td>" +
          "<td style=\"" + colStyle("event_types") + "\">" + escapeHtml(row.event_types || "—") + "</td>" +
          "<td class=\"cov-subject\" style=\"" + colStyle("last_subject") + "\" title=\"" + escapeHtml(subject) + "\">" +
          escapeHtml(short) + "</td>" +
          "<td style=\"" + colStyle("events_count") + "\"><button type=\"button\" class=\"cov-events-btn\" data-i=\"" +
          i + "\">" + n + " →</button></td>" +
          "<td style=\"" + colStyle("has_planned") + "\">" + (row.has_planned ? "да" : "") + "</td>" +
          "<td style=\"" + colStyle("has_overdue") + "\">" + (row.has_overdue ? "да" : "") + "</td>" +
          "<td style=\"" + colStyle("has_deal") + "\">" + (row.has_deal ? "да" : "") + "</td>" +
          "<td class=\"cov-links\" style=\"" + colStyle("deal_links") + "\">" + linkList(row.deal_links) + "</td>" +
          "<td style=\"" + colStyle("has_sp") + "\">" + (row.has_sp ? "да" : "") + "</td>" +
          "<td class=\"cov-links\" style=\"" + colStyle("sp_links") + "\">" + linkList(row.sp_links) + "</td>" +
          "<td style=\"" + colStyle("list_label") + "\">" + escapeHtml(row.list_label || "—") + "</td></tr>"
        );
        if (open) {
          const items = (row.members || []).map(function (m) {
            return "<li><a class=\"file-link\" href=\"" + escapeHtml(m.url) + "\" target=\"_blank\" rel=\"noopener\">" +
              escapeHtml(m.name) + "</a>" + (m.is_head ? "<span class=\"tag\">головная</span>" : "") +
              "<div class=\"cov-mem-meta\">" +
              "<span>Проработка: <b>" + escapeHtml(m.coverage_title) + "</b></span>" +
              "<span>RFM: <b>" + escapeHtml(m.rfm) + "</b></span>" +
              "<span>Отв.: <b>" + escapeHtml(m.mop) + "</b></span>" +
              "<span>Дел: <b>" + (m.events_count || 0) + "</b></span>" +
              "<span>Посл.: <b>" + escapeHtml(m.last_subject || "—") + "</b></span>" +
              "</div></li>";
          }).join("");
          bodyPieces.push("<tr class=\"cov-members\" data-gid=\"" + escapeHtml(gid) +
            "\"><td colspan=\"" + COLS.length + "\"><ul>" + items + "</ul></td></tr>");
        }
      });
    }
    const bodyHtml = bodyPieces.join("");
    table.innerHTML =
      "<div class=\"table-wrap cov-wrap\"><table class=\"flat cov-grid\"><thead><tr>" +
      COLS.map(function (c) {
        const active = colFilterActive(c.key);
        return "<th data-sort=\"" + c.key + "\" style=\"" + colStyle(c.key) + "\">" +
          "<span class=\"cov-th-main\">" +
          "<span class=\"cov-th-title\">" + escapeHtml(c.title) + arrow(c.key) + "</span>" +
          "<button type=\"button\" class=\"cov-th-filter" + (active ? " on" : "") +
          "\" data-filter=\"" + c.key + "\" title=\"Фильтр по значениям\">▾</button>" +
          "</span>" +
          "<span class=\"cov-col-resize\" data-resize=\"" + c.key + "\" title=\"Тянуть ширину\"></span>" +
          "</th>";
      }).join("") +
      "</tr></thead><tbody>" + bodyHtml + "</tbody></table></div>";
    table.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function (e) {
        if (e.target.closest && (e.target.closest(".cov-th-filter") || e.target.closest(".cov-col-resize"))) return;
        const key = th.getAttribute("data-sort") === "coverage_title" ? "coverage" : th.getAttribute("data-sort");
        if (STATE.sortKey === key) STATE.sortDir *= -1;
        else {
          STATE.sortKey = key;
          STATE.sortDir = 1;
        }
        paintTable();
      });
    });
    table.querySelectorAll(".cov-th-filter").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute("data-filter");
        if (STATE.openFilter === key) {
          closeColFilter();
          return;
        }
        openColFilter(key, btn);
      });
    });
    bindColResize(table);
    const tbody = table.querySelector("tbody");
    if (tbody) {
      tbody.addEventListener("click", function (e) {
        const exp = e.target.closest ? e.target.closest(".cov-exp") : null;
        if (exp) {
          const gid = exp.getAttribute("data-gid");
          if (STATE.openGroups[gid]) delete STATE.openGroups[gid];
          else STATE.openGroups[gid] = true;
          paintTable();
          return;
        }
        if (e.target.closest && e.target.closest("a")) return;
        const btn = e.target.closest ? e.target.closest(".cov-events-btn") : null;
        const tr = e.target.closest ? e.target.closest("tr.cov-row") : null;
        if (btn) {
          selectRow(STATE.view[Number(btn.getAttribute("data-i"))]);
          return;
        }
        if (!tr) return;
        selectRow(STATE.view[Number(tr.getAttribute("data-i"))]);
      });
    }
    if (STATE.selected) {
      const still = STATE.view.filter(function (r) { return r.id === STATE.selected.id; })[0];
      if (!still) {
        STATE.selected = null;
        paintDetail(null);
      }
    }
  }
  function showResult(rows, summary) {
    STATE.rows = rows || [];
    STATE.summary = summary || {};
    labelListRows(STATE.rows, STATE.summary);
    STATE.listPanel = null;
    if ($("cov-list-panel")) $("cov-list-panel").hidden = true;
    STATE.selected = null;
    STATE.covFilter = "all";
    STATE.search = "";
    STATE.colFilters = {};
    closeColFilter();
    const search = $("cov-search");
    if (search) search.value = "";
    syncChips();
    const result = must("cov-result");
    result.hidden = false;
    renderSummary(STATE.summary);
    paintDetail(null);
    paintTable();
    const detail = $("cov-detail");
    if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function bindShell() {
    const bounds = monthBounds();
    must("cov-period-from").value = bounds.from;
    must("cov-period-to").value = bounds.to;
    if ($("cov-created-from")) $("cov-created-from").value = "";
    if ($("cov-created-to")) $("cov-created-to").value = "";

    document.querySelectorAll("#cov-universe .sub-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setUniverse(btn.getAttribute("data-universe"));
        const preset = $("cov-preset");
        if (preset) preset.value = "";
        applySelectedPreset("");
      });
    });
    const preset = $("cov-preset");
    if (preset) {
      preset.addEventListener("change", function () {
        applySelectedPreset(preset.value);
        syncPresetActions();
      });
    }
    const presetSave = $("cov-preset-save");
    if (presetSave) {
      presetSave.addEventListener("click", async function () {
        const title = window.prompt("Название среза", "");
        if (title == null) return;
        if (!String(title).trim()) {
          showMsg("Название не может быть пустым.", false);
          return;
        }
        presetSave.disabled = true;
        try {
          const res = await window.rtlFetch("api/coverage/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.assign({ title: String(title).trim() }, payload())),
          });
          const body = await res.json();
          if (!body.ok) {
            showMsg(body.error || "Не удалось сохранить срез", false);
            return;
          }
          STATE.meta.user_presets = body.user_presets || STATE.meta.user_presets || [];
          fillPresets();
          if (preset && body.preset && body.preset.id) preset.value = body.preset.id;
          syncPresetActions();
          showMsg("Срез «" + String(title).trim() + "» сохранён.", true);
        } catch (err) {
          showMsg((err && err.message) || "Сервер не отвечает.", false);
        } finally {
          presetSave.disabled = false;
        }
      });
    }
    const presetDelete = $("cov-preset-delete");
    if (presetDelete) {
      presetDelete.addEventListener("click", async function () {
        const id = preset && preset.value;
        if (!id || id.indexOf("user:") !== 0) return;
        const item = findUserPreset(id);
        if (!window.confirm("Удалить срез «" + (item && item.title ? item.title : id) + "»?")) return;
        presetDelete.disabled = true;
        try {
          const res = await window.rtlFetch("api/coverage/presets/" + encodeURIComponent(id), {
            method: "DELETE",
          });
          const body = await res.json();
          if (!body.ok) {
            showMsg(body.error || "Не удалось удалить", false);
            return;
          }
          STATE.meta.user_presets = body.user_presets || [];
          if (preset) preset.value = "";
          applySelectedPreset("");
          fillPresets();
          showMsg("Срез удалён.", true);
        } catch (err) {
          showMsg((err && err.message) || "Сервер не отвечает.", false);
        } finally {
          presetDelete.disabled = false;
        }
      });
    }
    document.querySelectorAll(".cov-mini[data-check]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        checkAll(btn.getAttribute("data-check"), btn.getAttribute("data-on") === "1");
      });
    });
    document.querySelectorAll("#cov-chips .cov-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.covFilter = btn.getAttribute("data-cov");
        syncChips();
        renderSummary(STATE.summary || {});
        paintTable();
      });
    });
    const search = $("cov-search");
    if (search) {
      search.addEventListener("input", function () {
        STATE.search = search.value || "";
        paintTable();
      });
    }
    const clearCols = $("cov-clear-col-filters");
    if (clearCols) {
      clearCols.addEventListener("click", function () {
        STATE.colFilters = {};
        closeColFilter();
        paintTable();
      });
    }
    document.addEventListener("click", function (e) {
      const colPop = $("cov-col-filter-pop");
      if (colPop && !colPop.hidden) {
        if (!(e.target.closest && (e.target.closest("#cov-col-filter-pop") || e.target.closest(".cov-th-filter")))) {
          closeColFilter();
        }
      }
      const pickerPop = $("cov-picker-pop");
      if (pickerPop && !pickerPop.hidden) {
        if (!(e.target.closest && (e.target.closest("#cov-picker-pop") || e.target.closest(".cov-picker-btn")))) {
          closePickerPop();
        }
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeColFilter();
        closePickerPop();
      }
    });
    must("cov-list").addEventListener("change", onCallListChange);
    must("cov-list-refresh").addEventListener("click", async function () {
      const btn = must("cov-list-refresh");
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Фиксирую…";
      try {
        const res = await window.rtlFetch("api/coverage/call-lists/refresh", { method: "POST" });
        const body = await res.json();
        if (!body.ok) throw new Error(body.error || "не удалось");
        fillCallLists(body.call_lists || []);
        must("cov-list").value = body.snapshot.id;
        await onCallListChange();
        showMsg("Список зафиксирован: " + body.snapshot.title, true);
      } catch (err) {
        showMsg("Список обзвона: " + ((err && err.message) || err), false);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
    must("cov-btn").addEventListener("click", async function () {
      const btn = must("cov-btn");
      btn.disabled = true;
      btn.textContent = "Сборка…";
      showMsg("");
      try {
        const res = await window.rtlFetch("api/coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        const body = await res.json();
        if (!body.ok) {
          showMsg(body.error || "Не собралось", false);
          return;
        }
        showResult(body.rows || [], body.summary || {});
        showMsg("Готово: " + ((body.summary && body.summary.total) || 0) +
          " карточек. Лента дел — в блоке над таблицей.", true);
      } catch (err) {
        showMsg((err && err.message) || "Сервер не отвечает.", false);
      } finally {
        btn.disabled = false;
        btn.textContent = "Собрать проработку";
      }
    });
    must("cov-xlsx").addEventListener("click", async function () {
      if (!STATE.view.length) {
        showMsg("Сначала соберите таблицу.", false);
        return;
      }
      const btn = must("cov-xlsx");
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = "Формирую…";
      try {
        const summary = Object.assign({}, STATE.summary || {}, {
          total: STATE.view.length,
          touched: STATE.view.filter(function (r) { return r.coverage === "touched"; }).length,
          partial: STATE.view.filter(function (r) { return r.coverage === "partial"; }).length,
          email: STATE.view.filter(function (r) {
            return r.coverage === "partial" && (r.emails || 0) > 0 &&
              !(r.weak_calls || 0) && !(r.comments_count || 0);
          }).length,
          none: STATE.view.filter(function (r) { return r.coverage === "none"; }).length,
          with_deal: STATE.view.filter(function (r) { return r.has_deal; }).length,
          with_sp: STATE.view.filter(function (r) { return r.has_sp; }).length,
        });
        const res = await window.rtlFetch("api/coverage/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: STATE.view, summary: summary }),
        });
        const body = await res.json();
        if (!body.ok || !body.file) {
          showMsg(body.error || "Не удалось сделать Excel", false);
          return;
        }
        if (window.loadState) await window.loadState();
        if (window.goReady) window.goReady("coverage");
        showMsg("Файл в Готовых: " + body.file.name + " (" + STATE.view.length + " строк)", true);
      } catch (err) {
        showMsg((err && err.message) || "Сервер не отвечает.", false);
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
    setUniverse(STATE.universe);
  }
  function fillMeta(body) {
    STATE.meta = body;
    const enums = body.enums || {};
    mountPicker($("cov-rfm"), "cov-rfm", enums.rfm);
    mountPicker($("cov-work"), "cov-work", enums.work_status);
    mountPicker($("cov-type"), "cov-type", enums.client_type);
    mountPicker($("cov-dir"), "cov-dir", enums.direction);
    mountPicker($("cov-lead-sem"), "cov-lead-sem", body.lead_semantic);
    mountPicker($("cov-mops-company"), "cov-company-mop", body.mops);
    mountPicker($("cov-mops-other"), "cov-other-mop", body.other_assignees || []);
    mountPicker($("cov-mops-activity"), "cov-activity-mop", body.mops);
    mountPicker($("cov-planned"), "cov-planned", body.planned_filters || []);
    fillCallLists(body.call_lists || []);
    fillPresets();
    applySelectedPreset("");
    setUniverse(STATE.universe, false);
  }

  async function boot() {
    if (STATE.booted) return;
    STATE.booted = true;
    try {
      bindShell();
    } catch (err) {
      showMsg("Форма проработки не собралась: " + ((err && err.message) || err), false);
      return;
    }
    try {
      if (!window.rtlFetch) throw new Error("нет rtlFetch — обновите страницу");
      const res = await window.rtlFetch("api/coverage/meta");
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        throw new Error((body && body.error) || ("meta HTTP " + res.status));
      }
      fillMeta(body);
    } catch (err) {
      showMsg("Фильтры не загрузились: " + ((err && err.message) || err), false);
      ["cov-mops-company", "cov-mops-other", "cov-mops-activity", "cov-planned", "cov-rfm", "cov-work", "cov-type", "cov-dir", "cov-lead-sem"].forEach(function (id) {
        const el = $(id);
        if (el && !el.innerHTML) el.innerHTML = "<p class='empty'>Не загрузилось</p>";
      });
    }
  }

  function start() {
    const ready = window.rtlReady || Promise.resolve();
    ready.then(boot).catch(function (err) {
      showMsg("Проработка: " + ((err && err.message) || err), false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
