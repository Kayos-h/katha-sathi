/* Khata Sathi - settings: store info, PIN, theme, backup/restore, export, demo, audit, AI (future) */
"use strict";

/* global API, ico, fmtDateTime, escapeHtml, modal, confirmModal, toast */

const Settings = {
  id: "settings",
  title: "Settings",
  icon: "gear",

  async render(main) {
    main.innerHTML =
      '<div class="view-head"><div><div class="view-title">Settings</div>' +
      '<div class="view-sub">The shop\'s control room</div></div></div>' +
      '<div class="dash-grid">' +
      '<div class="panel panel-pad w-span-7" id="set-main"></div>' +
      '<div class="panel panel-pad w-span-5" id="set-side"></div>' +
      "</div>";
    await Promise.all([this.renderMain(main), this.renderSide(main)]);
  },

  async renderMain(main) {
    let stats;
    try { stats = await API.get("/api/stats"); } catch (e) { stats = null; }
    const store = App.state.store_name || "";
    const seller = App.state.seller_name || "";

    main.querySelector("#set-main").innerHTML =
      /* store */
      '<div class="set-section">' +
      '<div class="panel-title">' + ico("gear") + "Shop</div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Store name</div>' +
      '<div class="sr-sub">Shown on statements and the phone</div></div>' +
      '<input class="input" id="set-store" style="width:220px" value="' + escapeHtml(store) + '"></div>' +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Signed in as</div>' +
      '<div class="sr-sub">' + escapeHtml(seller) + "</div></div><div></div></div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Change PIN</div>' +
      '<div class="sr-sub">4-8 digits · needed to sign in</div></div>' +
      '<button class="btn" id="set-pin">' + ico("edit") + "Change</button></div>" +
      "</div>" +

      /* data safety */
      '<div class="set-section">' +
      '<div class="panel-title">' + ico("dl") + "Data safety</div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Download backup</div>' +
      '<div class="sr-sub">One file with everything — people, bills, payments, photos list. Keep it somewhere safe.</div></div>' +
      '<button class="btn" id="set-backup">' + ico("dl") + "Backup</button></div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Restore from backup</div>' +
      '<div class="sr-sub">Replaces everything with the backup file. Double-check before restoring.</div></div>' +
      '<button class="btn" id="set-restore">' + ico("up") + "Restore</button></div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Export to Excel (CSV)</div>' +
      '<div class="sr-sub">Every ledger line, one row each — opens in Excel</div></div>' +
      '<button class="btn" id="set-csv">' + ico("doc") + "Export</button></div>" +
      "</div>" +

      /* demo */
      '<div class="set-section">' +
      '<div class="panel-title">' + ico("eye") + "Demo data</div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Load demo shop</div>' +
      '<div class="sr-sub">8 fake people and ~40 bills so you can explore. <b>Replaces all current data.</b></div></div>' +
      '<button class="btn" id="set-demo">Load demo</button></div>' +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Remove demo data & start for real</div>' +
      '<div class="sr-sub">Deletes every person, bill, payment and galla day (demo or real — all of it) and leaves the shop empty. Your account, PIN and store name stay.</div></div>' +
      '<button class="btn danger" id="set-demo-clear">Remove all data</button></div>' +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Fresh backup first?</div>' +
      '<div class="sr-sub">If the shop has anything real in it, download a backup before removing anything. One file, everything in it.</div></div>' +
      '<button class="btn" id="set-backup-2">' + ico("dl") + "Backup</button></div>" +
      "</div>" +

      /* AI future */
      '<div class="set-section">' +
      '<div class="panel-title">' + ico("cam") + "Bill reading</div>" +
      '<div class="set-row"><div class="sr-main"><div class="sr-title">Mode: <span id="ai-mode" style="color:var(--accent)">Manual</span></div>' +
      '<div class="sr-sub">You type the name and amount — the photo is stored beside them. AI reading (Manual / AI · Local / API) arrives as an update; the confirm screen stays the same.</div></div>' +
      '<button class="btn" disabled>Coming in v1.5</button></div>' +
      "</div>" +

      /* stats */
      (stats
        ? '<div class="set-section"><div class="panel-title">' + ico("info") + "This shop\'s data</div>" +
          '<div class="set-row"><div class="sr-main"><div class="sr-title">People: ' + stats.people + " · Bills: " + stats.bills + " · Payments: " + stats.payments + " · Photos: " + stats.photos + "</div>" +
          '<div class="sr-sub">Database ' + stats.db_mb + " MB · every change is in the audit trail</div></div><div></div></div></div>"
        : "");

    main.querySelector("#set-store").addEventListener("change", async (e) => {
      try {
        await API.post("/api/settings", { store_name: e.target.value.trim() });
        App.state.store_name = e.target.value.trim();
        App.paintChrome();
        toast("Store name saved");
      } catch (err) { toast(err.message, "err"); }
    });

    main.querySelector("#set-pin").onclick = () => {
      const body = document.createElement("div");
      body.innerHTML =
        '<div class="field"><label>Current PIN</label><input class="input" id="cp-old" type="password" inputmode="numeric"></div>' +
        '<div class="field" style="margin-top:10px"><label>New PIN (4-8 digits)</label><input class="input" id="cp-new" type="password" inputmode="numeric"></div>';
      modal({
        title: "Change PIN",
        body,
        buttons: [
          { label: "Cancel", cls: "ghost" },
          {
            label: "Save PIN",
            cls: "primary",
            onClick: async () => {
              try {
                await API.post("/api/settings", { current_pin: body.querySelector("#cp-old").value, new_pin: body.querySelector("#cp-new").value });
                toast("PIN changed");
              } catch (e) { toast(e.message, "err"); }
            },
          },
        ],
      });
    };

    main.querySelector("#set-backup").onclick = () => {
      const a = document.createElement("a");
      a.href = "/api/backup.json";
      a.setAttribute("download", "khatasathi-backup.json");
      document.body.appendChild(a); a.click(); a.remove();
      toast("Backup downloading…");
    };

    main.querySelector("#set-csv").onclick = () => {
      const a = document.createElement("a");
      a.href = "/api/export.csv";
      a.setAttribute("download", "khatasathi-export.csv");
      document.body.appendChild(a); a.click(); a.remove();
      toast("CSV downloading…");
    };

    main.querySelector("#set-restore").onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const snap = JSON.parse(await f.text());
          confirmModal("Restore this backup?",
            "Everything currently in Khata Sathi will be <b>replaced</b> by the backup file (" +
            escapeHtml((snap.__meta__ && snap.__meta__.exported_at) || "unknown date") +
            "). This cannot be undone.",
            "Yes, restore", async () => {
              try {
                await API.post("/api/backup/restore", { snapshot: snap });
                toast("Backup restored");
                App.refresh();
              } catch (e) { toast(e.message, "err"); }
            }, true);
        } catch (e) { toast("That file isn't a Khata Sathi backup", "err"); }
      };
      input.click();
    };

    main.querySelector("#set-demo").onclick = () => {
      confirmModal("Load the demo shop?",
        "All current people, bills and payments will be <b>deleted</b> and replaced with demo data (8 people, ~40 entries).",
        "Load demo", async () => {
          try {
            await API.post("/api/demo", {});
            toast("Demo shop loaded — explore!");
            App.refresh();
          } catch (e) { toast(e.message, "err"); }
        }, true);
    };

    const backupNow = () => {
      const a = document.createElement("a");
      a.href = "/api/backup.json";
      a.setAttribute("download", "khatasathi-backup.json");
      document.body.appendChild(a); a.click(); a.remove();
      toast("Backup downloading…");
    };
    main.querySelector("#set-backup-2").onclick = backupNow;

    main.querySelector("#set-demo-clear").onclick = () => {
      confirmModal("Remove all shop data?",
        "Every person, bill, payment and galla day will be <b>deleted</b> — demo or real, all of it. " +
        "The account (PIN, your name, store name) stays, and the shop starts empty. " +
        "Download a backup first if there is anything real in here.",
        "Delete everything", async () => {
          try {
            await API.post("/api/demo/clear", {});
            toast("All data removed — the shop is empty and ready for real use", "ok", 4200);
            App.state.store_name = "";
            App.paintChrome();
            App.go("dash");
          } catch (e) { toast(e.message, "err"); }
        }, true);
    };
  },

  async renderSide(main) {
    let audit = { items: [] };
    try { audit = await API.get("/api/audit"); } catch (e) { /* empty */ }
    const side = main.querySelector("#set-side");
    side.innerHTML =
      '<div class="panel-title">' + ico("doc") + "Change trail — nothing vanishes silently</div>" +
      '<div id="audit-list" style="max-height:520px;overflow-y:auto">' +
      (audit.items.length
        ? audit.items.map((a) => '<div class="audit-row">' +
            '<span class="at-time">' + fmtDateTime(a.at) + "</span>" +
            '<span class="at-action">' + auditLabel(a.action) + "</span>" +
            '<span class="at-detail">' + escapeHtml(auditSummary(a)) + "</span></div>").join("")
        : '<div class="hint" style="padding:14px 0">Changes will be listed here.</div>') +
      "</div>";
  },
};

function auditLabel(action) {
  const map = {
    person_create: "person +", person_update: "person ✎", person_merge: "merge",
    bill_create: "bill +", bill_update: "bill ✎", bill_void: "bill ✕", bill_unvoid: "bill ↺",
    payment_create: "payment +", payment_undo: "payment ↺",
  };
  return map[action] || action;
}

function auditSummary(a) {
  try {
    const d = JSON.parse(a.detail);
    if (d.name) return d.name;
    if (d.amount !== undefined) return "रू " + d.amount + (d.note ? " · " + d.note : "");
    if (d.kept) return d.kept + " ← " + d.merged_in;
    if (d.before && d.after) return JSON.stringify(d.after);
    return "";
  } catch (e) { return ""; }
}
