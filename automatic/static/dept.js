(function () {
  const STATE = { payload: null, fileName: "" };
  const PRICE_KEY = "rtl_dept_price_date";

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
    const msg = $("dept-msg");
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
  function mln(v) {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!isFinite(n)) return "—";
    return (n / 1e6).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " млн";
  }
  function num(v) {
    if (v == null || v === "") return "—";
    return Number(v).toLocaleString("ru-RU");
  }
  function cell(v, cls) {
    return "<td" + (cls ? " class=\"" + cls + "\"" : "") + ">" + escapeHtml(v) + "</td>";
  }
  function moneyCell(v) {
    return "<td class=\"num\">" + escapeHtml(money(v)) + "</td>";
  }
  function tableHtml(headers, rows, emptyText) {
    if (!rows || !rows.length) {
      return "<p class=\"hint\" style=\"margin:0\">" + escapeHtml(emptyText || "Нет строк") + "</p>";
    }
    const head = headers.map(function (h) {
      return "<th" + (h.cls ? " class=\"" + h.cls + "\"" : "") + ">" + escapeHtml(h.title) + "</th>";
    }).join("");
    const body = rows.join("");
    return "<table class=\"flat\"><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function paint(payload) {
    STATE.payload = payload;
    STATE.fileName = (payload.file && payload.file.name) || STATE.fileName || "";
    const dept = payload.dept || {};
    const total = dept.total || {};
    const current = dept.current || {};
    const neu = dept.new || {};
    const r1 = dept.r1 || {};
    const growth = dept.growth || {};
    const market = payload.market || {};
    const uplift = payload.uplift || {};

    must("dept-result").hidden = false;
    must("dept-summary").innerHTML = [
      ["Песс", total.pess],
      ["Реал", total.real],
      ["Опт", total.opt],
    ].map(function (item) {
      return "<div class=\"cov-kpi dept-kpi\"><span>" + item[0] + "</span><b>" +
        escapeHtml(mln(item[1])) + "</b></div>";
    }).join("");

    const bits = [
      "Месяц " + (payload.forecast_label || "—"),
      "данные 1С до " + (payload.data_through ? formatStamp(payload.data_through) : "—"),
      "покупателей " + num(payload.n_buyers),
      "склад " + (payload.stock_updated || "—"),
      "цены " + (payload.price_stamp || market.stamp || "—"),
    ];
    if (uplift.synced_at) bits.push("CRM " + uplift.synced_at);
    if (payload.retro) bits.push("ретро-план: склад, цены и воронка — на сегодня, не на тот месяц");
    must("dept-meta").textContent = bits.join(" · ");

    const layers = [
      ["Текущие после склада", current],
      ["Новые после склада", neu],
      ["Р1 без двойного счёта", r1],
      ["Задел на рост", growth],
      ["Итого план", total],
    ];
    must("dept-layers").innerHTML = tableHtml(
      [{ title: "Слой" }, { title: "Песс", cls: "num" }, { title: "Реал", cls: "num" }, { title: "Опт", cls: "num" }],
      layers.map(function (row) {
        const v = row[1] || {};
        return "<tr>" + cell(row[0]) + moneyCell(v.pess) + moneyCell(v.real) + moneyCell(v.opt) + "</tr>";
      })
    );

    (function paintDemand() {
      const host = $("dept-demand");
      if (!host) return;
      const g = function (o, k) { const n = Number(o && o[k]); return isFinite(n) ? n : 0; };
      const m1 = function (v) {
        return (v / 1e6).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      };
      const dCur = payload.demand || {}, sCur = payload.ship_stock || {}, mCur = dept.current_in_market || {};
      const dNew = payload.demand_new_all || {}, sNew = payload.ship_new || {}, mNew = dept.new_in_market || {};
      const add = function (a, b) {
        const o = {};
        ["pess", "real", "opt"].forEach(function (k) { o[k] = g(a, k) + g(b, k); });
        return o;
      };
      const blocks = [
        ["Текущие клиенты", dCur, sCur, mCur],
        ["Новые клиенты", dNew, sNew, mNew],
        ["Всего", add(dCur, dNew), add(sCur, sNew), add(mCur, mNew)],
      ];
      const lines = [
        ["Хотят купить", function (d, s, m, k) { return g(d, k); }, "спрос по истории и циклу покупок"],
        ["− Нет товара", function (d, s, m, k) { return Math.max(0, g(d, k) - g(s, k)); }, "закупка / поставка"],
        ["→ Есть товар", function (d, s, m, k) { return g(s, k); }, "закроем складом и в пути"],
        ["− Цена выше рынка", function (d, s, m, k) { return Math.max(0, g(s, k) - g(m, k)); }, "выравнивание цены"],
        ["→ Продаём по рынку", function (d, s, m, k) { return g(m, k); }, "реальный потенциал при текущих ценах"],
      ];
      const rows = [];
      blocks.forEach(function (blk) {
        rows.push("<tr class=\"dept-block\"><td colspan=\"5\" style=\"background:#1e3a5f;color:#fff;font-weight:700\">" +
          escapeHtml(blk[0]) + "</td></tr>");
        lines.forEach(function (ln, idx) {
          const key = idx === 4;
          const cellStyle = key ? " style=\"background:#d1fae5;font-weight:700\"" : "";
          rows.push("<tr><td" + cellStyle + ">" + (idx % 2 === 1 || idx === 3 ? "&nbsp;&nbsp;" : "") + escapeHtml(ln[0]) + "</td>" +
            ["pess", "real", "opt"].map(function (k) {
              return "<td class=\"num\"" + cellStyle + ">" + m1(ln[1](blk[1], blk[2], blk[3], k)) + "</td>";
            }).join("") +
            "<td style=\"color:#6b7280;font-size:12px" + (key ? ";background:#d1fae5;font-weight:700" : "") + "\">" + escapeHtml(ln[2]) + "</td></tr>");
        });
      });
      const r1v = dept.r1 || {}, grv = dept.growth || {}, tpv = dept.total || {};
      const have = add(sCur, sNew);
      rows.push("<tr><td colspan=\"5\" style=\"background:#14532d;color:#fff;font-weight:700\">Как это связано с «Итого план»</td></tr>");
      [
        ["Есть товар (текущие + новые)", have, "из блока «Всего» выше", false],
        ["+ Р1: сделки в воронке", r1v, "подтверждённые сделки «1С РТЛ»", false],
        ["+ Задел на рост", grv, "доля «Нет товара»: песс 20% / реал 50% / опт 100%", false],
        ["→ Итого план отдела", tpv, "та же цифра, что в KPI вверху", true],
      ].forEach(function (ln) {
        const st = ln[3] ? " style=\"background:#dcfce7;font-weight:700\"" : "";
        rows.push("<tr><td" + st + ">" + escapeHtml(ln[0]) + "</td>" + ["pess", "real", "opt"].map(function (k) {
          return "<td class=\"num\"" + st + ">" + (g(ln[1], k) / 1e6).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "</td>";
        }).join("") + "<td style=\"color:#6b7280;font-size:12px" + (ln[3] ? ";background:#dcfce7" : "") + "\">" + escapeHtml(ln[2]) + "</td></tr>");
      });
      host.innerHTML = tableHtml(
        [{ title: "млн ₽" }, { title: "Песс", cls: "num" }, { title: "Реал", cls: "num" }, { title: "Опт", cls: "num" }, { title: "Что это значит" }],
        rows
      ) + "<p class=\"hint\" style=\"margin:8px 0 0\">«Итого план» считается от «Есть товар», а не от «Продаём по рынку»: цена не в рынке из плана не вычитается, это риск. " +
        "Если цена не выровняется, реально продадим ближе к «Продаём по рынку» + Р1.</p>";
    })();

    const inMarket = (dept.current_in_market || {}).real;
    const riskRows = [
      ["Текущие после склада", current.real],
      ["из них на рыночных позициях", inMarket],
      ["спрос не в рынке", market.demand_off_market],
      ["ёмкость склада в рынке", market.stock_in_market],
      ["ёмкость склада не в рынке", market.stock_off_market],
    ];
    const offGroups = (payload.stock || []).filter(function (row) {
      return Number(row.demand_off_market) > 0;
    }).sort(function (a, b) {
      return Number(b.demand_off_market) - Number(a.demand_off_market);
    }).slice(0, 20);
    let riskHtml = tableHtml(
      [{ title: "Риск" }, { title: "Сумма", cls: "num" }],
      riskRows.map(function (row) {
        return "<tr>" + cell(row[0]) + moneyCell(row[1]) + "</tr>";
      })
    );
    if (offGroups.length) {
      riskHtml += "<p class=\"hint\" style=\"margin:12px 0 6px\">Группы, где спрос не закрывается рыночным остатком</p>";
      riskHtml += tableHtml(
        [{ title: "Группа" }, { title: "Статус" }, { title: "Спрос", cls: "num" }, { title: "Не в рынке", cls: "num" }],
        offGroups.map(function (row) {
          return "<tr>" + cell(row.display || "—") + cell(row.market_status || "—") +
            moneyCell(row.demand_real) + moneyCell(row.demand_off_market) + "</tr>";
        })
      );
    }
    must("dept-risk").innerHTML = riskHtml;

    const r1Rows = payload.r1 || [];
    must("dept-r1").innerHTML = tableHtml(
      [{ title: "Покупатель" }, { title: "МОП" }, { title: "Р1", cls: "num" }, { title: "В план", cls: "num" }, { title: "Пересечение", cls: "num" }, { title: "Что" }],
      r1Rows.map(function (row) {
        const name = row.url
          ? "<a href=\"" + escapeHtml(row.url) + "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(row.buyer || "—") + "</a>"
          : escapeHtml(row.buyer || "—");
        return "<tr><td class=\"wrap\">" + name + "</td>" + cell(row.manager || "—") +
          moneyCell(row.amount) + moneyCell(row.added) + moneyCell(row.overlap) +
          "<td class=\"wrap\">" + escapeHtml(row.what || "—") + "</td></tr>";
      }),
      uplift.r1_n ? "Нет расшифровки Р1" : "Открытых Р1 в план нет"
    );

    const mgr = (payload.managers || []).slice();
    must("dept-mgr").innerHTML = tableHtml(
      [{ title: "МОП" }, { title: "ГК", cls: "num" }, { title: "Текущие", cls: "num" }, { title: "Новые", cls: "num" }, { title: "Песс", cls: "num" }, { title: "Реал", cls: "num" }, { title: "Опт", cls: "num" }],
      mgr.map(function (row) {
        return "<tr>" + cell(row.manager || "—") +
          "<td class=\"num\">" + escapeHtml(num(row.buyers)) + "</td>" +
          moneyCell(row.ship_real) + moneyCell(row.new_ship_real) +
          moneyCell(row.total_pess) + moneyCell(row.total_real) + moneyCell(row.total_opt) + "</tr>";
      }),
      "Нет МОПов"
    );

    const xlsx = $("dept-xlsx");
    if (xlsx) {
      xlsx.hidden = !STATE.fileName;
      xlsx.textContent = STATE.fileName ? "Скачать Excel" : "Скачать Excel";
    }
  }

  async function run() {
    const btn = must("dept-btn");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Считаем ~40 сек…";
    showMsg("Идёт расчёт: 1С, склад, цены, воронка 1С РТЛ.", true);
    const asOf = ($("dept-as-of") && $("dept-as-of").value) || "";
    const month = ($("dept-month") && $("dept-month").value) || "";
    const priceDate = ($("dept-price-date") && $("dept-price-date").value) || "";
    if (!priceDate) {
      btn.disabled = false;
      btn.textContent = label;
      showMsg("Выберите дату цен конкурентов.", false);
      return;
    }
    try {
      try { localStorage.setItem(PRICE_KEY, priceDate); } catch (err) {}
      const res = await window.rtlFetch("api/dept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          as_of: asOf || null,
          month: month || null,
          price_date: priceDate || null,
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
      paint(body);
      const total = (body.dept && body.dept.total) || {};
      showMsg("Готово: реал " + mln(total.real) + ". Excel во вкладке «Готовые».", true);
      if (window.loadState) await window.loadState();
    } catch (err) {
      showMsg((err && err.message) || "Сервер не отвечает.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function formatStamp(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return String(iso || "");
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  function monthLabel(ym) {
    const names = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август",
      "сентябрь", "октябрь", "ноябрь", "декабрь"];
    const p = String(ym || "").split("-");
    if (p.length !== 2) return String(ym || "");
    return names[Number(p[1]) - 1] + " " + p[0];
  }
  function lastDayBefore(ym) {
    const p = String(ym).split("-");
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, 1) - 86400000);
    return String(d.getUTCDate()).padStart(2, "0") + "." + String(d.getUTCMonth() + 1).padStart(2, "0") + "." + d.getUTCFullYear();
  }
  function paintMonths(body) {
    const sel = $("dept-month");
    const note = $("dept-month-note");
    if (!sel) return;
    const months = (body && body.months) || [];
    if (!months.length) {
      sel.innerHTML = "<option value=\"\">По умолчанию</option>";
      return;
    }
    const def = body.default_month || months[months.length - 1];
    sel.innerHTML = months.map(function (ym) {
      const extra = ym === def ? " — текущий" : " — ретро";
      return "<option value=\"" + escapeHtml(ym) + "\">" + escapeHtml(monthLabel(ym) + extra) + "</option>";
    }).join("");
    sel.value = def;
    function upd() {
      if (!note) return;
      const retro = sel.value && sel.value !== def;
      note.textContent = "План на " + monthLabel(sel.value) + " строится по данным 1С до " + lastDayBefore(sel.value) +
        " включительно. Последний день данных в загрузке: " + formatStamp(body.data_end || "") + "." +
        (retro ? " Ретро-план: склад, цены и воронка берутся на сегодня." : "");
    }
    sel.onchange = upd;
    upd();
  }

  async function loadMeta() {
    const sel = $("dept-price-date");
    if (!sel) return;
    try {
      if (!window.rtlFetch) return;
      const res = await window.rtlFetch("api/dept/meta");
      const body = await res.json();
      paintMonths(body);
      const dates = (body && body.price_dates) || [];
      if (!dates.length) {
        sel.innerHTML = "<option value=\"\">Нет срезов цен</option>";
        return;
      }
      let saved = "";
      try { saved = localStorage.getItem(PRICE_KEY) || ""; } catch (err) {}
      const picked = dates.indexOf(saved) >= 0 ? saved : (body.default_price_date || dates[0]);
      sel.innerHTML = dates.map(function (iso, i) {
        const extra = i === 0 ? " — последний" : "";
        return "<option value=\"" + escapeHtml(iso) + "\">" + escapeHtml(formatStamp(iso)) + extra + "</option>";
      }).join("");
      sel.value = picked;
    } catch (err) {
      sel.innerHTML = "<option value=\"\">Не удалось загрузить срезы</option>";
    }
  }

  async function loadLast() {
    try {
      if (!window.rtlFetch) return;
      const res = await window.rtlFetch("api/dept");
      if (!res.ok) return;
      const body = await res.json();
      if (body && body.ok) paint(body);
    } catch (err) {}
  }

  function bind() {
    if (!$("dept-btn")) return;
    $("dept-btn").addEventListener("click", run);
    const sel = $("dept-price-date");
    if (sel) {
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        try { localStorage.setItem(PRICE_KEY, sel.value); } catch (err) {}
      });
    }
    const xlsx = $("dept-xlsx");
    if (xlsx) {
      xlsx.addEventListener("click", function () {
        if (!STATE.fileName || !window.rtlDownload) return;
        window.rtlDownload(STATE.fileName).catch(function () {
          showMsg("Файл не скачался.", false);
        });
      });
    }
    (window.rtlReady || Promise.resolve()).then(function () {
      return loadMeta().then(loadLast);
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
