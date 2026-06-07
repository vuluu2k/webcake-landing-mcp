/**
 * The HTML guide page served at the server root (`GET /` with an HTML Accept).
 *
 * A browser visiting the deployed server (e.g. https://mcp.toolvn.io.vn/) gets a
 * branded, self-contained **landing page** explaining what the MCP is, how it
 * works, and the two ways to connect — instead of a bare JSON health blob.
 * Programmatic probes (the container healthcheck, MCP clients) still get JSON;
 * see http.ts.
 *
 * It is **bilingual (vi/en)**: every string lives in the `META` / `T` / `FAQ`
 * dictionaries and `guideHtml(origin, lang)` renders one language. http.ts picks
 * the language from `?lang=` (falling back to vi); a toggle in the header links to
 * the other language, and `<link rel="alternate" hreflang>` + `og:locale` are
 * emitted for SEO.
 *
 * It's also built to be *shareable*: a full SEO `<head>` (description, canonical,
 * Open Graph, Twitter Card, JSON-LD for SoftwareApplication + WebSite + FAQPage)
 * so links unfurl nicely on social/chat and the page can be indexed. The social
 * card image is served separately at `/og.svg` (see `ogImageSvg`, wired in http.ts).
 *
 * Self-contained (inline CSS + the Webcake icon, no external assets/fonts/trackers)
 * so it loads instantly and leaks nothing.
 */
import { readFileSync } from "node:fs";
import { ICON_SVG } from "./branding.js";

const MCP_REMOTE_URL = "https://webcake.io/mcp-remote";
// The "configure every IDE" one-liner — rendered as a code block (with a copy
// button) rather than long inline code, which wrapped messily on mobile.
const INSTALL_ALL_CMD = "npx -y webcake-landing-mcp install --ide all --env prod --jwt &lt;TOKEN&gt;";
const GITHUB_URL = "https://github.com/vuluu2k/webcake-landing-mcp";
const NPM_URL = "https://www.npmjs.com/package/webcake-landing-mcp";
const DOCS_URL = `${GITHUB_URL}#readme`;

export type Lang = "vi" | "en";
export const LANGS: Lang[] = ["vi", "en"];
export function normalizeLang(input: string | undefined | null): Lang {
  return input === "en" ? "en" : "vi";
}

/**
 * A small inline stroke-icon set (Lucide-style, MIT) so the page uses one
 * coherent icon language instead of mixed emoji — drawn in `currentColor` and
 * dropped into the soft tiles. Self-contained: no external icon font.
 */
const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.142 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.142 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  wand:
    '<path d="m9.5 14.5 5-5"/><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>',
  check2: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  magnet:
    '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4"/><path d="m12 15 4 4"/>',
  cart:
    '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>',
  mail:
    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  star:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  book:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  package:
    '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  bulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  window:
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M6 6.5h.01"/><path d="M9 6.5h.01"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};
function icon(name: string): string {
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}
function tile(name: string): string {
  return `<span class="ic">${icon(name)}</span>`;
}

// ── i18n: per-language SEO metadata ───────────────────────────────────────────
const META: Record<Lang, { title: string; desc: string; keywords: string; locale: string }> = {
  vi: {
    title: "Webcake Landing MCP — AI dựng landing page Webcake bằng lời nói",
    desc: "MCP server cho phép AI (Claude, Cursor, Windsurf…) dựng, kiểm tra và lưu thẳng landing page Webcake từ một câu mô tả. Không kéo-thả, không viết JSON, kết nối một lần là xong.",
    keywords:
      "Webcake, landing page, MCP, Model Context Protocol, AI, Claude, Cursor, Windsurf, tạo landing page bằng AI, no-code, COD, lead generation",
    locale: "vi_VN",
  },
  en: {
    title: "Webcake Landing MCP — let AI build Webcake landing pages from a sentence",
    desc: "An MCP server that lets AI (Claude, Cursor, Windsurf…) build, validate and save Webcake landing pages straight from a plain-language description. No drag-and-drop, no JSON, connect once.",
    keywords:
      "Webcake, landing page, MCP, Model Context Protocol, AI, Claude, Cursor, Windsurf, AI website builder, no-code, COD, lead generation",
    locale: "en_US",
  },
};

// ── i18n: FAQ (also powers the FAQPage structured data) ───────────────────────
const FAQ: Record<Lang, Array<{ q: string; a: string }>> = {
  vi: [
    {
      q: "Webcake Landing MCP là gì?",
      a: "Một MCP server dạy AI cách dựng trọn cấu trúc nguồn của landing page Webcake từ yêu cầu bằng lời, kiểm tra hợp lệ rồi lưu về tài khoản Webcake của bạn. Server lo phần khó; bạn chỉ mô tả và duyệt.",
    },
    {
      q: "Tôi có cần biết lập trình không?",
      a: "Không. Bạn chỉ cần mô tả trang bằng ngôn ngữ tự nhiên trong AI (Claude, Cursor…). AI dùng các tool của server để dựng đúng mô hình element thật của Webcake.",
    },
    {
      q: "Có miễn phí không?",
      a: "Có. Server là mã nguồn mở và miễn phí. Bạn chỉ cần một tài khoản Webcake để lưu trang; các tool tham chiếu + kiểm tra còn chạy được mà không cần token.",
    },
    {
      q: "Dùng được với AI/IDE nào?",
      a: "Claude Desktop, Claude Code, Cursor, Windsurf, Augment (VS Code), Codex, và claude.ai trên web — hay bất kỳ client nào hỗ trợ Model Context Protocol.",
    },
    {
      q: "Token của tôi có an toàn không?",
      a: "Có. Token chỉ là của riêng bạn, gửi qua header hoặc link cá nhân, không lưu lại; và mọi thao tác ghi đều mặc định xem trước (dry-run) trước khi thực sự lưu.",
    },
  ],
  en: [
    {
      q: "What is Webcake Landing MCP?",
      a: "An MCP server that teaches AI how to build the full source structure of a Webcake landing page from a plain-language request, validate it, then save it to your Webcake account. The server does the hard part; you just describe and review.",
    },
    {
      q: "Do I need to know how to code?",
      a: "No. You just describe the page in natural language in your AI (Claude, Cursor…). The AI uses the server's tools to build against Webcake's real element model.",
    },
    {
      q: "Is it free?",
      a: "Yes. The server is open-source and free. You only need a Webcake account to save pages; the reference and validation tools work without a token.",
    },
    {
      q: "Which AI / IDEs work with it?",
      a: "Claude Desktop, Claude Code, Cursor, Windsurf, Augment (VS Code), Codex, and claude.ai on the web — or any client that supports the Model Context Protocol.",
    },
    {
      q: "Is my token safe?",
      a: "Yes. The token is yours alone, sent via a header or your personal link and never stored; and every write defaults to a preview (dry-run) before anything is actually saved.",
    },
  ],
};

