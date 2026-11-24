/* Hash router + sign-in guard (pure; no DOM). Browser: window.Router.
 *
 *   #/signin              sign-in page (email link)
 *   #/projects            the user's projects
 *   #/projects/new        wizard, new project
 *   #/projects/<uuid>     wizard, saved project
 * Anything else is "notfound". Without Supabase config every route is
 * "wizard-only": the original wizard, with saving switched off.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.Router = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const PROJECT_RE = new RegExp(`^/projects/(${UUID})$`, "i");

  function parseRoute(hash) {
    const h = String(hash || "").replace(/^#/, "");
    if (h === "" || h === "/") return { name: "home" };
    if (h === "/signin") return { name: "signin" };
    if (h === "/projects") return { name: "projects" };
    if (h === "/projects/new") return { name: "new" };
    const m = h.match(PROJECT_RE);
    if (m) return { name: "project", id: m[1].toLowerCase() };
    return { name: "notfound" };
  }

  function routeFor(hash, { configured, signedIn }) {
    if (!configured) return { name: "wizard-only" };
    const route = parseRoute(hash);
    if (!signedIn) return { name: "signin" };
    if (route.name === "home" || route.name === "signin") return { name: "projects" };
    return route;
  }

  // Parameters an auth redirect can leave in the URL. They must not stay in
  // the address bar, history or anything copied/shared from it (R15).
  const AUTH_PARAMS = new Set([
    "code", "token", "token_hash", "type", "access_token", "refresh_token", "expires_in", "expires_at",
    "token_type", "provider_token", "provider_refresh_token", "error", "error_code", "error_description",
    "sb", // marker Supabase Auth adds to its redirect fragment
  ]);

  function strip(params) {
    for (const k of [...params.keys()]) if (AUTH_PARAMS.has(k)) params.delete(k);
    return params;
  }

  function scrubAuthParams(href) {
    const url = new URL(href);
    const search = strip(new URLSearchParams(url.search));
    url.search = [...search.keys()].length ? search.toString() : "";
    const hash = url.hash.replace(/^#/, "");
    if (hash && !hash.startsWith("/")) {
      const rest = strip(new URLSearchParams(hash));
      url.hash = [...rest.keys()].length ? rest.toString() : "";
    }
    return url.toString().replace(/#$/, "");
  }

  // Where the email link sends the user back to: the bare app URL.
  const authRedirectUrl = (loc) => loc.origin + loc.pathname;

  return { parseRoute, routeFor, scrubAuthParams, authRedirectUrl };
});
