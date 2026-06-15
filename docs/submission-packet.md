# Hồ sơ submit connector — Claude Directory & ChatGPT App Directory

> Mọi field copy-paste sẵn. Phần [HƯỚNG DẪN NỘP](#hướng-dẫn-nộp) ở cuối.
> Cập nhật: 2026-06-15.

## URL công khai (đã host sẵn trên connector)
| Mục | URL |
|---|---|
| MCP endpoint | `https://mcp.toolvn.io.vn/mcp` |
| Privacy policy | `https://mcp.toolvn.io.vn/privacy` |
| Terms of service | `https://mcp.toolvn.io.vn/terms` |
| Website | `https://webcake.io` (hoặc `https://mcp.toolvn.io.vn`) |
| Icon (SVG) | `https://mcp.toolvn.io.vn/icon.svg` |
| OAuth metadata | `https://mcp.toolvn.io.vn/.well-known/oauth-protected-resource` |

## Định danh
- **Name (ChatGPT ≤30 ký tự):** `Webcake Landing` (15 ký tự)
- **Tagline / short description (≤ ~80 ký tự):**
  `Build & edit Webcake landing pages with AI.`
- **Long description:**
  > Webcake Landing lets your AI assistant design, validate, and publish complete
  > landing pages straight into your Webcake account. Describe the page you want —
  > the assistant assembles the layout, content, and images, checks it against the
  > Webcake page schema, saves it, and publishes a live preview. It can also edit
  > existing pages section-by-section, search stock photos, and import a reference
  > URL/HTML to clone a layout. You stay in control: every change targets your own
  > Webcake organization via a secure per-user login.
- **Category:** Productivity / Design / Marketing
- **Support contact:** vuluu040320@gmail.com (đổi qua env `WEBCAKE_SUPPORT_EMAIL`)

## Authentication (cho phần mô tả auth trong form)
- **Type:** OAuth 2.1 (Authorization Code + PKCE S256), Dynamic Client Registration.
- **Authorization server = the MCP host itself** (`https://mcp.toolvn.io.vn`).
- Endpoints: `/authorize`, `/token`, `/register`, `/revoke`; metadata at
  `/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource`.
- **User consent:** the flow redirects the user to Webcake login; on success the
  connector mints a short-lived access token (~1h) + refresh token (~30d) mapped to
  the user's Webcake credential. Raw Webcake tokens are never exposed to the model.
- **Claude redirect URI** (auto via DCR): `https://claude.ai/api/mcp/auth_callback`.
- Scopes: `landing:read`, `landing:write`.

## Tools (20) — tên + annotation an toàn
**Read-only (`readOnlyHint`)** — no writes:
`get_generation_guide`, `list_elements`, `get_element`, `get_page_schema`,
`new_element`, `new_page_skeleton`, `validate_page`, `search_images`,
`ingest_html`, `ingest_url`, `list_organizations`, `list_pages`, `find_pages`, `get_page`.

**Write (`destructiveHint`)** — modify the user's Webcake account:
`update_page`, `patch_page`, `publish_page` (destructive: true);
`create_page`, `add_section` (append-only, destructive: false);
`upload_images` (re-host images).

> Mọi tool ghi đều mặc định `dry_run=true` (validate + trả preview đã che JWT); chỉ ghi thật khi `dry_run=false`.

## Test account cho reviewer
- [ ] Tạo tài khoản Webcake demo + 1 organization có sẵn vài trang mẫu.
- [ ] Ghi user/pass vào ô "test credentials" của form (KHÔNG để trong repo).
- [ ] Kịch bản gợi ý cho reviewer: "Tạo một landing page bán hàng đơn giản" → connector hỏi intake → tạo → trả link preview.

## Screenshots cần chuẩn bị (3–5 ảnh)
- [ ] Màn hình OAuth consent (đăng nhập Webcake).
- [ ] Assistant đang hỏi intake + dựng trang.
- [ ] Trang landing thành phẩm (preview Webcake).
- [ ] Danh sách tool trong client.

## Icon
- Có sẵn SVG tại `/icon.svg`. **ChatGPT cần PNG 64×64 < 5KB** — export từ SVG:
  `rsvg-convert -w 64 -h 64 src/branding-icon.svg > icon-64.png` (hoặc dùng Figma/online).

---

## HƯỚNG DẪN NỘP

### Điều kiện tiên quyết (làm trước khi submit)
1. **Deploy production** `mcp.toolvn.io.vn` với code mới (OAuth) — đang chạy bản cũ thì phải redeploy.
2. **builderx_spa `/mcp-connect`** đã sửa (allowlist host connector) — chỉ cần **deploy production** bản này.
3. **Verify** end-to-end production bằng MCP Inspector (URL = `https://mcp.toolvn.io.vn/mcp`) — phải qua được OAuth.
4. Chuẩn bị test account + screenshots + PNG icon ở trên.

### A. Claude Connectors Directory
1. Đọc yêu cầu: https://claude.com/docs/connectors/building/submission
   (FAQ: https://support.claude.com/en/articles/11596036).
2. Mở form **"MCP directory submission"** (remote MCP).
3. Điền: server URL `https://mcp.toolvn.io.vn/mcp`, auth = OAuth (mô tả ở trên),
   privacy `…/privacy`, terms `…/terms`, tool list, icon, mô tả, support email, test account.
4. Submit → theo dõi email review. Nếu kẹt, escalate qua support email trong form.

### B. ChatGPT App Directory
1. Bật **Developer mode** trong ChatGPT (Settings → Connectors) và test connector của bạn trước
   (add custom connector bằng URL `https://mcp.toolvn.io.vn/mcp`).
2. Đọc guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines
   và quy trình: https://developers.openai.com/apps-sdk/deploy/submission
3. Vào platform.openai.com → mục **Apps** → submit: name `Webcake Landing` (≤30),
   PNG icon 64×64, mô tả, privacy/terms URL, OAuth config, screenshots, test account.
4. Submit → review. (Apps SDK đang beta — có thể cần thêm UI component, nhưng MCP tools thuần vẫn nộp được.)

### Sau khi được duyệt
- Cập nhật README + skill `connector-directory` đánh dấu đã lên directory.
- Theo dõi version: mỗi lần đổi tool/scope đáng kể có thể cần re-review.
