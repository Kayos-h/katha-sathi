export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy API and photo endpoints to the cloud backend
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/photo/")) {
      const targetUrl = new URL(url.pathname + url.search, "https://khatasathi.vercel.app");
      const headers = new Headers(request.headers);
      headers.set("Host", "khatasathi.vercel.app");

      const newRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
        redirect: "follow",
      });

      return fetch(newRequest);
    }

    // Serve static frontend assets
    return env.ASSETS.fetch(request);
  },
};
