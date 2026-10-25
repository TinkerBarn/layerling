const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalRequest(request: Request) {
  const requestUrl = new URL(request.url);
  if (!LOCAL_HOSTS.has(requestUrl.hostname)) {
    return false;
  }

  // Next may normalize request.url to localhost in dev mode, even when the
  // incoming Host header names a remote site. Check the actual authority too;
  // the URL object alone is not a reliable loopback check behind that rewrite.
  const hostHeader = request.headers.get("host");
  if (!hostHeader) return false;
  try {
    const hostUrl = new URL(`${requestUrl.protocol}//${hostHeader}`);
    if (!LOCAL_HOSTS.has(hostUrl.hostname) || (hostUrl.port && requestUrl.port && hostUrl.port !== requestUrl.port)) return false;
  } catch {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      // Compare the port, not the whole origin: Next's dev server reports
      // request.url as "localhost" even when the browser actually connected
      // over 127.0.0.1 (or [::1]), so a page opened at that address always
      // failed this check even though it is the same loopback server.
      if (originUrl.port !== requestUrl.port || !LOCAL_HOSTS.has(originUrl.hostname)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
