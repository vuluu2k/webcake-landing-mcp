# Hồ sơ submission — Webcake Landing

> Cập nhật cho OpenAI Plugins: 2026-10-15. Gói hiện là **bản chuẩn bị**, chưa đủ điều kiện gửi duyệt.
> Nguồn: `plugins/webcake-landing/`; tạo ZIP bằng `npm run pack:plugin`.
> Xem [bằng chứng và các phần còn thiếu](plugin-review.md), [hướng dẫn quay demo](plugin-demo.md).
> Phần Claude bên dưới được giữ lại làm tham khảo riêng, không phải luồng nộp OpenAI.

## URL công khai (đã host sẵn trên connector)
| Mục | URL |
|---|---|
| MCP endpoint | `https://mcp.toolvn.io.vn/mcp` |
| Privacy policy | `https://mcp.toolvn.io.vn/privacy` |
| Terms of service | `https://mcp.toolvn.io.vn/terms` |
| Website | `https://webcake.io` (hoặc `https://mcp.toolvn.io.vn`) |
| Support (OpenAI) | `https://github.com/vuluu2k/webcake-landing-mcp/issues` |
| Icon (SVG) | `https://mcp.toolvn.io.vn/icon.svg` |
| OAuth metadata | `https://mcp.toolvn.io.vn/.well-known/oauth-protected-resource` |

## Định danh
- **Name (ChatGPT ≤30 ký tự):** `Webcake Landing` (15 ký tự)
- **Tagline / short description (OpenAI ≤30 ký tự):**
  `Build Webcake landing pages` (27 ký tự)
- **Publisher đã được người dùng xác nhận:** `Vũ Lưu`, cá nhân. Chưa xác minh trạng thái identity verification trên OpenAI.
- **Phạm vi quốc gia:** tất cả quốc gia khả dụng (`publication.countries: []`), người dùng xác nhận.
- **Commerce:** không có thanh toán/mua hàng trong plugin (`review.commerce: false`), người dùng xác nhận. Không suy ra Webcake là dịch vụ miễn phí.
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

## Tools (23) — tên + annotation
**Read-only (`readOnlyHint`)** — no writes:
`get_generation_guide`, `list_elements`, `get_element`, `get_page_schema`,
`new_element`, `new_page_skeleton`, `validate_page`, `layout`, `search_images`, `get_icon_svg`,
`render_preview`, `ingest_html`, `ingest_url`, `list_organizations`, `list_pages`,
`find_pages`, `get_page`.

**Write (`destructiveHint`)** — modify the user's Webcake account:
`update_page`, `patch_page`, `publish_page` (destructive: true);
`create_page`, `add_section` (append-only, destructive: false);
`upload_images` (re-host images).

> Các tool ghi trang mặc định `dry_run=true`; chỉ ghi thật khi `dry_run=false` sau khi xác nhận.
> `upload_images` ghi ngay vào CDN/media collection, không có tham số dry run; cần được phép upload trước khi gọi.
> Source hiện khai báo đủ boolean `readOnlyHint`, `destructiveHint`, `openWorldHint` cho mọi tool; cần deploy và scan để portal thấy bản mới.

## Test account cho reviewer
- [ ] Tạo tài khoản Webcake demo + 1 organization có sẵn vài trang mẫu.
- [ ] Ghi user/pass vào ô "test credentials" của form (KHÔNG để trong repo).
- [ ] Kịch bản gợi ý cho reviewer: "Tạo một landing page bán hàng đơn giản" → connector hỏi intake → tạo → trả link preview.

## Video và bằng chứng OpenAI
- [ ] Quay tương tác thật trong ChatGPT với tài khoản demo; xem [walkthrough](plugin-demo.md).
- [ ] Host video cho reviewer xem được, kiểm tra playback và ghi URL thật vào manifest.
- [ ] Chạy 5 positive + 3 negative cases trong manifest, ghi kết quả và bằng chứng.
- Plugin hiện không có UI nhúng riêng; không khai báo screenshot UI giả. Video có thể quay chat và preview Webcake thực tế.

