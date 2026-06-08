/**
 * Dev preview server for the web-guide landing page (src/web-guide.ts) with
 * hot-reload — NOT a production path (that's `serve` in src/http.ts).
 *
 *   npm run dev:guide        # → http://localhost:8788
 *
 * What it does:
 *  1. Builds once (so dist/web-guide.js + dist/changelog.json exist), then runs
 *     `tsc --watch` so every save to src/ recompiles into dist/.
 *  2. Serves the guide by dynamically re-importing the freshly built module with
 *     a cache-busting query, so edits show on refresh without restarting.
 *  3. Injects a tiny SSE client that reloads the browser the moment
 *     dist/web-guide.js changes — true hot-reload, no manual F5.
 *
 * Self-contained: no extra deps. og.png falls back to the SVG in dev.
 */
import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { watch, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_GUIDE = resolve(ROOT, "dist/web-guide.js");
const PORT = Number(process.argv[2] || process.env.PORT || 8788);

// 1) Build once so changelog.json/branding are present, then keep tsc watching.
console.error("[preview] initial build…");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
const tsc = spawn("npx", ["tsc", "--watch", "--preserveWatchOutput"], {
  cwd: ROOT,
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => tsc.kill());
process.on("SIGINT", () => process.exit(0));

// 2) SSE clients to push reloads to.
const clients = new Set();
function broadcastReload() {
  for (const res of clients) res.write("data: reload\n\n");
}
// fs.watch can fire twice per save — debounce.
let t;
watch(DIST_GUIDE, () => {
  clearTimeout(t);
  t = setTimeout(broadcastReload, 80);
});

const LIVERELOAD = `<script>(function(){var s=new EventSource('/__livereload');s.onmessage=function(e){if(e.data==='reload')location.reload();};})();</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/__livereload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  try {
    // Cache-bust by mtime so each edit re-evaluates the ESM module.
    const v = statSync(DIST_GUIDE).mtimeMs;
    const mod = await import(pathToFileURL(DIST_GUIDE).href + `?v=${v}`);

    if (url.pathname === "/og.svg" || url.pathname === "/og.png") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      return res.end(mod.ogImageSvg());
    }

    // Favicon — production serves the brand SVG from branding.ts (see http.ts);
    // mirror that here so the dev preview shows the icon instead of the HTML page.
    if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico" || url.pathname === "/icon.svg") {
      const { ICON_SVG, ICON_MIME } = await import(pathToFileURL(resolve(ROOT, "dist/branding.js")).href + `?v=${v}`);
      res.writeHead(200, { "Content-Type": ICON_MIME, "Cache-Control": "no-store" });
      return res.end(ICON_SVG);
    }

    const lang = mod.normalizeLang(url.searchParams.get("lang"));
    const html = mod.guideHtml(`http://localhost:${PORT}`, lang).replace("</body>", `${LIVERELOAD}</body>`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Preview error (still compiling?):\n" + (err?.stack || err));
  }
});

server.listen(PORT, () => {
  console.error(`\n[preview] web-guide → http://localhost:${PORT}  (edit src/web-guide.ts → auto reload)\n`);
});
