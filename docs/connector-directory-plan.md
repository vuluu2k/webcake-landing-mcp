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
- [x] Tạo module [src/auth/oauth-server.ts](../src/auth/oauth-server.ts) (in-memory store clients/codes/tokens; nâng Redis sau khi >1 instance).
- [x] Scope tối thiểu `landing:read`/`landing:write` + map access-token (opaque) → `ljwt`.
- [x] `GET /authorize`: validate `client_id,redirect_uri,code_challenge(S256),state,scope`; park request; redirect user sang `/mcp-connect`; sau khi có `ljwt` → phát `code` 1 lần, redirect về `redirect_uri?code=...&state=...`.
- [x] `POST /token`: verify `code`+`code_verifier` (S256) → access-token 1h + refresh-token 30d (rotation); map token→ljwt.
- [x] `POST /register` (**Dynamic Client Registration**) → client_id (public client, PKCE).
- [x] `GET /authorize` whitelist redirect_uri theo client đã đăng ký (Claude tự gửi `https://claude.ai/api/mcp/auth_callback` khi DCR).
- [x] `POST /revoke` + hết hạn token (lazy sweep).
- [x] **(builderx_spa)** `/mcp-connect` đã cho phép redirect về host connector tin cậy (https) ngoài loopback — sửa `isLoopback`→`isAllowedRedirect` trong `src/views/McpConnect.vue`, allowlist mặc định `mcp.toolvn.io.vn` (override `VITE_MCP_ALLOWED_HOSTS`). Logic đã test (chặn evil.com / giả subdomain / http tới host prod). **CÒN LẠI: deploy builderx_spa production.**

## Phase 2 — Biến serve mode thành OAuth Protected Resource ✅ ĐÃ XONG (code)
- [x] `GET /.well-known/oauth-protected-resource` + `GET /.well-known/oauth-authorization-server` trong [src/http.ts](../src/http.ts) (`handleOAuth`).
- [x] **Resolve Bearer access-token → `x-webcake-jwt` ngay trong http.ts** (KHÔNG sửa [config.ts](../src/persistence/config.ts) — luồng cũ `x-webcake-jwt`/`?jwt=` nguyên vẹn). Bearer không khớp access-token → fallback coi như JWT thô như cũ.
- [x] Trả `401` + `WWW-Authenticate: Bearer resource_metadata=...` khi thiếu credential — **CHỈ khi bật `WEBCAKE_OAUTH=1`** (mặc định tắt để Level A không đổi hành vi).
- [x] Test end-to-end bằng script + curl (13/13 pass). MCP Inspector: tuỳ chọn xác minh thêm với client thật.

### Cách bật + test
```bash
npm run build && npm run smoke            # gate (ALL GOOD)
# OAuth BẬT SẴN mặc định — không cần cờ:
node dist/index.js serve --port 8799
# Ở tab khác — chạy bộ test flow (DCR→PKCE→authorize→callback→token→refresh→/mcp):
node scripts/oauth-smoke.mjs              # in "OAUTH OK — 13 passed"
```
- **Mặc định = OAuth BẬT**: `/mcp` không có credential nào → `401` + `WWW-Authenticate` để OAuth client (Claude/ChatGPT/Inspector) tự khởi động login. MỌI credential vẫn pass: `?jwt=` / `x-webcake-jwt` / Bearer JWT cũ / OAuth access-token.
- **Tắt** (cho ẩn danh chạy như Level A cũ): `WEBCAKE_OAUTH=0` (hoặc `false`/`no`/`off`).
- TTL: `WEBCAKE_OAUTH_ACCESS_TTL_MS` / `WEBCAKE_OAUTH_REFRESH_TTL_MS`.
- LOGIN THẬT trên **local** chạy ngay (callback `http://localhost:<port>/oauth/callback` được `/mcp-connect` cho phép vì là loopback). Trên **production** (`mcp.toolvn.io.vn`) cần sửa `/mcp-connect` (builderx_spa) cho phép redirect về `https://mcp.toolvn.io.vn/oauth/callback` (xem Phase 1 mục cuối).

## Phase 3 — Tool safety annotations ✅ ĐÃ XONG
> Directory yêu cầu mỗi tool có `title` + annotation an toàn. SDK ≥1.29 hỗ trợ.
- [x] reference (`get_generation_guide`, `list_elements`, `get_element`, `get_page_schema`) → `readOnlyHint: true`.
- [x] generation (`new_element`, `new_page_skeleton`, `validate_page`) → `readOnlyHint: true`.
- [x] media (`search_images`) → `readOnlyHint: true`.
- [x] persistence READ (`list_organizations`, `list_pages`, `find_pages`, `get_page`) → `readOnlyHint: true`.
- [x] persistence WRITE (`update_page`, `patch_page`, `publish_page`) → `destructiveHint: true`; `create_page`/`add_section` → `destructiveHint: false` (append-only) (+ `title`).
- [x] Tất cả 20 tool đã có `title` người-đọc. (Còn lại: rà soát lần cuối trước khi submit.)

## Phase 4 — Chuẩn bị hồ sơ submission  → chi tiết: [submission-packet.md](./submission-packet.md)
- [x] **Privacy policy** + **Terms** — host công khai tại `/privacy` + `/terms` ([src/legal.ts](../src/legal.ts), wired in http.ts).
- [x] Tên (`Webcake Landing`, 15 ký tự), mô tả ngắn + dài — trong [submission-packet.md](./submission-packet.md).
- [x] Mô tả luồng auth (OAuth 2.1 + PKCE + DCR) + danh sách 20 tool với annotation — trong packet.
- [x] Icon PNG 64×64 <5KB (ChatGPT) — [assets/icon-64.png](../assets/icon-64.png) (64×64 RGBA, 2.9KB). ✅
- [ ] **Test account Webcake** + sample data cho reviewer (tạo tay, không commit).
- [ ] Screenshots (3–5 ảnh — checklist trong packet).

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
