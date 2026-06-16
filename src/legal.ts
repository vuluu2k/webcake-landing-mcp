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
what categories of data the connector handles, why, who receives it, and how long it is kept.</p>

<h2>Categories of personal data we access</h2>
<ul>
  <li><strong>Your Webcake identity &amp; access token.</strong> When you connect, you log in to Webcake and the
  connector receives a per-user access token mapped to your Webcake landing-page credential. <em>Purpose:</em> solely
  to call the Webcake backend on your behalf (create, read, update, publish pages, list your organizations).</li>
  <li><strong>Page content you ask the assistant to build or edit.</strong> The page-source JSON (text, images,
  layout) flows through the connector to your Webcake account. <em>Purpose:</em> to assemble and save the page you request.</li>
  <li><strong>Images.</strong> External image URLs in a page are re-hosted to the Webcake CDN on save. Optional
  stock-photo search uses the Pexels API and icon lookup uses the Iconify API. <em>Purpose:</em> to supply the
  visuals for your page.</li>
  <li><strong>Page preview screenshots.</strong> When you ask the assistant to visually check a page, the page's
  <em>public</em> preview URL is sent to a screenshot service (by default Microlink; optionally a self-hosted
  renderer) which returns a picture of the page. <em>Purpose:</em> so the assistant can see the rendered result and
  compare it to your reference. Only the public URL is sent — never your access token or page-source JSON.</li>
</ul>

<h2>What we store and for how long</h2>
<ul>
  <li><strong>OAuth tokens.</strong> Stored in the connector's database (PostgreSQL) when the server is configured
  with one — so a logged-in session survives a server restart and works across instances — otherwise only in
  process memory. Either way they <strong>expire automatically</strong> (access tokens ~1 hour, refresh tokens
  ~30 days) and are removed on logout/revoke or expiry.</li>
  <li><strong>Transient draft cache.</strong> If a page fails validation while being created, its draft page-source
  is cached briefly (about 2 hours, in Redis or memory) so you can fix and retry without re-sending everything.
  It is removed on success or expiry.</li>
  <li>The connector does <strong>not</strong> run an analytics database, does <strong>not</strong> sell data, and
  does <strong>not</strong> perform tracking, behavioral profiling, or advertising.</li>
</ul>

<h2>Categories of recipients (third-party services)</h2>
<p>Your data is shared only with the services required to perform your request:</p>
<ul>
  <li><strong>Webcake</strong> (api.webcake.io, the Webcake CDN, and the publish/build host) — stores, renders,
  and serves your pages; governed by Webcake's own terms.</li>
  <li><strong>Pexels</strong> (pexels.com) — stock-photo search, only when you request images.</li>
  <li><strong>Iconify</strong> (iconify.design) — resolves icon names to SVG, only when a page uses icons.</li>
  <li><strong>Microlink</strong> (api.microlink.io) — renders a page's public preview URL to a screenshot, only when
  you request a visual check. A self-hosted renderer can be configured instead; only the public URL is sent.</li>
</ul>

<h2>Data we do NOT collect</h2>
<p>The connector never asks for or stores payment-card data, health data, government identifiers, or
authentication secrets (passwords, API keys, MFA/OTP codes) as tool inputs. It operates only on the page
content you explicitly ask the assistant to build — it does <strong>not</strong> read, reconstruct, or infer
your full conversation or chat history.</p>

<h2>Data retention &amp; deletion</h2>
<p>Tokens and the draft cache expire automatically as described above; you can revoke access at any time by
disconnecting the connector in Claude/ChatGPT settings, or by logging out of Webcake. Pages you create live in
your Webcake account and are managed there. To request deletion of anything else, contact us below.</p>

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
