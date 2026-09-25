/* Khata Sathi - inventory view: product catalog, stock tracking,
   auto-deductions from bills, low stock alerts, restock logs. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, fmtDateTime, devToAscii, toAmountFloat, escapeHtml, modal, toast, debounce, App */

const Inventory = {
  id: "inventory",
  title: "Inventory",
  icon: "box",
  items: [],
  summary: null,
  activeFilter: "all", // all, low, out, in_stock
  activeCategory: "all",
  searchQuery: "",
  _loadSeq: 0,

  async render(main, params) {
    if (params && params.filter) this.activeFilter = params.filter;

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Inventory & Stock Management</div>' +
      '<div class="view-sub">Track real-time stock levels, valuations, reorder alerts, and automated bill deductions.</div></div>' +
      '<div class="view-actions">' +
      '<button class="btn" id="inv-btn-adjust">' + ico("edit") + "<span>Adjust Stock</span></button>" +
      '<button class="btn primary" id="inv-btn-add">' + ico("plus") + "<span>Add Product</span></button>" +
      "</div></div>" +
      '<div class="dash-grid" id="inv-kpi"></div>' +
      '<div class="panel panel-pad" style="margin-top:18px">' +
      '<div class="inv-toolbar">' +
      '<div class="field" style="flex:1;min-width:240px;position:relative">' +
      '<div class="input-with-ico">' + ico("search") +
      '<input class="input" id="inv-search" placeholder="Search product name, category or SKU…" value="' + escapeHtml(this.searchQuery) + '"></div></div>' +
      '<div class="field" style="width:170px"><select class="input" id="inv-cat-filter"><option value="all">All Categories</option></select></div>' +
      '<div class="pill-group" id="inv-status-pills">' +
      '<button class="pill ' + (this.activeFilter === "all" ? "active" : "") + '" data-st="all">All Items</button>' +
      '<button class="pill ' + (this.activeFilter === "in_stock" ? "active" : "") + '" data-st="in_stock">In Stock</button>' +
      '<button class="pill ' + (this.activeFilter === "low" ? "active" : "") + '" data-st="low">Low Stock</button>' +
      '<button class="pill ' + (this.activeFilter === "out" ? "active" : "") + '" data-st="out">Out of Stock</button>' +
      '</div></div>' +
      '<div id="inv-table-wrap" style="margin-top:16px;overflow-x:auto"></div>' +
      "</div>";

    this.bindEvents(main);
    await this.loadData(main);
  },

  bindEvents(main) {
    main.querySelector("#inv-btn-add").onclick = () => this.openAddEditModal(null, main);
    main.querySelector("#inv-btn-adjust").onclick = () => this.openAdjustModal(null, main);

    const searchInput = main.querySelector("#inv-search");
    searchInput.addEventListener("input", debounce(async () => {
      this.searchQuery = searchInput.value.trim();
      await this.loadItems(main, false);
    }, 180));

    const catSelect = main.querySelector("#inv-cat-filter");
    catSelect.addEventListener("change", async () => {
      this.activeCategory = catSelect.value;
      await this.loadItems(main, false);
    });

    const pills = main.querySelector("#inv-status-pills");
    pills.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-st]");
      if (!btn) return;
      pills.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      this.activeFilter = btn.getAttribute("data-st");
      await this.loadItems(main, false);
    });
  },

  async loadData(main) {
    const seq = ++this._loadSeq;
    try {
      const q = encodeURIComponent(this.searchQuery);
      const cat = encodeURIComponent(this.activeCategory);
      const st = encodeURIComponent(this.activeFilter);
      const [summary, itemsRes] = await Promise.all([
        API.get("/api/inventory/summary"),
        API.get("/api/inventory?q=" + q + "&category=" + cat + "&status=" + st),
      ]);
      if (seq !== this._loadSeq) return;
      this.summary = summary;
      this.items = itemsRes.items || [];
      this.renderKPI(main);
      this.populateCategories(main);
      this.renderTable(main);
    } catch (e) {
      toast("Failed to load inventory: " + e.message, "err");
    }
  },

  renderKPI(main) {
    const kpiEl = main.querySelector("#inv-kpi");
    if (!kpiEl || !this.summary) return;
    const s = this.summary;
    kpiEl.innerHTML =
      '<div class="panel kpi-card">' +
      '<div class="k-label">Stock Valuation</div>' +
      '<div class="k-value money">' + fmtMoney(s.total_value) + '</div>' +
      '<div class="k-foot">Retail: ' + fmtMoney(s.total_sell_value) + '</div>' +
      '<div class="k-ico indigo">' + ico("box") + '</div>' +
      '</div>' +
      '<div class="panel kpi-card">' +
      '<div class="k-label">Total Products</div>' +
      '<div class="k-value">' + s.total_items + ' <span style="font-size:14px;font-weight:600;color:var(--ink-2)">items</span></div>' +
      '<div class="k-foot">' + Math.round(s.total_units) + ' total units in store</div>' +
      '<div class="k-ico green">' + ico("tag") + '</div>' +
      '</div>' +
      '<div class="panel kpi-card ' + (s.low_stock_count > 0 ? "kpi-warn" : "") + '" style="cursor:pointer" id="kpi-low-btn">' +
      '<div class="k-label">Low Stock Alerts</div>' +
      '<div class="k-value ' + (s.low_stock_count > 0 ? "neg" : "") + '">' + s.low_stock_count + '</div>' +
      '<div class="k-foot">' + (s.low_stock_count > 0 ? "⚠️ Reorder items" : "All items well stocked") + '</div>' +
      '<div class="k-ico amber">' + ico("warn") + '</div>' +
      '</div>' +
      '<div class="panel kpi-card ' + (s.out_of_stock_count > 0 ? "kpi-danger" : "") + '" style="cursor:pointer" id="kpi-out-btn">' +
      '<div class="k-label">Out of Stock</div>' +
      '<div class="k-value ' + (s.out_of_stock_count > 0 ? "neg" : "") + '">' + s.out_of_stock_count + '</div>' +
      '<div class="k-foot">' + (s.out_of_stock_count > 0 ? "🚨 Restock needed" : "Zero empty items") + '</div>' +
      '<div class="k-ico red">' + ico("out") + '</div>' +
      '</div>';

    const lowBtn = kpiEl.querySelector("#kpi-low-btn");
    if (lowBtn) {
      lowBtn.onclick = () => {
        this.activeFilter = "low";
        const pills = main.querySelector("#inv-status-pills");
        pills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p.getAttribute("data-st") === "low"));
        this.loadItems(main, false);
      };
    }
    const outBtn = kpiEl.querySelector("#kpi-out-btn");
    if (outBtn) {
      outBtn.onclick = () => {
        this.activeFilter = "out";
        const pills = main.querySelector("#inv-status-pills");
        pills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p.getAttribute("data-st") === "out"));
        this.loadItems(main, false);
      };
    }
  },

  populateCategories(main) {
    const sel = main.querySelector("#inv-cat-filter");
    if (!sel || !this.summary || !this.summary.categories) return;
    const current = this.activeCategory || "all";
    sel.innerHTML = '<option value="all">All Categories</option>' +
      this.summary.categories.map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join("");
    sel.value = current;
  },

  async loadItems(main, showLoading = true) {
    const wrap = main.querySelector("#inv-table-wrap");
    if (!wrap) return;
    const seq = ++this._loadSeq;
    if (showLoading || !this.items.length) {
      wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-2)">Loading stock...</div>';
    }

    try {
      const q = encodeURIComponent(this.searchQuery);
      const cat = encodeURIComponent(this.activeCategory);
      const st = encodeURIComponent(this.activeFilter);
      const res = await API.get("/api/inventory?q=" + q + "&category=" + cat + "&status=" + st);
      if (seq !== this._loadSeq) return;
      this.items = res.items || [];
      this.renderTable(main);
    } catch (e) {
      wrap.innerHTML = '<div class="alert alert-err">Failed to load items: ' + escapeHtml(e.message) + '</div>';
    }
  },

  renderTable(main) {
    const wrap = main.querySelector("#inv-table-wrap");
    if (!wrap) return;

    if (!this.items.length) {
      wrap.innerHTML =
        '<div class="empty-box" style="padding:48px 16px;text-align:center">' +
        '<div class="ico-bubble" style="margin:0 auto 14px;width:52px;height:52px;border-radius:14px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">' + ico("box") + "</div>" +
        '<div style="font-weight:800;font-size:17px;color:var(--ink)">No products found</div>' +
        '<div style="color:var(--ink-2);font-size:13.5px;margin-top:6px;max-width:380px;margin-left:auto;margin-right:auto">' +
        (this.searchQuery || this.activeFilter !== "all" || this.activeCategory !== "all"
          ? "Try adjusting your search query or status filter."
          : "Add your store items to track stock and automate inventory deductions when making bills.") +
        "</div>" +
        '<button class="btn primary" style="margin-top:18px" id="inv-empty-add">' + ico("plus") + "<span>Add First Product</span></button>" +
        "</div>";
      const addBtn = wrap.querySelector("#inv-empty-add");
      if (addBtn) addBtn.onclick = () => this.openAddEditModal(null, main);
      return;
    }

    let rowsHtml = "";
    this.items.forEach((it) => {
      let statusBadge = '<span class="badge-ok">' + ico("check") + ' In Stock</span>';
      if (it.is_out_of_stock) {
        statusBadge = '<span class="badge-danger">' + ico("out") + ' Out of Stock</span>';
      } else if (it.is_low_stock) {
        statusBadge = '<span class="badge-warn">' + ico("warn") + ' Low (' + it.stock_qty + ' ' + escapeHtml(it.unit) + ')</span>';
      }

      const catLower = (it.category || "").toLowerCase();
      let avatarClass = "groceries";
      if (catLower.includes("grain") || catLower.includes("rice") || catLower.includes("flour")) avatarClass = "grains";
      else if (catLower.includes("bev") || catLower.includes("tea") || catLower.includes("coffee") || catLower.includes("drink")) avatarClass = "beverages";
      else if (catLower.includes("snack") || catLower.includes("noodle") || catLower.includes("biscuit")) avatarClass = "snacks";

      const margin = (it.buy_price > 0 && it.sell_price > it.buy_price)
        ? Math.round(((it.sell_price - it.buy_price) / it.buy_price) * 100)
        : null;

      rowsHtml +=
        '<tr data-id="' + it.id + '">' +
        '<td>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
        '<div class="prod-avatar ' + avatarClass + '">' + escapeHtml(it.name.charAt(0).toUpperCase()) + '</div>' +
        '<div>' +
        '<div style="font-weight:700;color:var(--ink);font-size:14.5px">' + escapeHtml(it.name) + '</div>' +
        (it.sku ? '<div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;font-family:monospace">SKU: ' + escapeHtml(it.sku) + '</div>' : '') +
        '</div></div>' +
        '</td>' +
        '<td><span class="tag-chip">' + escapeHtml(it.category || "General") + '</span></td>' +
        '<td>' +
        '<div style="font-weight:800;font-size:15px;margin-bottom:3px">' + it.stock_qty + ' <span style="font-size:12px;font-weight:normal;color:var(--ink-2)">' + escapeHtml(it.unit) + '</span></div>' +
        statusBadge +
        '</td>' +
        '<td class="money" style="color:var(--ink-2)">' + (it.buy_price > 0 ? fmtMoney(it.buy_price) : "-") + '</td>' +
        '<td>' +
        '<div class="money" style="font-weight:700;font-size:15px">' + (it.sell_price > 0 ? fmtMoney(it.sell_price) : "-") + '</div>' +
        (margin !== null ? '<div class="profit-pill">+' + margin + '% profit</div>' : '') +
        '</td>' +
        '<td class="money" style="font-weight:800;font-size:15px;color:var(--accent)">' + fmtMoney(it.stock_value) + '</td>' +
        '<td>' +
        '<div class="btn-row" style="justify-content:flex-end;gap:6px">' +
        '<button class="btn sm" data-act="restock" title="Quick Restock" style="padding:4px 8px;font-size:12px">' + ico("plus") + '<span>Restock</span></button>' +
        '<button class="icon-btn" data-act="history" title="Movement History">' + ico("clock") + '</button>' +
        '<button class="icon-btn" data-act="edit" title="Edit Product">' + ico("edit") + '</button>' +
        '<button class="icon-btn danger" data-act="del" title="Delete Product">' + ico("trash") + '</button>' +
        '</div>' +
        '</td>' +
        '</tr>';
    });

    wrap.innerHTML =
      '<table class="data-table"><thead><tr>' +
      "<th>Product</th><th>Category</th><th>Available Stock</th>" +
      "<th>Cost Price</th><th>Selling Price</th><th>Total Value</th><th style='text-align:right'>Actions</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody></table>";

    wrap.onclick = (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const tr = btn.closest("tr");
      const id = tr.getAttribute("data-id");
      const item = this.items.find((x) => x.id === id);
      if (!item) return;

      const act = btn.getAttribute("data-act");
      if (act === "restock") this.openAdjustModal(item, main);
      else if (act === "edit") this.openAddEditModal(item, main);
      else if (act === "history") this.openHistoryModal(item);
      else if (act === "del") this.confirmDelete(item, main);
    };
  },

  /* ---------- Add / Edit Product Modal ---------- */
  openAddEditModal(item, main) {
    const isEdit = !!item;
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="field"><label>Product Name *</label>' +
      '<input class="input" id="im-name" placeholder="e.g. Basmati Rice 25kg" value="' + (item ? escapeHtml(item.name) : "") + '" autocomplete="off"></div>' +
      '<div class="two-col" style="margin-top:12px">' +
      '<div class="field"><label>Category</label>' +
      '<input class="input" id="im-category" placeholder="e.g. Grocery" value="' + (item ? escapeHtml(item.category || "") : "General") + '"></div>' +
      '<div class="field"><label>SKU / Barcode</label>' +
      '<input class="input" id="im-sku" placeholder="e.g. RICE-25" value="' + (item ? escapeHtml(item.sku || "") : "") + '"></div>' +
      "</div>" +
      '<div class="two-col" style="margin-top:12px">' +
      '<div class="field"><label>Selling Price (Rs.)</label>' +
      '<input class="input money" id="im-sell" placeholder="Rs. 0" value="' + (item && item.sell_price ? item.sell_price : "") + '" inputmode="decimal"></div>' +
      '<div class="field"><label>Cost / Buy Price (Rs.)</label>' +
      '<input class="input money" id="im-buy" placeholder="Rs. 0" value="' + (item && item.buy_price ? item.buy_price : "") + '" inputmode="decimal"></div>' +
      "</div>" +
      '<div class="two-col" style="margin-top:12px">' +
      '<div class="field"><label>Unit of Measure</label>' +
      '<select class="input" id="im-unit">' +
      ['pcs', 'kg', 'ltr', 'packet', 'box', 'bag', 'meter', 'dozen'].map((u) =>
        '<option value="' + u + '" ' + (item && item.unit === u ? "selected" : "") + '>' + u + '</option>'
      ).join("") +
      '</select></div>' +
      '<div class="field"><label>Low Stock Alert Threshold</label>' +
      '<input class="input" id="im-alert" type="number" placeholder="5" value="' + (item ? item.min_stock_alert : 5) + '"></div>' +
      "</div>" +
      (!isEdit ?
        '<div class="field" style="margin-top:12px"><label>Opening Stock Quantity</label>' +
        '<input class="input" id="im-qty" type="number" placeholder="0" value="0" step="any">' +
        '<div class="hint">Initial quantity in store right now.</div></div>' : "") +
      '<div class="btn-row" style="margin-top:20px;justify-content:flex-end">' +
      '<button class="btn ghost" id="im-cancel">Cancel</button>' +
      '<button class="btn primary" id="im-save">' + ico("check") + (isEdit ? "Update Product" : "Create Product") + '</button>' +
      "</div>";

    const m = modal({ title: isEdit ? "Edit Product" : "Add New Product", body, dismissable: true });

    body.querySelector("#im-cancel").onclick = () => m.close();
    body.querySelector("#im-save").onclick = async () => {
      const name = body.querySelector("#im-name").value.trim();
      if (!name) { toast("Product name is required", "err"); body.querySelector("#im-name").focus(); return; }

      const payload = {
        name,
        category: body.querySelector("#im-category").value.trim() || "General",
        sku: body.querySelector("#im-sku").value.trim(),
        sell_price: toAmountFloat(body.querySelector("#im-sell").value) || 0,
        buy_price: toAmountFloat(body.querySelector("#im-buy").value) || 0,
        unit: body.querySelector("#im-unit").value.trim() || "pcs",
        min_stock_alert: toAmountFloat(body.querySelector("#im-alert").value) || 5,
      };

      if (!isEdit) {
        payload.stock_qty = toAmountFloat(body.querySelector("#im-qty").value) || 0;
      }

      try {
        if (isEdit) {
          payload.id = item.id;
          await API.post("/api/inventory/update", payload);
          toast("Product updated successfully", "ok");
        } else {
          await API.post("/api/inventory/add", payload);
          toast("Product added to inventory", "ok");
        }
        m.close();
        await this.loadData(main);
      } catch (e) {
        toast(e.message, "err");
      }
    };
  },

  /* ---------- Stock Adjust / Restock Modal ---------- */
  openAdjustModal(item, main) {
    const body = document.createElement("div");
    let itemSelectHtml = "";
    if (item) {
      itemSelectHtml = '<input class="input" value="' + escapeHtml(item.name) + ' (Current: ' + item.stock_qty + ' ' + escapeHtml(item.unit) + ')" disabled>';
    } else {
      itemSelectHtml = '<select class="input" id="adj-item-select">' +
        '<option value="">-- Choose a Product --</option>' +
        this.items.map((it) => '<option value="' + it.id + '">' + escapeHtml(it.name) + ' (' + it.stock_qty + ' ' + escapeHtml(it.unit) + ')</option>').join("") +
        '</select>';
    }

    body.innerHTML =
      '<div class="field"><label>Select Product *</label>' + itemSelectHtml + "</div>" +
      '<div class="two-col" style="margin-top:12px">' +
      '<div class="field"><label>Adjustment Type</label>' +
      '<select class="input" id="adj-reason">' +
      '<option value="restock">Restock (+ Add Stock)</option>' +
      '<option value="return">Customer Return (+ Add)</option>' +
      '<option value="adjustment">Manual Count Correction (±)</option>' +
      '<option value="damage">Damaged / Expired (- Deduct)</option>' +
      '<option value="shrinkage">Loss / Shrinkage (- Deduct)</option>' +
      '</select></div>' +
      '<div class="field"><label>Quantity</label>' +
      '<input class="input" id="adj-qty" type="number" step="any" placeholder="e.g. 10" autocomplete="off">' +
      '</div></div>' +
      '<div class="field" style="margin-top:12px"><label>Note / Reason (Optional)</label>' +
      '<input class="input" id="adj-note" placeholder="e.g. New shipment from wholesaler">' +
      '</div>' +
      '<div class="btn-row" style="margin-top:20px;justify-content:flex-end">' +
      '<button class="btn ghost" id="adj-cancel">Cancel</button>' +
      '<button class="btn primary" id="adj-submit">' + ico("check") + "Apply Adjustment</button>" +
      "</div>";

    const m = modal({ title: "Stock Adjustment / Restock", body, dismissable: true });

    body.querySelector("#adj-cancel").onclick = () => m.close();
    body.querySelector("#adj-submit").onclick = async () => {
      const selectedId = item ? item.id : body.querySelector("#adj-item-select").value;
      if (!selectedId) { toast("Please select a product", "err"); return; }

      const rawQty = toAmountFloat(body.querySelector("#adj-qty").value);
      if (rawQty === null || rawQty === 0) { toast("Please enter a valid non-zero quantity", "err"); return; }

      const reason = body.querySelector("#adj-reason").value;
      let changeQty = rawQty;
      if (reason === "damage" || reason === "shrinkage") {
        changeQty = -Math.abs(rawQty);
      } else if (reason === "restock" || reason === "return") {
        changeQty = Math.abs(rawQty);
      }

      const note = body.querySelector("#adj-note").value.trim();

      try {
        await API.post("/api/inventory/adjust", {
          id: selectedId,
          change_qty: changeQty,
          reason,
          note,
        });
        toast("Stock updated successfully", "ok");
        m.close();
        await this.loadData(main);
      } catch (e) {
        toast(e.message, "err");
      }
    };
  },

  /* ---------- Movement History Modal ---------- */
  async openHistoryModal(item) {
    const body = document.createElement("div");
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--ink-2)">Loading stock history…</div>';
    const m = modal({ title: "Stock History: " + item.name, body, dismissable: true });

    try {
      const full = await API.get("/api/inventory/item?id=" + encodeURIComponent(item.id));
      if (!full.logs || !full.logs.length) {
        body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-2)">No movement history recorded yet for this item.</div>';
        return;
      }

      let logHtml = '<div style="max-height:360px;overflow-y:auto"><table class="data-table"><thead><tr>' +
        '<th>Date</th><th>Reason</th><th>Change</th><th>Final Stock</th><th>Notes</th>' +
        '</tr></thead><tbody>';

      full.logs.forEach((l) => {
        const isPos = l.change_qty > 0;
        const changeTxt = (isPos ? "+" : "") + l.change_qty + " " + escapeHtml(item.unit);
        const changeClass = isPos ? "badge-ok" : "badge-danger";

        logHtml +=
          '<tr>' +
          '<td style="font-size:12.5px">' + fmtDateTime(l.created_at) + '</td>' +
          '<td><span class="tag-chip">' + escapeHtml(l.reason) + '</span></td>' +
          '<td><span class="badge ' + changeClass + '">' + changeTxt + '</span></td>' +
          '<td style="font-weight:600">' + l.final_qty + '</td>' +
          '<td style="font-size:13px;color:var(--ink-2)">' + escapeHtml(l.note || "-") + '</td>' +
          '</tr>';
      });
      logHtml += '</tbody></table></div>';
      body.innerHTML = logHtml;
    } catch (e) {
      body.innerHTML = '<div class="alert alert-err">' + escapeHtml(e.message) + '</div>';
    }
  },

  /* ---------- Delete Confirmation ---------- */
  confirmDelete(item, main) {
    const body = document.createElement("div");
    body.innerHTML =
      '<p>Are you sure you want to delete <b>' + escapeHtml(item.name) + '</b> from inventory?</p>' +
      '<p style="font-size:13px;color:var(--ink-2)">All movement logs for this item will be removed. Existing bills containing this item will remain untouched.</p>' +
      '<div class="btn-row" style="margin-top:20px;justify-content:flex-end">' +
      '<button class="btn ghost" id="del-cancel">Cancel</button>' +
      '<button class="btn danger" id="del-confirm">' + ico("trash") + "Delete Product</button>" +
      "</div>";

    const m = modal({ title: "Delete Product", body, dismissable: true });
    body.querySelector("#del-cancel").onclick = () => m.close();
    body.querySelector("#del-confirm").onclick = async () => {
      try {
        await API.post("/api/inventory/delete", { id: item.id });
        toast("Product deleted", "ok");
        m.close();
        await this.loadData(main);
      } catch (e) {
        toast(e.message, "err");
      }
    };
  },
};
