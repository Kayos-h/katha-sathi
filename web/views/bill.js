/* Khata Sathi - add bill: text/amount input -> confirm -> saved
   Photo capture is temporarily under construction for cloud upgrades. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, devToAscii, toAmountFloat, escapeHtml, modal, toast, debounce, App */

const AddBill = {
  id: "add",
  title: "Add bill",
  icon: "cam",
  personId: null,
  suggestionSel: -1,

  async render(main, params) {
    this.personId = (params && params.person) || null;

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Add a bill</div>' +
      '<div class="view-sub">Enter the customer name, amount, and save into the khata.</div></div></div>' +
      '<div class="add-grid">' +
      '<div class="panel panel-pad" id="ab-left"></div>' +
      '<div class="panel panel-pad" id="ab-right"></div>' +
      "</div>";

    this.renderLeft(main);
    this.renderRight(main);
  },

  /* ---------- photo side (Under Construction) ---------- */
  renderLeft(main) {
    const el = main.querySelector("#ab-left");
    el.innerHTML =
      '<div class="construction-zone">' +
      '<div class="cam-ico">' + ico("gear") + "</div>" +
      '<div style="font-weight:800;font-size:16px;margin-top:4px">Photo feature — Under Construction</div>' +
      '<div style="font-size:13px;line-height:1.5;max-width:320px;color:var(--ink-2);margin-top:4px">' +
      'Cloud photo storage is currently being upgraded. Enter bill details on the right to record this bill straight into the khata.' +
      "</div>" +
      '<div class="construction-badge">' + ico("clock") + " Arriving Soon</div>" +
      "</div>" +
      '<div class="hint" style="margin-top:14px;text-align:center;line-height:1.45">' +
      "All khata records, ledger calculations, and PDF shares work 100% without photos." +
      "</div>";
  },

  /* ---------- details side ---------- */
  renderRight(main) {
    const el = main.querySelector("#ab-right");
    el.innerHTML =
      '<div class="panel-title">' + ico("doc") + "Bill details</div>" +
      '<div class="sug-row">' +
      '<div class="field"><label>Who is this bill for?</label>' +
      '<input class="input" id="ab-name" placeholder="Type a name — new names create an account" autocomplete="off" autocapitalize="words" enterkeyhint="next"></div>' +
      '<div class="sug-pop hidden" id="ab-sug"></div>' +
      "</div>" +
      '<div class="field" style="margin-top:14px"><label>Amount on the bill</label>' +
      '<input class="input big money" id="ab-amt" placeholder="Rs. 0" inputmode="text" autocomplete="off">' +
      '<div class="hint">Commas are fine — Nepali digits convert to English as you type.</div></div>' +
      '<div class="field" style="margin-top:14px"><label>Paid now (optional)</label>' +
      '<input class="input money" id="ab-paid-now" placeholder="Rs. 0" inputmode="text" autocomplete="off">' +
      '<div class="hint" id="ab-paid-hint">Leave empty for full credit, or enter the amount paid now.</div></div>' +
      '<div class="field" style="margin-top:14px"><label>Note (optional)</label>' +
      '<input class="input" id="ab-note" placeholder="e.g. 5kg sugar, mustard oil"></div>' +
      '<div class="check-row" style="margin-top:14px">' +
      '<label class="switch"><input type="checkbox" id="ab-paid"><span class="track"></span></label>' +
      '<div><div class="cr-txt">Already paid at the counter</div>' +
      '<div class="cr-sub">Cash added to today\'s galla automatically.</div></div>' +
      "</div>" +
      '<button class="btn primary lg block" id="ab-save" style="margin-top:18px">' + ico("check") + "Save bill</button>";

    const nameEl = el.querySelector("#ab-name");
    const amt = el.querySelector("#ab-amt");
    const note = el.querySelector("#ab-note");
    const sug = el.querySelector("#ab-sug");
    const paid = el.querySelector("#ab-paid");
    const paidNow = el.querySelector("#ab-paid-now");
    const paidHint = el.querySelector("#ab-paid-hint");

    if (this.personId) {
      API.get("/api/person?id=" + encodeURIComponent(this.personId)).then((p) => {
        nameEl.value = p.name;
      }).catch(() => {});
    }

    const updatePaidState = () => {
      const billTotal = toAmountFloat(amt.value) || 0;
      if (paid.checked) {
        paidNow.value = "";
        paidNow.disabled = true;
        paidHint.textContent = "Full amount is marked paid at the counter.";
        return;
      }
      paidNow.disabled = false;
      const pVal = toAmountFloat(paidNow.value) || 0;
      if (pVal > 0) {
        const rest = Math.max(0, billTotal - pVal);
        paidHint.textContent = fmtMoney(pVal) + " will be recorded as paid; " + fmtMoney(rest) + " stays in the khata.";
      } else {
        paidHint.textContent = "Leave empty for full credit, or enter the amount paid now.";
      }
    };

    paid.addEventListener("change", updatePaidState);

    const formatMoneyInput = (inputEl) => {
      const v = devToAscii(inputEl.value).replace(/रू|rs\.?|npr/gi, "").replace(/[^\d.]/g, "");
      const first = v.indexOf(".");
      const cleaned = first === -1 ? v : v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, "");
      if (cleaned !== inputEl.value) inputEl.value = cleaned;
    };

    amt.addEventListener("input", () => { formatMoneyInput(amt); updatePaidState(); });
    paidNow.addEventListener("input", () => { formatMoneyInput(paidNow); updatePaidState(); });

    const onNameInput = debounce(async () => {
      const q = nameEl.value.trim();
      this.personId = null;
      if (!q) { sug.classList.add("hidden"); return; }
      try {
        const d = await API.get("/api/search?q=" + encodeURIComponent(q));
        if (!d.results.length) { sug.classList.add("hidden"); return; }
        sug.innerHTML = d.results.map((r) =>
          '<div class="search-hit" data-id="' + r.id + '">' +
          '<div><div class="sh-name">' + escapeHtml(r.name) + '</div><div class="sh-sub">' + (r.phone || r.open_count + " open bills") + "</div></div>" +
          '<div class="sh-bal money ' + (r.balance > 0.004 ? "neg" : "") + '">' + fmtMoney(r.balance) + "</div></div>"
        ).join("");
        sug.classList.remove("hidden");
        this.suggestionSel = -1;
        sug.querySelectorAll(".search-hit").forEach((hit) => {
          hit.onclick = () => {
            this.personId = hit.getAttribute("data-id");
            nameEl.value = hit.querySelector(".sh-name").textContent;
            sug.classList.add("hidden");
            amt.focus();
          };
        });
      } catch (e) { /* silent */ }
    }, 140);

    nameEl.addEventListener("input", onNameInput);
    nameEl.addEventListener("blur", () => setTimeout(() => sug.classList.add("hidden"), 180));

    el.querySelector("#ab-save").onclick = () => this.save(main);
    setTimeout(() => (this.personId ? amt.focus() : nameEl.focus()), 60);
  },

  save(main) {
    const name = main.querySelector("#ab-name").value.trim();
    const amtRaw = main.querySelector("#ab-amt").value;
    const note = main.querySelector("#ab-note").value.trim();
    const alreadyPaid = main.querySelector("#ab-paid").checked;
    const paidRaw = main.querySelector("#ab-paid-now").value.trim();
    const amount = toAmountFloat(amtRaw);
    const paidNow = paidRaw ? toAmountFloat(paidRaw) : 0;

    if (!name) { toast("Type who the bill is for", "err"); main.querySelector("#ab-name").focus(); return; }
    if (amount === null || amount <= 0) { toast("Enter the bill amount", "err"); main.querySelector("#ab-amt").focus(); return; }
    if (paidNow === null || paidNow < 0) { toast("Enter a valid paid amount", "err"); return; }
    if (alreadyPaid && paidNow > 0) { toast("Use either already paid or paid now, not both", "err"); return; }
    if (paidNow > amount + 0.004) { toast("Paid amount cannot be more than the bill total", "err"); return; }

    const payload = {
      person_id: this.personId || undefined,
      person_name: this.personId ? undefined : name,
      amount: amtRaw,
      note: note,
      already_paid: alreadyPaid,
      paid_amount: paidNow > 0 ? paidNow : undefined,
      paid_note: paidNow > 0 ? "paid while adding bill" : undefined,
    };

    const doSave = () => {
      API.post("/api/bills/add", payload).then((res) => {
        let msg = alreadyPaid ? "Bill saved (paid at counter)" : "Bill saved — " + fmtMoney(amount);
        if (paidNow > 0) msg += " · " + fmtMoney(paidNow) + " paid, " + fmtMoney(res.remaining) + " left";
        if ((alreadyPaid || paidNow > 0) && res.galla_in) msg += " · cash added to galla";
        toast(msg, "ok");
        App.go("ledger", { id: res.person_id });
      }).catch((e) => {
        if (e.message && e.message.includes("Open today's galla")) {
          promptOpenGalla(doSave);
        } else {
          toast(e.message, "err");
        }
      });
    };
    doSave();
  },
};
