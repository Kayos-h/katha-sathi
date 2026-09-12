/* Khata Sathi - people view: search/filter cards, person ledger, open-bills drill-down */
"use strict";

/* global API, ico, fmtMoney, fmtDate, fmtDateTime, timeAgo, daysSince, avatarEl, escapeHtml, modal, confirmModal, lightbox, debounce */

const People = {
  id: "people",
  title: "People",
  icon: "people",
  people: [],
  filter: "all",   // all | owing | clear
  q: "",
  sort: "name",    // name | balance

  async render(main) {
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">People</div><div class="view-sub" id="p-count"></div></div>' +
      '<div class="view-actions">' +
      '<button class="btn primary" id="p-add">' + ico("plus") + "New person</button>" +
      "</div></div>" +
      '<div class="people-tools">' +
      '<input class="input" id="p-search" placeholder="Search name or phone…">' +
      '<div class="seg" id="p-seg">' +
      '<button class="seg-btn active" data-f="all">All</button>' +
      '<button class="seg-btn" data-f="owing">Owing</button>' +
      '<button class="seg-btn" data-f="clear">Clear</button>' +
      "</div></div>" +
      '<div class="people-grid" id="p-grid"></div>' +
      '<button class="fab" id="p-fab" title="Add bill">' + ico("plus") + "</button>";

    main.querySelector("#p-add").onclick = () => this.addPersonDialog();
    main.querySelector("#p-fab").onclick = () => App.go("add");
    const searchEl = main.querySelector("#p-search");
    searchEl.value = this.q;
    searchEl.oninput = debounce(() => {
      this.q = searchEl.value.trim();
      this.apply(main);
    }, 120);
    main.querySelector("#p-seg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn");
      if (!b) return;
      main.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      this.filter = b.getAttribute("data-f");
      this.apply(main);
    });
    main.querySelector("#p-grid").addEventListener("click", (e) => {
      const card = e.target.closest("[data-person]");
      if (card) App.go("ledger", { id: card.getAttribute("data-person") });
      const btn = e.target.closest("[data-pay]");
      if (btn) {
        e.stopPropagation();
        App.go("pay", { id: btn.getAttribute("data-pay") });
      }
    });
    await this.load(main);
  },

  async load(main) {
    try {
      const d = await API.get("/api/people");
      this.people = d.people;
    } catch (e) {
      main.querySelector("#p-grid").innerHTML =
        '<div class="panel panel-pad" style="grid-column:1/-1">' + escapeHtml(e.message) + "</div>";
      return;
    }
    this.apply(main);
  },

  apply(main) {
    const grid = main.querySelector("#p-grid");
    let list = this.people.slice();
    if (this.q) {
      const q = this.q.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone || "").includes(q));
    }
    if (this.filter === "owing") list = list.filter((p) => p.balance > 0.004);
    if (this.filter === "clear") list = list.filter((p) => p.balance <= 0.004);
    if (this.sort === "balance") list.sort((a, b) => b.balance - a.balance);

    main.querySelector("#p-count").textContent =
      list.length + (list.length === 1 ? " person" : " people") +
      (this.filter === "owing" ? " owing " + fmtMoney(list.reduce((s, p) => s + p.balance, 0)) : "");

    if (!list.length) {
      grid.innerHTML =
        '<div class="panel empty" style="grid-column:1/-1">' +
        '<div class="e-ico">' + ico("people") + '</div><div class="e-t">No people' + (this.q ? " found" : " yet") + "</div>" +
        '<div class="e-s">Tap "New person", or just add a bill with a new name and the account is created automatically.</div></div>';
      return;
    }

    grid.innerHTML = list.map((p) => {
      const owing = p.balance > 0.004;
      const last = p.last_activity ? " · last activity " + timeAgo(p.last_activity) : "";
      return '<div class="panel person-card" data-person="' + p.id + '">' +
        '<div class="p-top">' + avatarEl(p.name, 40) +
        '<div style="min-width:0"><div class="p-name">' + escapeHtml(p.name) + "</div>" +
        '<div class="p-sub">' + (p.phone ? escapeHtml(p.phone) + " · " : "") + (p.open_count ? p.open_count + " open bill" + (p.open_count === 1 ? "" : "s") : "no open bills") + "</div></div>" +
        '<div class="p-bal">' +
        '<div class="b-cap">' + (owing ? "owes" : "clear") + "</div>" +
        '<div class="b-main money ' + (owing ? "neg" : "pos") + '">' + fmtMoney(owing ? p.balance : 0) + "</div>" +
        "</div></div>" +
        '<div class="p-meta"><span>' + ico("doc") + "lifetime रू " + fmtMoney(p.lifetime_billed) + "</span>" +
        "<span>" + ico("money") + "paid रू " + fmtMoney(p.lifetime_paid) + "</span>" +
        (owing ? '<button class="btn sm success" data-pay="' + p.id + '" style="margin-left:auto">' + ico("money") + "Got money</button>" : "") +
        "</div>" +
        '<div class="p-sub" style="font-size:11px;color:var(--ink-3)">' + "added " + fmtDate(p.created_at) + last + "</div>" +
        "</div>";
    }).join("");
  },

  addPersonDialog(existing) {
    const isEdit = !!existing;
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="field"><label>Name</label><input class="input" id="np-name" placeholder="e.g. Ram Thapa" value="' + (isEdit ? escapeHtml(existing.name) : "") + '"></div>' +
      '<div class="field" style="margin-top:12px"><label>Phone (optional)</label><input class="input" id="np-phone" placeholder="98…" value="' + (isEdit ? escapeHtml(existing.phone || "") : "") + '"></div>' +
      '<div class="field" style="margin-top:12px"><label>Notes (optional)</label><textarea class="textarea" id="np-notes" placeholder="e.g. pays every Friday">' + (isEdit ? escapeHtml(existing.notes || "") : "") + "</textarea></div>";
    modal({
      title: isEdit ? "Edit person" : "New person",
      body,
      buttons: [
        { label: "Cancel", cls: "ghost" },
        {
          label: isEdit ? "Save" : "Add person",
          cls: "primary",
          onClick: async (ov, close) => {
            const name = body.querySelector("#np-name").value.trim();
            const phone = body.querySelector("#np-phone").value.trim();
            const notes = body.querySelector("#np-notes").value.trim();
            if (!name) { toast("Name is required", "err"); return; }
            try {
              if (isEdit) {
                await API.post("/api/people/update", { id: existing.id, name, phone, notes });
                toast("Saved");
              } else {
                const d = await API.post("/api/people/add", { name, phone, notes });
                toast(name + " added");
                App.go("ledger", { id: d.id });
              }
            } catch (e) { toast(e.message, "err"); }
          },
        },
      ],
    });
    setTimeout(() => body.querySelector("#np-name").focus(), 60);
  },
};

