/**
 * Privacy Policy + Terms of Service pages for the Webcake Landing MCP connector.
 *
 * Both the Claude Connectors Directory and the ChatGPT App Directory require a
 * PUBLIC privacy-policy URL (and terms are strongly recommended). We host them on
 * the connector's own origin (/privacy and /terms) so the submission can point at
 * a stable URL we control. Plain self-contained HTML — no deps, served by http.ts.
 *
 * Keep the facts here in sync with what the server actually does (see http.ts,
 * auth/oauth-server.ts, persistence/*). Reviewers read these.
 */

const CONTACT_EMAIL = process.env.WEBCAKE_SUPPORT_EMAIL || "vuluu040320@gmail.com";
const LAST_UPDATED = "2026-06-15";

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Webcake Landing MCP</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.65;color:#1e293b;background:#f8fafc}
  @media(prefers-color-scheme:dark){body{color:#e2e8f0;background:#0f172a}}
  main{max-width:760px;margin:0 auto;padding:48px 24px 80px}
  h1{font-size:1.9rem;margin:0 0 4px}
  h2{font-size:1.2rem;margin:32px 0 8px}
  .meta{color:#64748b;font-size:.9rem;margin-bottom:28px}
  a{color:#108B67}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.15);padding:1px 5px;border-radius:4px}
  ul{padding-left:22px}
  footer{margin-top:48px;padding-top:20px;border-top:1px solid rgba(127,127,127,.25);color:#64748b;font-size:.85rem}
</style></head>
<body><main>${bodyHtml}
<footer>Webcake Landing MCP · <a href="https://mcp.toolvn.io.vn">mcp.toolvn.io.vn</a> · <a href="https://github.com/vuluu2k/webcake-landing-mcp">source</a> · Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></footer>
</main></body></html>`;
}

export function privacyHtml(): string {
  return page(
    "Privacy Policy",
    `<h1>Privacy Policy</h1>
<div class="meta">Last updated: ${LAST_UPDATED}</div>
<p>Webcake Landing MCP ("the connector") is a Model Context Protocol server that lets an AI assistant
build and edit landing pages in your <a href="https://webcake.io">Webcake</a> account. This policy explains
what data the connector handles and how.</p>

<h2>What we access</h2>
<ul>
  <li><strong>Your Webcake identity &amp; access token.</strong> When you connect, you log in to Webcake and the
  connector receives a per-user access token mapped to your Webcake landing-page credential. It is used solely
  to call the Webcake backend on your behalf (create, read, update, publish pages, list your organizations).</li>
  <li><strong>Page content you ask the assistant to build or edit.</strong> The page-source JSON (text, images,
  layout) flows through the connector to your Webcake account.</li>
  <li><strong>Images.</strong> External image URLs in a page are re-hosted to the Webcake CDN on save. Optional
  stock-photo search is served via the Pexels API.</li>
</ul>

<h2>What we store</h2>
<ul>
  <li><strong>OAuth tokens are kept in memory only</strong>, for the lifetime of the running server, and expire
  automatically (access tokens ~1 hour, refresh tokens ~30 days). They are never written to disk by the
  connector and are removed on logout/revoke or when they expire.</li>
  <li>The connector does <strong>not</strong> run an analytics database, does not sell data, and does not share
  your data with third parties beyond the services required to perform your request (below).</li>
</ul>

<h2>Third-party services</h2>
<ul>
  <li><strong>Webcake</strong> (api.webcake.io) — stores and serves your pages; governed by Webcake's own terms.</li>
  <li><strong>Pexels</strong> (pexels.com) — stock-photo search, only when you request images.</li>
</ul>

<h2>Data retention &amp; deletion</h2>
<p>Tokens expire automatically as described above; you can revoke access at any time by disconnecting the
connector in Claude/ChatGPT settings, or by logging out of Webcake. Pages you create live in your Webcake
account and are managed there. To request deletion of anything else, contact us below.</p>

<h2>Security</h2>
<p>All traffic uses HTTPS. Authentication follows OAuth 2.1 with PKCE; the connector validates a short-lived
access token per request and never exposes your raw Webcake token to the AI assistant.</p>

<h2>Contact</h2>
<p>Questions or requests: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`
  );
}

export function termsHtml(): string {
  return page(
    "Terms of Service",
    `<h1>Terms of Service</h1>
<div class="meta">Last updated: ${LAST_UPDATED}</div>
<p>By connecting to and using the Webcake Landing MCP connector ("the service") you agree to these terms.</p>

<h2>What the service does</h2>
<p>The service exposes tools that let an AI assistant generate, validate, and persist Webcake landing pages to
your own Webcake account. It acts on your behalf using credentials you authorize via Webcake login.</p>

<h2>Your responsibilities</h2>
<ul>
  <li>You must have a valid Webcake account and the right to create/modify content in the organizations you target.</li>
  <li>You are responsible for the content you generate and publish, and for complying with Webcake's terms and
  applicable law.</li>
  <li>Do not use the service to create unlawful, infringing, or harmful content.</li>
</ul>

<h2>Availability &amp; changes</h2>
<p>The service is provided "as is" without warranty. We may update, suspend, or discontinue it, and may change
these terms; continued use after a change means you accept it.</p>

<h2>Limitation of liability</h2>
<p>To the extent permitted by law, the operators of the connector are not liable for indirect or consequential
damages arising from use of the service. The service depends on third-party platforms (Webcake, the AI
assistant) whose own terms also apply.</p>

<h2>Contact</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>`
  );
}
