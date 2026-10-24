const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const HTML_PAGE_CACHE_CONTROL = "public, max-age=300";

function stripQueryString(urlPath: string): string {
  return urlPath.split("?", 1)[0];
}

export function getStaticAssetCacheControl(
  urlPath: string | undefined,
): string | undefined {
  if (!urlPath) {
    return undefined;
  }

  const normalizedPath = stripQueryString(urlPath);
  if (
    normalizedPath.startsWith("/assets/") ||
    normalizedPath.startsWith("/_assets/")
  ) {
    return IMMUTABLE_CACHE_CONTROL;
  }

  // Root HTML pages (the Terms, the Privacy Policy, the wiki at /wiki/<slug>/
  // and its sitemap) are edited in place, so they must not inherit
  // express.static's one-year maxAge.
  if (
    normalizedPath.endsWith(".html") ||
    normalizedPath.endsWith("/") ||
    normalizedPath.endsWith(".xml")
  ) {
    return HTML_PAGE_CACHE_CONTROL;
  }

  return undefined;
}

export function applyStaticAssetCacheControl(
  setHeader: (name: string, value: string) => void,
  urlPath: string | undefined,
): void {
  const cacheControl = getStaticAssetCacheControl(urlPath);
  if (cacheControl) {
    setHeader("Cache-Control", cacheControl);
  }
}
