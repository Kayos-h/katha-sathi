/* Khata Sathi - dashboard view: KPIs, 30-day chart, aging, top debtors, activity */
"use strict";

/* global API, Live, ico, fmtMoney, fmtDate, fmtDateTime, timeAgo, avatarEl, escapeHtml, debounce */

const Dashboard = {
  id: "dash",
  title: "Dashboard",
  icon: "dash",
  data: null,

  async render(main) {
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Dashboard</div>' +
      '<div class="view-sub" id="dash-sub">Everything at a glance</div></div>' +
      '<div class="view-actions">' +
      '<button class="btn" id="dash-refresh">' + ico("undo") + "Refresh</button>" +
      "</div></div>" +
      '<div class="dash-grid" id="dash-grid">' +
      '<div class="empty"><div class="e-ico">' + ico("chart") + '</div><div class="e-t">Loading…</div></div>' +
      "</div>";
    main.querySelector("#dash-refresh").onclick = () => this.load(main);
    await this.load(main);
  },

  async load(main) {
    try {
      this.data = await API.get("/api/dashboard");
    } catch (e) {
      main.querySelector("#dash-grid").innerHTML =
        '<div class="empty w-span-12"><div class="e-ico">' + ico("warn") + '</div><div class="e-t">Could not load the dashboard</div><div class="e-s">' + escapeHtml(e.message) + '</div></div>';
      return;
    }
    const d = this.data;
    const today = d.today;

    main.querySelector("#dash-sub").textContent =
      today.n_bills + (today.n_bills === 1 ? " bill" : " bills") + " today · " +
      today.n_payments + (today.n_payments === 1 ? " payment" : " payments") + " today";

    let html = "";

    /* KPI cards */
    html += kpi("Total to collect", fmtMoney(d.total_to_collect), d.people_open + " people owing", "wallet", "indigo");
    html += kpi("Collected today", fmtMoney(today.collected), today.n_payments + " payments" + (today.collected_counter ? " + रू " + today.collected_counter + " paid at counter" : ""), "money", "green");
    html += kpi("Billed today", fmtMoney(today.billed), today.n_bills + " bills", "bill", "amber");
    html += kpi("People", String(d.total_people), d.open_count + " open bills", "people", "red");

    /* 30-day chart */
    html += '<div class="panel panel-pad w-span-8" id="chart-panel">' +
      '<div class="panel-title">' + ico("chart") + "Last 30 days</div>" +
      '<div class="chart-wrap">' +
      '<div class="chart-bars" id="chart-bars"></div>' +
      '<div class="chart-x"><span>30 days ago</span><span>15</span><span>Today</span></div>' +
      '<div class="chart-legend"><span><span class="dot b"></span>Billed (credit given)</span><span><span class="dot c"></span>Collected (money in)</span></div>' +
      "</div></div>";

    /* aging */
    html += '<div class="panel panel-pad w-span-4">' +
      '<div class="panel-title">' + ico("clock") + "How old is the money owed</div>" +
      '<div id="aging-rows"></div></div>';

    /* top debtors */
    html += '<div class="panel panel-pad w-span-5">' +
      '<div class="panel-title">' + ico("people") + "Biggest balances</div>" +
      '<div class="dept-list" id="dept-list"></div></div>';

    /* recent activity */
    html += '<div class="panel panel-pad w-span-7">' +
      '<div class="panel-title">' + ico("clock") + "Latest activity" +
      '<span style="margin-left:auto"><a href="#activity" style="font-size:11.5px;font-weight:700;color:var(--accent);text-decoration:none">SEE ALL ›</a></span></div>' +
      '<div class="act-list" id="act-list"></div></div>';

    const grid = main.querySelector("#dash-grid");
    grid.innerHTML = html;

    this.renderChart(grid, d.chart);
    this.renderAging(grid, d.aging, d.total_to_collect);
    this.renderDebtors(grid, d.top_debtors);

    /* activity */
    try {
      const act = await API.get("/api/activity?limit=8");
      this.renderActivity(grid.querySelector("#act-list"), act.items);
    } catch (e) {
      grid.querySelector("#act-list").innerHTML = emptyRow("Nothing yet");
    }

    grid.querySelector("#dept-list").addEventListener("click", (e) => {
      const it = e.target.closest("[data-person]");
      if (it) App.go("ledger", { id: it.getAttribute("data-person") });
    });
    grid.querySelector("#act-list").addEventListener("click", (e) => {
      const it = e.target.closest("[data-person]");
      if (it) App.go("ledger", { id: it.getAttribute("data-person") });
    });
  },

  renderChart(grid, chart) {
    const wrap = grid.querySelector("#chart-bars");
    const max = Math.max(1, ...chart.map((c) => Math.max(c.billed, c.collected)));
    wrap.innerHTML = chart.map((c) => {
      const hb = Math.max(2, Math.round((c.billed / max) * 100));
      const hc = Math.max(2, Math.round((c.collected / max) * 100));
      return '<div class="chart-col">' +
        '<div class="bar billed" style="height:' + hb + '%"></div>' +
        '<div class="bar collected" style="height:' + hc + '%"></div>' +
        '<div class="tip">' + fmtDate(c.date) + "<br>Billed " + fmtMoney(c.billed) + "<br>Collected " + fmtMoney(c.collected) + "</div>" +
        "</div>";
    }).join("");
  },

  renderAging(grid, aging, total) {
    const wrap = grid.querySelector("#aging-rows");
    const colors = { "0-7": "var(--green)", "8-15": "var(--amber)", "16-30": "#f97316", "31-60": "#ef4444", "60+": "#b91c1c" };
    const labels = { "0-7": "0-7 days", "8-15": "8-15 days", "16-30": "16-30 days", "31-60": "31-60 days", "60+": "60+ days" };
    const max = Math.max(1, ...Object.values(aging));
    const any = Object.values(aging).some((v) => v > 0);
    wrap.innerHTML = Object.keys(aging).map((k) =>
      '<div class="aging-row"><div class="a-label">' + labels[k] + '</div>' +
      '<div class="a-track"><div class="a-fill" style="width:' + Math.round((aging[k] / max) * 100) + '%;background:' + colors[k] + '"></div></div>' +
      '<div class="a-val">' + fmtMoney(aging[k]) + "</div></div>"
    ).join("") || emptyRow("No open bills");
    if (!any) wrap.innerHTML = emptyRow("Nothing owed — all clear!");
  },

  renderDebtors(grid, top) {
    const wrap = grid.querySelector("#dept-list");
    if (!top.length) {
      wrap.innerHTML = emptyRow("No open balances");
      return;
    }
    wrap.innerHTML = top.map((t) =>
      '<div class="dept-item" data-person="' + t.id + '">' +
      avatarEl(t.name) +
      '<div><div class="d-name">' + escapeHtml(t.name) + '</div>' +
      '<div class="d-sub">' + t.open_count + " open bill" + (t.open_count === 1 ? "" : "s") + "</div></div>" +
      '<div class="d-bal"><div class="money neg">' + fmtMoney(t.balance) + "</div></div>" +
      "</div>"
    ).join("");
  },

  renderActivity(wrap, items) {
    if (!items.length) {
      wrap.innerHTML = emptyRow("No activity yet — add the first bill");
      return;
    }
    wrap.innerHTML = items.map((a) => {
      const isPay = a.kind === "payment";
      return '<div class="act-item" data-person="' + a.person_id + '" style="cursor:pointer">' +
        '<div class="act-badge ' + (isPay ? "pay" : "bill") + '">' + ico(isPay ? "money" : "bill") + "</div>" +
        '<div><div class="a-name">' + escapeHtml(a.person_name) + (a.already_paid ? ' <span class="pill counter">paid at counter</span>' : "") + "</div>" +
        '<div class="a-time">' + (isPay ? "Payment received" : "Bill added") + " · " + timeAgo(a.created_at) + "</div></div>" +
        '<div class="a-amt ' + (isPay ? "credit" : "debit") + '">' + (isPay ? "+" : "") + fmtMoney(a.amount) + "</div>" +
        "</div>";
    }).join("");
  },
};

function kpi(label, value, foot, icon, color) {
  return '<div class="panel kpi-card"><div class="k-ico ' + color + '">' + ico(icon) + "</div>" +
    '<div class="k-label">' + label + '</div><div class="k-value">' + value + "</div>" +
    '<div class="k-foot">' + foot + "</div></div>";
}

function emptyRow(msg) {
  return '<div style="padding:22px 8px;color:var(--ink-3);font-size:13px;text-align:center">' + escapeHtml(msg) + "</div>";
}
