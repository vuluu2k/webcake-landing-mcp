/**
 * The HTML guide page served at the server root (`GET /` with an HTML Accept).
 *
 * A browser visiting the deployed server (e.g. https://mcp.toolvn.io.vn/) gets a
 * branded, self-contained page explaining what the MCP is, how it works, and the
 * two ways to connect — instead of a bare JSON health blob. Programmatic probes
 * (the container healthcheck, MCP clients) still get JSON; see http.ts.
 *
 * Self-contained (inline CSS + the Webcake icon) so it needs no extra assets.
 */
import { ICON_SVG } from "./branding.js";

const MCP_REMOTE_URL = "https://webcake.io/mcp-remote";
const DOCS_URL = "https://github.com/vuluu2k/webcake-landing-mcp#readme";

// `origin` is the public base URL (proto + host) derived from the request, so the
// shown endpoint matches whatever domain the user is actually visiting.
export function guideHtml(origin: string): string {
  const endpoint = `${origin}/mcp`;
  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Webcake Landing MCP — Hướng dẫn</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
  :root{--g:#1DB954;--g7:#178f43;--ink:#11221a;--mut:#5b6b63;--bg:#f4f9f6;--card:#fff;--line:#e6efe9}
  @media(prefers-color-scheme:dark){:root{--ink:#e8f0ec;--mut:#9fb1a8;--bg:#0d1411;--card:#141d18;--line:#22302a}}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
    background:radial-gradient(900px 500px at 80% -10%,rgba(29,185,84,.14),transparent 60%),var(--bg);line-height:1.6}
  .wrap{max-width:880px;margin:0 auto;padding:40px 20px 64px}
  header{display:flex;align-items:center;gap:14px;margin-bottom:8px}
  header .logo{width:46px;height:46px;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(29,185,84,.35);flex:0 0 auto}
  header .logo svg{width:100%;height:100%;display:block}
  h1{font-size:1.7rem;margin:0;font-weight:800;letter-spacing:-.02em}
  .sub{color:var(--mut);margin:2px 0 0;font-size:.98rem}
  .lead{font-size:1.12rem;margin:22px 0 26px;max-width:60ch}
  .pill{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;font-size:.82rem;font-weight:600;
    background:rgba(29,185,84,.12);color:var(--g7)}
  @media(prefers-color-scheme:dark){.pill{color:#5ee08a}}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--g);box-shadow:0 0 0 3px rgba(29,185,84,.25)}
  h2{font-size:1.18rem;margin:38px 0 14px;font-weight:700}
  .grid{display:grid;gap:16px;grid-template-columns:1fr 1fr}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
  .card h3{margin:0 0 6px;font-size:1.05rem}
  .card .tag{font-size:.78rem;font-weight:700;color:var(--g7);text-transform:uppercase;letter-spacing:.04em}
  @media(prefers-color-scheme:dark){.card .tag{color:#5ee08a}}
  .card p{color:var(--mut);font-size:.92rem;margin:.5rem 0 1rem}
  pre{margin:0;background:#0d1411;color:#e8f0ec;border-radius:10px;padding:12px 14px;overflow-x:auto;
    font:600 .82rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  .feat{list-style:none;padding:0;margin:0;display:grid;gap:10px}
  .feat li{display:flex;gap:10px;align-items:flex-start;font-size:.96rem}
  .feat svg{flex:0 0 auto;margin-top:3px;color:var(--g)}
  .btn{display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:11px 18px;border-radius:10px;
    background:var(--g);color:#fff;text-decoration:none;font-weight:700;font-size:.92rem;box-shadow:0 4px 14px rgba(29,185,84,.4)}
  .btn:hover{background:var(--g7)}
  .method{margin-bottom:16px}
  .msub{color:var(--mut);font-size:.92rem;margin:.35rem 0 1.1rem}
  .steps{list-style:none;margin:0;padding:0;display:grid;gap:16px}
  .steps li{display:flex;gap:13px}
  .steps .n{flex:0 0 auto;width:27px;height:27px;border-radius:50%;background:var(--g);color:#fff;
    font:800 .85rem/1 system-ui;display:flex;align-items:center;justify-content:center}
  .steps .body{flex:1;min-width:0;font-size:.95rem}
  .steps .body pre{margin-top:9px}
  .steps .body .btn{margin-top:10px}
  code.inl{background:rgba(29,185,84,.12);color:var(--g7);padding:1px 6px;border-radius:6px;font-size:.85em}
  @media(prefers-color-scheme:dark){code.inl{color:#5ee08a}}
  .note{font-size:.86rem;color:var(--mut);margin-top:8px}
  footer{margin-top:46px;padding-top:20px;border-top:1px solid var(--line);color:var(--mut);font-size:.86rem;
    display:flex;gap:16px;flex-wrap:wrap;align-items:center}
  footer a{color:var(--g7);font-weight:600;text-decoration:none}
  @media(prefers-color-scheme:dark){footer a{color:#5ee08a}}
</style></head>
<body><div class="wrap">

  <header>
    <span class="logo">${ICON_SVG}</span>
    <div>
      <h1>Webcake Landing MCP</h1>
      <p class="sub">Cho AI dựng &amp; sửa landing page Webcake bằng lời nói</p>
    </div>
  </header>

  <p><span class="pill"><span class="dot"></span> Server đang chạy</span></p>

  <p class="lead">Bạn gõ yêu cầu, AI (Claude, Cursor…) dựng nguyên cái landing page rồi lưu thẳng vào
  tài khoản Webcake của bạn. Không kéo thả, không cài server — kết nối một lần là xong.</p>

  <h2>Cách hoạt động</h2>
  <ul class="feat">
    <li>${check()} <span><b>AI học mô hình thật của Webcake</b> — danh mục element, <code class="inl">specials</code>, hệ toạ độ, sự kiện — qua các tool của server này.</span></li>
    <li>${check()} <span><b>Server lo phần khó</b>: dựng JSON nguồn, kiểm tra hợp lệ (validate), rồi lưu trang về backend Webcake.</span></li>
    <li>${check()} <span><b>Bạn chỉ duyệt</b>: mở trang trong editor Webcake, lưu lại để render — xong.</span></li>
  </ul>

  <h2>Kết nối — chọn 1 trong 2 cách</h2>

  <div class="card method">
    <span class="tag">Cách ① · npx — chạy trên máy bạn</span>
    <p class="msub">Hợp khi dùng cá nhân, muốn toàn quyền. Cần cài Node.js 18+.</p>
    <ol class="steps">
      <li><span class="n">1</span><div class="body"><b>Cài Node.js 18+</b> nếu chưa có. Kiểm tra bằng <code class="inl">node -v</code>; chưa có thì tải ở <b>nodejs.org</b>.</div></li>
      <li><span class="n">2</span><div class="body"><b>Mở Terminal và chạy:</b><pre>npx -y webcake-landing-mcp install</pre></div></li>
      <li><span class="n">3</span><div class="body"><b>Làm theo hỏi đáp:</b> chọn môi trường (<code class="inl">prod</code>) → đăng nhập Webcake qua trình duyệt (hoặc dán JWT) → chọn IDE (Claude Desktop / Cursor / Claude Code…).</div></li>
      <li><span class="n">4</span><div class="body"><b>Khởi động lại IDE</b> → thấy <code class="inl">webcake-landing</code> trong danh sách MCP là xong.</div></li>
    </ol>
    <p class="note">Muốn cấu hình mọi IDE một phát: <code class="inl">npx -y webcake-landing-mcp install --ide all --env prod --jwt &lt;TOKEN&gt;</code></p>
  </div>

  <div class="card method">
    <span class="tag">Cách ② · URL remote — không cần cài gì</span>
    <p class="msub">Hợp khi máy không có Node.js, dùng theo nhóm, hoặc dùng claude.ai trên web.</p>
    <ol class="steps">
      <li><span class="n">1</span><div class="body"><b>Lấy link cá nhân</b> (đã gắn sẵn token) — mở trang sau rồi bấm <b>Copy</b>:<a class="btn" href="${MCP_REMOTE_URL}">Mở ${MCP_REMOTE_URL.replace("https://", "")} →</a></div></li>
      <li><span class="n">2</span><div class="body"><b>Mở phần thêm connector</b> trong client:<br>• claude.ai: <i>Settings → Connectors → Add custom connector</i><br>• Cursor / Claude Code: mở file <code class="inl">.mcp.json</code></div></li>
      <li><span class="n">3</span><div class="body"><b>Dán link</b> vừa copy (có dạng):<pre>${endpoint}?jwt=&lt;TOKEN&gt;</pre></div></li>
      <li><span class="n">4</span><div class="body"><b>Bấm Add</b> (hoặc lưu file) → đợi kết nối → xong. Icon Webcake xanh hiện lên là chạy được.</div></li>
    </ol>
    <p class="note">⚠️ Link chứa token cá nhân — coi như mật khẩu, đừng chia sẻ, luôn dùng HTTPS.</p>
  </div>

  <h2>Sau khi kết nối, bạn nói được</h2>
  <ul class="feat">
    <li>${check()} <span>“Dựng landing bán khoá học, tông xanh, có form đăng ký + nút Zalo.”</span></li>
    <li>${check()} <span>“Mở trang <i>sale-hè</i>, đổi tiêu đề thành ‘Giảm 50%’, nút sang màu đỏ.”</span></li>
    <li>${check()} <span>“Thêm section đếm ngược + 3 testimonial vào cuối trang.”</span></li>
  </ul>

  <footer>
    <span>Endpoint MCP: <code class="inl">${endpoint}</code></span>
    <a href="${DOCS_URL}">Hướng dẫn chi tiết ↗</a>
    <a href="/health">Health</a>
  </footer>

</div></body></html>`;
}

function check(): string {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
