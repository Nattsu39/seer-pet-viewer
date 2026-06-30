const REMOTE_BASE =
  "https://newseer.61.com/Assets/StandaloneWindows64/PetAnimPackage";
const HASH_RE = /^[a-f0-9]{32}$/;

export interface ProxyOptions {
  allowedOrigin?: string;
}

export function extractHash(pathname: string): string | null {
  const hash = pathname.replace(/^\/+/, "").split("/").pop() ?? "";
  return HASH_RE.test(hash) ? hash : null;
}

export function corsHeaders(origin: string | null, allowedOrigin?: string): HeadersInit {
  const allowOrigin =
    allowedOrigin ?? (origin && origin !== "null" ? origin : "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function proxyBundleRequest(
  request: Request,
  hash: string,
  options: ProxyOptions = {},
): Promise<Response> {
  const upstream = `${REMOTE_BASE}/${hash}`;
  const upstreamRes = await fetch(upstream, {
    method: "GET",
    headers: {
      referer: "https://newseer.61.com",
      "user-agent": request.headers.get("user-agent") ?? "seer-pet-viewer-proxy",
    },
  });

  if (!upstreamRes.ok) {
    return new Response(`上游错误: ${upstreamRes.status}`, {
      status: upstreamRes.status,
      headers: corsHeaders(request.headers.get("Origin"), options.allowedOrigin),
    });
  }

  const headers = new Headers(upstreamRes.headers);
  headers.set(
    "Access-Control-Allow-Origin",
    options.allowedOrigin ??
      request.headers.get("Origin") ??
      "*",
  );
  headers.set("Access-Control-Expose-Headers", "Content-Type, Content-Length");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  });
}

export function handleProxyRequest(
  request: Request,
  options: ProxyOptions = {},
): Promise<Response> | Response {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin, options.allowedOrigin),
    });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const hash = extractHash(url.pathname);
  if (!hash) {
    return new Response("Invalid bundle hash", {
      status: 400,
      headers: corsHeaders(origin, options.allowedOrigin),
    });
  }

  return proxyBundleRequest(request, hash, options);
}
