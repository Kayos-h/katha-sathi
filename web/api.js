/* Khata Sathi - API client + SSE live sync */
"use strict";

const API = {
  token: localStorage.getItem("bs_token") || "",

  async req(method, path, body, raw, ctype) {
    const headers = {};
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    let payload;
    if (raw !== undefined) {
      headers["Content-Type"] = ctype || "application/octet-stream";
      payload = raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const resp = await fetch(path, { method, headers, body: payload });
    let data = {};
    try { data = await resp.json(); } catch (e) { /* non-json (png) */ }
    if (resp.status === 401 && path !== "/api/login") {
      this.token = "";
      localStorage.removeItem("bs_token");
      window.dispatchEvent(new CustomEvent("bs-auth-expired"));
      throw new Error("Signed out - please sign in again");
    }
    if (!resp.ok) throw new Error(data.error || ("Error " + resp.status));
    return data;
  },

  get(path) { return this.req("GET", path); },
  post(path, body) { return this.req("POST", path, body); },
  postRaw(path, bytes, ctype) { return this.req("POST", path, undefined, bytes, ctype); },

  saveToken(t) {
    this.token = t;
    localStorage.setItem("bs_token", t);
  },
};

/* ---------- SSE live sync ---------- */
const Live = {
  es: null,
  handlers: {},

  on(kind, fn) {
    (this.handlers[kind] = this.handlers[kind] || []).push(fn);
  },

  connect() {
    if (this.es) this.es.close();
    if (!API.token) return;
    // EventSource can't send headers, so the token rides as a query param
    const es = new EventSource("/api/events?token=" + encodeURIComponent(API.token));
    this.es = es;
    es.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      (this.handlers[m.kind] || []).forEach((fn) => {
        try { fn(m.payload || {}); } catch (e) { console.warn("live handler", e); }
      });
      (this.handlers["*"] || []).forEach((fn) => {
        try { fn(m.kind, m.payload || {}); } catch (e) { console.warn("live handler", e); }
      });
    };
    es.onerror = () => { /* browser auto-reconnects EventSource */ };
  },

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  },
};
