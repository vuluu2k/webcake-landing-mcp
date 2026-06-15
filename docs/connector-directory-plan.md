# Kế hoạch: đưa webcake-landing-mcp lên Directory của Claude & ChatGPT

> Plan **resumable** — đánh dấu `[x]` khi xong, để phiên sau (hoặc Claude) tiếp tục đúng chỗ.
> Kiến thức nền + quy trình: skill [`connector-directory`](../.claude/skills/connector-directory/SKILL.md).
> Cập nhật lần cuối: 2026-06-15.

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
- [x] **Phase 3 (tool safety annotations) ĐÃ XONG** — cả 20 tool đã có `title` + `readOnlyHint`/`destructiveHint`/`openWorldHint` (xem [src/tools/](../src/tools/)). Không phải làm lại.

---

## Phase 0 — Quyết định phạm vi ✅ ĐÃ CHỐT (2026-06-15)
- [x] Phạm vi: **Level B — lên directory cả Claude + ChatGPT.**
- [x] Domain production: **`mcp.toolvn.io.vn`** (host serve mode hiện tại).
- [x] Backend đã có OAuth 2.1 chưa? → **CHƯA.** `landing_page_backend` (Phoenix) chỉ có JWT HS256 (`JWT_KEY`) + login qua **PancakeID OAuth**; có bảng `api_keys` + `/api/v1/external/oauth/token` (refresh, `GATEWAY_JWT_KEY`) nhưng KHÔNG có `/authorize`/`/register`/PKCE/introspection.
- [x] `builderx_spa` (Vue + Express) login PancakeID → backend `/oauth2/pancakeid/login` → phát **`ljwt`** (landing JWT) + đã có route **`/mcp-connect`** trả `ljwt` về client (đúng cơ chế `login` của MCP).

## Phase 1 — OAuth 2.1: dựng AS MỎNG ngay trong MCP server (KHÔNG sửa Elixir)
> **Hướng đã chọn = (b) lớp AS mỏng đứng trước login hiện có**, vì:
> dựng full OAuth AS trong `landing_page_backend` tốn ~8–13 ngày Elixir; còn MCP repo (Node) ta tự kiểm soát,
> và `builderx_spa` đã có `/mcp-connect` trả `ljwt`. Nên MCP host **tự làm Authorization Server**: bọc login
> PancakeID/ljwt sẵn có, rồi tự mint access-token riêng map về `ljwt`. Toàn bộ code nằm trong repo này
> ([src/http.ts](../src/http.ts) + module oauth mới) — không đụng backend.
>
> Luồng: Claude/ChatGPT → `/authorize` (PKCE) → redirect user sang builderx_spa login (PancakeID) → lấy `ljwt`
> qua cơ chế `/mcp-connect` → MCP phát `code` → `/token` đổi `code`+`code_verifier` → access-token (ngắn hạn,
> opaque/JWT) lưu map → `ljwt`. Resource server (chính MCP) validate access-token → resolve ra `ljwt`.
- [ ] Tạo module `src/auth/oauth-server.ts` (in-memory store cho clients/codes/tokens; có thể nâng lên Redis sau).
- [ ] Định nghĩa scope tối thiểu (vd `landing:read`, `landing:write`) + map access-token → `ljwt`/identity.
- [ ] `GET /authorize`: nhận `client_id,redirect_uri,code_challenge(S256),state,scope`; redirect user sang builderx_spa login; sau khi có `ljwt` → phát `code` 1 lần, redirect về `redirect_uri?code=...&state=...`.
- [ ] `POST /token`: verify `code`+`code_verifier` (S256) → mint access-token (ngắn hạn) + refresh-token; lưu map token→ljwt.
- [ ] `POST /register` (**Dynamic Client Registration**) để Claude/ChatGPT tự đăng ký client_id.
- [ ] Whitelist redirect URI Claude: `https://claude.ai/api/mcp/auth_callback` (+ ChatGPT khi submit).
- [ ] Revoke + hết hạn token theo user (refresh rotation).
- [ ] (Phối hợp builderx_spa) đảm bảo `/mcp-connect` trả `ljwt` được cho redirect server-to-server (không chỉ loopback localhost) — đây là điểm DUY NHẤT có thể cần sửa ngoài repo này.

## Phase 2 — Biến serve mode thành OAuth Protected Resource
- [ ] Host `GET /.well-known/oauth-protected-resource` (trỏ tới AS ở Phase 1) trong [src/http.ts](../src/http.ts).
- [ ] (Nếu cần) `GET /.well-known/oauth-authorization-server` metadata.
- [ ] **Validate Bearer access-token** ở [src/persistence/config.ts](../src/persistence/config.ts) `configFromHeaders`: thay vì coi Bearer là JWT thô, verify access-token (chữ ký/introspection) rồi resolve ra Webcake JWT của user. Giữ nhánh `x-webcake-jwt`/`?jwt=` cho Level A để không phá tương thích.
- [ ] Trả `401` + header `WWW-Authenticate: Bearer resource_metadata=...` khi thiếu/sai token (để client khởi động OAuth).
- [ ] Test luồng OAuth end-to-end bằng `mcp-remote` hoặc MCP Inspector trước khi đụng tới Claude/ChatGPT.

## Phase 3 — Tool safety annotations ✅ ĐÃ XONG
> Directory yêu cầu mỗi tool có `title` + annotation an toàn. SDK ≥1.29 hỗ trợ.
- [x] reference (`get_generation_guide`, `list_elements`, `get_element`, `get_page_schema`) → `readOnlyHint: true`.
- [x] generation (`new_element`, `new_page_skeleton`, `validate_page`) → `readOnlyHint: true`.
- [x] media (`search_images`) → `readOnlyHint: true`.
- [x] persistence READ (`list_organizations`, `list_pages`, `find_pages`, `get_page`) → `readOnlyHint: true`.
- [x] persistence WRITE (`update_page`, `patch_page`, `publish_page`) → `destructiveHint: true`; `create_page`/`add_section` → `destructiveHint: false` (append-only) (+ `title`).
- [x] Tất cả 20 tool đã có `title` người-đọc. (Còn lại: rà soát lần cuối trước khi submit.)

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
- [x] Webcake backend có sẵn OAuth chưa? → CHƯA → chọn hướng (b): AS mỏng trong MCP server.
- [x] Domain chính thức cho connector production? → `mcp.toolvn.io.vn`.
- [ ] Access-token: opaque (lookup map trong store) hay JWT tự ký (HS/RS256)? → khuyến nghị opaque + store để revoke dễ.
- [ ] Store cho clients/codes/tokens: in-memory (1 instance) hay Redis (nếu scale nhiều instance)?
- [ ] `ljwt` sống 365 ngày — access-token MCP nên ngắn hơn nhiều (vd 1h) + refresh; có cần map refresh→re-login không?
- [ ] Có cần UI components (ChatGPT Apps SDK) hay chỉ MCP tools thuần? → mặc định MCP tools thuần.

## Cách resume nhanh
1. Mở file này, tìm dòng `[~]`/`[ ]` đầu tiên chưa xong.
2. Đọc skill [`connector-directory`](../.claude/skills/connector-directory/SKILL.md) để nhớ context.
3. Bám 2 seam code: serve = [src/http.ts](../src/http.ts), auth = [src/persistence/config.ts](../src/persistence/config.ts) `configFromHeaders`.
4. Mọi thay đổi `src/` → `npm run build && npm run smoke` (phải `ALL GOOD`).
