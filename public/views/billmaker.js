/* Khata Sathi - bill maker: the estimate form. Items with qty x rate,
   live total, live inventory autocomplete & auto-deduction, save into the khata,
   then share the bill as a PDF over WhatsApp.
   The paper form this mirrors: Brought to / ESTIMATE box / S.N.-PARTICULARS-
   QTY.-RATE-AMOUNT / TOTAL / "Goods once sold..." note. */
"use strict";

/* global API, ico, fmtMoney, devToAscii, toAmountFloat, escapeHtml, modal, toast,
   lightbox, debounce, whatsappShare, avatarEl, promptOpenGalla, App */

const BillMaker = {
  id: "billmaker",
  title: "Make bill",
  icon: "doc",
  personId: null,
  items: [],          // {particulars, qty, rate, amount, stockInfo}
  stockCache: null,
  stockCacheAt: 0,
  searchCache: {},

  async render(main, params) {
    this.personId = (params && params.person) || null;
    this.items = [{ particulars: "", qty: 1, rate: "", amount: "", stockInfo: "" }];

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Make a bill</div>' +
      '<div class="view-sub">Like the paper estimate form — items, rate, total. Saved straight into the khata with automated inventory sync.</div></div></div>' +
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
      '<div style="overflow-x:auto"><table class="bm-table"><thead><tr>' +
      "<th>S.N.</th><th>PARTICULARS</th><th>QTY.</th><th>RATE</th><th>AMOUNT</th><th></th>" +
      "</tr></thead><tbody id='bm-rows'>" + rowsHtml + "</tbody></table></div>" +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn" id="bm-add-row">' + ico("plus") + "Add empty item</button>" +
      '<button class="btn primary" id="bm-pick-stock">' + ico("box") + "<span>Pick from Stock (Fast Autofill)</span></button>" +
      '</div>';

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
        this.items.push({ particulars: "", qty: 1, rate: "", amount: "", stockInfo: "" });
        this.paintRows(main);
        const rows = el.querySelectorAll("#bm-rows input[data-f=particulars]");
        if (rows.length) rows[rows.length - 1].focus();
      }
      if (e.target.closest("#bm-pick-stock")) {
        this.openStockPickerModal(main);
      }
    });

    /* live autocomplete for inventory particulars */
    const showSuggestions = debounce(async (inp) => {
      const q = inp.value.trim();
      const td = inp.closest("td");
      const sugPop = td.querySelector(".inv-sug-pop");
      if (!sugPop) return;
      if (q.length < 2) {
        sugPop.classList.add("hidden");
        return;
      }

      try {
        const key = q.toLowerCase();
        const cached = this.searchCache[key];
        let res;
        if (cached && Date.now() - cached.time < 30000) {
          res = cached.data;
        } else {
          res = await API.get("/api/inventory/search?q=" + encodeURIComponent(q) + "&limit=8");
          this.searchCache[key] = { data: res, time: Date.now() };
        }
        if (inp.value.trim() !== q) return;
        if (!res.results || !res.results.length) {
          sugPop.classList.add("hidden");
          return;
        }

        sugPop.innerHTML =
          '<div style="padding:6px 10px;font-size:10.5px;font-weight:750;color:var(--ink-3);text-transform:uppercase;background:var(--bg-inset);border-bottom:1px solid var(--line-2)">' +
          'Stock Autofill Suggestions' +
          '</div>' +
          res.results.map((r) =>
            '<div class="inv-sug-hit" data-item=\'' + escapeHtml(JSON.stringify(r)) + '\'>' +
            '<div style="display:flex;align-items:center;justify-content:space-between">' +
            '<div style="font-weight:700;color:var(--ink);font-size:13.5px">' + escapeHtml(r.name) + '</div>' +
            '<div class="money" style="font-weight:750;color:var(--accent)">' + fmtMoney(r.sell_price) + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--ink-2);display:flex;justify-content:space-between;margin-top:3px">' +
            '<span>In Stock: <b style="color:' + (r.stock_qty <= 0 ? 'var(--red)' : 'var(--green-ink)') + '">' + r.stock_qty + ' ' + escapeHtml(r.unit) + '</b></span>' +
            '<span style="font-size:11px;color:var(--ink-3)">' + escapeHtml(r.category || "General") + '</span>' +
            '</div></div>'
          ).join("");
        sugPop.classList.remove("hidden");

        sugPop.querySelectorAll(".inv-sug-hit").forEach((hit) => {
          hit.onmousedown = (e) => {
            e.preventDefault();
            const item = JSON.parse(hit.getAttribute("data-item"));
            const tr = inp.closest("tr");
            const idx = parseInt(tr.getAttribute("data-i"), 10);
            inp.value = item.name;
            this.items[idx].particulars = item.name;

            const rateInp = tr.querySelector('input[data-f="rate"]');
            if (item.sell_price > 0) {
              rateInp.value = String(item.sell_price);
              this.items[idx].rate = String(item.sell_price);
            }

            const qtyInp = tr.querySelector('input[data-f="qty"]');
            if (!this.items[idx].qty || Number(this.items[idx].qty) <= 0) {
              this.items[idx].qty = 1;
              if (qtyInp) qtyInp.value = "1";
            }

            const qtyVal = toAmountFloat(this.items[idx].qty) || 1;
            const rateVal = toAmountFloat(this.items[idx].rate) || item.sell_price || 0;
            const amtInp = tr.querySelector('input[data-f="amount"]');
            if (qtyVal > 0 && rateVal > 0) {
              const calcAmt = String(Math.round(qtyVal * rateVal * 100) / 100);
              this.items[idx].amount = calcAmt;
              amtInp.value = calcAmt;
            }

            this.items[idx].stockInfo = 'Available in stock: ' + item.stock_qty + ' ' + item.unit + (item.stock_qty <= 0 ? ' (Out of stock)' : '');
            sugPop.classList.add("hidden");
            this.paintTotal(main);

            if (qtyInp) {
              qtyInp.focus();
              qtyInp.select();
            }
          };
        });
      } catch (err) {
        /* silent */
      }
    }, 120);

    /* number conversion + live total on any input in the table.
       No re-render here: the tbody stays, focus survives, cells update in place. */
    const tbody = el.querySelector("#bm-rows");
    tbody.addEventListener("input", (e) => {
      const inp = e.target;
      if (!inp.matches("input")) return;
      const tr = inp.closest("tr");
      const i = parseInt(tr.getAttribute("data-i"), 10);
      const f = inp.getAttribute("data-f");

      if (f === "particulars") {
        this.items[i].particulars = inp.value;
        showSuggestions(inp);
        return;
      }

      let v = devToAscii(inp.value);
      v = v.replace(/रू|rs\.?|npr/gi, "").replace(/[^\d.]/g, "");
      const first = v.indexOf(".");
      if (first !== -1) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, "");
      if (v !== inp.value) inp.value = v;
      this.items[i][f] = inp.value;

      if (f === "qty" || f === "rate") {
        const q = toAmountFloat(this.items[i].qty) || 0;
        const r = toAmountFloat(this.items[i].rate) || 0;
        const amtCell = tr.querySelector('input[data-f="amount"]');
        if (q > 0 && r > 0) {
          this.items[i].amount = String(Math.round(q * r * 100) / 100);
          amtCell.value = this.items[i].amount;
        } else {
          this.items[i].amount = "";
          amtCell.value = "";
        }
      }
      this.paintTotal(main);
    });

    tbody.addEventListener("focusin", (e) => {
      if (e.target.matches('input[data-f="particulars"]')) {
        showSuggestions(e.target);
      }
    });

    tbody.addEventListener("focusout", (e) => {
      if (e.target.matches('input[data-f="particulars"]')) {
        const td = e.target.closest("td");
        const pop = td.querySelector(".inv-sug-pop");
        if (pop) setTimeout(() => pop.classList.add("hidden"), 200);
      }
    });

    this.paintTotal(main);
  },

  rowHtml(it, i) {
    const num = (v) => (v === "" || v == null ? "" : String(v));
    return '<tr data-i="' + i + '">' +
      '<td class="bm-sn">' + (i + 1) + "</td>" +
      '<td style="position:relative">' +
      '<input class="input bm-in" data-f="particulars" placeholder="e.g. sunflower oil 1L" value="' + escapeHtml(it.particulars) + '" autocomplete="off">' +
      '<div class="inv-sug-pop hidden"></div>' +
      (it.stockInfo ? '<div class="bm-stock-info">' + escapeHtml(it.stockInfo) + '</div>' : '') +
      '</td>' +
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

  /* ---------- side: summary + AI card + save ---------- */
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
    box.innerHTML =
      '<div class="ai-scanner-card">' +
      '<div class="ai-scanner-head">' +
      '<div class="ai-ico-wrap">' + ico("sparkles") + '</div>' +
      '<div style="flex:1">' +
      '<div class="ai-scanner-title">AI Bill Scanner <span class="badge badge-pro">' + ico("lock") + ' v2.0 Locked</span></div>' +
      '<div class="ai-scanner-sub">Instantly scan receipts & handwritten bills into itemized rows with Deep AI Vision.</div>' +
      '</div></div>' +
      '<div class="ai-scanner-badge">' + ico("clock") + ' Unlocks in Khata Sathi v2.0</div>' +
      '</div>';
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

    const finish = () => {
      API.post("/api/bills/itemized/add", payload).then((res) => {
        this.stockCache = null;
        this.searchCache = {};
        let msg = "Bill " + res.bill_no + " saved — " + fmtMoney(res.amount);
        if ((alreadyPaid || paidNow > 0) && res.galla_in) msg += " · cash added to today's galla";
        if (paidNow > 0) msg += " · " + fmtMoney(paidNow) + " paid, " + fmtMoney(res.remaining) + " left";
        toast(msg, "ok", 4200);
        this.shareDialog(res, name);
      }).catch((e) => {
        if (e.message && e.message.includes("Open today's galla")) {
          promptOpenGalla(() => finish());
        } else {
          toast(e.message, "err");
        }
      });
    };

    finish();
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

  /* ---------- Pick from Stock Modal ---------- */
  async openStockPickerModal(main) {
    try {
      let items = [];
      const cacheFresh = this.stockCache && Date.now() - this.stockCacheAt < 30000;
      const body = document.createElement("div");
      body.innerHTML =
        '<div class="field" style="margin-bottom:12px">' +
        '<div class="input-with-ico">' + ico("search") +
        '<input class="input" id="sp-search" placeholder="Search product name, category, or SKU…" autocomplete="off"></div></div>' +
        '<div id="sp-list" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:2px"></div>';

      const renderList = (filterText = "") => {
        const listEl = body.querySelector("#sp-list");
        const filtered = items.filter((it) =>
          !filterText ||
          it.name.toLowerCase().includes(filterText.toLowerCase()) ||
          (it.category && it.category.toLowerCase().includes(filterText.toLowerCase())) ||
          (it.sku && it.sku.toLowerCase().includes(filterText.toLowerCase()))
        );

        if (!filtered.length) {
          listEl.innerHTML = '<div style="padding:28px;text-align:center;color:var(--ink-2);font-size:13.5px">No matching stock items</div>';
          return;
        }

        listEl.innerHTML = filtered.map((it) => {
          const catLower = (it.category || "").toLowerCase();
          let avatarClass = "groceries";
          if (catLower.includes("grain") || catLower.includes("rice")) avatarClass = "grains";
          else if (catLower.includes("bev") || catLower.includes("tea")) avatarClass = "beverages";
          else if (catLower.includes("snack") || catLower.includes("noodle")) avatarClass = "snacks";

          return '<div class="sp-item panel" data-id="' + it.id + '" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;border:1.5px solid var(--line-2);border-radius:10px;transition:all 0.15s ease">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
            '<div class="prod-avatar ' + avatarClass + '" style="width:34px;height:34px;font-size:13px">' + escapeHtml(it.name.charAt(0).toUpperCase()) + '</div>' +
            '<div><div style="font-weight:700;font-size:14.5px;color:var(--ink)">' + escapeHtml(it.name) + '</div>' +
            '<div style="font-size:12px;color:var(--ink-2);margin-top:2px">Stock: <b style="color:' + (it.stock_qty <= 0 ? 'var(--red)' : 'var(--green-ink)') + '">' + it.stock_qty + ' ' + escapeHtml(it.unit) + '</b> · ' + escapeHtml(it.category || "General") + '</div>' +
            '</div></div>' +
            '<div style="display:flex;align-items:center;gap:12px">' +
            '<div class="money" style="font-weight:750;font-size:15px">' + fmtMoney(it.sell_price) + '</div>' +
            '<button class="btn sm primary" data-act="pick-add" style="padding:5px 12px;font-size:12.5px">' + ico("plus") + ' Add</button>' +
            '</div></div>';
        }).join("");

        listEl.querySelectorAll(".sp-item").forEach((el) => {
          el.onmouseenter = () => { el.style.borderColor = "var(--accent)"; el.style.background = "var(--bg-inset)"; };
          el.onmouseleave = () => { el.style.borderColor = "var(--line-2)"; el.style.background = ""; };
          el.onclick = () => {
            const id = el.getAttribute("data-id");
            const it = items.find((x) => x.id === id);
            if (!it) return;
            this.addStockItemToBill(it, main);
            toast("Added " + it.name + " to bill", "ok", 1200);
          };
        });
      };

      const searchInp = body.querySelector("#sp-search");
      searchInp.addEventListener("input", debounce(() => renderList(searchInp.value.trim()), 100));

      modal({
        title: "Pick Products from Stock",
        body,
        buttons: [{ label: "Done", cls: "primary" }]
      });

      if (cacheFresh) {
        items = this.stockCache;
        renderList();
      } else {
        body.querySelector("#sp-list").innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-2)">Loading stock...</div>';
        const res = await API.get("/api/inventory");
        items = res.items || [];
        this.stockCache = items;
        this.stockCacheAt = Date.now();
        renderList(searchInp.value.trim());
      }

      setTimeout(() => searchInp.focus(), 60);
    } catch (e) {
      toast("Could not load stock: " + e.message, "err");
    }
  },

  addStockItemToBill(it, main) {
    let targetIdx = this.items.length - 1;
    if (targetIdx < 0 || this.items[targetIdx].particulars || this.items[targetIdx].amount) {
      this.items.push({ particulars: "", qty: 1, rate: "", amount: "", stockInfo: "" });
      targetIdx = this.items.length - 1;
    }

    const row = this.items[targetIdx];
    row.particulars = it.name;
    row.rate = it.sell_price > 0 ? String(it.sell_price) : "";
    row.qty = row.qty || 1;
    if (row.rate) {
      row.amount = String(Math.round((toAmountFloat(row.qty) || 1) * (toAmountFloat(row.rate) || 0) * 100) / 100);
    }
    row.stockInfo = 'Available in stock: ' + it.stock_qty + ' ' + it.unit + (it.stock_qty <= 0 ? ' (Out of stock)' : '');

    this.paintRows(main);
  },
};