// ── i18n: UI strings. Step HTML carries tokens ({REMOTE}/{REMOTE_HOST}/{ENDPOINT}/
//    {ARROW}) replaced with live values at render time. ─────────────────────────
type Strings = {
  sub: string;
  running: string;
  leadPre: string;
  leadGrad: string;
  leadPost: string;
  ctaStart: string;
  ctaStar: string;
  flowH2: string;
  flow: Array<{ icon: string; t: string; s: string }>;
  flowCap: string;
  howH2: string;
  how: Array<{ icon: string; t: string; d: string }>;
  buildH2: string;
  uses: Array<{ icon: string; t: string; e: string }>;
  connectH2: string;
  m1Tag: string;
  m1Sub: string;
  m1Steps: string[];
  m1Note: string;
  m2Tag: string;
  m2Sub: string;
  m2Steps: string[];
  m2Note: string;
  afterH2: string;
  examples: Array<{ icon: string; t: string }>;
  newH2: string;
  newBadge: string;
  clMore: string;
  faqH2: string;
  starH2: string;
  starP: string;
  starBtn: string;
  footGuide: string;
  switchLabel: string; // name of the OTHER language, shown on the toggle
};

const T: Record<Lang, Strings> = {
  vi: {
    sub: "Cho AI dựng & sửa landing page Webcake bằng lời nói",
    running: "Server đang chạy",
    leadPre: "Bạn gõ yêu cầu, AI (Claude, Cursor…) dựng nguyên cái landing page rồi ",
    leadGrad: "lưu thẳng vào tài khoản Webcake",
    leadPost: " của bạn. Không kéo thả, không cài server — kết nối một lần là xong.",
    ctaStart: "Bắt đầu kết nối",
    ctaStar: "Star trên GitHub",
    flowH2: "Mô hình hoạt động",
    flow: [
      { icon: "bulb", t: "Bạn", s: "ý tưởng" },
      { icon: "brain", t: "Trợ lý AI", s: "Claude · Cursor" },
      { icon: "server", t: "MCP", s: "webcake-landing" },
      { icon: "window", t: "WebCake", s: "trang thật" },
    ],
    flowCap: "Bạn mô tả bằng lời → AI học mô hình thật từ MCP → MCP dựng JSON + kiểm tra → lưu thành trang thật trên WebCake. Bạn nhận link, mở editor, publish.",
    howH2: "Cách hoạt động",
    how: [
      {
        icon: "brain",
        t: "AI học mô hình thật",
        d: 'Danh mục element, <code class="inl">specials</code>, hệ toạ độ và sự kiện của Webcake — lấy trực tiếp qua các tool của server.',
      },
      {
        icon: "check2",
        t: "Server lo phần khó",
        d: "Dựng JSON nguồn, kiểm tra hợp lệ (validate) rồi lưu trang về backend Webcake — bạn khỏi đụng schema.",
      },
      {
        icon: "edit",
        t: "Bạn chỉ duyệt",
        d: "Mở trang trong editor Webcake, chỉnh vài chỗ nếu thích, lưu lại để render — xong.",
      },
    ],
    buildH2: "Bạn dựng được những gì",
    uses: [
      { icon: "magnet", t: "Trang thu lead", e: '"Trang waitlist cho SaaS — hero, 3 lợi ích, form thu email."' },
      { icon: "cart", t: "Bán hàng COD / online", e: '"Trang một sản phẩm — gallery, giá, biến thể, form đặt hàng có giỏ."' },
      { icon: "ticket", t: "Sự kiện / webinar", e: '"Trang đăng ký — đếm ngược, agenda, form đăng ký."' },
      { icon: "mail", t: "Thiệp mời", e: '"Thiệp cưới — tên, ngày, bản đồ, form RSVP."' },
      { icon: "phone", t: "Quảng bá app", e: '"Mockup điện thoại, danh sách tính năng, nút App Store + Google Play."' },
      { icon: "flame", t: "Flash sale", e: '"Đồng hồ đếm ngược to, lưới sản phẩm giảm giá, nút Mua dính."' },
    ],
    connectH2: "Kết nối — chọn 1 trong 2 cách",
    m1Tag: "Cách ① · npx — chạy trên máy bạn",
    m1Sub: "Hợp khi dùng cá nhân, muốn toàn quyền. Cần cài Node.js 18+.",
    m1Steps: [
      '<b>Cài Node.js 18+</b> nếu chưa có. Kiểm tra bằng <code class="inl">node -v</code>; chưa có thì tải ở <b>nodejs.org</b>.',
      "<b>Mở Terminal và chạy:</b><pre>npx -y webcake-landing-mcp install</pre>",
      '<b>Làm theo hỏi đáp:</b> chọn môi trường (<code class="inl">prod</code>) → đăng nhập Webcake qua trình duyệt (hoặc dán JWT) → chọn IDE (Claude Desktop / Cursor / Claude Code…).',
      '<b>Khởi động lại IDE</b> → thấy <code class="inl">webcake-landing</code> trong danh sách MCP là xong.',
    ],
    m1Note: "Muốn cấu hình mọi IDE một phát:",
    m2Tag: "Cách ② · URL remote — không cần cài gì",
    m2Sub: "Hợp khi máy không có Node.js, dùng theo nhóm, hoặc dùng claude.ai trên web.",
    m2Steps: [
      '<b>Lấy link cá nhân</b> (đã gắn sẵn token) — mở trang sau rồi bấm <b>Copy</b>:<a class="btn" href="{REMOTE}">Mở {REMOTE_HOST} {ARROW}</a>',
      '<b>Mở phần thêm connector</b> trong client:<br>• claude.ai: <i>Settings → Connectors → Add custom connector</i><br>• Cursor / Claude Code: mở file <code class="inl">.mcp.json</code>',
      '<b>Dán link</b> vừa copy (có dạng):<pre>{ENDPOINT}?jwt=&lt;TOKEN&gt;</pre>',
      "<b>Bấm Add</b> (hoặc lưu file) → đợi kết nối → xong. Icon Webcake xanh hiện lên là chạy được.",
    ],
    m2Note: "⚠️ Link chứa token cá nhân — coi như mật khẩu, đừng chia sẻ, luôn dùng HTTPS.",
    afterH2: "Sau khi kết nối, bạn nói được",
    examples: [
      { icon: "wand", t: '"Dựng landing bán khoá học, tông xanh, có form đăng ký + nút Zalo."' },
      { icon: "edit", t: '"Mở trang <i>sale-hè</i>, đổi tiêu đề thành \'Giảm 50%\', nút sang màu đỏ."' },
      { icon: "clock", t: '"Thêm section đếm ngược + 3 testimonial vào cuối trang."' },
    ],
    newH2: "Có gì mới",
    newBadge: "MỚI",
    clMore: "Xem toàn bộ changelog",
    faqH2: "Câu hỏi thường gặp",
    starH2: "Thấy hữu ích? Thả cho dự án một star",
    starP: "Đây là dự án mã nguồn mở — mỗi star là một liều động viên giữ nó phát triển và giúp người khác tìm thấy nó.",
    starBtn: "Star trên GitHub",
    footGuide: "Hướng dẫn",
    switchLabel: "English",
  },
  en: {
    sub: "Let AI build & edit Webcake landing pages from plain words",
    running: "Server is running",
    leadPre: "You type a request, AI (Claude, Cursor…) builds the whole landing page and ",
    leadGrad: "saves it straight to your Webcake account",
    leadPost: ". No drag-and-drop, no server to host — connect once and you're set.",
    ctaStart: "Get connected",
    ctaStar: "Star on GitHub",
    flowH2: "How it flows",
    flow: [
      { icon: "bulb", t: "You", s: "your idea" },
      { icon: "brain", t: "AI assistant", s: "Claude · Cursor" },
      { icon: "server", t: "MCP", s: "webcake-landing" },
      { icon: "window", t: "WebCake", s: "a real page" },
    ],
    flowCap: "You describe it in words → the AI learns the real model from the MCP → the MCP builds the JSON + validates → it's saved as a real WebCake page. You get a link, open the editor, publish.",
    howH2: "How it works",
    how: [
      {
        icon: "brain",
        t: "AI learns the real model",
        d: 'Webcake\'s element catalog, <code class="inl">specials</code>, coordinate system and events — pulled straight from this server\'s tools.',
      },
      {
        icon: "check2",
        t: "The server does the hard part",
        d: "Builds the source JSON, validates it, then saves the page to the Webcake backend — you never touch the schema.",
      },
      {
        icon: "edit",
        t: "You just review",
        d: "Open the page in the Webcake editor, tweak if you like, save to render — done.",
      },
    ],
    buildH2: "What you can build",
    uses: [
      { icon: "magnet", t: "Lead-gen page", e: '"A SaaS waitlist — hero, 3 benefits, an email-capture form."' },
      { icon: "cart", t: "COD / online store", e: '"A one-product page — gallery, price, variations, an order form with cart."' },
      { icon: "ticket", t: "Event / webinar", e: '"A registration page — countdown, agenda, sign-up form."' },
      { icon: "mail", t: "Invitation", e: '"A wedding invite — names, date, a map, an RSVP form."' },
      { icon: "phone", t: "App promo", e: '"Phone mockups, feature list, App Store + Google Play buttons."' },
      { icon: "flame", t: "Flash sale", e: '"A big countdown, a discounted product grid, a sticky Buy button."' },
    ],
    connectH2: "Connect — pick one of two ways",
    m1Tag: "Way ① · npx — runs on your machine",
    m1Sub: "Best for personal use and full control. Needs Node.js 18+.",
    m1Steps: [
      '<b>Install Node.js 18+</b> if you don\'t have it. Check with <code class="inl">node -v</code>; otherwise grab it from <b>nodejs.org</b>.',
      "<b>Open a terminal and run:</b><pre>npx -y webcake-landing-mcp install</pre>",
      '<b>Follow the prompts:</b> pick an environment (<code class="inl">prod</code>) → sign in to Webcake in the browser (or paste a JWT) → pick your IDE (Claude Desktop / Cursor / Claude Code…).',
      '<b>Restart your IDE</b> → see <code class="inl">webcake-landing</code> in the MCP list and you\'re done.',
    ],
    m1Note: "Configure every IDE at once:",
    m2Tag: "Way ② · Remote URL — nothing to install",
    m2Sub: "Best when you have no Node.js, work in a team, or use claude.ai on the web.",
    m2Steps: [
      '<b>Get your personal link</b> (token baked in) — open the page below and hit <b>Copy</b>:<a class="btn" href="{REMOTE}">Open {REMOTE_HOST} {ARROW}</a>',
      '<b>Open the add-connector area</b> in your client:<br>• claude.ai: <i>Settings → Connectors → Add custom connector</i><br>• Cursor / Claude Code: open <code class="inl">.mcp.json</code>',
      '<b>Paste the link</b> you copied (looks like):<pre>{ENDPOINT}?jwt=&lt;TOKEN&gt;</pre>',
      "<b>Hit Add</b> (or save the file) → wait for it to connect → done. A green Webcake icon means it's live.",
    ],
    m2Note: "⚠️ The link carries your personal token — treat it like a password, never share it, always use HTTPS.",
    afterH2: "Once connected, you can say",
    examples: [
      { icon: "wand", t: '"Build a landing page to sell a course, green theme, a sign-up form + a Zalo button."' },
      { icon: "edit", t: "\"Open the <i>summer-sale</i> page, change the headline to 'Save 50%', make the button red.\"" },
      { icon: "clock", t: '"Add a countdown section + 3 testimonials to the bottom of the page."' },
    ],
    newH2: "What's new",
    newBadge: "NEW",
    clMore: "See full changelog",
    faqH2: "FAQ",
    starH2: "Find it useful? Drop the project a star",
    starP: "It's an open-source project — every star keeps it moving and helps others discover it.",
    starBtn: "Star on GitHub",
    footGuide: "Docs",
    switchLabel: "Tiếng Việt",
  },
};

