/* Khata Sathi - galla: the cash drawer. Morning: how much cash did you
   start with? During the day: money in / money out (with notes).
   Evening: count the cash, close the day — surplus or short is shown
   honestly, never judged. Share the day as a PDF over WhatsApp. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, escapeHtml, modal, toast, whatsappShare */

const Galla = {
  id: "galla",
  title: "Galla",
  icon: "wallet",
  data: null,
  recent: [],

  async render(main) {
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Galla — the cash drawer</div>' +
      '<div class="view-sub" id="gl-sub">Morning cash, money in/out, evening count</div></div>' +
      '<div class="view-actions" id="gl-actions"></div></div>' +
      '<div id="gl-body"></div>' +
      '<div class="panel panel-pad" style="margin-top:16px" id="gl-recent"></div>';

    main.querySelector("#gl-actions").innerHTML =
      '<button class="btn" data-a="share">' + ico("share") + "Share PDF</button>" +
      '<button class="btn" data-a="refresh">' + ico("undo") + "Refresh</button>";
    main.querySelector("#gl-actions").addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.getAttribute("data-a") === "share") this.share();
      else this.load(main);
    });

    /* one delegated listener for the whole body zone — attach exactly once,
       survive every re-render without stacking (the live-sync reloads often) */
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
      });
    }

    await this.load(main);
    await this.loadRecent(main);
  },

  async load(main) {
    let d;
    try {
      d = await API.get("/api/galla");
      this.data = d;
    } catch (e) {
      main.querySelector("#gl-body").innerHTML =
        '<div class="panel empty"><div class="e-ico">' + ico("warn") + '</div><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
      return;
    }
    if (!d.open) return this.renderNotOpen(main);
    this.renderOpen(main);
  },

  /* ---------- the day hasn't started ---------- */
  renderNotOpen(main) {
    const body = main.querySelector("#gl-body");
    body.innerHTML =
      '<div class="panel panel-pad galla-open-card">' +
      '<div class="go-title">Start the day</div>' +
      '<div class="go-sub">How much movable cash is in the drawer right now? ' +
      "This is today's opening galla — coins, notes, the float.</div>" +
      '<div class="field" style="max-width:340px;margin-top:14px">' +
      '<label>Cash at the start of the day</label>' +
      '<input class="input big money" id="go-amt" placeholder="Rs. 0" inputmode="text"></div>' +
      '<div class="field" style="max-width:340px;margin-top:12px">' +
      '<label>Note (optional)</label><input class="input" id="go-note" placeholder="e.g. after yesterday\'s 5000"></div>' +
      '<button class="btn primary lg" id="go-open" style="margin-top:16px">' + ico("check") + "Open today's galla</button>" +
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
        this.load(main); this.loadRecent(main);
      } catch (e) { toast(e.message, "err"); }
    };
  },

  /* ---------- the day is open (or closed) ---------- */
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
      entriesHtml = '<div class="ge-row" style="color:var(--ink-3)">No money in or out yet today.</div>';
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
      '<div class="panel-title">' + ico("chart") + "Where the money went</div>" +
      '<div class="gk-row"><span>Opening cash</span><b class="money">' + fmtMoney(d.opening) + "</b></div>" +
      '<div class="gk-row"><span>Cash put in (incl. counter sales)</span><b class="money pos">+' + fmtMoney(d.cash_in) + "</b></div>" +
      '<div class="gk-row"><span>Cash taken out / spent</span><b class="money neg">−' + fmtMoney(d.cash_out) + "</b></div>" +
      '<div class="gk-row gk-expect"><span>Expected in drawer</span><b class="money">' + fmtMoney(d.expected) + "</b></div>" +
      (closed
        ? '<div class="gk-row"><span>Counted at closing</span><b class="money">' + fmtMoney(d.closing) + "</b></div>"
        : '<button class="btn primary lg block" style="margin-top:14px" data-a="close">' + ico("check") + "Close the day — count the cash</button>") +
      verdict +
      "</div></div>";
  },

  verdictHtml(d) {
    const diff = d.difference || 0;
    if (Math.abs(diff) < 0.005) {
      return '<div class="gk-verdict ok"><div class="gv-t">ALL COUNTED — EXACT</div>' +
        '<div class="gv-s">The drawer matches the book. Good day.</div></div>';
    }
    if (diff > 0) {
      return '<div class="gk-verdict warn"><div class="gv-t">SURPLUS ' + fmtMoney(diff) + "</div>" +
        '<div class="gv-s">More cash in the drawer than the book says — maybe an entry is missing?</div></div>';
    }
    return '<div class="gk-verdict bad"><div class="gv-t">SHORT ' + fmtMoney(Math.abs(diff)) + "</div>" +
      '<div class="gv-s">Less cash than the book says. Recount the drawer once before worrying.</div></div>';
  },

  /* ---------- dialogs ---------- */
  entryDialog(main, direction) {
    const isIn = direction === "in";
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:14px;color:var(--ink-2);margin-bottom:12px">' +
      (isIn ? "Money put INTO the drawer — someone returned a loan, you added float." :
        "Money taken OUT of the drawer — spending, a bank deposit, cash taken home.") + "</div>" +
      '<div class="field"><label>Amount</label>' +
      '<input class="input big money" id="ge-amt" placeholder="Rs. 0" inputmode="text"></div>' +
      '<div class="field" style="margin-top:12px"><label>Note (what was it?)</label>' +
      '<input class="input" id="ge-note" placeholder="' +
      (isIn ? "e.g. loan returned" : "e.g. vegetables, bank deposit") + '"></div>';
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
              this.load(main); this.loadRecent(main);
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
              this.load(main); this.loadRecent(main);
            } catch (e) { toast(e.message, "err"); }
          },
        },
      ],
    });
    setTimeout(() => body.querySelector("#gc-amt").focus(), 60);
  },

  /* ---------- share ---------- */
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

  /* ---------- last 7 days ---------- */
  async loadRecent(main) {
    const wrap = main.querySelector("#gl-recent");
    try {
      const d = await API.get("/api/galla/recent?days=7");
      this.recent = d.days || [];
    } catch (e) {
      wrap.innerHTML = '<div class="panel-title">Last 7 days</div>' + escapeHtml(e.message);
      return;
    }
    let html = '<div class="panel-title">' + ico("clock") + "Last 7 days — opening vs closing</div>";
    if (!this.recent.length) {
      html += '<div style="padding:18px 8px;color:var(--ink-3);font-size:13px;text-align:center">No galla history yet — today is the first day.</div>';
    } else {
      html += '<table class="gr-table"><thead><tr>' +
        "<th>Day</th><th>Opening</th><th>In</th><th>Out</th><th>Expected</th><th>Counted</th><th>Difference</th>" +
        "</tr></thead><tbody>";
      for (const r of this.recent) {
        const diff = r.difference;
        const diffCell = diff == null ? "—" :
          (Math.abs(diff) < 0.005 ? "exact" :
            '<span class="' + (diff > 0 ? "pos" : "neg") + '">' + (diff > 0 ? "+" : "") + fmtMoney(diff) + "</span>");
        html += "<tr><td>" + fmtDate(r.date) + "</td><td>" + fmtMoney(r.opening) + "</td>" +
          '<td class="pos">' + (r.cash_in ? "+" + fmtMoney(r.cash_in) : "—") + "</td>" +
          '<td class="neg">' + (r.cash_out ? "−" + fmtMoney(r.cash_out) : "—") + "</td>" +
          "<td>" + fmtMoney(r.expected) + "</td>" +
          "<td>" + (r.closing == null ? "—" : fmtMoney(r.closing)) + "</td><td>" + diffCell + "</td></tr>";
      }
      html += "</tbody></table>";
    }
    wrap.innerHTML = html;
  },
};
