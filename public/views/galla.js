/* Khata Sathi - galla: the cash drawer & 30-day history.
   Daily Midnight Reset: Each day is tracked separately.
   30-Day History: Interactive view of past 30 days of drawer opening, in, out, expected, and closing. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, escapeHtml, modal, toast, whatsappShare, toAmountFloat, devToAscii, confirmModal, App */

const Galla = {
  id: "galla",
  title: "Galla",
  icon: "wallet",
  tab: "today", // 'today' | 'history'
  data: null,
  history: [],
  selectedDate: null,

  async render(main, params) {
    if (params && params.tab) this.tab = params.tab;
    this.selectedDate = (params && params.date) || null;

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Galla — Cash Drawer & 30-Day History</div>' +
      '<div class="view-sub" id="gl-sub">Daily midnight reset · Morning float, money in/out, evening count · Past 30 days record</div></div>' +
      '<div class="view-actions" id="gl-actions"></div></div>' +
      '<div class="galla-tabs" style="display:flex;gap:8px;margin-bottom:16px">' +
      '<button class="btn ' + (this.tab === "today" ? "primary" : "ghost") + '" data-tab="today">' + ico("wallet") + "Today's Drawer</button>" +
      '<button class="btn ' + (this.tab === "history" ? "primary" : "ghost") + '" data-tab="history">' + ico("clock") + "30-Day History</button>' +
      '</div>' +
      '<div id="gl-body"></div>';

    main.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.tab = btn.getAttribute("data-tab");
        main.querySelectorAll("[data-tab]").forEach((b) => {
          b.className = "btn " + (b.getAttribute("data-tab") === this.tab ? "primary" : "ghost");
        });
        if (this.tab === "today") this.load(main);
        else this.loadHistory(main);
      });
    });

    main.querySelector("#gl-actions").innerHTML =
      '<button class="btn" data-a="share">' + ico("share") + "Share PDF</button>" +
      '<button class="btn" data-a="refresh">' + ico("undo") + "Refresh</button>";

    main.querySelector("#gl-actions").addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.getAttribute("data-a") === "share") this.share();
      else if (this.tab === "today") this.load(main);
      else this.loadHistory(main);
    });

    const body = main.querySelector("#gl-body");
    if (!body.getAttribute("data-wired")) {
      body.setAttribute("data-wired", "1");
      body.addEventListener("click", (e) => {
        const del = e.target.closest("[data-eid]");
        if (del) {
          const eid = del.getAttribute("data-eid");
          confirmModal("Remove this entry?", "The in/out entry is removed and the expected cash is recalculated.", "Remove it", async () => {
            try { await API.post("/api/galla/entry/undo", { id: eid }); toast("Entry removed"); this.load(main); }
            catch (err) { toast(err.message, "err"); }
          }, true);
          return;
        }
        const b = e.target.closest("[data-a]");
        if (!b) return;
        const a = b.getAttribute("data-a");
        if (a === "in" || a === "out") this.entryDialog(main, a);
        if (a === "close") this.closeDialog(main);
        if (a === "view-day") {
          const dt = b.getAttribute("data-date");
          this.viewDayModal(dt);
        }
      });
    }

    if (this.tab === "today") {
      await this.load(main);
    } else {
      await this.loadHistory(main);
    }
  },

  async load(main) {
    let d;
    try {
      const url = this.selectedDate ? ("/api/galla?date=" + encodeURIComponent(this.selectedDate)) : "/api/galla";
      d = await API.get(url);
      this.data = d;
    } catch (e) {
      main.querySelector("#gl-body").innerHTML =
        '<div class="panel empty"><div class="e-ico">' + ico("warn") + '</div><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
      return;
    }
    if (!d.open) return this.renderNotOpen(main);
    this.renderOpen(main);
  },

  /* ---------- Today has not been opened ---------- */
  renderNotOpen(main) {
    const body = main.querySelector("#gl-body");
    body.innerHTML =
      '<div class="panel panel-pad galla-open-card">' +
      '<div class="go-title">Start Today\'s Day (' + fmtDate(this.data ? this.data.date : new Date().toISOString().slice(0, 10)) + ')</div>' +
      '<div class="go-sub">Daily reset is automatic at 12:00 midnight. How much movable cash float is in the drawer right now?</div>' +
      '<div class="field" style="max-width:340px;margin-top:14px">' +
      '<label>Cash at the start of the day</label>' +
      '<input class="input big money" id="go-amt" placeholder="Rs. 0" inputmode="text"></div>' +
      '<div class="field" style="max-width:340px;margin-top:12px">' +
      '<label>Note (optional)</label><input class="input" id="go-note" placeholder="e.g. morning cash float"></div>' +
      '<button class="btn primary lg" id="go-open" style="margin-top:16px">' + ico("check") + "Open today's galla</button>' +
      "</div>";
    const amt = body.querySelector("#go-amt");
    amt.addEventListener("input", () => {
      const conv = devToAscii(amt.value);
      if (conv !== amt.value) amt.value = conv;
    });
    amt.focus();
    body.querySelector("#go-open").onclick = async () => {
      const v = toAmountFloat(amt.value);
      if (v === null || v < 0) { toast("Enter today's starting cash", "err"); amt.focus(); return; }
      try {
        await API.post("/api/galla/open", { opening: amt.value, note: body.querySelector("#go-note").value.trim() });
        toast("Galla opened — " + fmtMoney(v), "ok");
        this.load(main);
      } catch (e) { toast(e.message, "err"); }
    };
  },

  /* ---------- Drawer is Open or Closed ---------- */
  renderOpen(main) {
    const d = this.data;
    const closed = d.closed;
    const body = main.querySelector("#gl-body");

    let entriesHtml = "";
    for (const e of d.entries) {
      const isIn = e.direction === "in";
      const counter = !!e.bill_id;
      const payment = !!e.payment_id;
      const locked = counter || payment;
      entriesHtml +=
        '<div class="ge-row">' +
        '<div class="ge-badge ' + (isIn ? "in" : "out") + '">' + ico(isIn ? "plus" : "minus") + "</div>" +
        '<div><div class="ge-note">' + escapeHtml(e.note || (isIn ? "cash in" : "cash out")) +
        (counter ? ' <span class="pill counter">bill</span>' : "") +
        (payment ? ' <span class="pill paid">payment</span>' : "") + "</div>" +
        '<div class="ge-time">' + (e.at || "").slice(11, 16) + "</div></div>" +
        (closed || locked ? "" : '<button class="icon-btn ge-del" data-eid="' + e.id + '" title="Remove this entry">' + ico("trash") + "</button>") +
        (locked && !closed
          ? '<span class="hint" style="align-self:center">' + (payment ? "undo payment to undo" : "void the bill to undo") + "</span>" : "") +
        '<div class="ge-amt money ' + (isIn ? "pos" : "neg") + '">' + (isIn ? "+" : "−") + fmtMoney(e.amount) + "</div>" +
        "</div>";
    }
    if (!d.entries.length) {
      entriesHtml = '<div class="ge-row" style="color:var(--ink-3)">No cash in or out yet today.</div>';
    }

    const verdict = closed ? this.verdictHtml(d) : "";

    body.innerHTML =
      '<div class="dash-grid">' +
      '<div class="panel panel-pad w-span-7">' +
      '<div class="panel-title">' + ico("wallet") + "Today — " + fmtDate(d.date) + " " +
      (closed ? '<span class="pill counter">closed</span>' : '<span class="pill open">open</span>') + "</div>" +
      '<div class="ge-list">' + entriesHtml + "</div>" +
      (closed ? "" :
        '<div class="btn-row" style="margin-top:14px">' +
        '<button class="btn success" data-a="in">' + ico("plus") + "Add money</button>" +
        '<button class="btn danger" data-a="out">' + ico("minus") + "Subtract money</button></div>") +
      "</div>" +
      '<div class="panel panel-pad w-span-5">' +
      '<div class="panel-title">' + ico("chart") + "Drawer Summary</div>" +
      '<div class="gk-row"><span>Opening cash</span><b class="money">' + fmtMoney(d.opening) + "</b></div>" +
      '<div class="gk-row"><span>Cash put in (incl. sales & payments)</span><b class="money pos">+' + fmtMoney(d.cash_in) + "</b></div>" +
      '<div class="gk-row"><span>Cash taken out / expenses</span><b class="money neg">−' + fmtMoney(d.cash_out) + "</b></div>" +
      '<div class="gk-row gk-expect"><span>Expected in drawer</span><b class="money">' + fmtMoney(d.expected) + "</b></div>" +
      (closed
        ? '<div class="gk-row"><span>Counted at closing</span><b class="money">' + fmtMoney(d.closing) + "</b></div>"
        : '<button class="btn primary lg block" style="margin-top:14px" data-a="close">' + ico("check") + "Close the day — count cash</button>") +
      verdict +
      "</div></div>";
  },

  verdictHtml(d) {
    const diff = d.difference || 0;
    if (Math.abs(diff) < 0.005) {
      return '<div class="gk-verdict ok"><div class="gv-t">ALL COUNTED — EXACT</div>' +
        '<div class="gv-s">The drawer matches the ledger book exactly.</div></div>';
    }
    if (diff > 0) {
      return '<div class="gk-verdict warn"><div class="gv-t">SURPLUS ' + fmtMoney(diff) + "</div>" +
        '<div class="gv-s">More cash in drawer than recorded.</div></div>';
    }
    return '<div class="gk-verdict bad"><div class="gv-t">SHORT ' + fmtMoney(Math.abs(diff)) + "</div>" +
      '<div class="gv-s">Less cash than recorded. Recount once.</div></div>';
  },

  /* ---------- 30-Day History Tab ---------- */
  async loadHistory(main) {
    const body = main.querySelector("#gl-body");
    body.innerHTML = '<div class="panel panel-pad"><div class="hint">Loading 30-day galla history...</div></div>';
    try {
      const res = await API.get("/api/galla/history?days=30");
      this.history = res.days || [];
    } catch (e) {
      body.innerHTML = '<div class="panel empty"><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
      return;
    }

    const totalIn = this.history.reduce((s, r) => s + (r.cash_in || 0), 0);
    const totalOut = this.history.reduce((s, r) => s + (r.cash_out || 0), 0);
    const netFlow = totalIn - totalOut;

    let rowsHtml = "";
    if (!this.history.length) {
      rowsHtml = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--ink-3)">No galla history in the past 30 days. Open today\'s drawer to start.</td></tr>';
    } else {
      for (const r of this.history) {
        const diff = r.difference;
        const diffCell = diff == null ? "—" :
          (Math.abs(diff) < 0.005 ? '<span class="pill open">Exact</span>' :
            '<span class="' + (diff > 0 ? "pos" : "neg") + '">' + (diff > 0 ? "+" : "") + fmtMoney(diff) + "</span>");
        const statusBadge = r.closed
          ? '<span class="pill counter">Closed</span>'
          : '<span class="pill open">Open</span>';

        rowsHtml +=
          '<tr>' +
          '<td><b>' + fmtDate(r.date) + "</b></td>" +
          "<td>" + statusBadge + "</td>" +
          "<td>" + fmtMoney(r.opening) + "</td>" +
          '<td class="pos">+' + fmtMoney(r.cash_in) + "</td>" +
          '<td class="neg">−' + fmtMoney(r.cash_out) + "</td>" +
          '<td><b>' + fmtMoney(r.expected) + "</b></td>" +
          "<td>" + (r.closing == null ? "—" : fmtMoney(r.closing)) + "</td>" +
          "<td>" + diffCell + "</td>" +
          '<td><button class="btn sm" data-a="view-day" data-date="' + r.date + '">' + ico("eye") + "View</button></td>" +
          "</tr>";
      }
    }

    body.innerHTML =
      '<div class="dash-grid" style="margin-bottom:16px">' +
      '<div class="panel panel-pad kpi-card"><div class="kpi-label">30-Day Total Inflow</div><div class="kpi-val money pos">+' + fmtMoney(totalIn) + "</div></div>" +
      '<div class="panel panel-pad kpi-card"><div class="kpi-label">30-Day Total Outflow</div><div class="kpi-val money neg">−' + fmtMoney(totalOut) + "</div></div>" +
      '<div class="panel panel-pad kpi-card"><div class="kpi-label">30-Day Net Cash Flow</div><div class="kpi-val money ' + (netFlow >= 0 ? "pos" : "neg") + '">' + (netFlow >= 0 ? "+" : "") + fmtMoney(netFlow) + "</div></div>" +
      '<div class="panel panel-pad kpi-card"><div class="kpi-label">Days Recorded</div><div class="kpi-val">' + this.history.length + " / 30</div></div>" +
      "</div>" +
      '<div class="panel panel-pad">' +
      '<div class="panel-title" style="margin-bottom:12px">' + ico("clock") + "Past 30 Days Cash Drawer Record</div>" +
      '<div class="table-wrap"><table class="gr-table"><thead><tr>' +
      "<th>Date</th><th>Status</th><th>Opening</th><th>Cash In</th><th>Cash Out</th><th>Expected</th><th>Counted</th><th>Difference</th><th>Action</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody></table></div></div>";
  },

  /* ---------- Historical Day Modal View ---------- */
  async viewDayModal(date) {
    try {
      const d = await API.get("/api/galla?date=" + encodeURIComponent(date));
      const body = document.createElement("div");
      let entries = "";
      if (d.entries && d.entries.length) {
        for (const e of d.entries) {
          const isIn = e.direction === "in";
          entries +=
            '<div class="ge-row">' +
            '<div class="ge-badge ' + (isIn ? "in" : "out") + '">' + ico(isIn ? "plus" : "minus") + "</div>" +
            '<div><div class="ge-note">' + escapeHtml(e.note || (isIn ? "cash in" : "cash out")) +
            (e.bill_id ? ' <span class="pill counter">bill</span>' : "") +
            (e.payment_id ? ' <span class="pill paid">payment</span>' : "") + "</div>" +
            '<div class="ge-time">' + (e.at || "").slice(11, 16) + "</div></div>" +
            '<div class="ge-amt money ' + (isIn ? "pos" : "neg") + '">' + (isIn ? "+" : "−") + fmtMoney(e.amount) + "</div>" +
            "</div>";
        }
      } else {
        entries = '<div style="padding:12px;color:var(--ink-3)">No individual entries recorded.</div>';
      }

      body.innerHTML =
        '<div style="font-size:14px;margin-bottom:12px">Opening: <b>' + fmtMoney(d.opening) +
        "</b> · Total In: <b class='pos'>+" + fmtMoney(d.cash_in) +
        "</b> · Total Out: <b class='neg'>−" + fmtMoney(d.cash_out) +
        "</b> · Expected: <b>" + fmtMoney(d.expected) + "</b></div>" +
        '<div class="ge-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px">' + entries + "</div>";

      modal({
        title: "Galla Record — " + fmtDate(date),
        body,
        buttons: [
          { label: "Close", cls: "ghost" },
          {
            label: "Download PDF",
            cls: "primary",
            onClick: () => {
              const pdfUrl = "/api/galla/pdf?date=" + encodeURIComponent(date);
              window.open(pdfUrl, "_blank");
            },
          },
        ],
      });
    } catch (e) {
      toast(e.message, "err");
    }
  },

  /* ---------- Dialogs ---------- */
  entryDialog(main, direction) {
    const isIn = direction === "in";
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:14px;color:var(--ink-2);margin-bottom:12px">' +
      (isIn ? "Money put INTO the drawer — loan returned, float added, cash deposit." :
        "Money taken OUT of the drawer — shop expenses, vegetables, bank deposit, cash taken home.") + "</div>" +
      '<div class="field"><label>Amount</label>' +
      '<input class="input big money" id="ge-amt" placeholder="Rs. 0" inputmode="text"></div>' +
      '<div class="field" style="margin-top:12px"><label>Note (what was it?)</label>' +
      '<input class="input" id="ge-note" placeholder="' +
      (isIn ? "e.g. loan returned" : "e.g. tea, vegetables, bank deposit") + '"></div>';
    modal({
      title: isIn ? "Add money to galla" : "Subtract money from galla",
      body,
      buttons: [
        { label: "Cancel", cls: "ghost" },
        {
          label: isIn ? "Money added" : "Money taken out",
          cls: isIn ? "success" : "danger",
          onClick: async () => {
            const amt = body.querySelector("#ge-amt").value;
            const v = toAmountFloat(amt);
            if (v === null || v <= 0) { toast("Enter the amount", "err"); return; }
            try {
              await API.post("/api/galla/entry", {
                direction, amount: amt,
                note: body.querySelector("#ge-note").value.trim(),
              });
              toast((isIn ? "Added " : "Took out ") + fmtMoney(v), "ok");
              this.load(main);
            } catch (e) { toast(e.message, "err"); }
          },
        },
      ],
    });
    setTimeout(() => body.querySelector("#ge-amt").focus(), 60);
  },

  closeDialog(main) {
    const d = this.data;
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:14px;color:var(--ink-2);margin-bottom:12px">' +
      "Count every coin and note in the drawer and enter what you counted. " +
      "The book says there should be <b>" + fmtMoney(d.expected) + "</b>.</div>" +
      '<div class="field"><label>Counted cash at the end of the day</label>' +
      '<input class="input big money" id="gc-amt" placeholder="Rs. 0" inputmode="text"></div>';
    modal({
      title: "Close today's galla",
      body,
      buttons: [
        { label: "Cancel", cls: "ghost" },
        {
          label: "Close the day",
          cls: "primary",
          onClick: async () => {
            const amt = body.querySelector("#gc-amt").value;
            const v = toAmountFloat(amt);
            if (v === null || v < 0) { toast("Enter the counted cash", "err"); return; }
            try {
              await API.post("/api/galla/close", { closing: amt });
              const s = await API.get("/api/galla");
              const diff = s.difference || 0;
              if (Math.abs(diff) < 0.005) toast("Closed — drawer matches the book exactly", "ok", 4200);
              else if (diff > 0) toast("Closed — surplus " + fmtMoney(diff), "warn", 5200);
              else toast("Closed — short " + fmtMoney(Math.abs(diff)) + ". Recount once.", "warn", 6000);
              this.data = s;
              this.load(main);
            } catch (e) { toast(e.message, "err"); }
          },
        },
      ],
    });
    setTimeout(() => body.querySelector("#gc-amt").focus(), 60);
  },

  share() {
    if (!this.data || !this.data.open) { toast("Open today's galla first", "err"); return; }
    const pdfUrl = "/api/galla/pdf?date=" + encodeURIComponent(this.data.date);
    const text = "Galla — " + fmtDate(this.data.date) +
      "\nOpening: " + fmtMoney(this.data.opening) +
      "\nIn: " + fmtMoney(this.data.cash_in) + " · Out: " + fmtMoney(this.data.cash_out) +
      "\nExpected: " + fmtMoney(this.data.expected) +
      (this.data.closed ? "\nCounted: " + fmtMoney(this.data.closing) +
        " · Difference: " + fmtMoney(this.data.difference || 0) : "") +
      "\n" + (App.state.store_name || "Khata Sathi");
    whatsappShare(pdfUrl, text, "galla-" + this.data.date + ".pdf");
  },
};
