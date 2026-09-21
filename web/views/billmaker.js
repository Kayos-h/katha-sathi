/* Khata Sathi - bill maker: the estimate form. Items with qty x rate,
   live total, optional photo of the paper bill, save into the khata,
   then share the bill as a PDF over WhatsApp.
   The paper form this mirrors: Brought to / ESTIMATE box / S.N.-PARTICULARS-
   QTY.-RATE-AMOUNT / TOTAL / "Goods once sold..." note. */
"use strict";

/* global API, ico, fmtMoney, devToAscii, toAmountFloat, escapeHtml, modal, toast,
   lightbox, debounce, whatsappShare, avatarEl */

const BillMaker = {
  id: "billmaker",
  title: "Make bill",
  icon: "doc",
  personId: null,
  items: [],          // {particulars, qty, rate, amount}
  photoFile: null,
  photoUrl: "",
  photoBytes: null,

  async render(main, params) {
    this.personId = (params && params.person) || null;
    this.items = [{ particulars: "", qty: 1, rate: "", amount: "" }];
    this.photoFile = null; this.photoUrl = ""; this.photoBytes = null;

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Make a bill</div>' +
      '<div class="view-sub">Like the paper estimate form — items, rate, total. Saved straight into the khata.</div></div></div>' +
      '<div class="dash-grid">' +
      '<div class="panel panel-pad w-span-8" id="bm-form"></div>' +
      '<div class="panel panel-pad w-span-4" id="bm-side"></div>' +
      "</div>";

    this.renderForm(main);
    this.renderSide(main);
  },

  /* ---------- the form ---------- */
  renderForm(main) {
    const el = main.querySelector("#bm-form");
    const rowsHtml = this.items.map((it, i) => this.rowHtml(it, i)).join("");
    el.innerHTML =
      '<div class="sug-row">' +
      '<div class="field"><label>Brought to (who is this bill for?)</label>' +
      '<input class="input" id="bm-name" placeholder="Type a name — new names create an account" autocomplete="off" autocapitalize="words" enterkeyhint="next"></div>' +
      '<div class="sug-pop hidden" id="bm-sug"></div>' +
      "</div>" +
      '<div class="bm-meta-row">' +
      '<div class="field"><label>Phone (for new people)</label><input class="input" id="bm-phone" placeholder="98… (optional)"></div>' +
      '<div class="field"><label>Date</label><input class="input" id="bm-date" type="date"></div>' +
      "</div>" +
      '<table class="bm-table"><thead><tr>' +
      "<th>S.N.</th><th>PARTICULARS</th><th>QTY.</th><th>RATE</th><th>AMOUNT</th><th></th>" +
      "</tr></thead><tbody id='bm-rows'>" + rowsHtml + "</tbody></table>" +
      '<button class="btn" id="bm-add-row" style="margin-top:10px">' + ico("plus") + "Add item</button>";

    const dateEl = el.querySelector("#bm-date");
    dateEl.value = new Date().toISOString().slice(0, 10);

    /* prefill chosen person */
    if (this.personId) {
      API.get("/api/person?id=" + encodeURIComponent(this.personId)).then((p) => {
        el.querySelector("#bm-name").value = p.name;
      }).catch(() => {});
    }

    /* name suggestions (same flow as Add bill) */
    const nameEl = el.querySelector("#bm-name");
    const sugEl = el.querySelector("#bm-sug");
    const onName = debounce(async () => {
      const q = nameEl.value.trim();
      this.personId = null;
      if (!q) { sugEl.classList.add("hidden"); return; }
      try {
        const d = await API.get("/api/search?q=" + encodeURIComponent(q));
        if (!d.results.length) { sugEl.classList.add("hidden"); return; }
        sugEl.innerHTML = d.results.map((r) =>
          '<div class="search-hit" data-id="' + r.id + '">' + avatarEl(r.name, 30) +
          '<div><div class="sh-name">' + escapeHtml(r.name) + '</div><div class="sh-sub">' + (r.phone || "no phone") + "</div></div>" +
          '<div class="sh-bal money ' + (r.balance > 0.004 ? "neg" : "") + '">' + fmtMoney(r.balance) + "</div></div>"
        ).join("");
        sugEl.classList.remove("hidden");
        sugEl.querySelectorAll(".search-hit").forEach((hit) => {
          hit.onclick = () => {
            this.personId = hit.getAttribute("data-id");
            nameEl.value = hit.querySelector(".sh-name").textContent;
            sugEl.classList.add("hidden");
          };
        });
      } catch (e) { /* silent */ }
    }, 140);
    nameEl.addEventListener("input", onName);
    nameEl.addEventListener("blur", () => setTimeout(() => sugEl.classList.add("hidden"), 180));

    el.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        const i = parseInt(del.getAttribute("data-del"), 10);
        if (this.items.length > 1) { this.items.splice(i, 1); this.paintRows(main); }
        return;
      }
      if (e.target.closest("#bm-add-row")) {
        this.items.push({ particulars: "", qty: 1, rate: "", amount: "" });
        this.paintRows(main);
        const rows = el.querySelectorAll("#bm-rows input[data-f=particulars]");
        if (rows.length) rows[rows.length - 1].focus();
      }
    });

    /* number conversion + live total on any input in the table.
       No re-render here: the tbody stays, focus survives, cells update in place. */
    const tbody = el.querySelector("#bm-rows");
    tbody.addEventListener("input", (e) => {
      const inp = e.target;
      if (!inp.matches("input")) return;
      const tr = inp.closest("tr");
      const i = parseInt(tr.getAttribute("data-i"), 10);
      const f = inp.getAttribute("data-f");
      let v = devToAscii(inp.value);
      if (f !== "particulars") {
        v = v.replace(/रू|rs\.?|npr/gi, "").replace(/[^\d.]/g, "");
        /* one dot max: "1.2.3" is a typo, never a number */
        const first = v.indexOf(".");
        if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, "");
      }
      if (v !== inp.value) inp.value = v;
      this.items[i][f] = inp.value;
      if (f === "qty" || f === "rate") {
        /* qty or rate changed: recompute amount = qty x rate, in place */
        const q = toAmountFloat(this.items[i].qty) || 0;
        const r = toAmountFloat(this.items[i].rate) || 0;
        const amtCell = tr.querySelector('input[data-f="amount"]');
        if (q > 0 && r > 0) {
          this.items[i].amount = String(Math.round(q * r * 100) / 100);
          amtCell.value = this.items[i].amount;
        } else {
          /* missing half of the math: show nothing rather than a wrong number */
          this.items[i].amount = "";
          amtCell.value = "";
        }
      }
      this.paintTotal(main);
    });

    this.paintTotal(main);
  },

  rowHtml(it, i) {
    const num = (v) => (v === "" || v == null ? "" : String(v));
    return '<tr data-i="' + i + '">' +
      '<td class="bm-sn">' + (i + 1) + "</td>" +
      '<td><input class="input bm-in" data-f="particulars" placeholder="e.g. sunflower oil 1L" value="' + escapeHtml(it.particulars) + '"></td>' +
      '<td><input class="input bm-in num" data-f="qty" inputmode="decimal" placeholder="Qty" value="' + escapeHtml(num(it.qty)) + '"></td>' +
      '<td><input class="input bm-in num" data-f="rate" inputmode="decimal" placeholder="Rate" value="' + escapeHtml(num(it.rate)) + '"></td>' +
      '<td><input class="input bm-in num money" data-f="amount" inputmode="decimal" placeholder="Amount" value="' + escapeHtml(num(it.amount)) + '"></td>' +
      '<td><button class="icon-btn" data-del="' + i + '" title="Remove item">' + ico("trash") + "</button></td>" +
      "</tr>";
  },

  paintRows(main) {
    const el = main.querySelector("#bm-rows");
    el.innerHTML = this.items.map((it, i) => this.rowHtml(it, i)).join("");
    this.paintTotal(main);
  },

  paintTotal(main) {
    const side = main.querySelector("#bm-total");
    if (!side) return;
    const total = this.items.reduce((s, it) => s + (toAmountFloat(it.amount) || 0), 0);
    side.textContent = fmtMoney(total);
    this.paintPaidPreview(main);
  },

  paintPaidPreview(main) {
    const paidEl = main.querySelector("#bm-paid-now");
    const paidFull = main.querySelector("#bm-paid");
    const hint = main.querySelector("#bm-paid-hint");
    if (!paidEl || !paidFull || !hint) return;
    const total = this.items.reduce((s, it) => s + (toAmountFloat(it.amount) || 0), 0);
    if (paidFull.checked) {
      paidEl.value = "";
      paidEl.disabled = true;
      hint.textContent = "Full amount is marked paid at the counter.";
      return;
    }
    paidEl.disabled = false;
    const paid = toAmountFloat(paidEl.value) || 0;
    if (paid > 0) {
      const rest = Math.max(0, total - paid);
      hint.textContent = fmtMoney(paid) + " will be recorded as paid; " + fmtMoney(rest) + " stays in the khata.";
    } else {
      hint.textContent = "Leave empty for full credit, or enter the amount paid now.";
    }
  },

  /* ---------- side: photo + save ---------- */
  renderSide(main) {
    const el = main.querySelector("#bm-side");
    el.innerHTML =
      '<div class="panel-title">' + ico("doc") + "Bill summary</div>" +
      '<div class="bm-total-row"><span>TOTAL</span><div class="bm-total money" id="bm-total">Rs. 0</div></div>' +
      '<div class="field" style="margin-top:14px"><label>Paid now (optional)</label>' +
      '<input class="input money" id="bm-paid-now" placeholder="Rs. 0" inputmode="text" autocomplete="off">' +
      '<div class="hint" id="bm-paid-hint">Leave empty for full credit, or enter the amount paid now.</div></div>' +
      '<div class="field" style="margin-top:14px"><label>Note (optional)</label>' +
      '<input class="input" id="bm-note" placeholder="e.g. monthly ration"></div>' +
      '<div class="check-row" style="margin-top:14px">' +
      '<label class="switch"><input type="checkbox" id="bm-paid"><span class="track"></span></label>' +
      '<div><div class="cr-txt">Already paid at the counter</div>' +
      '<div class="cr-sub">No balance is owed — the cash is added to today\'s galla automatically.</div></div>' +
      "</div>" +
      '<div style="margin-top:18px" id="bm-photo-box"></div>' +
      '<button class="btn primary lg block" id="bm-save" style="margin-top:16px">' + ico("check") + "Save bill</button>";

    const paidNow = el.querySelector("#bm-paid-now");
    paidNow.addEventListener("input", () => {
      const v = devToAscii(paidNow.value).replace(/रू|rs\.?|npr/gi, "").replace(/[^\d.]/g, "");
      const first = v.indexOf(".");
      const cleaned = first === -1 ? v : v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, "");
      if (cleaned !== paidNow.value) paidNow.value = cleaned;
      this.paintPaidPreview(main);
    });
    el.querySelector("#bm-paid").addEventListener("change", () => this.paintPaidPreview(main));
    el.querySelector("#bm-save").onclick = () => this.save(main);
    this.renderPhotoBox(main);
    this.paintTotal(main);
  },

  renderPhotoBox(main) {
    const box = main.querySelector("#bm-photo-box");
    if (this.photoUrl) {
      box.innerHTML =
        '<div class="photo-frame"><img src="' + this.photoUrl + '" alt="bill photo"></div>' +
        '<div class="btn-row" style="margin-top:8px">' +
        '<button class="btn sm" id="bm-retake">' + ico("camera_retake") + "Retake photo</button>" +
        '<button class="btn sm ghost" id="bm-nophoto">' + ico("trash") + "Remove photo</button></div>";
      box.querySelector("#bm-retake").onclick = () => this.pickPhoto(main, true);
      box.querySelector("#bm-nophoto").onclick = () => {
        this.photoFile = null; this.photoUrl = ""; this.photoBytes = null;
        this.renderPhotoBox(main);
      };
      return;
    }
    box.innerHTML =
      '<button class="btn block" id="bm-photo-btn">' + ico("cam") + "Attach paper bill photo</button>" +
      '<div class="hint" style="margin-top:6px">Optional — kept as proof with the bill.</div>';
    box.querySelector("#bm-photo-btn").onclick = () => this.pickPhoto(main, true);
  },

  async pickPhoto(main, wantCamera) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    if (wantCamera !== false && window.matchMedia("(max-width: 900px)").matches) {
      input.capture = "environment";
    }
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      if (f.size > 40 * 1024 * 1024) { toast("Photo too large (max 40MB)", "err"); return; }
      this.photoFile = f;
      if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
      f.arrayBuffer().then((buf) => { this.photoBytes = new Uint8Array(buf); });
      this.photoUrl = URL.createObjectURL(f);
      this.renderPhotoBox(main);
    };
    input.click();
  },

  save(main) {
    const name = main.querySelector("#bm-name").value.trim();
    const phone = main.querySelector("#bm-phone").value.trim();
    const note = main.querySelector("#bm-note").value.trim();
    const alreadyPaid = main.querySelector("#bm-paid").checked;
    const paidRaw = main.querySelector("#bm-paid-now").value.trim();

    if (!name) { toast("Type who the bill is for", "err"); main.querySelector("#bm-name").focus(); return; }

    const items = [];
    this.items.forEach((it) => {
      const part = (it.particulars || "").trim();
      const amt = toAmountFloat(it.amount);
      const rate = toAmountFloat(it.rate);
      const qty = toAmountFloat(it.qty);
      if (part && (amt || rate)) {
        items.push({ particulars: part, qty: qty || 1, rate: rate || 0, amount: amt || 0 });
      }
    });
    if (!items.length) { toast("Add at least one item (particulars + rate or amount)", "err"); return; }
    const total = items.reduce((s, it) => s + it.amount, 0);
    const paidNow = paidRaw ? toAmountFloat(paidRaw) : 0;
    if (paidNow === null || paidNow < 0) { toast("Enter a valid paid amount", "err"); return; }
    if (alreadyPaid && paidNow > 0) { toast("Use either already paid or paid now, not both", "err"); return; }
    if (paidNow > total + 0.004) { toast("Paid amount cannot be more than the bill total", "err"); return; }

    const payload = {
      person_id: this.personId || undefined,
      person_name: this.personId ? undefined : name,
      phone: this.personId ? undefined : phone,
      note,
      already_paid: alreadyPaid,
      paid_amount: paidNow > 0 ? paidNow : undefined,
      paid_note: paidNow > 0 ? "paid while making bill" : undefined,
      items,
    };

    const finish = (photoB64) => {
      if (photoB64) payload.photo_b64 = photoB64;
      API.post("/api/bills/itemized/add", payload).then((res) => {
        let msg = "Bill " + res.bill_no + " saved — " + fmtMoney(res.amount);
        if ((alreadyPaid || paidNow > 0) && res.galla_in) msg += " · cash added to today's galla";
        if (paidNow > 0) msg += " · " + fmtMoney(paidNow) + " paid, " + fmtMoney(res.remaining) + " left";
        toast(msg, "ok", 4200);
        this.shareDialog(res, name);
      }).catch((e) => toast(e.message, "err"));
    };

    if (this.photoFile) {
      const fr = new FileReader();
      fr.onload = () => finish(fr.result.split(",")[1]);
      fr.onerror = () => finish(null);
      fr.readAsDataURL(this.photoFile);
    } else {
      finish(null);
    }
  },

  /* ---------- share: WhatsApp mobile + desktop ---------- */
  shareDialog(res, name) {
    const body = document.createElement("div");
    body.innerHTML =
      '<div style="font-size:13.5px;color:var(--ink-2);margin-bottom:14px">Bill <b>' + res.bill_no + "</b> of <b>" +
      escapeHtml(name) + "</b> — " + fmtMoney(res.amount) + " is saved in the khata.</div>" +
      '<button class="btn success lg block" data-s="wa" style="margin-bottom:10px">' + ico("whatsapp") +
      "Send on WhatsApp</button>" +
      '<div class="hint" style="margin:-4px 0 12px 4px">Phone: the share sheet opens with the PDF attached. ' +
      "Desktop: the PDF downloads and WhatsApp Web opens — you pick the chat, the text is on your clipboard.</div>" +
      '<button class="btn lg block" data-s="pdf" style="margin-bottom:10px">' + ico("dl") + "Just download the PDF</button>" +
      '<button class="btn ghost lg block" data-s="later">Later — open the khata</button>';
    modal({ title: "Bill saved", body, dismissable: true });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      const how = b.getAttribute("data-s");
      if (how === "later") { App.go("ledger", { id: res.person_id }); return; }
      const pdfUrl = "/api/bill/pdf?id=" + encodeURIComponent(res.id);
      const text = "Bill " + res.bill_no + " for " + name + " — " + fmtMoney(res.amount) +
        "\n" + (App.state.store_name || "Khata Sathi");
      if (how === "pdf") {
        const a = document.createElement("a");
        a.href = pdfUrl; a.setAttribute("download", "");
        document.body.appendChild(a); a.click(); a.remove();
        toast("PDF downloading — check your Downloads");
      } else {
        whatsappShare(pdfUrl, text, "bill-" + res.bill_no + ".pdf");
      }
    });
  },
};