// The "What's new" timeline is loaded dynamically from changelog.json, which the
// build generates from CHANGELOG.md + CHANGELOG.vi.md (scripts/gen-changelog.mjs)
// and copy-assets mirrors next to this module in dist/ — same runtime-read pattern
// as the page schema. Falls back to an empty list (section hidden) if absent.
type ChangelogEntry = { v: string; d: string; type?: string; en: string; vi: string };
const CHANGELOG: ChangelogEntry[] = loadChangelog();
function loadChangelog(): ChangelogEntry[] {
  try {
    const raw = readFileSync(new URL("./changelog.json", import.meta.url), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
// English Keep-a-Changelog section names → short Vietnamese tags (en uses the raw name).
const CL_TYPE_VI: Record<string, string> = {
  Added: "Thêm mới",
  Changed: "Cải tiến",
  Fixed: "Sửa lỗi",
  Removed: "Gỡ bỏ",
  Deprecated: "Ngừng dùng",
  Security: "Bảo mật",
  Internal: "Nội bộ",
};
function clTag(type: string | undefined, lang: Lang): string {
  if (!type) return "";
  const label = lang === "vi" ? CL_TYPE_VI[type] ?? "" : type;
  return label ? ` <span class="cl-tag">${label}</span>` : "";
}

function steps(items: string[]): string {
  return items
    .map((body, i) => `<li><span class="n">${i + 1}</span><div class="body">${body}</div></li>`)
    .join("\n      ");
}

// `origin` is the public base URL (proto + host) derived from the request, so the
// shown endpoint + canonical/OG URLs match whatever domain the user is visiting.
export function guideHtml(origin: string, lang: Lang = "vi"): string {
  const L = normalizeLang(lang);
  const t = T[L];
  const m = META[L];
  const faq = FAQ[L];
  const endpoint = `${origin}/mcp`;
  const ogImage = `${origin}/og.svg`;
  const selfPath = L === "en" ? "?lang=en" : "/";
  const otherLang: Lang = L === "vi" ? "en" : "vi";
  const otherHref = otherLang === "en" ? "?lang=en" : "?lang=vi";
  const canonical = `${origin}/${L === "en" ? "?lang=en" : ""}`;
  const remoteHost = MCP_REMOTE_URL.replace("https://", "");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Webcake Landing MCP",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux",
        description: m.desc,
        url: canonical,
        image: ogImage,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: { "@type": "Organization", name: "Webcake", url: "https://webcake.io" },
        softwareHelp: DOCS_URL,
        installUrl: NPM_URL,
      },
      { "@type": "WebSite", name: "Webcake Landing MCP", url: `${origin}/`, inLanguage: L },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
  // Escape `<` so the JSON can't break out of the <script> element.
  const jsonLdScript = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  // Replace step tokens with live values.
  const fill = (s: string) =>
    s
      .replaceAll("{REMOTE}", MCP_REMOTE_URL)
      .replaceAll("{REMOTE_HOST}", remoteHost)
      .replaceAll("{ENDPOINT}", endpoint)
      .replaceAll("{ARROW}", icon("arrow"));

  return `<!doctype html>
<html lang="${L}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>(function(){try{var t=localStorage.getItem('wc-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<title>${m.title}</title>
<meta name="description" content="${m.desc}">
<meta name="keywords" content="${m.keywords}">
<meta name="author" content="Webcake">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#1DB954">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="vi" href="${origin}/">
<link rel="alternate" hreflang="en" href="${origin}/?lang=en">
<link rel="alternate" hreflang="x-default" href="${origin}/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Webcake Landing MCP">
<meta property="og:title" content="${m.title}">
<meta property="og:description" content="${m.desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${m.locale}">
<meta property="og:locale:alternate" content="${META[otherLang].locale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${m.title}">
<meta name="twitter:description" content="${m.desc}">
<meta name="twitter:image" content="${ogImage}">
<script type="application/ld+json">${jsonLdScript}</script>
<style>
  /* Light defaults. Dark applies via OS preference OR a forced [data-theme="dark"]
     (the toggle); [data-theme="light"] forces light even on a dark OS. */
  :root{--g:#1DB954;--g7:#178f43;--ink:#11231b;--mut:#5e6d65;--bg:#f5f9f7;--card:#ffffff;
    --line:rgba(16,40,30,.09);--shadow:0 1px 2px rgba(16,40,30,.05),0 6px 20px -12px rgba(16,40,30,.18);--code:#0e1714;
    --ic-fg:#178f43;--btn-hover:#178f43}
  @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#e8f0ec;--mut:#9aaba2;--bg:#0b110e;--card:#141b17;
    --line:rgba(255,255,255,.07);--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -14px rgba(0,0,0,.7);--code:#070f0b;--g7:#5ee08a;--ic-fg:#6fe79a;--btn-hover:#21c264}}
  :root[data-theme="dark"]{--ink:#e8f0ec;--mut:#9aaba2;--bg:#0b110e;--card:#141b17;
    --line:rgba(255,255,255,.07);--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -14px rgba(0,0,0,.7);--code:#070f0b;--g7:#5ee08a;--ic-fg:#6fe79a;--btn-hover:#21c264}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
    background:var(--bg);line-height:1.62;overflow-x:hidden}
  /* Subtle background tint — one faint, slow accent glow */
  .blobs{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
  .blobs b{position:absolute;border-radius:50%;filter:blur(90px);opacity:.16;will-change:transform}
  .blobs b:nth-child(1){width:560px;height:560px;right:-160px;top:-180px;background:radial-gradient(circle,#1DB954,transparent 70%);animation:drift1 40s ease-in-out infinite}
  .blobs b:nth-child(2){width:440px;height:440px;left:-160px;bottom:-160px;background:radial-gradient(circle,#16b89a,transparent 70%);animation:drift2 48s ease-in-out infinite}
  @keyframes drift1{50%{transform:translate(-50px,60px)}}
  @keyframes drift2{50%{transform:translate(40px,-50px)}}
  .wrap{max-width:900px;margin:0 auto;padding:48px 20px 72px}
  a{color:inherit}
  .i{width:1.1em;height:1.1em;flex:0 0 auto;vertical-align:-.15em}
  .glass{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);
    transition:box-shadow .2s ease,border-color .2s ease}
  header{display:flex;align-items:center;gap:14px;margin-bottom:14px}
  header .logo{width:50px;height:50px;border-radius:14px;overflow:hidden;flex:0 0 auto;
    box-shadow:0 6px 16px -4px rgba(29,185,84,.4)}
  header .logo svg{width:100%;height:100%;display:block}
  .hgrow{flex:1 1 auto;min-width:0}
  .controls{margin-left:auto;flex:0 0 auto;display:flex;align-items:center;gap:8px}
  .langsw{font-size:.82rem;font-weight:700;color:var(--g7);text-decoration:none;white-space:nowrap;
    border:1px solid var(--line);background:var(--card);padding:7px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px}
  .langsw:hover{border-color:var(--g)}
  .iconbtn{width:36px;height:36px;flex:0 0 auto;display:grid;place-items:center;cursor:pointer;color:var(--g7);
    border:1px solid var(--line);background:var(--card);border-radius:10px;transition:border-color .15s ease,color .15s ease}
  .iconbtn:hover{border-color:var(--g)}
  .iconbtn svg{width:17px;height:17px}
  h1{font-size:1.78rem;margin:0;font-weight:800;letter-spacing:-.02em}
  .sub{color:var(--mut);margin:3px 0 0;font-size:.98rem}
  .lead{font-size:1.16rem;margin:20px 0 18px;max-width:60ch}
  .lead b{color:var(--ink)}
  .grad{background:linear-gradient(95deg,#1DB954,#16b89a 60%,#37d979);-webkit-background-clip:text;background-clip:text;color:transparent;
    background-size:200% auto;animation:shim 7s linear infinite}
  @keyframes shim{to{background-position:200% center}}
  .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-size:.82rem;font-weight:600;
    color:var(--g7);background:rgba(29,185,84,.10);border:1px solid var(--line)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--g);box-shadow:0 0 0 0 rgba(29,185,84,.5);animation:pulse 2s infinite}
  @keyframes pulse{70%{box-shadow:0 0 0 7px rgba(29,185,84,0)}100%{box-shadow:0 0 0 0 rgba(29,185,84,0)}}
  h2{font-size:1.32rem;margin:46px 0 16px;font-weight:800;letter-spacing:-.01em}
  .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto;color:var(--ic-fg);
    background:rgba(29,185,84,.11);border:1px solid var(--line);transition:transform .2s ease}
  .ic .i{width:22px;height:22px}
  .grid{display:grid;gap:16px;grid-template-columns:1fr 1fr 1fr}
  @media(max-width:720px){.grid{grid-template-columns:1fr}}
  .card{padding:22px}
  .card .ic{margin-bottom:14px}
  .card h3{margin:0 0 6px;font-size:1.04rem}
  .card p{color:var(--mut);font-size:.93rem;margin:0}
  .tag{display:inline-flex;align-items:center;gap:9px;font-size:.82rem;font-weight:800;color:var(--g7);
    text-transform:uppercase;letter-spacing:.04em;flex-wrap:wrap}
  .tag .ic{width:30px;height:30px;border-radius:9px}
  .tag .ic .i{width:16px;height:16px}
  pre{margin:0;background:var(--code);color:#e8f0ec;border-radius:11px;padding:12px 14px;overflow-x:auto;
    border:1px solid rgba(255,255,255,.06);font:600 .82rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  /* Copy button injected onto every <pre> by the inline script */
  .codewrap{position:relative}
  .codewrap pre{padding-right:46px}
  .copy{position:absolute;top:8px;right:8px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;
    border:1px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.06);color:#cfe9d8;
    transition:background .15s ease,color .15s ease,border-color .15s ease}
  .copy:hover{background:rgba(255,255,255,.13);color:#fff}
  .copy svg{width:15px;height:15px}
  .copy.done{color:#5ee08a;border-color:rgba(94,224,138,.55)}
  .feat{list-style:none;padding:0;margin:0;display:grid;gap:12px}
  .feat li{display:flex;gap:13px;align-items:center;font-size:.97rem;padding:13px 16px}
  .feat li b{color:var(--ink)}
  .cta-row{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0 6px}
  /* Flow diagram: nodes connected by wires with a traveling "packet" */
  .flow{display:flex;align-items:flex-start;gap:0;padding:24px 18px 18px;overflow-x:auto}
  .flow .node{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;width:104px}
  .flow .node .ic{width:54px;height:54px;border-radius:16px}
  .flow .node .ic .i{width:27px;height:27px}
  .flow .node b{font-size:.93rem}
  .flow .node span{font-size:.75rem;color:var(--mut)}
  .flow .wire{flex:1 1 auto;min-width:30px;position:relative;height:2px;margin-top:27px;
    background:linear-gradient(90deg,var(--line),rgba(29,185,84,.45),var(--line))}
  .flow .wire .pkt{position:absolute;top:50%;left:0;width:9px;height:9px;margin:-5px 0 0 -4px;border-radius:50%;
    background:var(--g);box-shadow:0 0 9px 1px rgba(29,185,84,.7)}
  .flow .wire::after{content:"";position:absolute;right:-1px;top:50%;width:7px;height:7px;margin-top:-4px;
    border-top:2px solid var(--g7);border-right:2px solid var(--g7);transform:rotate(45deg)}
  .flow-cap{color:var(--mut);font-size:.9rem;margin:2px 2px 0;max-width:68ch}
  @media(prefers-reduced-motion:no-preference){
    .flow .wire .pkt{animation:pkt 2.4s ease-in-out infinite}
    @keyframes pkt{0%{left:0;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:100%;opacity:0}}
    .flow .node .ic{animation:nodepop 2.4s ease-in-out infinite}
  }
  @media(prefers-reduced-motion:reduce){.flow .wire .pkt{display:none}}
  @keyframes nodepop{0%,100%{box-shadow:none}50%{box-shadow:0 0 0 4px rgba(29,185,84,.12)}}
  .btn{display:inline-flex;align-items:center;gap:9px;padding:11px 19px;border-radius:11px;cursor:pointer;
    background:var(--g);color:#fff;text-decoration:none;font-weight:700;font-size:.93rem;
    box-shadow:0 4px 12px -4px rgba(29,185,84,.5);transition:transform .15s ease,background .15s ease}
  .btn .i{width:18px;height:18px}
  .btn:hover{transform:translateY(-1px);background:var(--btn-hover)}
  .btn.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);box-shadow:none}
  .btn.ghost:hover{border-color:var(--g);background:var(--card)}
  .uses{display:grid;gap:14px;grid-template-columns:1fr 1fr;padding:0;margin:0;list-style:none}
  @media(max-width:640px){.uses{grid-template-columns:1fr}}
  .uses li{display:flex;gap:13px;padding:16px 18px;align-items:flex-start;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
  .uses li:hover{transform:translateY(-3px);border-color:rgba(29,185,84,.4);box-shadow:0 10px 26px -14px rgba(16,40,30,.4)}
  .uses b{display:block;font-size:.96rem;margin-bottom:2px}
  .uses span{color:var(--mut);font-size:.88rem}
  .card{transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
  .card:hover{transform:translateY(-3px);box-shadow:0 10px 26px -14px rgba(16,40,30,.4)}
  .card:hover,.method:hover{border-color:rgba(29,185,84,.32)}
  .method{margin-bottom:16px;padding:24px}
  .method>.tag{margin-bottom:4px}
  .msub{color:var(--mut);font-size:.92rem;margin:.5rem 0 1.2rem}
  .steps{list-style:none;margin:0;padding:0;display:grid;gap:18px;position:relative}
  .steps li{display:flex;gap:14px;align-items:flex-start;position:relative}
  /* Faint connector between step numbers → reads as an intentional stepper */
  .steps li:not(:last-child)::after{content:"";position:absolute;left:13px;top:30px;bottom:-18px;width:2px;background:var(--line)}
  .steps .n{flex:0 0 auto;width:28px;height:28px;border-radius:50%;color:var(--ic-fg);
    background:rgba(29,185,84,.12);border:1px solid var(--line);
    font:800 .85rem/1 system-ui;display:flex;align-items:center;justify-content:center}
  .steps .body{flex:1;min-width:0;font-size:.95rem}
  .steps .body pre{margin-top:9px}
  /* A button inside a step drops to its own left-aligned line (inline-flex would
     sit beside the text and be shoved off-baseline by the top margin). */
  .steps .body .btn{display:flex;width:fit-content;margin-top:10px}
  code.inl{background:rgba(29,185,84,.13);color:var(--g7);padding:1px 6px;border-radius:6px;font-size:.85em;font-weight:600;
    overflow-wrap:anywhere;word-break:break-word}
  .note{font-size:.86rem;color:var(--mut);margin-top:10px}
  .note + pre,.note + .codewrap{margin-top:9px}
  .tip{margin-top:16px;background:rgba(29,185,84,.06);border:1px solid var(--line);border-radius:12px;padding:13px 15px}
  .tip .note{margin:0}
  details{padding:2px 18px;margin-bottom:11px}
  details summary{cursor:pointer;font-weight:600;padding:15px 0;list-style:none;display:flex;align-items:center;gap:10px}
  details summary::-webkit-details-marker{display:none}
  details summary::after{content:"";margin-left:auto;width:9px;height:9px;border-right:2.5px solid var(--g7);
    border-bottom:2.5px solid var(--g7);transform:rotate(45deg);transition:transform .25s ease}
  details[open] summary::after{transform:rotate(-135deg)}
  details p{color:var(--mut);font-size:.92rem;margin:0 0 16px;padding-left:0}
  .star{margin-top:48px;text-align:center;padding:38px 24px;overflow:hidden;position:relative}
  .star::before{content:"";position:absolute;inset:-40% 0 auto;height:70%;
    background:radial-gradient(closest-side,rgba(29,185,84,.10),transparent);pointer-events:none}
  .star h2{margin:0 0 6px;position:relative;display:inline-flex;align-items:center;gap:9px;justify-content:center}
  .star h2 .i{color:var(--g7)}
  .star p{color:var(--mut);max-width:48ch;margin:0 auto 18px;position:relative}
  .star .btn{position:relative}
  footer{margin-top:42px;padding:20px 22px;color:var(--mut);font-size:.86rem;
    display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  footer a{color:var(--g7);font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  footer a:hover{text-decoration:underline}
  .cl-wrap{padding:24px 26px 12px}
  .cl{position:relative;margin:0;padding:0 0 0 24px;list-style:none}
  .cl::before{content:"";position:absolute;left:6px;top:8px;bottom:14px;width:2px;
    background:linear-gradient(var(--g),rgba(29,185,84,.08))}
  .cl li{position:relative;padding:0 0 18px}
  .cl li:last-child{padding-bottom:0}
  .cl li::before{content:"";position:absolute;left:-24px;top:4px;width:12px;height:12px;border-radius:50%;
    background:var(--card);border:2.5px solid var(--g);box-sizing:border-box}
  .cl li.is-new::before{box-shadow:0 0 0 0 rgba(29,185,84,.5);animation:ring 2s infinite}
  @keyframes ring{70%{box-shadow:0 0 0 8px rgba(29,185,84,0)}100%{box-shadow:0 0 0 0 rgba(29,185,84,0)}}
  .cl .v{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:.97rem;flex-wrap:wrap}
  .cl-tag{font-size:.68rem;font-weight:700;color:var(--g7);background:rgba(29,185,84,.12);
    border:1px solid var(--line);padding:1px 8px;border-radius:999px;margin-left:8px}
  .cl .date{color:var(--mut);font-size:.79rem;margin-left:8px;font-weight:500}
  .cl .t{color:var(--mut);font-size:.91rem;margin:3px 0 0;max-width:62ch}
  .new{font-size:.64rem;font-weight:800;letter-spacing:.06em;color:#fff;background:var(--g);
    padding:2px 7px;border-radius:999px;animation:blink 1.8s ease-in-out infinite}
  @keyframes blink{50%{opacity:.55}}
  .cl-more{display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:.86rem;font-weight:600;color:var(--g7);text-decoration:none}
  .cl-more:hover{gap:9px}
  @media(max-width:640px){
    .wrap{padding:30px 15px 56px}
    /* Header: logo + controls on the top row, title drops to its own full line */
    header{flex-wrap:wrap;gap:12px}
    .hgrow{order:2;flex:1 1 100%}
    h1{font-size:1.4rem}
    h2{font-size:1.2rem;margin:34px 0 14px}
    .lead{font-size:1.05rem}
    .method{padding:18px 15px}
    .card{padding:18px}
    .tip{padding:11px 12px}
    .cl-wrap{padding:18px 16px 10px}
    .langsw{padding:6px 10px}
    .uses li,.feat li{padding:14px}
    /* Flow diagram: stack vertically (the horizontal row overflows narrow screens) */
    .flow{flex-direction:column;align-items:stretch;overflow:visible;padding:16px}
    .flow .node{flex-direction:row;width:auto;align-items:center;gap:13px;text-align:left}
    .flow .node .ic{width:44px;height:44px;border-radius:13px}
    .flow .node .ic .i{width:22px;height:22px}
    .flow .node b{font-size:.95rem}
    .flow .node span{font-size:.8rem}
    .flow .wire{flex:0 0 auto;width:2px;height:20px;min-width:0;margin:3px 0 3px 21px;
      background:linear-gradient(var(--line),var(--g))}
    .flow .wire::after{content:none}
    .flow .wire .pkt{display:none}
  }
  @media(prefers-reduced-motion:no-preference){
    @supports (animation-timeline:view()){
      .reveal{animation:rise linear both;animation-timeline:view();animation-range:entry 0% entry 32%}
      @keyframes rise{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
    }
    .hero-in{animation:rise2 .8s cubic-bezier(.2,.7,.2,1) both}
    @keyframes rise2{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
  }
</style></head>
<body>
<div class="blobs"><b></b><b></b></div>
<div class="wrap">

  <header class="hero-in">
    <span class="logo">${ICON_SVG}</span>
    <div class="hgrow">
      <h1>Webcake Landing MCP</h1>
      <p class="sub">${t.sub}</p>
    </div>
    <div class="controls">
      <button class="iconbtn" id="theme" type="button" aria-label="Toggle theme" title="Theme">${icon("moon")}</button>
      <a class="langsw" href="${otherHref}" hreflang="${otherLang}" rel="alternate">${icon("globe")} ${t.switchLabel}</a>
    </div>
  </header>

  <p class="hero-in" style="display:flex;gap:9px;flex-wrap:wrap"><span class="pill"><span class="dot"></span> ${t.running}</span>${
    CHANGELOG[0] ? `<span class="pill">v${CHANGELOG[0].v}</span>` : ""
  }</p>

  <p class="lead hero-in">${t.leadPre}<b class="grad">${t.leadGrad}</b>${t.leadPost}</p>

  <div class="cta-row hero-in">
    <a class="btn" href="#connect">${icon("rocket")} ${t.ctaStart}</a>
    <a class="btn ghost" href="${GITHUB_URL}">${icon("star")} ${t.ctaStar}</a>
  </div>

  <h2 class="reveal">${t.flowH2}</h2>
  <div class="glass flow reveal">
    ${t.flow
      .map(
        (n, i) =>
          `<div class="node"><span class="ic" style="animation-delay:${(i * 0.8).toFixed(1)}s">${icon(n.icon)}</span><b>${n.t}</b><span>${n.s}</span></div>` +
          (i < t.flow.length - 1
            ? `<div class="wire"><i class="pkt" style="animation-delay:${(i * 0.8).toFixed(1)}s"></i></div>`
            : ""),
      )
      .join("\n    ")}
  </div>
  <p class="flow-cap reveal">${t.flowCap}</p>

  <h2 class="reveal">${t.howH2}</h2>
  <div class="grid">
    ${t.how
      .map((h) => `<div class="glass card reveal">${tile(h.icon)}<h3>${h.t}</h3><p>${h.d}</p></div>`)
      .join("\n    ")}
  </div>

  <h2 class="reveal">${t.buildH2}</h2>
  <ul class="uses">
    ${t.uses
      .map((u) => `<li class="glass reveal">${tile(u.icon)}<div><b>${u.t}</b><span>${u.e}</span></div></li>`)
      .join("\n    ")}
  </ul>

  <h2 id="connect" class="reveal">${t.connectH2}</h2>

  <div class="glass card method reveal">
    <span class="tag">${tile("terminal")} ${t.m1Tag}</span>
    <p class="msub">${t.m1Sub}</p>
    <ol class="steps">
      ${steps(t.m1Steps.map(fill))}
    </ol>
    <div class="tip"><p class="note">${t.m1Note}</p><pre>${INSTALL_ALL_CMD}</pre></div>
  </div>

  <div class="glass card method reveal">
    <span class="tag">${tile("link")} ${t.m2Tag}</span>
    <p class="msub">${t.m2Sub}</p>
    <ol class="steps">
      ${steps(t.m2Steps.map(fill))}
    </ol>
    <p class="note">${t.m2Note}</p>
  </div>

  <h2 class="reveal">${t.afterH2}</h2>
  <ul class="feat">
    ${t.examples
      .map((e) => `<li class="glass reveal">${tile(e.icon)} <span>${e.t}</span></li>`)
      .join("\n    ")}
  </ul>

  ${
    CHANGELOG.length
      ? `<h2 class="reveal">${t.newH2}</h2>
  <div class="glass cl-wrap reveal">
    <ul class="cl">
      ${CHANGELOG.map(
        (c, i) =>
          `<li class="${i === 0 ? "is-new" : ""}"><span class="v">v${c.v}${
            i === 0 ? ` <span class="new">${t.newBadge}</span>` : ""
          }${clTag(c.type, L)}<span class="date">${c.d}</span></span><p class="t">${L === "en" ? c.en : c.vi}</p></li>`,
      ).join("\n      ")}
    </ul>
    <a class="cl-more" href="${GITHUB_URL}/blob/main/${L === "en" ? "CHANGELOG.md" : "CHANGELOG.vi.md"}">${t.clMore} ${icon("arrow")}</a>
  </div>`
      : ""
  }

  <h2 class="reveal">${t.faqH2}</h2>
  ${faq.map((f) => `<details class="glass reveal"><summary>${f.q}</summary><p>${f.a}</p></details>`).join("\n  ")}

  <div class="glass star reveal">
    <h2>${icon("star")} ${t.starH2}</h2>
    <p>${t.starP}</p>
    <a class="btn" href="${GITHUB_URL}">${icon("github")} ${t.starBtn}</a>
  </div>

  <footer class="glass">
    <span>Endpoint: <code class="inl">${endpoint}</code></span>
    <a href="${DOCS_URL}">${icon("book")} ${t.footGuide}</a>
    <a href="${GITHUB_URL}">${icon("github")} GitHub</a>
    <a href="${NPM_URL}">${icon("package")} npm</a>
    <a href="${selfPath === "/" ? "/health" : "/health"}">Health</a>
  </footer>

</div>
<script>
(function(){
  var COPY='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var DONE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  function copyText(t){
    if(navigator.clipboard&&navigator.clipboard.writeText){return navigator.clipboard.writeText(t);}
    return new Promise(function(res,rej){try{var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);res();}catch(e){rej(e);}});
  }
  document.querySelectorAll('pre').forEach(function(pre){
    var w=document.createElement('div');w.className='codewrap';
    pre.parentNode.insertBefore(w,pre);w.appendChild(pre);
    var b=document.createElement('button');b.type='button';b.className='copy';b.title='Copy';b.setAttribute('aria-label','Copy');b.innerHTML=COPY;
    b.addEventListener('click',function(){
      copyText(pre.innerText).then(function(){b.classList.add('done');b.innerHTML=DONE;setTimeout(function(){b.classList.remove('done');b.innerHTML=COPY;},1400);}).catch(function(){});
    });
    w.appendChild(b);
  });

  // Dark / light toggle — overrides the OS preference and persists the choice.
  var SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var html=document.documentElement, tBtn=document.getElementById('theme');
  function effective(){return html.getAttribute('data-theme')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}
  function paint(){if(tBtn)tBtn.innerHTML=effective()==='dark'?SUN:MOON;}
  paint();
  if(tBtn)tBtn.addEventListener('click',function(){var next=effective()==='dark'?'light':'dark';html.setAttribute('data-theme',next);try{localStorage.setItem('wc-theme',next);}catch(e){}paint();});
})();
</script>
</body></html>`;
}

/**
 * The social-card image served at `/og.svg` and referenced by the page's
 * `og:image` / `twitter:image`. A self-contained 1200×630 branded SVG (the size
 * social scrapers expect) — no external fonts/assets. Slack, Telegram, LinkedIn,
 * Discord render SVG OG images; a few (older Twitter/Facebook) may skip it, which
 * is acceptable for a dependency-free server.
 */
export function ogImageSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0d1411"/><stop offset="1" stop-color="#102a1c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(960 70) rotate(130) scale(620)" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1DB954" stop-opacity="0.40"/><stop offset="1" stop-color="#1DB954" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(90 96)">
    <g transform="scale(2.5)">${ICON_SVG.replace("<svg", "<svg x='0' y='0'")}</g>
    <text x="108" y="42" fill="#ffffff" font-size="40" font-weight="800" letter-spacing="-1">Webcake Landing MCP</text>
    <text x="108" y="74" fill="#7fe0a0" font-size="22" font-weight="600">Model Context Protocol · AI landing builder</text>
  </g>
  <text x="90" y="320" fill="#ffffff" font-size="64" font-weight="800" letter-spacing="-2">AI builds Webcake landing</text>
  <text x="90" y="400" fill="#ffffff" font-size="64" font-weight="800" letter-spacing="-2">pages from <tspan fill="#1DB954">one sentence</tspan>.</text>
  <text x="90" y="478" fill="#9fb1a8" font-size="30" font-weight="500">No drag-and-drop · No JSON · Saves straight to your Webcake account</text>
  <g transform="translate(90 520)">
    <rect width="290" height="56" rx="12" fill="#1DB954"/>
    <text x="145" y="36" fill="#ffffff" font-size="24" font-weight="700" text-anchor="middle">npx webcake-landing-mcp</text>
  </g>
  <text x="1110" y="560" fill="#5b6b63" font-size="24" font-weight="600" text-anchor="end">github.com/vuluu2k/webcake-landing-mcp</text>
</svg>`;
}
