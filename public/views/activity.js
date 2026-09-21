/* Khata Sathi - activity view: every bill and payment, newest first */
"use strict";

/* global API, ico, fmtMoney, fmtDateTime, timeAgo, avatarEl, escapeHtml */

const Activity = {
  id: "activity",
  title: "Activity",
  icon: "clock",
  items: [],
  q: "",

  async render(main) {
    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Activity</div>' +
      '<div class="view-sub" id="act-sub">Every bill and payment</div></div>' +
      '<div class="view-actions"><input class="input" id="act-q" placeholder="Filter by name…" style="max-width:220px"></div></div>' +
      '<div class="panel"><div class="ledger-rows" id="act-list" style="min-height:200px"></div></div>';

    const qEl = main.querySelector("#act-q");
    qEl.value = this.q;
    qEl.oninput = debounce ? debounce(() => this.apply(main), 150) : () => this.apply(main);
    main.querySelector("#act-list").addEventListener("click", (e) => {
      const it = e.target.closest("[data-person]");
      if (it) App.go("ledger", { id: it.getAttribute("data-person") });
    });
    await this.load(main);
  },

  async load(main) {
    try {
      const d = await API.get("/api/activity?limit=120");
      this.items = d.items;
    } catch (e) {
      main.querySelector("#act-list").innerHTML =
        '<div class="empty"><div class="e-ico">' + ico("warn") + '</div><div class="e-t">' + escapeHtml(e.message) + "</div></div>";
      return;
    }
    this.apply(main);
  },

  apply(main) {
    this.q = main.querySelector("#act-q").value.trim().toLowerCase();
    let list = this.items;
    if (this.q) list = list.filter((a) => a.person_name.toLowerCase().includes(this.q));
    main.querySelector("#act-sub").textContent = list.length + " entries" + (this.q ? " matching \"" + this.q + "\"" : "");
    if (!list.length) {
      main.querySelector("#act-list").innerHTML =
        '<div class="empty"><div class="e-ico">' + ico("clock") + '</div><div class="e-t">Nothing yet</div><div class="e-s">Bills and payments will appear here.</div></div>';
      return;
    }
    main.querySelector("#act-list").innerHTML = list.map((a) => {
      const isPay = a.kind === "payment";
      const pill = a.already_paid ? ' <span class="pill counter">counter</span>' : "";
      return '<div class="lrow ' + (isPay ? "credit" : "debit") + '" data-person="' + a.person_id + '">' +
        '<div class="lr-kind">' + ico(isPay ? "money" : "bill") + "</div>" +
        '<div class="lr-mid"><div class="lr-title">' + escapeHtml(a.person_name) + pill + "</div>" +
        '<div class="lr-sub">' + (isPay ? "payment received" : "bill") + " · " + fmtDateTime(a.created_at) + (a.note ? " · " + escapeHtml(a.note) : "") + "</div></div>" +
        '<div class="lr-amt ' + (isPay ? "pos" : "") + '">' + (isPay ? "+" : "−") + fmtMoney(a.amount) + "</div>" +
        '<div class="lr-bal hint">' + timeAgo(a.created_at) + "</div>" +
        "</div>";
    }).join("");
  },
};