/* ================= person ledger ================= */

const Ledger = {
  id: "ledger",
  title: "Ledger",
  icon: "people",
  person: null,

  async render(main, params) {
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title" id="lg-name">…</div><div class="view-sub" id="lg-sub"></div></div>' +
      '<div class="view-actions" id="lg-actions"></div></div>' +
      '<div id="lg-khata"></div>' +
      '<div class="dash-grid" id="lg-side-grid" style="margin-top:16px">' +
      '<div class="panel panel-pad w-span-12" id="lg-side"></div>' +
      "</div>";
    await this.load(main, params.id);
  },

  async load(main, pid) {
    let d;
    try {
      d = await API.get("/api/ledger?id=" + encodeURIComponent(pid));
      this.person = d;
    } catch (e) {
      main.querySelector("#lg-name").textContent = "Could not load";
      toast(e.message, "err");
      return;
    }
    const p = d.person;
    const owing = d.balance > 0.004;

    document.title = p.name + " · Khata Sathi";
    main.querySelector("#lg-name").textContent = p.name + " — खाता";
    main.querySelector("#lg-sub").textContent =
      (p.phone ? p.phone + " · " : "") + "added " + fmtDate(p.created_at);

    main.querySelector("#lg-actions").innerHTML =
      (owing ? '<button class="btn success" data-a="pay">' + ico("money") + "Got money</button>" : "") +
      '<button class="btn primary" data-a="bill">' + ico("cam") + "Add bill</button>" +
      '<button class="btn" data-a="edit">' + ico("edit") + "</button>" +
      '<button class="btn" data-a="merge">' + ico("merge") + "</button>" +
      '<button class="btn" data-a="share">' + ico("share") + "Share</button>" +
      '<button class="btn" data-a="print">' + ico("doc") + "Print</button>";

    const actions = main.querySelector("#lg-actions");
    actions.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "pay") App.go("pay", { id: p.id });
      if (a === "bill") App.go("add", { person: p.id });
      if (a === "edit") People.addPersonDialog({ id: p.id, name: p.name, phone: p.phone, notes: p.notes });
      if (a === "merge") this.mergeDialog(p);
      if (a === "share") this.shareDialog(d, p);
      if (a === "print") window.print();
    });

    /* ============ the khata — real paper ledger ============ */
    let totalDebit = 0, totalCredit = 0;
    let bodyRows = "";
    for (const r of d.rows) {
      const isPay = r.kind === "payment";
      const dateCell = fmtDate(r.at).replace(/ (\d{4})$/, " $1");
      let particular = isPay ? "Payment received" : "Bill — credit given";
      if (!isPay && r.already_paid) particular = "Bill — paid at counter";
      if (r.note) particular += " · " + r.note;
      const pill = isPay ? "" : this.billPill(r);
      const photo = r.photo
        ? ' <img class="khata-thumb" data-photo="' + r.photo + '" src="/photo/' + r.photo + '" alt="bill photo">'
        : "";
      const debit = isPay || r.already_paid ? "" : fmtMoney(r.amount);
      const credit = isPay ? fmtMoney(r.amount) : (r.already_paid ? fmtMoney(r.amount) : "");
      if (!isPay && !r.already_paid && r.status !== "void") totalDebit += r.amount;
      if (isPay) totalCredit += r.amount;
      if (!isPay && r.already_paid) totalCredit += r.amount;
      const bal = r.balance_after;
      bodyRows +=
        '<tr class="krow' + (r.status === "void" ? " voided" : "") + (r.already_paid ? " counter" : "") +
        '" data-row="' + r.id + '" data-kind="' + r.kind + '">' +
        '<td class="date-col">' + dateCell + "</td>" +
        '<td class="part-col">' + escapeHtml(particular) + pill + photo +
        (r.note ? "" : "") +
        (!isPay && r.remaining > 0.004 && r.amount > r.remaining + 0.004
          ? '<div class="khata-note">' + fmtMoney(r.remaining) + " still open on this bill</div>" : "") +
        "</td>" +
        '<td class="amt num k-dr">' + (debit || "—") + "</td>" +
        '<td class="amt num k-cr">' + (credit || "—") + "</td>" +
        '<td class="bal-col num' + (bal < 0.005 ? " zero" : "") + '">' + fmtMoney(bal) + "</td>" +
        "</tr>";
    }

    const khata = main.querySelector("#lg-khata");
    if (!d.rows.length) {
      khata.innerHTML =
        '<div class="khata-paper"><div class="khata-head">' +
        '<div class="khata-title">खाता <span class="dev">· ' + escapeHtml(p.name) + "</span></div>" +
        '<div class="khata-sub">the account is empty — add the first bill</div></div>' +
        '<div class="khata-empty">Nothing written in this khata yet.</div></div>';
    } else {
      khata.innerHTML =
        '<div class="khata-paper" id="khata-paper">' +
        '<div class="khata-head">' +
        '<div class="khata-title">खाता <span class="dev">— ' + escapeHtml(p.name) + "</span></div>" +
        '<div class="khata-sub">' + escapeHtml(App.state.store_name || "Khata Sathi") + "</div>" +
        '<div class="khata-head-actions" style="margin-left:auto">' +
        (owing ? '<button class="btn success sm" data-a="pay">' + ico("money") + "Got money</button>" : "") +
        '<button class="btn primary sm" data-a="bill">' + ico("cam") + "Add bill</button>" +
        "</div></div>" +
        '<div class="khata-meta">' +
        "<span>Phone: <b>" + escapeHtml(p.phone || "—") + "</b></span>" +
        "<span>Since: <b>" + fmtDate(p.created_at) + "</b></span>" +
        "<span>Entries: <b>" + d.rows.length + "</b></span>" +
        "<span>Bills with photos: <b>" + d.rows.filter((r) => r.photo).length + "</b></span>" +
        "</div>" +
        '<table class="khata-table"><thead><tr>' +
        '<th class="date-col">मिति<span class="hide-sm"> Date</span></th>' +
        '<th class="part-col">विवरण Particulars</th>' +
        '<th class="num">डेबिट Debit</th>' +
        '<th class="num">क्रेडिट Credit</th>' +
        '<th class="num">बाँकी Balance</th>' +
        "</tr></thead><tbody>" + bodyRows + "</tbody>" +
        '<tfoot><tr class="khata-totals">' +
        '<td colspan="2" class="t-label">जम्मा Total</td>' +
        '<td class="num k-dr">' + fmtMoney(totalDebit) + "</td>" +
        '<td class="num k-cr">' + fmtMoney(totalCredit) + "</td>" +
        '<td class="num">' + fmtMoney(d.balance) + "</td>" +
        "</tr></tfoot></table>" +
        '<div class="khata-grand">' +
        '<span class="g-lbl">' + (owing ? "बाँकी बाँकी Balance owed</span>" : "सबै चुक्ता All clear</span>") +
        '<span class="g-val money ' + (owing ? "neg" : "pos") + '">' + fmtMoney(d.balance) + "</span></div>" +
        "</div>";
    }

    /* khata row clicks: photo -> lightbox, else bill/payment dialog */
    khata.addEventListener("click", (e) => {
      const ph = e.target.closest("[data-photo]");
      if (ph) { e.stopPropagation(); lightbox("/photo/" + ph.getAttribute("data-photo")); return; }
      const row = e.target.closest("[data-row]");
      if (!row) return;
      if (row.getAttribute("data-kind") === "bill") this.billDialog(row.getAttribute("data-row"), p.id);
      else this.paymentDialog(row.getAttribute("data-row"), p.id);
    });

    /* side: drill-down of open bills */
    const side = main.querySelector("#lg-side");
    try {
      const ob = await API.get("/api/openbills?id=" + encodeURIComponent(p.id));
      let inner = '<div class="panel-title">' + ico("wallet") + "What makes up the balance</div>";
      if (!ob.bills.length) {
        inner += emptyRow2("Nothing owed");
      } else {
        inner += '<div class="ob-list">' + ob.bills.map((b) =>
          '<div class="ob-item">' +
          (b.photo ? '<img class="ob-thumb" data-photo="' + b.photo + '" src="/photo/' + b.photo + '" alt="bill">' : '<div class="ob-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--ink-3)">' + ico("bill") + "</div>") +
          '<div class="ob-mid"><div class="ob-title">' + fmtMoney(b.remaining) + " of " + fmtMoney(b.amount) + "</div>" +
          '<div class="ob-sub">' + fmtDate(b.created_at) + " · " + daysSince(b.created_at) + " days owed" + (b.note ? " · " + escapeHtml(b.note) : "") + "</div></div>" +
          '<div class="ob-right"><div class="ob-rem money neg">' + fmtMoney(b.remaining) + '</div><div class="ob-cap">open</div></div>' +
          "</div>").join("") + "</div>";
        inner += '<div class="hint" style="margin-top:10px">Payments clear the oldest bill first. Tap a bill in the ledger to see or change it.</div>';
      }
      side.innerHTML = inner;
      side.addEventListener("click", (e) => {
        const ph = e.target.closest("[data-photo]");
        if (ph) lightbox("/photo/" + ph.getAttribute("data-photo"));
      });
    } catch (e) {
      side.innerHTML = '<div class="panel-title">Open bills</div>' + emptyRow2("Could not load");
    }
  },

  billPill(r) {
    if (r.status === "void") return ' <span class="kpill void">void</span>';
    if (r.already_paid) return ' <span class="kpill counter">counter</span>';
    if (r.remaining <= 0.004) return ' <span class="kpill paid">paid</span>';
    if (r.remaining < r.amount - 0.004) return ' <span class="kpill partial">part-paid</span>';
    return ' <span class="kpill open">open</span>';
  },

  billDialog(bid, personId) {
    API.get("/api/bill?id=" + encodeURIComponent(bid)).then((b) => {
      const body = document.createElement("div");
      const paidTotal = (b.allocations || []).reduce((s, a) => s + a.apply, 0);
      const allocHtml = (b.allocations || []).map((a) =>
        '<div class="pp-row"><span class="pp-date">' + fmtDateTime(a.paid_at) + "</span>" +
        "<span>payment applied</span>" +
        '<span class="pp-apply">' + fmtMoney(a.apply) + "</span></div>").join("");
      /* the complete credit of this bill, khata-style */
      const creditBox =
        '<div class="pay-plan" style="margin-top:12px">' +
        '<div class="pp-row pp-head">Complete credit — यो बिलको पूरा हिसाब</div>' +
        '<div class="pp-row"><span class="pp-date">Bill amount</span><span class="pp-amount">the full credit given</span>' +
        '<span style="font-weight:800">' + fmtMoney(b.amount) + "</span></div>" +
        (paidTotal > 0.004
          ? '<div class="pp-row"><span class="pp-date">Paid against</span><span class="pp-amount">' +
            (b.allocations || []).length + " payment" + ((b.allocations || []).length === 1 ? "" : "s") + ' applied</span>' +
            '<span class="pp-apply">−' + fmtMoney(paidTotal) + "</span></div>"
          : "") +
        (b.already_paid
          ? '<div class="pp-row" style="background:var(--green-soft)"><span class="pp-date">Paid at counter</span><span class="pp-amount">no credit was owed</span><span class="pp-apply">रू 0</span></div>'
          : '<div class="pp-row" style="background:' + (b.remaining > 0.004 ? "var(--amber-soft)" : "var(--green-soft)") + '">' +
            '<span class="pp-date">' + (b.remaining > 0.004 ? "Still open" : "Fully cleared") + "</span>" +
            '<span class="pp-amount">remaining on this bill</span>' +
            '<span style="font-weight:800">' + fmtMoney(b.remaining) + "</span></div>") +
        "</div>";
      body.innerHTML =
        (b.photo ? '<div class="photo-frame" style="margin-bottom:12px"><img src="/photo/' + b.photo + '" alt="bill photo" onclick="lightbox(this.src)"></div>' : "") +
        '<div class="field"><label>Amount (the complete credit recorded for this bill)</label><input class="input big money" id="bd-amt" value="' + b.amount + '"></div>' +
        '<div class="field" style="margin-top:10px"><label>Note</label><input class="input" id="bd-note" value="' + escapeHtml(b.note || "") + '"></div>' +
        creditBox +
        '<div style="margin-top:12px" class="hint">Added ' + fmtDateTime(b.created_at) + " · " +
        (b.photo ? "photo stored with this bill" : "no photo on this bill") + "</div>";
      modal({
        title: "Bill — " + fmtMoney(b.amount),
        wide: !!b.photo,
        body,
        buttons: [
          b.status === "void" || b.already_paid
            ? { label: "Close", cls: "primary" }
            : {
                label: "Pay this bill",
                cls: "success",
                icon: "money",
                onClick: () => {
                  App.go("pay", { id: personId, bill: bid });
                },
              },
          {
            label: "Void bill",
            cls: "danger",
            keepOpen: false,
            icon: "trash",
            onClick: () => {
              confirmModal("Void this bill?", "Voiding removes it from the balance forever (kept in history as void). This can't create money back — undo payments first if any paid against it.", "Void it", async () => {
                try { await API.post("/api/bills/void", { id: bid }); toast("Bill voided"); App.refresh(); }
                catch (e) { toast(e.message, "err"); }
              }, true);
            },
          },
          {
            label: "Save",
            cls: "primary",
            onClick: async () => {
              const amt = toAmountFloat(body.querySelector("#bd-amt").value);
              if (amt === null || amt <= 0) { toast("Enter a valid amount", "err"); return; }
              try {
                await API.post("/api/bills/update", { id: bid, amount: amt, note: body.querySelector("#bd-note").value });
                toast("Bill updated");
                App.refresh();
              } catch (e) { toast(e.message, "err"); }
            },
          },
        ],
      });
    }).catch((e) => toast(e.message, "err"));
  },

  paymentDialog(pmtId, personId) {
    API.get("/api/payment?id=" + encodeURIComponent(pmtId)).then((m) => {
      const cleared = (m.cleared || []).map((c) =>
        '<div class="pp-row"><span class="pp-date">' + fmtDate(c.bill_at) + "</span>" +
        '<span class="pp-amount">bill of ' + fmtMoney(c.bill_amount) + "</span>" +
        '<span class="pp-apply">−' + fmtMoney(c.apply) + "</span></div>").join("");
      const body = "<div style=\"font-size:15px;font-weight:750;margin-bottom:4px\">Payment of " + fmtMoney(m.amount) + "</div>" +
        "<div class=\"hint\" style=\"margin-bottom:12px\">" + fmtDateTime(m.created_at) + (m.note ? " · " + escapeHtml(m.note) : "") + "</div>" +
        (m.photo ? '<div class="photo-frame" style="margin-bottom:12px"><img src="/photo/' + m.photo + '" alt="payment proof"></div>' : "") +
        (cleared ? '<div class="pay-plan"><div class="pp-row pp-head">This payment cleared</div>' + cleared + "</div>" : "");
      modal({
        title: "Payment",
        wide: !!m.photo,
        body,
        buttons: [
          { label: "Close", cls: "ghost" },
          {
            label: "Undo payment",
            cls: "danger",
            icon: "undo",
            onClick: () => {
              confirmModal("Undo this payment?", "The balance comes back exactly as it was, and the bills it cleared reopen. Do this if it was recorded by mistake.", "Undo it", async () => {
                try { await API.post("/api/payments/undo", { id: pmtId, reason: "undone from ledger" }); toast("Payment undone"); App.refresh(); }
                catch (e) { toast(e.message, "err"); }
              }, true);
            },
          },
        ],
      });
    }).catch((e) => toast(e.message, "err"));
  },

  mergeDialog(p) {
    API.get("/api/people").then((d) => {
      const others = d.people.filter((x) => x.id !== p.id);
      if (!others.length) { toast("No other people to merge with", "warn"); return; }
      const body = document.createElement("div");
      body.innerHTML =
        "<div style=\"font-size:13.5px;color:var(--ink-2);margin-bottom:12px\">If " + escapeHtml(p.name) + " exists twice (e.g. \"R. Thapa\" and \"Ram Thapa\"), pick the other copy. All bills and payments move to <b>" + escapeHtml(p.name) + "</b> and the copy is deleted.</div>" +
        '<div class="field"><label>Merge this person INTO ' + escapeHtml(p.name) + ':</label><select class="input" id="mg-sel">' +
        others.map((o) => '<option value="' + o.id + '">' + escapeHtml(o.name) + (o.balance > 0.004 ? " (owes " + fmtMoney(o.balance) + ")" : "") + "</option>").join("") +
        "</select></div>";
      modal({
        title: "Merge duplicate",
        body,
        buttons: [
          { label: "Cancel", cls: "ghost" },
          {
            label: "Merge",
            cls: "primary",
            icon: "merge",
            onClick: async () => {
              try {
                await API.post("/api/people/merge", { primary: p.id, dup: body.querySelector("#mg-sel").value });
                toast("Merged");
                App.refresh();
              } catch (e) { toast(e.message, "err"); }
            },
          },
        ],
      });
    });
  },

  shareDialog(d, p) {
    /* Share: PDF / Excel / Copy text statement — all the same khata */
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--ink-2);margin-bottom:14px">' +
      "Share " + escapeHtml(p.name) + "'s khata — the same numbers as on screen, in the format you need.</div>" +
      '<button class="btn primary lg block" data-share="pdf" style="margin-bottom:10px">' + ico("doc") +
      "PDF — with bill photos</button>" +
      '<div class="hint" style="margin:-4px 0 14px 4px">One file: the khata page, totals, and every bill photo attached behind it. Best for WhatsApp.</div>' +
      '<button class="btn lg block" data-share="xlsx" style="margin-bottom:10px">' + ico("chart") +
      "Excel sheet (.xlsx)</button>" +
      '<div class="hint" style="margin:-4px 0 14px 4px">Two sheets: the khata with debit/credit/balance and totals, plus a list of bill photos. Opens in Excel or Google Sheets.</div>' +
      '<button class="btn lg block" data-share="text">' + ico("share") + "Copy as text</button>" +
      '<div class="hint" style="margin:-4px 0 0 4px">Plain khata text — paste straight into any message.</div>';
    modal({ title: "Share khata", body, buttons: [{ label: "Close", cls: "ghost" }] });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-share]");
      if (!b) return;
      const how = b.getAttribute("data-share");
      if (how === "pdf" || how === "xlsx") {
        const a = document.createElement("a");
        a.href = "/api/khata/" + how + "?id=" + encodeURIComponent(p.id);
        a.setAttribute("download", "");
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(how === "pdf" ? "PDF downloading — check your Downloads" : "Excel file downloading");
      } else if (how === "text") {
        this.statement(d);
      }
    });
  },

  statement(d) {
    /* shareable statement: plain text, copy-ready, khata format */
    const p = d.person;
    let lines = [];
    lines.push("KHATA SATHI STATEMENT — " + p.name);
    lines.push("Generated " + fmtDateTime(new Date().toISOString().slice(0, 19)));
    lines.push("Store: " + (App.state.store_name || "Khata Sathi"));
    lines.push("");
    let bal = 0, totDr = 0, totCr = 0;
    lines.push("DATE       | PARTICULARS          | DEBIT     | CREDIT    | BALANCE");
    for (const r of d.rows) {
      const isPay = r.kind === "payment";
      const counter = !isPay && r.already_paid;
      const dr = (!isPay && !counter) ? r.amount : 0;
      const cr = (isPay || counter) ? r.amount : 0;
      totDr += dr; totCr += cr;
      bal = r.balance_after;
      const dt = r.at.slice(0, 10);
      let part = isPay ? "payment received" : (counter ? "bill (paid at counter)" : "bill - credit given");
      if (r.note) part += " - " + r.note;
      lines.push(
        dt + " | " + part.slice(0, 20).padEnd(20) + " | " +
        (dr ? fmtMoney(dr).padStart(9) : "—".padStart(9)) + " | " +
        (cr ? fmtMoney(cr).padStart(9) : "—".padStart(9)) + " | " +
        fmtMoney(bal).padStart(9));
    }
    lines.push("-".repeat(72));
    lines.push("TOTAL      |                      | " + fmtMoney(totDr).padStart(9) + " | " + fmtMoney(totCr).padStart(9) + " | " + fmtMoney(d.balance).padStart(9));
    lines.push("");
    lines.push("BALANCE OWED: " + fmtMoney(d.balance));
    lines.push("Lifetime billed: " + fmtMoney(p.lifetime_billed) + " · Lifetime paid: " + fmtMoney(p.lifetime_paid));
    const text = lines.join("\n");
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--ink-2);margin-bottom:12px">Copy this and send it to ' + escapeHtml(p.name) + " — every line matches the khata.</div>" +
      '<textarea class="textarea" style="min-height:240px;font-family:ui-monospace,monospace;font-size:12px" readonly>' + escapeHtml(text) + "</textarea>";
    modal({
      title: "Statement for " + p.name,
      wide: true,
      body,
      buttons: [
        { label: "Close", cls: "ghost" },
        {
          label: "Copy",
          cls: "primary",
          icon: "share",
          onClick: () => {
            navigator.clipboard.writeText(text).then(() => toast("Statement copied")).catch(() => {
              const ta = body.querySelector("textarea");
              ta.select(); document.execCommand("copy"); toast("Statement copied");
            });
          },
        },
      ],
    });
  },
};

function emptyRow2(msg) {
  return '<div style="padding:18px 8px;color:var(--ink-3);font-size:13px;text-align:center">' + escapeHtml(msg) + "</div>";
}
