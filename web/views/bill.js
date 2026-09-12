/* Khata Sathi - add bill: photo -> quality gate -> confirm screen -> saved
   The confirm screen is the law: autofill what we can, but a human taps Save. */
"use strict";

/* global API, ico, fmtMoney, fmtDate, devToAscii, toAmountFloat, escapeHtml, modal, toast, lightbox, debounce */

const AddBill = {
  id: "add",
  title: "Add bill",
  icon: "cam",
  photoFile: null,      // File object
  photoUrl: "",         // object URL for preview
  photoBytes: null,     // raw bytes for quality check + upload
  quality: null,       // {ok, problems, duplicate}
  personId: null,       // chosen person (null = new)
  suggestionSel: -1,

  async render(main, params) {
    this.personId = (params && params.person) || null;
    this.photoFile = null; this.photoUrl = ""; this.photoBytes = null; this.quality = null;

    main.innerHTML =
      '<div class="view-head">' +
      '<div><div class="view-title">Add a bill</div>' +
      '<div class="view-sub">Snap the bill, check the numbers, save.</div></div></div>' +
      '<div class="add-grid">' +
      '<div class="panel panel-pad" id="ab-left"></div>' +
      '<div class="panel panel-pad" id="ab-right"></div>' +
      "</div>";

    this.renderLeft(main);
    this.renderRight(main);
  },

  /* ---------- photo side ---------- */
  renderLeft(main) {
    const el = main.querySelector("#ab-left");
    if (this.photoUrl) {
      el.innerHTML =
        '<div class="photo-frame"><img src="' + this.photoUrl + '" alt="bill photo">' +
        '<div class="pf-actions">' +
        '<button class="btn sm" id="ab-retake">' + ico("camera_retake") + "Retake</button>" +
        "</div></div>" +
        '<div id="ab-quality" style="margin-top:12px"></div>';
      el.querySelector("#ab-retake").onclick = () => this.pickPhoto(main);
      this.renderQuality(el);
    } else {
      el.innerHTML =
        '<div class="cam-zone" id="ab-cam">' +
        '<div class="cam-ico">' + ico("cam") + "</div>" +
        '<div class="cam-t">Take or choose a photo of the bill</div>' +
        '<div class="cam-s">Hold steady, fill the frame with the bill, light on. Bad photos get a retake ask — that\'s the app protecting you.</div>' +
        '<div class="cam-sec">' +
        '<button class="btn primary" id="ab-cam-btn">' + ico("cam") + "Camera</button>" +
        '<button class="btn" id="ab-file-btn">' + ico("up") + "Gallery</button>" +
        "</div></div>" +
        '<div class="hint" style="margin-top:10px;text-align:center">No bill photo? Skip it — a photo is recommended but not required.</div>';
      el.querySelector("#ab-cam").onclick = (e) => {
        if (e.target.closest("button")) return;
        this.pickPhoto(main);
      };
      el.querySelector("#ab-cam-btn").onclick = () => this.pickPhoto(main, true);
      el.querySelector("#ab-file-btn").onclick = () => this.pickPhoto(main, false);
    }
  },

  async pickPhoto(main, wantCamera) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    if (wantCamera !== false && this.isMobile()) input.capture = "environment";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (f) this.setPhoto(main, f);
    };
    input.click();
  },

  isMobile() {
    return window.matchMedia("(max-width: 900px)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  },

  async setPhoto(main, file) {
    if (file.size > 40 * 1024 * 1024) { toast("Photo too large (max 40MB)", "err"); return; }
    this.photoFile = file;
    this.quality = null;
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
    this.photoBytes = new Uint8Array(await file.arrayBuffer());
    this.photoUrl = URL.createObjectURL(file);
    this.renderLeft(main);
    this.renderQuality(main.querySelector("#ab-left"));  // runs async check
  },

  renderQuality(el) {
    const box = el.querySelector("#ab-quality");
    if (!box) return;
    box.innerHTML = '<div class="quality-msg warn">' + ico("info") + "<span>Checking photo quality…</span></div>";
    API.postRaw("/api/photo/check", this.photoBytes, this.photoFile ? this.photoFile.type : "image/jpeg")
      .then((v) => {
        this.quality = v;
        if (v.ok && !v.duplicate) {
          box.innerHTML = '<div class="quality-msg good">' + ico("check") + "<span>Photo looks good — sharp and readable.</span></div>";
        } else if (v.ok && v.duplicate) {
          box.innerHTML = '<div class="quality-msg warn">' + ico("warn") + "<span>" + escapeHtml(v.duplicate) + "</span></div>";
        } else {
          box.innerHTML =
            '<div class="quality-msg bad">' + ico("warn") + "<span><b>This photo can't be read later.</b> " +
            escapeHtml(v.problems.join(" ")) + "</span></div>" +
            '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button class="btn primary" id="ab-q-retake">' + ico("camera_retake") + "Retake photo</button>" +
            '<button class="btn ghost" id="ab-q-keep">Keep anyway</button>' +
            "</div>";
          box.querySelector("#ab-q-retake").onclick = () => this.pickPhoto(el.closest("#main"), true);
          box.querySelector("#ab-q-keep").onclick = () => {
            this.quality.forced = true;
            box.querySelector(".quality-msg.bad").className = "quality-msg warn";
            box.querySelector(".quality-msg.warn").innerHTML = ico("warn") + "<span>Kept against advice — check the amount twice.</span>";
            box.querySelectorAll("#ab-q-retake,#ab-q-keep").forEach((b) => b.remove());
          };
        }
      })
      .catch((e) => {
        box.innerHTML = '<div class="quality-msg warn">' + ico("warn") + "<span>Quality check failed (" + escapeHtml(e.message) + ") — you can still continue.</span></div>";
      });
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
      '<input class="input big money" id="ab-amt" placeholder="रू 0" inputmode="text" autocomplete="off">' +
      '<div class="hint">Devanagari digits (१२३) and commas are fine — they convert as you type.</div></div>' +
      '<div class="field" style="margin-top:14px"><label>Note (optional)</label>' +
      '<input class="input" id="ab-note" placeholder="e.g. groceries, 3 tins oil"></div>' +
      '<div class="check-row" style="margin-top:16px">' +
      '<label class="switch"><input type="checkbox" id="ab-paid"><span class="track"></span></label>' +
      '<div><div class="cr-txt">Already paid at the counter</div>' +
      '<div class="cr-sub">Photo kept as a record only — no balance changes.</div></div>' +
      "</div>" +
      '<button class="btn primary lg block" id="ab-save" style="margin-top:18px">' + ico("check") + "Save bill</button>";

    /* prefill chosen person */
    if (this.personId) {
      API.get("/api/person?id=" + encodeURIComponent(this.personId)).then((p) => {
        el.querySelector("#ab-name").value = p.name;
      }).catch(() => {});
    }

    /* Devanagari live conversion on amount */
    const amt = el.querySelector("#ab-amt");
    amt.addEventListener("input", () => {
      const raw = amt.value;
      const conv = devToAscii(raw);
      if (conv !== raw) amt.value = conv;
    });

    /* name suggestions */
    const nameEl = el.querySelector("#ab-name");
    const sugEl = el.querySelector("#ab-sug");
    const onName = debounce(async () => {
      const q = nameEl.value.trim();
      this.personId = null;
      this.suggestionSel = -1;
      if (!q) { sugEl.classList.add("hidden"); return; }
      try {
        const d = await API.get("/api/search?q=" + encodeURIComponent(q));
        if (!d.results.length) { sugEl.classList.add("hidden"); return; }
        sugEl.innerHTML = d.results.map((r, i) =>
          '<div class="search-hit" data-i="' + i + '" data-id="' + r.id + '">' + avatarEl(r.name, 30) +
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
    nameEl.addEventListener("keydown", (e) => {
      const hits = sugEl.querySelectorAll(".search-hit");
      if (e.key === "Escape") { sugEl.classList.add("hidden"); return; }
      if (!hits.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.suggestionSel = Math.max(0, Math.min(hits.length - 1, this.suggestionSel + (e.key === "ArrowDown" ? 1 : -1)));
        hits.forEach((h, i) => h.classList.toggle("sel", i === this.suggestionSel));
      } else if (e.key === "Enter" && this.suggestionSel >= 0) {
        e.preventDefault();
        hits[this.suggestionSel].click();
      }
    });

    el.querySelector("#ab-save").onclick = () => this.save(main);
    setTimeout(() => (this.personId ? amt.focus() : nameEl.focus()), 60);
  },

  save(main) {
    const name = main.querySelector("#ab-name").value.trim();
    const amtRaw = main.querySelector("#ab-amt").value;
    const note = main.querySelector("#ab-note").value.trim();
    const alreadyPaid = main.querySelector("#ab-paid").checked;
    const amount = toAmountFloat(amtRaw);

    if (!name) { toast("Type who the bill is for", "err"); main.querySelector("#ab-name").focus(); return; }
    if (amount === null || amount <= 0) { toast("Enter the bill amount", "err"); main.querySelector("#ab-amt").focus(); return; }

    /* the law: bad photo never saves silently */
    if (this.quality && this.quality.ok === false && !this.quality.forced) {
      toast("Please retake the photo first (or tap Keep anyway)", "warn", 4200);
      main.querySelector("#ab-left").scrollIntoView({ behavior: "smooth" });
      return;
    }

    const payload = {
      person_id: this.personId || undefined,
      person_name: this.personId ? undefined : name,
      amount: amtRaw,
      note: note,
      already_paid: alreadyPaid,
    };

    /* attach photo if we have one */
    const finish = (photoB64) => {
      if (photoB64) payload.photo_b64 = photoB64;
      API.post("/api/bills/add", payload).then((res) => {
        toast(alreadyPaid ? "Bill saved (paid at counter)" : "Bill saved — " + fmtMoney(amount) + (photoB64 ? " · received on laptop ✓" : ""), "ok");
        App.go("ledger", { id: res.person_id });
      }).catch((e) => toast(e.message, "err"));
    };

    if (this.photoBytes) {
      const fr = new FileReader();
      fr.onload = () => finish(fr.result.split(",")[1]);
      fr.onerror = () => finish(null);
      fr.readAsDataURL(this.photoFile);
    } else {
      finish(null);
    }
  },
};
