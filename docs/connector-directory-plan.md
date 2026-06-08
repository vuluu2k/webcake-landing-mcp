# Kế hoạch: đưa webcake-landing-mcp lên Directory của Claude & ChatGPT

> Plan **resumable** — đánh dấu `[x]` khi xong, để phiên sau (hoặc Claude) tiếp tục đúng chỗ.
> Kiến thức nền + quy trình: skill [`connector-directory`](../.claude/skills/connector-directory/SKILL.md).
> Cập nhật lần cuối: 2026-06-08.

Trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong · `[-]` bỏ qua/không cần.

---

## Mục tiêu
Để webcake-landing-mcp **xuất hiện trong danh sách connector/app built-in** của Claude và ChatGPT (Level B), không chỉ add-by-URL thủ công (Level A). Khối việc chắn đường: **OAuth 2.1**.

## Đã có sẵn (không phải làm lại)
- [x] npm `webcake-landing-mcp` publish qua CI `auto-release.yml`.
- [x] MCP Registry: `io.github.vuluu2k/webcake-landing-mcp` (xem [`server.json`](../server.json)).
- [x] Remote MCP `serve` mode: [src/http.ts](../src/http.ts) phục vụ `/mcp` (Streamable HTTP, stateful sessions), host công khai `https://mcp.toolvn.io.vn/mcp`.
- [x] Multi-user qua JWT tĩnh: [src/persistence/config.ts](../src/persistence/config.ts) `configFromHeaders` (`Authorization: Bearer` / `x-webcake-jwt` / `?jwt=`).
- [x] Icon + OG + favicon đã phục vụ trong serve mode.

---

## Phase 0 — Quyết định phạm vi
- [ ] Chốt: chỉ cần **Level A** (add-by-URL, xong rồi) hay làm **Level B** (lên directory)?
- [ ] Nếu Level B: nhắm **Claude trước**, **ChatGPT trước**, hay **cả hai**? (Claude bắt buộc OAuth; ChatGPT linh hoạt hơn nhưng nên có OAuth.)
- [ ] Xác nhận host production ổn định + domain cố định cho submission (`mcp.toolvn.io.vn` hay domain khác?).

## Phase 1 — OAuth 2.1 Authorization Server (khối lớn nhất)
> Cần một Authorization Server (AS) để user đăng nhập Webcake và nhận token. 2 hướng:
> **(a)** Webcake backend tự expose OAuth endpoints; **(b)** dựng lớp AS mỏng đứng trước Webcake login.
- [ ] **Quyết định (a) vs (b).** Hỏi team backend Webcake xem có sẵn `/authorize` + `/token` + introspection không (`landing_page_backend`).
- [ ] Định nghĩa scope (vd `pages:read`, `pages:write`) và cách map access-token → Webcake JWT/identity.
- [ ] Endpoint `authorize`: redirect tới Webcake login, lấy consent, trả `code` (PKCE S256 bắt buộc).
- [ ] Endpoint `token`: đổi `code` + `code_verifier` → access-token (ngắn hạn) + refresh-token.
- [ ] **Dynamic Client Registration (DCR)** `POST /register` (hoặc CIMD) để Claude/ChatGPT tự đăng ký client.
- [ ] Đăng ký redirect URI của Claude: `https://claude.ai/api/mcp/auth_callback` (và của ChatGPT khi submit).
- [ ] Lưu trữ token/refresh + cách thu hồi (revoke) theo user.

## Phase 2 — Biến serve mode thành OAuth Protected Resource
- [ ] Host `GET /.well-known/oauth-protected-resource` (trỏ tới AS ở Phase 1) trong [src/http.ts](../src/http.ts).
- [ ] (Nếu cần) `GET /.well-known/oauth-authorization-server` metadata.
- [ ] **Validate Bearer access-token** ở [src/persistence/config.ts](../src/persistence/config.ts) `configFromHeaders`: thay vì coi Bearer là JWT thô, verify access-token (chữ ký/introspection) rồi resolve ra Webcake JWT của user. Giữ nhánh `x-webcake-jwt`/`?jwt=` cho Level A để không phá tương thích.
- [ ] Trả `401` + header `WWW-Authenticate: Bearer resource_metadata=...` khi thiếu/sai token (để client khởi động OAuth).
- [ ] Test luồng OAuth end-to-end bằng `mcp-remote` hoặc MCP Inspector trước khi đụng tới Claude/ChatGPT.

## Phase 3 — Tool safety annotations
> Directory yêu cầu mỗi tool có `title` + annotation an toàn. SDK ≥1.29 hỗ trợ.
- [ ] reference (`get_generation_guide`, `list_elements`, `get_element`, `get_page_schema`) → `readOnlyHint: true`.
- [ ] generation (`new_element`, `new_page_skeleton`, `validate_page`) → `readOnlyHint: true`.
- [ ] media (`search_images`) → `readOnlyHint: true`.
- [ ] persistence READ (`list_organizations`, `list_pages`, `get_page`) → `readOnlyHint: true`.
- [ ] persistence WRITE (`create_page`, `update_page`, `add_section`) → `destructiveHint: true` (+ `title`).
- [ ] Thêm `title` người-đọc cho cả 14 tool. Sửa trong [src/tools/](../src/tools/), chạy `npm run build && npm run smoke`.

## Phase 4 — Chuẩn bị hồ sơ submission
- [ ] Icon (ChatGPT: 64×64 px, <5KB) — đã có asset trong [src/branding.ts](../src/branding.ts)/`src/og.png`, export đúng kích cỡ.
- [ ] Tên (ChatGPT ≤30 ký tự), mô tả ngắn + dài.
- [ ] **Privacy policy** + **Terms** (URL công khai).
- [ ] **Test account Webcake** + sample data cho reviewer.
- [ ] Screenshots, website đã verify, support contact (email).
- [ ] Mô tả luồng auth + danh sách tool cho reviewer.

## Phase 5 — Nộp Claude Connectors Directory
- [ ] Đọc lại requirements: https://claude.com/docs/connectors/building/submission
- [ ] Điền form "MCP directory submission" (server URL, auth, tool list, assets).
- [ ] Nộp → theo dõi review (escalate qua email nếu kẹt).

## Phase 6 — Nộp ChatGPT App Directory
- [ ] Bật Developer mode, test connector trong ChatGPT trước.
- [ ] platform.openai.com → Apps submission (https://developers.openai.com/apps-sdk/deploy/submission).
- [ ] Đảm bảo tuân thủ App Submission Guidelines → nộp → review.

---

## Quyết định còn mở (điền khi biết)
- [ ] Webcake backend có sẵn OAuth chưa? (quyết định Phase 1 (a)/(b))
- [ ] Access-token: tự ký JWT của mình hay introspection về Webcake?
- [ ] Domain chính thức cho connector production?
- [ ] Có cần UI components (ChatGPT Apps SDK) hay chỉ MCP tools thuần?

## Cách resume nhanh
1. Mở file này, tìm dòng `[~]`/`[ ]` đầu tiên chưa xong.
2. Đọc skill [`connector-directory`](../.claude/skills/connector-directory/SKILL.md) để nhớ context.
3. Bám 2 seam code: serve = [src/http.ts](../src/http.ts), auth = [src/persistence/config.ts](../src/persistence/config.ts) `configFromHeaders`.
4. Mọi thay đổi `src/` → `npm run build && npm run smoke` (phải `ALL GOOD`).
