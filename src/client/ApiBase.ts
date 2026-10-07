import { ClientEnv } from "./ClientEnv";

// The account/shop API origin (api.<audience>). Lives apart from Api.ts so
// modules that Api.ts itself depends on (ServerList) can reach it without an
// import cycle; Api.ts re-exports both for its existing importers.

export function getApiBase() {
  const domainname = getAudience();

  if (domainname === "localhost") {
    const apiDomain = process.env.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    // A developer's own override first; then the origin the server injected
    // into the page (a production-mode container audited on one PC runs its
    // API on another port); then upstream's default.
    return (
      localStorage.getItem("apiHost") ??
      ClientEnv.apiOrigin() ??
      "http://localhost:8787"
    );
  }

  // One rule, kept in ClientEnv: the page's apiOrigin when the server
  // injected one (API_DOMAIN), else api.<audience>.
  return ClientEnv.jwtIssuer();
}

export function getAudience() {
  // Sourced from BOOTSTRAP_CONFIG (server/desktop-injected) rather than
  // window.location, so a non-browser host targets real infra.
  return ClientEnv.jwtAudience();
}
