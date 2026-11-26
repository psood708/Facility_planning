/* Email-link sign-in. createAuth({ client, location }) wraps a supabase-js
 * client (created with flowType "pkce", so the link returns a one-time code,
 * not tokens in the URL). sendLink answers the same way whether or not the
 * address has an account (R9); only "invalid email" and "rate limited" are
 * distinguished, both of which say nothing about the account. With a CAPTCHA
 * (Cloudflare Turnstile) the token goes along; a rejected token is reported
 * too, which also reveals nothing about the account.
 * Browser: window.Auth; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory(typeof module === "object" && module.exports ? require("./router.js") : root.Router);
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.Auth = mod;
})(typeof self !== "undefined" ? self : this, function (Router) {
  "use strict";

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function normalizeEmail(raw) {
    const e = String(raw || "").trim().toLowerCase();
    return e.length <= 254 && EMAIL.test(e) ? e : null;
  }

  function createAuth({ client, location }) {
    return {
      async sendLink(rawEmail, { captchaToken } = {}) {
        const email = normalizeEmail(rawEmail);
        if (!email) return { ok: false, reason: "invalid_email" };
        const options = { emailRedirectTo: Router.authRedirectUrl(location), shouldCreateUser: true };
        if (typeof captchaToken === "string" && captchaToken) options.captchaToken = captchaToken;
        const { error } = await client.auth.signInWithOtp({ email, options });
        if (!error) return { ok: true };
        if (error.status === 429 || /rate_limit/.test(error.code || "")) return { ok: false, reason: "rate_limited" };
        if (/captcha/i.test(`${error.code || ""} ${error.message || ""}`)) return { ok: false, reason: "captcha" };
        if (!error.status) return { ok: false, reason: "network" }; // request never reached the server
        return { ok: true }; // account-specific errors look like success
      },

      // "global" revokes every refresh token for the user, not just this tab's.
      async signOut() {
        await client.auth.signOut({ scope: "global" });
      },
    };
  }

  return { createAuth, normalizeEmail };
});