## Icon
- SVG công khai: `/icon.svg`.
- **Listing:** [PNG 512×512](../assets/icon-512.png), đóng gói tại `assets/icon-512.png`.
- **Composer:** [PNG 64×64](../assets/icon-64.png), đóng gói tại `assets/icon-64.png`.
- Dùng icon sẵn có; người dùng không yêu cầu thêm icon nền tối hay màu thương hiệu.

---

## HƯỚNG DẪN NỘP

### Điều kiện tiên quyết (làm trước khi submit)
1. **Deploy production** `mcp.toolvn.io.vn` với code mới (OAuth). Đã có sẵn [deploy/coolify/Dockerfile](../deploy/coolify/Dockerfile) + [deploy/coolify/docker-compose.yml](../deploy/coolify/docker-compose.yml) (env OAuth set sẵn, build context = repo root). Trên Coolify: New Resource → Docker Compose → trỏ repo → **Base Directory = `/`**, **Docker Compose Location = `/deploy/coolify/docker-compose.yml`** → set domain `mcp.toolvn.io.vn` (port 8787) + điền secret `PEXELS_API_KEY` trong Environment UI → Deploy. (Đã build + run thử local: healthy, /mcp trả 401 đúng.)
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

### B. OpenAI Plugin Directory — ChatGPT và Codex

Chuẩn bị theo thứ tự: listing → demo/tài khoản reviewer → ZIP cuối → portal.

1. Kiểm tra [gói nguồn](../plugins/webcake-landing/plugin.json): tên `Webcake Landing`, publisher `Vũ Lưu`, subtitle 27/30, đủ 4 URL, logo PNG, 5 positive + 3 negative cases, commerce false, tất cả quốc gia khả dụng. Chọn category `Productivity` tương ứng trong portal.
2. Hoàn tất [các phần còn thiếu](plugin-review.md), nhất là video thực, tài khoản demo và kiểm thử OAuth bằng tài khoản thật. Không đưa credentials vào ZIP, commit, hay chat.
3. Ghi URL video đã kiểm tra vào `extensions.com.openai.review.demo_recording_url`, tăng version nếu đã từng upload, chạy `npm run pack:plugin`. Kiểm tra lại ZIP cuối, không chỉ thư mục nguồn.
4. Mở [OpenAI Plugins](https://platform.openai.com/plugins) bằng organization/project đúng. Hoàn tất individual verification cho danh tính `Vũ Lưu`; cần owner hoặc quyền Apps Management Write.
5. Chọn upload plugin ZIP có MCP. Đây là bản nháp, chưa gửi duyệt. Không tạo bản private bằng Plugin Creator để thay cho public submission.
6. Trong MCPs: dùng HTTPS endpoint có sẵn trong `mcp.json`, auth OAuth, client registration DCR, scopes `landing:read landing:write`. Không dùng `?jwt=` hoặc custom token headers trong public package. OAuth discovery cung cấp các endpoint.
7. Hoàn tất domain verification bằng đúng token/URL challenge portal cấp. Không tự tạo token hoặc thay token của plugin khác. Kết nối tài khoản demo, scan server và xử lý findings.
8. Kiểm tra metadata đã import: publisher, 4 URL, icons, 5/3 cases, video, release notes, countries, commerce. Điền reviewer credentials và login/workspace instructions chỉ vào trường bảo mật trong portal.
9. Chạy lại cases trên phiên bản đã lưu. Người có thẩm quyền tự hoàn tất policy/legal attestations và chọn **Submit for review** khi mọi điều kiện đã đủ.
10. Sau khi được duyệt, chọn **Publish plugin**. Upload, submit, approval và publish là các trạng thái khác nhau; chưa có trạng thái nào được thực hiện bởi gói local này.

Tài liệu chính thức:
- [Package format](https://developers.openai.com/plugins/build/plugins)
- [Submission và field reference](https://developers.openai.com/plugins/deploy/submission)
- [Authentication](https://developers.openai.com/plugins/build/auth)
- [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)

### Sau khi được duyệt
- Cập nhật README + skill `connector-directory` đánh dấu đã lên directory.
- Theo dõi version: mỗi lần đổi tool/scope đáng kể có thể cần re-review.
