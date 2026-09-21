/* Khata Sathi - Ledger section: every person's khata in one place.
   Left: the people (pick one). Right: that person's ledger —
   S.N. | Date | Particulars | Debit | Credit | Remaining — with the khata
   paper look beside it, shareable as PDF / Excel / text. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, escapeHtml, modal, confirmModal, toast, lightbox */

const LedgerView = {
  id: "ledgerhub",
  title: "Ledger",
  icon: "bill",
  personId: null,
  people: [],
  data: null,

  async render(main, params) {
    this.personId = (params && params.person) || this.personId || null;
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Ledger</div>' +
      '<div class="view-sub">Every person\'s khata — debit, credit, running remaining</div></div></div>' +
      '<div class="dash-grid">' +
      '<div class="panel panel-pad w-span-5" id="lh-list"></div>' +
      '<div class="w-span-7" id="lh-detail"></div>' +
      "</div>";
    /* one delegated listener on #main — main itself is never replaced, so
       live-sync re-renders can never stack it */
    if (!main.getAttribute("data-lh-wired")) {
      main.setAttribute("data-lh-wired", "1");
      main.addEventListener("click", (e) => {
        const b = e.target.closest(".lh-person[data-person]");
        if (!b) return;
        this.personId = b.getAttribute("data-person");
        this.renderList(main);
        this.renderPerson(main, this.personId);
      });
    }
    this.renderList(main);
    if (this.personId) await this.renderPerson(main, this.personId);
    else main.querySelector("#lh-detail").innerHTML =
      '<div class="panel empty" style="height:100%"><div class="e-ico">' + ico("bill") + '</div>' +
      '<div class="e-t">Pick a person</div><div class="e-s">Their full ledger opens here — every bill, every payment, the running remaining, ready to share.</div></div>';
  },

  async renderList(main) {
    const el = main.querySelector("#lh-list");
    try {
      const d = await API.get("/api/people");
      this.people = d.people;
    } catch (e) {
      el.innerHTML = escapeHtml(e.message);
      return;
    }
    let html = '<div class="panel-title">' + ico("people") + "People</div>" +
      '<div class="lh-people">';
    if (!this.people.length) {
      html += '<div class="hint" style="padding:16px 4px">No people yet — add a bill with a name and the account is created.</div>';
    }
    for (const p of this.people) {
      const owing = p.balance > 0.004;
      html += '<button class="lh-person' + (p.id === this.personId ? " active" : "") +
        '" data-person="' + p.id + '">' +
        '<span class="lh-name">' + escapeHtml(p.name) + "</span>" +
        '<span class="lh-bal money ' + (owing ? "neg" : "pos") + '">' + fmtMoney(p.balance) + "</span>" +
        (owing ? '<span class="pill open">' + p.open_count + " open</span>" : '<span class="pill paid">clear</span>') +
        "</button>";
    }
    html += "</div>";
    el.innerHTML = html;
  },

  async renderPerson(main, pid) {
    const box = main.querySelector("#lh-detail");
    let d;
    try {
      d = await API.get("/api/ledger?id=" + encodeURIComponent(pid));
      this.data = d;
    } catch (e) {
      box.innerHTML = '<div class="panel empty"><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
      return;
    }
    const p = d.person;
    const owing = d.balance > 0.004;

    let totalDr = 0, totalCr = 0;
    let rows = "";
    for (const r of d.rows) {
      const isPay = r.kind === "payment";
      const counter = !isPay && r.already_paid;
      let part = isPay ? "Payment received" : "Bill — credit given";
      if (counter) part = "Bill — paid at counter";
      if (r.note) part += " · " + r.note;
      const pill = isPay ? "" : Ledger.billPill(r);
      const photo = r.photo
        ? ' <img class="khata-thumb" data-photo="' + r.photo + '" src="/photo/' + r.photo + '" alt="bill photo">' : "";
      const dr = (!isPay && !counter && r.status !== "void") ? r.amount : 0;
      const cr = (isPay || counter) ? r.amount : 0;
      if (!isPay && !counter && r.status !== "void") totalDr += r.amount;
      if (isPay || counter) totalCr += r.amount;
      rows += '<tr class="krow' + (r.status === "void" ? " voided" : "") + '">' +
        '<td class="sn-col">' + r.sn + "</td>" +
        '<td class="date-col">' + fmtDate(r.at) + "</td>" +
        '<td class="part-col">' + escapeHtml(part) + pill + photo + "</td>" +
        '<td class="amt num k-dr">' + (dr ? fmtMoney(dr) : "—") + "</td>" +
        '<td class="amt num k-cr">' + (cr ? fmtMoney(cr) : "—") + "</td>" +
        '<td class="bal-col num' + (r.balance_after < 0.005 ? " zero" : "") + '">' + fmtMoney(r.balance_after) + "</td>" +
        "</tr>";
    }

    box.innerHTML =
      '<div class="panel khata-paper" id="lh-paper">' +
      '<div class="khata-head">' +
      '<div class="khata-title">Khata <span class="dev">— ' + escapeHtml(p.name) + "</span></div>" +
      '<div class="khata-sub">' + escapeHtml(App.state.store_name || "Khata Sathi") + "</div>" +
      '<div class="khata-head-actions">' +
      (owing ? '<button class="btn success sm" data-a="pay-full">' + ico("check") + "Full clear</button>" +
      '<button class="btn sm" data-a="pay">' + ico("money") + "Pay little</button>" : "") +
      '<button class="btn primary sm" data-a="share">' + ico("share") + "Share</button>" +
      '<button class="btn sm" data-a="print">' + ico("doc") + "Print</button>" +
      "</div></div>" +
      '<div class="khata-meta">' +
      "<span>Phone: <b>" + escapeHtml(p.phone || "—") + "</b></span>" +
      "<span>Since: <b>" + fmtDate(p.created_at) + "</b></span>" +
      "<span>Entries: <b>" + d.rows.length + "</b></span>" +
      '<span>Billed: <b>' + fmtMoney(p.lifetime_billed) + "</b></span>" +
      '<span>Paid: <b>' + fmtMoney(p.lifetime_paid) + "</b></span>" +
      "</div>" +
      '<table class="khata-table"><thead><tr>' +
      "<th>S.N.</th>" +
      '<th class="date-col">Date</th>' +
      '<th class="part-col">Particulars</th>' +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      '<th class="num">Remaining</th>' +
      "</tr></thead><tbody>" + rows + "</tbody>" +
      '<tfoot><tr class="khata-totals">' +
      '<td colspan="3" class="t-label">Total</td>' +
      '<td class="num k-dr">' + fmtMoney(totalDr) + "</td>" +
      '<td class="num k-cr">' + fmtMoney(totalCr) + "</td>" +
      '<td class="num">' + fmtMoney(d.balance) + "</td>" +
      "</tr></tfoot></table>" +
      '<div class="khata-grand">' +
      '<span class="g-lbl">' + (owing ? "Balance owed</span>" : "All clear</span>") +
      '<span class="g-val money ' + (owing ? "neg" : "pos") + '">' + fmtMoney(d.balance) + "</span></div>" +
      "</div>";

    const paper = box.querySelector("#lh-paper");
    paper.addEventListener("click", (e) => {
      const ph = e.target.closest("[data-photo]");
      if (ph) { e.stopPropagation(); lightbox("/photo/" + ph.getAttribute("data-photo")); return; }
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "pay-full") App.go("pay", { id: p.id, full: true });
      if (a === "pay") App.go("pay", { id: p.id });
      if (a === "print") window.print();
      if (a === "share") Ledger.shareDialog(d, p);
    });
  },
};
