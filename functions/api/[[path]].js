export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = new URL(url.pathname + url.search, "https://khatasathi.vercel.app");
  
  const headers = new Headers(context.request.headers);
  headers.set("Host", "khatasathi.vercel.app");
  
  const newRequest = new Request(targetUrl, {
    method: context.request.method,
    headers: headers,
    body: ["GET", "HEAD"].includes(context.request.method) ? null : context.request.body,
    redirect: "follow",
  });
  
  return fetch(newRequest);
}
