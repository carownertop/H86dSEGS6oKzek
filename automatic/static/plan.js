(function () {
  const STATE = {
    rows: [],
    summary: null,
    view: [],
    selected: null,
    sortKey: "priority",
    sortDir: 1,
    stockFilters: [],
    priorityFilters: [],
    revenueBuckets: [],
    search: "",
    colWidths: {},
    colFilters: {},
    openFilter: null,
    openPicker: null,
    expanded: {},
  };

  const COLS = [
    { key: "name", title: "Клиент" },
    { key: "gk", title: "ГК" },
    { key: "manager", title: "МОП" },
    { key: "priority", title: "Приоритет" },
    { key: "rhythm", title: "Ритм" },
    { key: "cycle_status", title: "Статус цикла" },
    { key: "rfm", title: "RFM" },
    { key: "lifecycle", title: "Жизн. цикл" },
    { key: "days_since_buy", title: "Дней без покупки" },
    { key: "median_interval", title: "Мед. интервал" },
    { key: "avg_check", title: "Ср. чек" },
    { key: "days_in_base", title: "Дней в базе" },
    { key: "revenue", title: "Выручка" },
    { key: "stock_hits", title: "На складе" },
    { key: "brands", title: "Бренды" },
    { key: "bought_count", title: "Покупки" },
    { key: "offers_count", title: "Что предложить" },
  ];
  const COL_DEFAULT_W = {
    name: 200, gk: 52, manager: 120, priority: 110, rhythm: 90, cycle_status: 100, rfm: 92, lifecycle: 100,
    days_since_buy: 72, median_interval: 72, avg_check: 84, days_in_base: 72,
    revenue: 92, stock_hits: 64, brands: 120, bought_count: 72, offers_count: 88,
  };
  const MULTI_FILTER_COLS = { brands: true };
  const PRIO_RANK = { "1. Горячие": 0, "2. Новые": 1, "3. Задержались": 2, "4. Потерянные": 3, "5. Не сейчас": 4, "6. Спящие": 5 };
  const STOCK_ITEMS = [
    { id: "with_stock", title: "На складе" },
    { id: "without", title: "Без совпадения" },
  ];
  const PRIO_ITEMS = [
    { id: "1. Горячие", title: "Горячие" },
    { id: "2. Новые", title: "Новые" },
    { id: "3. Задержались", title: "Задержались" },
    { id: "4. Потерянные", title: "Потерянные" },
    { id: "5. Не сейчас", title: "Не сейчас" },
    { id: "6. Спящие", title: "Спящие" },
  ];
  const REV_ITEMS = [
    { id: "lt50", title: "до 50 тыс" },
    { id: "b50_100", title: "50–100 тыс" },
    { id: "b100_300", title: "100–300 тыс" },
    { id: "b300_1m", title: "300 тыс–1 млн" },
    { id: "gt1m", title: "более 1 млн" },
  ];
  const PICKER_STORE = {};

  function $(id) { return document.getElementById(id); }
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
    const msg = $("plan-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = text ? ("msg show " + (ok ? "ok" : "err")) : "msg";
  }
  function money(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return Math.round(n).toLocaleString("ru-RU") + " ₽";
  }
  function num(v) {
    if (v == null || v === "") return "—";
    return String(v);
  }
  function blockHtml(text) {
    const raw = String(text || "—");
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }
  function selectedManagers() {
    return Array.prototype.slice.call(document.querySelectorAll("input[name=mop]:checked"))
      .map(function (el) { return el.value; });
  }
  function colFilterActive(key) {
    return Object.prototype.hasOwnProperty.call(STATE.colFilters, key);
  }
  function splitTokens(text) {
    return String(text || "").split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== "—"; });
  }
  function cellFilterText(row, key) {
    if (key === "gk") return String(row.members_count || 1);
    if (key === "avg_check") return row.avg_check == null ? "—" : money(row.avg_check);
    if (key === "revenue") return money(row.revenue);
    if (key === "with_stock" || key === "stock_hits") {
      return row.with_stock || (row.stock_hits || 0) > 0 ? "да" : "нет";
    }
    if (key === "days_since_buy" || key === "median_interval" || key === "days_in_base" || key === "stock_hits") {
      return row[key] == null || row[key] === "" ? "—" : String(row[key]);
    }
    if (key === "brands") return String(row.brands || "—");
    if (key === "bought_count") return String(row.bought_count || (row.bought || []).length || 0);
    if (key === "offers_count") return String(countOffers(row));
    if (key === "offers") return String(row.offers || "—");
    if (key === "top_bought") return String(row.bought_text || row.top_bought || "—");
    const raw = row[key];
    return String(raw == null || raw === "" ? "—" : raw);
  }
  function rowMatchesColFilter(row, key, allowed) {
    if (!allowed.length) return false;
    if (MULTI_FILTER_COLS[key]) {
      const tokens = splitTokens(row.brands);
      if (!tokens.length) return false;
      return allowed.some(function (v) { return tokens.indexOf(v) >= 0; });
    }
    return allowed.indexOf(cellFilterText(row, key)) >= 0;
  }
  function matchesStockFilter(row) {
    if (!STATE.stockFilters.length) return true;
    const wantStock = STATE.stockFilters.indexOf("with_stock") >= 0;
    const wantWithout = STATE.stockFilters.indexOf("without") >= 0;
    if (wantStock && row.with_stock) return true;
    if (wantWithout && !row.with_stock) return true;
    return false;
  }
  function matchesPriorityFilter(row) {
    if (!STATE.priorityFilters.length) return true;
    return STATE.priorityFilters.indexOf(row.priority) >= 0;
  }
  function matchesRevenueFilter(row) {
    if (!STATE.revenueBuckets.length) return true;
    return STATE.revenueBuckets.indexOf(row.revenue_bucket) >= 0;
  }
  function sortValue(row, key) {
    if (key === "gk") return row.members_count || 1;
    if (key === "priority") return PRIO_RANK[row.priority] != null ? PRIO_RANK[row.priority] : 9;
    if (key === "avg_check" || key === "revenue" || key === "days_since_buy" ||
        key === "median_interval" || key === "days_in_base" || key === "stock_hits" ||
        key === "bought_count" || key === "offers_count") {
      const n = Number(
        key === "bought_count" ? (row.bought_count || (row.bought || []).length || 0)
          : key === "offers_count" ? countOffers(row)
          : row[key]
      );
      return isFinite(n) ? n : -1;
    }
    return String(row[key] == null ? "" : row[key]).toLowerCase();
  }
  function baseFilteredRows() {
    const q = (STATE.search || "").trim().toLowerCase();
    let rows = STATE.rows.slice()
      .filter(matchesStockFilter)
      .filter(matchesPriorityFilter)
      .filter(matchesRevenueFilter);
    if (q) {
      rows = rows.filter(function (r) {
        const members = (r.members || []).map(function (m) { return m.name; }).join(" ");
        return [r.name, r.manager, r.priority, r.rhythm, r.cycle_status, r.rfm, r.lifecycle, r.brands,
          r.bought_text, r.top_bought, r.offers, members].join(" ").toLowerCase().indexOf(q) >= 0;
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
        if (!rowMatchesColFilter(r, key, STATE.colFilters[key] || [])) return false;
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
        splitTokens(r.brands).forEach(function (v) {
          if (seen[v]) return;
          seen[v] = true;
          out.push(v);
        });
      });
      return out.sort(function (a, b) { return String(a).localeCompare(String(b), "ru"); });
    }
    const seen = {};
    const out = [];
    rows.forEach(function (r) {
      const v = cellFilterText(r, key);
      if (seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort(function (a, b) { return String(a).localeCompare(String(b), "ru", { numeric: true }); });
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
  function hasColFilters() {
    return Object.keys(STATE.colFilters).some(function (k) { return colFilterActive(k); });
  }
  function closeColFilter() {
    STATE.openFilter = null;
    const pop = $("plan-col-filter-pop");
    if (pop) pop.hidden = true;
  }
  function closePickerPop() {
    STATE.openPicker = null;
    const pop = $("plan-picker-pop");
    if (pop) pop.hidden = true;
    document.querySelectorAll("#plan-result .cov-picker-btn.on").forEach(function (btn) {
      btn.classList.remove("on");
    });
  }
  function pickerSelected(name) {
    if (name === "plan-stock") return STATE.stockFilters.slice();
    if (name === "plan-prio") return STATE.priorityFilters.slice();
    if (name === "plan-rev") return STATE.revenueBuckets.slice();
    return [];
  }
  function setPickerSelected(name, ids) {
    if (name === "plan-stock") STATE.stockFilters = ids;
    else if (name === "plan-prio") STATE.priorityFilters = ids;
    else if (name === "plan-rev") STATE.revenueBuckets = ids;
  }
  function pickerSummaryText(name, items) {
    const selected = pickerSelected(name);
    const total = (items || []).length;
    if (!selected.length || selected.length === total) return "Все";
    const titles = (items || []).filter(function (item) {
      return selected.indexOf(item.id) >= 0;
    }).map(function (item) { return item.title; });
    if (titles.length <= 2) return titles.join(", ");
    return titles.length + " из " + total;
  }
  function updatePickerSummary(name) {
    const host = document.querySelector("#plan-result .cov-picker[data-name=\"" + name + "\"]");
    if (!host) return;
    const items = PICKER_STORE[name] || [];
    const summary = host.querySelector(".cov-picker-summary");
    const text = pickerSummaryText(name, items);
    if (summary) summary.textContent = text;
    const btn = host.querySelector(".cov-picker-btn");
    if (btn) btn.classList.toggle("cov-picker-btn-empty", text === "Ничего не выбрано");
  }
  function mountPicker(host, name, items) {
    if (!host) return;
    PICKER_STORE[name] = items || [];
    const label = host.getAttribute("data-label") || name;
    host.setAttribute("data-name", name);
    const selected = pickerSelected(name);
    const all = !selected.length;
    const set = {};
    selected.forEach(function (id) { set[String(id)] = true; });
    const storeHtml = (items || []).map(function (item) {
      const on = all || set[String(item.id)];
      return "<label><input type=\"checkbox\" value=\"" + escapeHtml(item.id) + "\"" +
        (on ? " checked" : "") + " /> <span>" + escapeHtml(item.title) + "</span></label>";
    }).join("");
    host.innerHTML =
      "<div class=\"cov-picker\" data-name=\"" + escapeHtml(name) + "\">" +
      "<button type=\"button\" class=\"cov-picker-btn\" aria-haspopup=\"listbox\">" +
      "<span class=\"cov-picker-label\">" + escapeHtml(label) + "</span>" +
      "<span class=\"cov-picker-summary\">" + escapeHtml(pickerSummaryText(name, items)) + "</span>" +
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
  function openPickerPop(name, anchor) {
    const store = document.querySelector("#plan-result .cov-picker-store[data-name=\"" + name + "\"]");
    if (!store) return;
    if (STATE.openPicker === name) {
      closePickerPop();
      return;
    }
    closeColFilter();
    let pop = $("plan-picker-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "plan-picker-pop";
      pop.className = "cov-picker-pop";
      document.body.appendChild(pop);
    }
    STATE.openPicker = name;
    anchor.classList.add("on");
    const title = anchor.querySelector(".cov-picker-label");
    const items = PICKER_STORE[name] || [];
    const selected = pickerSelected(name);
    const all = !selected.length;
    const set = {};
    selected.forEach(function (id) { set[String(id)] = true; });
    pop.hidden = false;
    pop.innerHTML =
      "<div class=\"cov-picker-pop-head\">" + escapeHtml(title ? title.textContent : name) + "</div>" +
      "<input type=\"search\" class=\"cov-picker-pop-q\" placeholder=\"Поиск…\" />" +
      "<div class=\"cov-picker-pop-actions\">" +
      "<button type=\"button\" data-act=\"all\">Все</button>" +
      "<button type=\"button\" data-act=\"none\">Сбросить</button>" +
      "<button type=\"button\" data-act=\"done\" class=\"primary\">Готово</button></div>" +
      "<div class=\"cov-picker-pop-list\">" +
      items.map(function (item) {
        const on = all || set[String(item.id)];
        return "<label><input type=\"checkbox\" value=\"" + escapeHtml(item.id) + "\"" +
          (on ? " checked" : "") + " /> <span>" + escapeHtml(item.title) + "</span></label>";
      }).join("") +
      "</div>";
    const listEl = pop.querySelector(".cov-picker-pop-list");
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
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
        listEl.querySelectorAll("input").forEach(function (el) {
          if (el.closest("label").style.display === "none") return;
          el.checked = true;
        });
        return;
      }
      if (act === "none") {
        listEl.querySelectorAll("input").forEach(function (el) { el.checked = false; });
        return;
      }
      if (act === "done") {
        const picked = Array.prototype.slice.call(listEl.querySelectorAll("input:checked"))
          .map(function (el) { return el.value; });
        if (!picked.length || picked.length === items.length) setPickerSelected(name, []);
        else setPickerSelected(name, picked);
        closePickerPop();
        updatePickerSummary(name);
        paintTable();
        renderSummary(STATE.summary);
      }
    };
  }
  function mountPlanPickers() {
    mountPicker($("plan-pick-stock"), "plan-stock", STOCK_ITEMS);
    mountPicker($("plan-pick-prio"), "plan-prio", PRIO_ITEMS);
    mountPicker($("plan-pick-rev"), "plan-rev", REV_ITEMS);
  }
  function openColFilter(key, anchor) {
    let pop = $("plan-col-filter-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "plan-col-filter-pop";
      pop.className = "cov-col-filter-pop";
      document.body.appendChild(pop);
    }
    STATE.openFilter = key;
    closePickerPop();
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
        pop.querySelectorAll(".cov-col-filter-list input").forEach(function (el) { el.checked = false; });
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
  function renderSummary(summary) {
    const box = $("plan-summary");
    if (!box) return;
    summary = summary || {};
    const stockOnly = STATE.stockFilters.length === 1 ? STATE.stockFilters[0] : "";
    const items = [
      ["all", "В срезе", summary.total],
      ["with_stock", "На складе", summary.with_stock],
      ["without", "Без совпадения", summary.without],
      ["groups", "Групп ГК", summary.groups],
    ];
    box.innerHTML = items.map(function (item) {
      const clickable = item[0] !== "groups";
      const on = clickable && (
        (item[0] === "all" && !STATE.stockFilters.length && !STATE.priorityFilters.length && !STATE.revenueBuckets.length) ||
        (item[0] !== "all" && stockOnly === item[0] && !STATE.priorityFilters.length && !STATE.revenueBuckets.length)
      );
      return "<div class=\"cov-kpi" + (on ? " on" : "") + "\" data-plan=\"" +
        (clickable ? item[0] : "") + "\"><span>" + item[1] + "</span><b>" + (item[2] == null ? 0 : item[2]) + "</b></div>";
    }).join("");
    box.querySelectorAll(".cov-kpi[data-plan]").forEach(function (el) {
      if (!el.getAttribute("data-plan")) return;
      el.addEventListener("click", function () {
        const key = el.getAttribute("data-plan");
        STATE.priorityFilters = [];
        STATE.revenueBuckets = [];
        if (key === "all") STATE.stockFilters = [];
        else STATE.stockFilters = [key];
        updatePickerSummary("plan-stock");
        updatePickerSummary("plan-prio");
        updatePickerSummary("plan-rev");
        paintTable();
        renderSummary(STATE.summary);
      });
    });
  }
  function prioBadge(priority) {
    const cls = priority && priority.indexOf("Горячие") >= 0 ? "ok"
      : priority && priority.indexOf("Новые") >= 0 ? ""
      : priority && (priority.indexOf("Потерянные") >= 0 || priority.indexOf("Спящие") >= 0) ? "bad"
      : priority && priority.indexOf("Не сейчас") >= 0 ? "" : "mail";
    return "<span class=\"cov-badge " + cls + "\">" + escapeHtml(priority || "—") + "</span>";
  }
  function membersHtml(row) {
    const members = row.members || [];
    if (members.length <= 1) return "";
    return "<tr class=\"plan-members\"><td colspan=\"" + COLS.length + "\">" +
      "<div class=\"plan-members-list\">" + members.map(function (m) {
        const title = m.url
          ? "<a class=\"file-link\" href=\"" + escapeHtml(m.url) +
            "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(m.name || "") + "</a>"
          : "<strong>" + escapeHtml(m.name || "") + "</strong>";
        return "<div class=\"plan-member" + (m.is_head ? " head" : "") + "\">" +
          title +
          "<span class=\"hint\"> · ср.чек " + money(m.avg_check) +
          " · в базе " + num(m.days_in_base) +
          " · выручка " + money(m.revenue) +
          (m.in_plan ? "" : " · нет реализаций в 1С у этого МОПа") +
          "</span></div>";
      }).join("") + "</div></td></tr>";
  }
  function nameCell(row) {
    const label = escapeHtml(row.name || "—");
    const gkBadge = (row.members_count || 1) > 1
      ? " <span class=\"cov-badge\" title=\"Группа компаний: " + (row.members_count || 1) +
        " юрлиц. Дни без покупки, интервал, ср. чек, выручка и статус — по всей группе.\">ГК · " +
        (row.members_count || 1) + "</span>"
      : "";
    if (row.url) {
      return "<a class=\"file-link\" href=\"" + escapeHtml(row.url) +
        "\" target=\"_blank\" rel=\"noopener\">" + label + "</a>" + gkBadge;
    }
    return label + gkBadge;
  }
  function countOffers(row) {
    if (row.offers_count != null && row.offers_count !== "") {
      const n = Number(row.offers_count);
      if (isFinite(n)) return n;
    }
    if (row.offer_items && row.offer_items.length) return row.offer_items.length;
    const text = String(row.offers || "").trim();
    if (!text || text === "нет подходящих позиций в остатках") return 0;
    return offerBlocks(text).length;
  }
  function boughtCountCell(row) {
    const n = Number(row.bought_count || (row.bought || []).length || 0);
    return "<button type=\"button\" class=\"plan-bought-btn\" data-id=\"" +
      escapeHtml(row.id) + "\" data-focus=\"bought\">" + n + " →</button>";
  }
  function offersCountCell(row) {
    const n = countOffers(row);
    return "<button type=\"button\" class=\"plan-bought-btn\" data-id=\"" +
      escapeHtml(row.id) + "\" data-focus=\"offers\">" + n + " →</button>";
  }
  function offerBlocks(text) {
    return String(text || "")
      .split(/\n-\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  function paintDetail(row, focus) {
    const panel = $("plan-detail");
    if (!panel) return;
    if (!row) {
      panel.innerHTML = "<p class=\"hint\" style=\"margin:0\">Кликните «N →» у покупок или предложений — здесь откроется полный список.</p>";
      return;
    }
    const bought = row.bought || [];
    const boughtList = bought.length
      ? "<div class=\"cov-timeline\">" + bought.map(function (item) {
          return "<div class=\"cov-event\">" +
            "<div class=\"cov-event-title\">" + escapeHtml(item.display || "—") + "</div>" +
            "<div class=\"cov-event-meta\">" +
            escapeHtml(String(Math.round(Number(item.qty) || 0))) + " шт · " +
            money(item.revenue) + " · последний раз " +
            escapeHtml(item.last_month || "—") +
            "</div></div>";
        }).join("") + "</div>"
      : "<p class=\"hint\" style=\"margin:8px 0 0\">Нет разбивки покупок по SKU</p>";
    const offerItems = row.offer_items || [];
    let offersHtml;
    if (offerItems.length) {
      offersHtml = "<div class=\"cov-timeline\">" + offerItems.map(function (item) {
        return "<div class=\"cov-event\">" +
          "<div class=\"cov-event-title\">" + escapeHtml(item.display || "—") + "</div>" +
          "<div class=\"cov-event-meta\">" +
          escapeHtml(item.note || "повтор") + " · " +
          escapeHtml(item.location || "—") + " · " +
          escapeHtml(String(Math.round(Number(item.qty) || 0))) + " шт · " +
          money(item.price) +
          (item.article ? " · арт. " + escapeHtml(String(item.article)) : "") +
          "</div></div>";
      }).join("") + "</div>";
    } else {
      const blocks = offerBlocks(row.offers).filter(function (b) {
        return b !== "нет подходящих позиций в остатках";
      });
      offersHtml = blocks.length
        ? "<div class=\"cov-timeline\">" + blocks.map(function (b) {
            return "<div class=\"cov-event\"><div class=\"cov-quote\" style=\"white-space:pre-wrap;margin:0\">" +
              escapeHtml(b) + "</div></div>";
          }).join("") + "</div>"
        : "<p class=\"hint\" style=\"margin:8px 0 0\">нет подходящих позиций в остатках</p>";
    }
    const members = row.members || [];
    const membersHtmlBlock = members.length > 1
      ? "<div class=\"cov-detail-meta\" style=\"margin-top:8px\"><span>Состав ГК:</span> " +
        members.map(function (m) {
          const label = escapeHtml(m.name || "—");
          const link = m.url
            ? "<a class=\"file-link\" href=\"" + escapeHtml(m.url) +
              "\" target=\"_blank\" rel=\"noopener\">" + label + "</a>"
            : label;
          return link + " (" + money(m.revenue) +
            (m.in_plan ? "" : ", нет реализаций в 1С") + ")";
        }).join(" · ") + "</div>"
      : "";
    const title = row.url
      ? "<a class=\"file-link\" href=\"" + escapeHtml(row.url) +
        "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(row.name || "—") + "</a>"
      : escapeHtml(row.name || "—");
    const countLabel = focus === "offers"
      ? (offerItems.length || offerBlocks(row.offers).length) + " предложений"
      : bought.length + " покупок";
    panel.innerHTML =
      "<div class=\"cov-detail-top\">" +
      "<h3>" + title + "</h3>" +
      "<span class=\"cov-detail-count\">" + countLabel + "</span></div>" +
      "<div class=\"cov-detail-meta\">" +
      "<span>" + prioBadge(row.priority) + "</span>" +
      "<span>МОП: " + escapeHtml(row.manager || "—") + "</span>" +
      "<span>RFM: " + escapeHtml(row.rfm || "—") + "</span>" +
      "<span>ГК: " + (row.members_count || 1) + "</span>" +
      "<span>Выручка: " + money(row.revenue) + "</span></div>" +
      membersHtmlBlock +
      "<h4 class=\"cov-events-title\" id=\"plan-detail-bought\">Все купленные позиции</h4>" + boughtList +
      "<h4 class=\"cov-events-title\" id=\"plan-detail-offers\">Что предложить</h4>" + offersHtml;
    const anchor = focus === "offers" ? $("plan-detail-offers") : $("plan-detail-bought");
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function selectRow(row, focus) {
    STATE.selected = row || null;
    paintTable();
    paintDetail(STATE.selected, focus || "bought");
    const panel = $("plan-detail");
    if (panel && STATE.selected) {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  function tipAttr(text) {
    const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t || t === "—") return "";
    return " title=\"" + escapeHtml(t) + "\"";
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
          tableRoot.querySelectorAll("tbody tr.cov-row").forEach(function (tr) {
            const td = tr.children[idx];
            if (!td) return;
            td.style.width = w + "px";
            td.style.minWidth = w + "px";
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
  function paintTable() {
    STATE.view = visibleRows();
    const meta = $("plan-view-meta");
    if (meta) {
      const filt = hasColFilters() ? " · есть фильтры по столбцам" : "";
      meta.textContent = "На экране " + STATE.view.length + " из " + STATE.rows.length +
        filt +
        ". Тяните край заголовка — ширина колонки. Наведите на ячейку — полный текст. «Сформировать файл» — Excel видимого среза.";
    }
    const clearBtn = $("plan-clear-col-filters");
    if (clearBtn) clearBtn.hidden = !hasColFilters();
    const table = $("plan-table");
    if (!table) return;
    if (!STATE.rows.length) {
      table.innerHTML = "<p class='empty'>Нет строк.</p>";
      paintDetail(null);
      return;
    }
    function arrow(key) {
      if (STATE.sortKey !== key) return "";
      return STATE.sortDir > 0 ? " ↑" : " ↓";
    }
    function colStyle(key) {
      const w = STATE.colWidths[key] || COL_DEFAULT_W[key] || 120;
      return "width:" + w + "px;min-width:" + w + "px;max-width:" + w + "px";
    }
    const bodyHtml = STATE.view.length
      ? STATE.view.map(function (row) {
          const open = !!STATE.expanded[row.id];
          const canExpand = (row.members_count || 1) > 1;
          const selected = STATE.selected && STATE.selected.id === row.id;
          const gkLabel = String(row.members_count || 1);
          const gk = canExpand
            ? "<button type=\"button\" class=\"plan-exp\" data-id=\"" + escapeHtml(row.id) + "\">" +
              (open ? "−" : "+") + " " + gkLabel + "</button>"
            : gkLabel;
          const daysBuy = num(row.days_since_buy);
          const median = num(row.median_interval);
          const avg = money(row.avg_check);
          const daysBase = num(row.days_in_base);
          const rev = money(row.revenue);
          const stock = num(row.stock_hits);
          const brands = row.brands || "—";
          const boughtN = String(row.bought_count || (row.bought || []).length || 0);
          const offersN = String(countOffers(row));
          return "<tr class=\"cov-row" + (selected ? " on" : "") + "\" data-id=\"" +
            escapeHtml(row.id) + "\">" +
            "<td style=\"" + colStyle("name") + "\"" + tipAttr(row.name) + ">" + nameCell(row) + "</td>" +
            "<td style=\"" + colStyle("gk") + "\"" + tipAttr("ГК: " + gkLabel) + ">" + gk + "</td>" +
            "<td style=\"" + colStyle("manager") + "\"" + tipAttr(row.manager) + ">" + escapeHtml(row.manager || "—") + "</td>" +
            "<td style=\"" + colStyle("priority") + "\"" + tipAttr(row.priority) + ">" + prioBadge(row.priority) + "</td>" +
            "<td style=\"" + colStyle("rhythm") + "\"" + tipAttr(row.rhythm) + ">" + escapeHtml(row.rhythm || "—") + "</td>" +
            "<td style=\"" + colStyle("cycle_status") + "\"" + tipAttr(row.cycle_status) + ">" + escapeHtml(row.cycle_status || "—") + "</td>" +
            "<td style=\"" + colStyle("rfm") + "\"" + tipAttr(row.rfm) + ">" + escapeHtml(row.rfm || "—") + "</td>" +
            "<td style=\"" + colStyle("lifecycle") + "\"" + tipAttr(row.lifecycle) + ">" + escapeHtml(row.lifecycle || "—") + "</td>" +
            "<td style=\"" + colStyle("days_since_buy") + "\"" + tipAttr(daysBuy) + ">" + daysBuy + "</td>" +
            "<td style=\"" + colStyle("median_interval") + "\"" + tipAttr(median) + ">" + median + "</td>" +
            "<td style=\"" + colStyle("avg_check") + "\"" + tipAttr(avg) + ">" + avg + "</td>" +
            "<td style=\"" + colStyle("days_in_base") + "\"" + tipAttr(daysBase) + ">" + daysBase + "</td>" +
            "<td style=\"" + colStyle("revenue") + "\"" + tipAttr(rev) + ">" + rev + "</td>" +
            "<td style=\"" + colStyle("stock_hits") + "\"" + tipAttr(stock) + ">" + stock + "</td>" +
            "<td style=\"" + colStyle("brands") + "\"" + tipAttr(brands) + ">" + escapeHtml(brands) + "</td>" +
            "<td style=\"" + colStyle("bought_count") + "\"" + tipAttr("Покупок: " + boughtN) + ">" + boughtCountCell(row) + "</td>" +
            "<td style=\"" + colStyle("offers_count") + "\"" + tipAttr("Предложений: " + offersN) + ">" + offersCountCell(row) + "</td>" +
            "</tr>" + (open ? membersHtml(row) : "");
        }).join("")
      : "<tr><td colspan=\"" + COLS.length + "\" class=\"empty\">Нет строк под текущий поиск и фильтры.</td></tr>";
    table.innerHTML =
      "<div class=\"table-wrap cov-wrap\"><table class=\"flat cov-grid\"><thead><tr>" +
      COLS.map(function (c) {
        const active = colFilterActive(c.key);
        return "<th data-sort=\"" + c.key + "\" style=\"" + colStyle(c.key) + "\"" + tipAttr(c.title) + ">" +
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
        const key = th.getAttribute("data-sort");
        if (STATE.sortKey === key) STATE.sortDir *= -1;
        else {
          STATE.sortKey = key;
          STATE.sortDir = key === "priority" || key === "name" ? 1 : -1;
        }
        paintTable();
      });
    });
    table.querySelectorAll(".cov-th-filter").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const key = btn.getAttribute("data-filter");
        if (STATE.openFilter === key) closeColFilter();
        else openColFilter(key, btn);
      });
    });
    bindColResize(table);
    table.querySelectorAll(".plan-exp").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        STATE.expanded[id] = !STATE.expanded[id];
        paintTable();
      });
    });
    table.querySelectorAll(".plan-bought-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const focus = btn.getAttribute("data-focus") || "bought";
        const row = STATE.view.find(function (r) { return r.id === id; }) ||
          STATE.rows.find(function (r) { return r.id === id; });
        selectRow(row || null, focus);
      });
    });
    table.querySelectorAll("tr.cov-row").forEach(function (tr) {
      tr.addEventListener("click", function (e) {
        if (e.target.closest && (
          e.target.closest("a") ||
          e.target.closest("button") ||
          e.target.closest(".plan-exp")
        )) return;
        const id = tr.getAttribute("data-id");
        const row = STATE.view.find(function (r) { return r.id === id; }) ||
          STATE.rows.find(function (r) { return r.id === id; });
        selectRow(row || null, "bought");
      });
    });
  }
  function showResult(rows, summary) {
    STATE.rows = rows || [];
    STATE.summary = summary || {};
    STATE.stockFilters = [];
    STATE.priorityFilters = [];
    STATE.revenueBuckets = [];
    STATE.search = "";
    STATE.colFilters = {};
    STATE.expanded = {};
    STATE.selected = null;
    closeColFilter();
    closePickerPop();
    const search = $("plan-search");
    if (search) search.value = "";
    const result = must("plan-result");
    result.hidden = false;
    mountPlanPickers();
    renderSummary(STATE.summary);
    paintTable();
    paintDetail(null);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function buildTable() {
    const btn = must("plan-btn");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Сборка…";
    showMsg("", true);
    try {
      const res = await window.rtlFetch("api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managers: selectedManagers(),
          report_date: ($("plan-date") && $("plan-date").value) || null,
        }),
      });
      const raw = await res.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (err) {
        showMsg("Сервер вернул ошибку (не JSON). Код " + res.status + ".", false);
        return;
      }
      if (!body || !body.ok) {
        showMsg((body && body.error) || ("Не собралось (код " + res.status + ")"), false);
        return;
      }
      showResult(body.rows || [], body.summary || {});
      showMsg("Таблица готова: " + ((body.summary && body.summary.total) || 0) + " строк. При необходимости сформируйте Excel.", true);
    } catch (err) {
      showMsg((err && err.message) || "Сервер не отвечает.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  async function exportXlsx() {
    if (!STATE.view.length) {
      showMsg("Нет видимых строк для Excel.", false);
      return;
    }
    const btn = must("plan-xlsx");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Файл…";
    try {
      const summary = Object.assign({}, STATE.summary || {}, {
        total: STATE.view.length,
        with_stock: STATE.view.filter(function (r) { return r.with_stock; }).length,
        without: STATE.view.filter(function (r) { return !r.with_stock; }).length,
        groups: STATE.view.filter(function (r) { return (r.members_count || 1) > 1; }).length,
      });
      const res = await window.rtlFetch("api/plan/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: STATE.view, summary: summary }),
      });
      const body = await res.json();
      if (!body.ok) {
        showMsg(body.error || "Не удалось сформировать файл", false);
        return;
      }
      showMsg("Excel готов: " + ((body.file && body.file.name) || ""), true);
      if (typeof window.loadState === "function") await window.loadState();
    } catch (err) {
      showMsg((err && err.message) || "Сервер не отвечает.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  function bind() {
    if (!$("plan-btn")) return;
    must("plan-btn").addEventListener("click", buildTable);
    const xlsx = $("plan-xlsx");
    if (xlsx) xlsx.addEventListener("click", exportXlsx);
    const search = $("plan-search");
    if (search) {
      search.addEventListener("input", function () {
        STATE.search = search.value || "";
        paintTable();
      });
    }
    document.querySelectorAll("#plan-chips .cov-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.planFilter = btn.getAttribute("data-plan") || "all";
        syncChips();
        paintTable();
        renderSummary(STATE.summary);
      });
    });
    document.querySelectorAll("#plan-rev-chips .cov-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = btn.getAttribute("data-rev");
        if (!id) return;
        const idx = STATE.revenueBuckets.indexOf(id);
        if (idx >= 0) STATE.revenueBuckets.splice(idx, 1);
        else STATE.revenueBuckets.push(id);
        syncRevChips();
        paintTable();
      });
    });
    const clearBtn = $("plan-clear-col-filters");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        STATE.colFilters = {};
        closeColFilter();
        paintTable();
      });
    }
    document.addEventListener("click", function (e) {
      const colPop = $("plan-col-filter-pop");
      if (colPop && !colPop.hidden) {
        if (!(e.target.closest && (e.target.closest("#plan-col-filter-pop") || e.target.closest(".cov-th-filter")))) {
          closeColFilter();
        }
      }
      const pickPop = $("plan-picker-pop");
      if (pickPop && !pickPop.hidden) {
        if (!(e.target.closest && (e.target.closest("#plan-picker-pop") || e.target.closest(".cov-picker-btn")))) {
          closePickerPop();
        }
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
