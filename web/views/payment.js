/* Khata Sathi - record payment with FIFO clearing preview */
"use strict";

/* global API, ico, fmtMoney, fmtDate, fmtDateTime, devToAscii, toAmountFloat, escapeHtml, modal, toast, debounce */

const Payment = {
  id: "pay",
  title: "Got money",
  icon: "money",
  person: null,
  plan: null,
  billId: null,        // set = pay ONE bill (the partial-payment path)
  prefillFull: false,
  photoFile: null, photoBytes: null, photoUrl: "",

  async render(main, params) {
    this.photoFile = null; this.photoBytes = null; this.photoUrl = "";
    this.billId = (params && params.bill) || null;
    this.bill = null;
    this.prefillFull = !!(params && params.full);
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Got money</div>' +
      '<div class="view-sub">' + (this.billId
        ? "Paying one bill — partial payments are fine; the bill turns part-paid, then paid."
        : (this.prefillFull
          ? "Full clear is ready — save to clear the whole open balance."
          : "Record a payment — type any amount, or clear the full balance.")) + "</div></div></div>" +
      '<div class="add-grid">' +
      '<div class="panel panel-pad" id="pay-left"></div>' +
      '<div class="panel panel-pad" id="pay-right"></div>' +
      "</div>";
    await this.load(main, params.id);
  },

  async load(main, pid) {
    try {
      this.person = await API.get("/api/person?id=" + encodeURIComponent(pid));
    } catch (e) {
      toast(e.message, "err");
      App.go("people");
      return;
    }
    if (this.billId) {
      try {
        const ob = await API.get("/api/openbills?id=" + encodeURIComponent(pid));
        const target = ob.bills.find((b) => b.id === this.billId);
        if (!target) { toast("That bill is already fully paid", "warn", 4200); App.go("ledger", { id: pid }); return; }
        this.bill = target;
      } catch (e) { toast(e.message, "err"); App.go("people"); return; }
    } else if (this.person.balance <= 0.004) {
      main.innerHTML =
        '<div class="panel empty" style="max-width:480px;margin:40px auto">' +
        '<div class="e-ico">' + ico("check") + '</div><div class="e-t">' + escapeHtml(this.person.name) + " owes nothing</div>" +
        '<div class="e-s">There\'s nothing to pay against. Add a bill first.</div>' +
        '<button class="btn primary" style="margin-top:6px" onclick="App.go(\'add\',{person:\'' + this.person.id + '\'})">' + ico("cam") + "Add a bill</button></div>";
      return;
    }
    this.renderLeft(main);
    this.renderRight(main);
  },

  renderLeft(main) {
    const p = this.person;
    main.querySelector("#pay-left").innerHTML =
      '<div class="panel-title">' + ico("wallet") + (this.billId
        ? "Paying this bill"
        : "Open bills (oldest first)") + "</div>" +
      '<div class="ob-list" id="pay-bills"></div>';
    API.get("/api/openbills?id=" + encodeURIComponent(p.id)).then((d) => {
      const list = main.querySelector("#pay-bills");
      if (!list) return;
      list.innerHTML = d.bills.length
        ? d.bills.map((b) => {
          const mine = this.billId && b.id === this.billId;
          return '<div class="ob-item"' + (mine ? ' style="border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)"' : "") + '>' +
          (b.photo ? '<img class="ob-thumb" src="/photo/' + b.photo + '" alt="bill" onclick="lightbox(this.src)">' : '<div class="ob-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--ink-3)">' + ico("bill") + "</div>") +
          '<div class="ob-mid"><div class="ob-title">' + fmtMoney(b.remaining) + " of " + fmtMoney(b.amount) + "</div>" +
          '<div class="ob-sub">' + fmtDate(b.created_at) + (b.note ? " · " + escapeHtml(b.note) : "") + (mine ? " · <b>this bill</b>" : "") + "</div></div>" +
          '<div class="ob-right"><div class="ob-rem money">' + fmtMoney(b.remaining) + '</div><div class="ob-cap">' + (mine ? "paying this" : "open") + "</div></div>" +
          "</div>";
        }).join("")
        : emptyRow3("No open bills");
    }).catch(() => {
      const list = main.querySelector("#pay-bills");
      if (list) list.innerHTML = emptyRow3("Could not load bills");
    });
  },

  renderRight(main) {
    const p = this.person;
    const el = main.querySelector("#pay-right");
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">' +
      avatarEl(p.name, 40) +
      '<div><div style="font-weight:750;font-size:15.5px">' + escapeHtml(p.name) + "</div>" +
      '<div class="hint">owes <b class="money neg">' + fmtMoney(p.balance) + "</b></div></div></div>" +
      '<div class="field" style="margin-top:14px"><label>How much came in?</label>' +
      '<input class="input big money" id="pay-amt" placeholder="Rs. 0" inputmode="text" autocomplete="off">' +
      '<div class="hint">Tap a quick amount or type — partial payments are fine.</div></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px" id="pay-quick"></div>' +
      '<div class="field" style="margin-top:14px"><label>Note (optional)</label>' +
      '<input class="input" id="pay-note" placeholder="e.g. cash, eSewa, Khalti"></div>' +
      '<div class="cam-zone" id="pay-photo" style="margin-top:14px;padding:14px">' +
      '<div style="display:flex;align-items:center;gap:10px;width:100%">' +
      '<span style="color:var(--ink-2)">' + ico("cam") + "</span>" +
      '<span style="font-size:13px;color:var(--ink-2)">Add proof photo (optional)</span>' +
      '<button class="btn sm" style="margin-left:auto" id="pay-photo-btn">Choose</button>' +
      "</div></div>" +
      '<div id="pay-plan" style="margin-top:16px"></div>' +
      '<button class="btn success lg block" id="pay-save" style="margin-top:16px" disabled>' + ico("check") + "Save payment</button>";

    /* quick amount buttons */
    const bal = this.billId ? this.bill.remaining : p.balance;
    const quicks = [];
    if (bal >= 100) quicks.push(100, 500);
    if (bal > 500) quicks.push(Math.round(bal / 2));
    quicks.push("Full clear " + fmtMoney(bal));
    el.querySelector("#pay-quick").innerHTML = quicks.map((q) => {
      const isAll = typeof q === "string";
      const v = isAll ? bal : q;
      return '<button class="btn sm" data-v="' + v + '">' + (isAll ? q : fmtMoney(v)) + "</button>";
    }).join("");
    el.querySelector("#pay-quick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) { el.querySelector("#pay-amt").value = b.getAttribute("data-v"); this.preview(main); }
    });

    const amt = el.querySelector("#pay-amt");
    amt.addEventListener("input", debounce(() => this.preview(main), 260));
    amt.addEventListener("keydown", (e) => { if (e.key === "Enter" && !el.querySelector("#pay-save").disabled) this.save(main); });
    el.querySelector("#pay-note").addEventListener("keydown", (e) => { if (e.key === "Enter" && !el.querySelector("#pay-save").disabled) this.save(main); });

    el.querySelector("#pay-photo-btn").onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        this.photoFile = f;
        this.photoBytes = new Uint8Array(await f.arrayBuffer());
        if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
        this.photoUrl = URL.createObjectURL(f);
        const zone = el.querySelector("#pay-photo");
        zone.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;width:100%">' +
          '<img src="' + this.photoUrl + '" style="width:44px;height:44px;object-fit:cover;border-radius:8px" alt="proof">' +
          '<span style="font-size:13px;color:var(--ink-2)">Proof attached</span>' +
          '<button class="btn sm" style="margin-left:auto" id="pay-photo-x">Remove</button></div>';
        zone.querySelector("#pay-photo-x").onclick = () => {
          this.photoFile = null; this.photoBytes = null;
          this.renderRight(main);
          this.preview(main);
        };
      };
      input.click();
    };

    el.querySelector("#pay-save").onclick = () => this.save(main);
    if (this.prefillFull) {
      amt.value = bal;
      this.preview(main);
    }
    setTimeout(() => amt.focus(), 60);
  },

  preview(main) {
    const amtEl = main.querySelector("#pay-amt");
    const box = main.querySelector("#pay-plan");
    const saveBtn = main.querySelector("#pay-save");
    const v = toAmountFloat(amtEl.value);
    if (v === null || v <= 0) { box.innerHTML = ""; saveBtn.disabled = true; return; }
    const payload = { person_id: this.person.id, amount: amtEl.value };
    if (this.billId) payload.bill_id = this.billId;
    API.post("/api/payments/preview", payload)
      .then((d) => {
        this.plan = d.plan;
        saveBtn.disabled = false;
        const afterThis = this.billId
          ? Math.max(0, this.bill.remaining - v)
          : Math.max(0, d.open_total - v);
        box.innerHTML =
          '<div class="pay-plan"><div class="pp-row pp-head">' +
          (this.billId ? "This payment goes to the bill of " + fmtDate(this.bill.created_at) +
            " (" + fmtMoney(this.bill.amount) + ")" : "This payment will clear") +
          "</div>" +
          d.plan.map((a) =>
            '<div class="pp-row"><span class="pp-date">' + fmtDate(a.bill_at) + "</span>" +
            '<span class="pp-amount">bill of ' + fmtMoney(a.bill_amount) + (a.apply < a.bill_remaining - 0.004 ? " (part)" : "") + "</span>" +
            '<span class="pp-apply">−' + fmtMoney(a.apply) + "</span></div>").join("") +
          '<div class="pp-row" style="background:var(--green-soft)"><span class="pp-date" style="font-weight:700;color:var(--green-ink)">After this</span>' +
          '<span class="pp-amount" style="color:var(--green-ink);font-weight:600">' +
          (this.billId ? "still open on this bill" : escapeHtml(this.person.name) + " will owe") +
          "</span>" +
          '<span style="font-weight:800;color:var(--green-ink)">' + fmtMoney(afterThis) + "</span></div>" +
          "</div>";
      })
      .catch((e) => {
        saveBtn.disabled = true;
        box.innerHTML = '<div class="quality-msg bad">' + ico("warn") + "<span>" + escapeHtml(e.message) + "</span></div>";
      });
  },

  save(main) {
    const amtEl = main.querySelector("#pay-amt");
    const note = main.querySelector("#pay-note").value.trim();
    const payload = { person_id: this.person.id, amount: amtEl.value, note };
    if (this.billId) payload.bill_id = this.billId;

    const finish = (b64) => {
      if (b64) payload.photo_b64 = b64;
      API.post("/api/payments/add", payload).then((res) => {
        const clearedTxt = this.plan && this.plan.length === 1 && this.plan[0].apply >= this.plan[0].bill_remaining - 0.004
          ? "cleared the " + fmtDate(this.plan[0].bill_at) + " bill fully"
          : (this.plan ? "cleared " + this.plan.length + " bill" + (this.plan.length === 1 ? "" : "s") + ", oldest first" : "");
        toast("Payment saved" + (res.galla_in ? " — cash added to galla" : "") +
          (clearedTxt ? " — " + clearedTxt : ""), "ok", 3800);
        App.go("ledger", { id: this.person.id });
      }).catch((e) => toast(e.message, "err"));
    };

    if (this.photoBytes) {
      const fr = new FileReader();
      fr.onload = () => finish(fr.result.split(",")[1]);
      fr.onerror = () => finish(null);
      fr.readAsDataURL(this.photoFile);
    } else finish(null);
  },
};

function emptyRow3(msg) {
  return '<div style="padding:18px 8px;color:var(--ink-3);font-size:13px;text-align:center">' + escapeHtml(msg) + "</div>";
}
