# 🍰 WebCake Landing MCP

[English](./README.md) · **Tiếng Việt**

> **Mô tả landing page bằng lời nói — AI tự dựng, tự kiểm tra và đẩy thẳng lên WebCake.**

> *"Dựng cho tôi một landing page quán cà phê — một hero có nút đăng ký, một mục 3 tính năng, và một form thu lead. Lưu vào workspace của tôi."*

…và một trang WebCake **thật, sửa được** hiện ra trong tài khoản của bạn. Không kéo-thả từng khối, không cần học schema, không phải tự viết JSON.

---

## 🧩 Mô hình hoạt động

Server này là **cầu nối** giữa trợ lý AI và WebCake. AI không *đoán* trang WebCake trông thế nào —
nó hỏi MCP (vốn nắm trọn mô hình element), kiểm tra hợp lệ, rồi lưu giúp bạn.

```text
   Bạn             Trợ lý AI              webcake-landing MCP            WebCake
  ┌──────┐  yêu cầu┌────────────┐  tools  ┌──────────────────────┐  API  ┌──────────┐
  │ ý    │ ───────►│  Claude /  │ ──────► │ • nắm mô hình element│ ────► │  trang   │
  │ tưởng│         │  Cursor /  │         │   + gợi ý cho AI     │       │  thật,   │
  │      │ ◄───────│  Windsurf  │ ◄────── │ • dựng + kiểm tra    │ ◄──── │  sửa được│
  └──────┘ link    └────────────┘ kết quả │ • lưu vào tài khoản  │       │  trên    │
           trang                          └──────────────────────┘       │  WebCake │
                                                                         └──────────┘
```

1. **Bạn yêu cầu** bằng lời — mục tiêu, thương hiệu, các section, nút CTA, trường form.
2. **AI học mô hình** từ MCP: danh mục element, canvas toạ độ tuyệt đối, bộ sự kiện — nên nó dựng trang WebCake *thật*, không phải đoán.
3. **Dựng + kiểm tra** trọn JSON `{ page, popup, settings, options }`. `validate_page` bắt lỗi (element lệch khung, CTA trỏ sai, thiếu trường form) **trước khi** lưu.
4. **Lưu** vào tài khoản WebCake — xem trước dry-run, rồi mới lưu thật.
5. **Nhận link editor** — mở, chỉnh, publish. AI lo phần nặng.

### Vì sao đáng tin

| | |
|---|---|
| 📚 **Nắm đúng mô hình** | Cung cấp danh mục element thật của WebCake (40+ loại — hero, form, đếm ngược, gallery, danh sách sản phẩm…), mỗi loại kèm `specials` chính xác và gợi ý cho AI, rút thẳng từ renderer của editor. |
| ✅ **Kiểm tra trước khi lưu** | Kiểm tra cấu trúc + ngữ nghĩa (id duy nhất, layout trong khung, CTA hoạt động, trường form không trùng) để trang không hỏng khi lưu. |
| 🛡️ **An toàn mặc định** | Mọi thao tác ghi đều **dry-run trước** (xem trước request, token được che) — không đụng tài khoản của bạn cho tới khi bạn xác nhận. |
| ✏️ **Sửa đúng chỗ** | Yêu cầu một thay đổi ("đổi nút CTA sang xanh") thì nó chỉ sửa *đúng* element đó — mọi id, toạ độ, khối khác giữ nguyên. |

> 💡 **Thu lead, sự kiện, thiệp mời, quảng bá app** — hay **bán hàng COD/online**? Nó hiểu cả mô hình thương mại của WebCake (danh sách sản phẩm, biến thể, giỏ hàng).

---

## Bản chất kỹ thuật

Server MCP (Model Context Protocol) dạy AI cách dựng trọn **JSON nguồn (page_source) của landing page WebCake**
từ một yêu cầu — và lưu nó về backend WebCake.

Nó expose danh mục element, gợi ý dùng từng element + `specials`, JSON Schema đầy đủ của trang, skeleton
element/trang hợp lệ, bộ kiểm tra trang, và các tool để tạo/sửa trang trên backend. AI dựng trọn JSON
`{ page, popup, settings, options, cartConfigs }`; `create_page` lưu nó (chỉ-source — trang mở trong editor,
lưu lại sẽ render).

## Các cách setup (chọn một)

| # | Cách | Hợp cho | Auth | Xem |
|---|------|---------|------|-----|
| 1 | **Local stdio** — gắn vào IDE (Claude Desktop / Cursor / …) qua `npx` hoặc file build | Dùng hằng ngày trên máy | env `WEBCAKE_JWT`, hoặc `login`, hoặc không cần (tool tham chiếu) | [Cấu hình IDE](#cấu-hình-theo-ide--công-cụ-ai) |
| 2 | **`login`** — tự lấy token qua browser (khỏi copy-paste) | Khỏi dán token tay (stdio / remote 1 người) | session browser → file `auth.json` | [Kết nối một lần](#kết-nối-một-lần--tự-lấy-token-login) |
| 3 | **Remote HTTP (`serve`)** — chạy như HTTP server, test bằng MCP Inspector / `mcp-remote` / curl | Thử transport remote ở local | header `x-webcake-jwt` mỗi request, hoặc env | [Remote](#chạy-như-remote-connector-streamable-http) |
| 4 | **VPS + claude.ai connector** — deploy HTTPS public, thêm làm custom connector | Chia sẻ 1 server hosted | single-account (token env); per-user cần OAuth (chưa có) | [Deploy lên VPS](#deploy-lên-vps) |

Hai **dạng chạy** áp dụng cho mọi cách: **`npx -y webcake-landing-mcp …`** (không clone, tự cập nhật) hoặc **`node /abs/path/dist/index.js …`** (bản đã clone & build — chạy `npm run build` trước). Cấu hình IDE bên dưới dùng dạng local; đổi `command`/`args` sang dạng npx để dùng CDN.

Các **tool tham chiếu + generation** (`get_generation_guide`, `list_elements`, `validate_page`, …) chạy **zero config**; chỉ **tool lưu trữ** (`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`) mới cần token. Token ưu tiên theo thứ tự: **header mỗi request → biến env → file `auth.json`** (`login`).

## Cài nhanh (Khuyến nghị)

Chạy script tự cài — lo trọn gói: clone, cài dependencies, build, và cấu hình IDE của bạn.

### macOS / Linux

Nếu bạn đã clone repo:
```bash
./install.sh
```

Hoặc tải & chạy trực tiếp:
```bash
curl -fsSL https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.sh -o install.sh && bash install.sh
```

Trình cài tương tác: hỏi nơi cài (mặc định `~/.webcake-landing-mcp`), hỏi các biến môi trường
(`WEBCAKE_API_BASE`, `WEBCAKE_JWT`, `WEBCAKE_ORG_ID` — đều tuỳ chọn, Enter để bỏ qua), rồi cho bạn chọn
IDE cần cấu hình: `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment`, `codex`, hoặc tất cả.

Gỡ cài (xoá entry MCP server khỏi mọi IDE đã cấu hình):
```bash
./install.sh --uninstall
```

### Windows (PowerShell)

Nếu bạn đã clone repo:
```powershell
.\install.ps1
```

Hoặc tải & chạy trực tiếp:
```powershell
irm https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.ps1 -OutFile install.ps1; .\install.ps1
```

Gỡ cài:
```powershell
.\install.ps1 --uninstall
```

---

## Cập nhật

Cập nhật lên bản mới nhất:

```bash
cd ~/.webcake-landing-mcp   # hoặc nơi bạn đã cài
git pull
npm install
npm run build
```

Rồi khởi động lại IDE.

---

## Chạy không cần clone (npx)

Sau khi đã publish lên npm, server chạy thẳng từ registry — không clone, không build:

```bash
npx -y webcake-landing-mcp
```

Hoặc chạy bản mới nhất từ GitHub (npx tự clone + build qua script `prepare`):

```bash
npx -y github:vuluu2k/webcake-landing-mcp
```

### Tự cấu hình IDE (lệnh con `install`)

`npx` chỉ **chạy** server — khác với `install.sh`/`install.ps1`, nó không ghi cấu hình MCP vào IDE.
Lệnh con `install` đi kèm sẽ làm hộ bạn bước đó, không cần clone:

```bash
# Tương tác — hỏi env + chọn IDE từng bước
npx -y webcake-landing-mcp install

# Không tương tác — cấu hình mọi IDE hỗ trợ cùng lúc
npx -y webcake-landing-mcp install --ide all --jwt <your-jwt> --api-base http://localhost:5800

# Chỉ một IDE
npx -y webcake-landing-mcp install --ide cursor --jwt <your-jwt>

# Gỡ server khỏi mọi cấu hình IDE
npx -y webcake-landing-mcp uninstall
```

Nó ghi entry `webcake-landing` (dùng dạng khởi chạy `npx` bên dưới) vào đúng file cấu hình của từng IDE:
`claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment` (VS Code), `codex`, hoặc `all`. Cờ:
`--ide`, `--api-base`, `--jwt`, `--org-id`, `--host`, `--app-base`, `--npx`/`--local`, `-y`. Chạy
`npx -y webcake-landing-mcp --help` để xem đầy đủ.

### Cấu hình thủ công

Cấu hình MCP giống bản local, chỉ khác `command`/`args` trỏ tới `npx` thay vì file đã build:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

> npx cache lại package sau lần chạy đầu, nên các lần sau khởi động nhanh. Dùng phiên bản ghim
> (`webcake-landing-mcp@1.0.0`) nếu cần build tái lập được.

## Chạy như remote connector (Streamable HTTP)

Server còn nói được transport **remote MCP** (Streamable HTTP), nên có thể thêm qua dialog
**"Add custom connector"** của Claude bằng một URL — không chỉ stdio local.

Chạy chế độ HTTP (port mặc định `8787`, hoặc đặt `PORT` / `--port`):

```bash
npx -y webcake-landing-mcp serve --port 8787
# → endpoint MCP tại http://localhost:8787/mcp   (GET / hoặc /health trả JSON trạng thái)
```

Đưa ra **HTTPS** ở URL public (reverse proxy, tunnel như `ngrok http 8787`, hoặc host bất kỳ), rồi vào
Claude → **Add custom connector**:

- **Name**: `webcake-landing`
- **Remote MCP server URL**: `https://<host-của-bạn>/mcp`

Dialog không có ô header, nên muốn truyền token qua đó thì **để vào URL**:
`https://<host-của-bạn>/mcp?jwt=<ljwt>` (nhận thêm `&api_base=…`, `&org_id=…`, `&host=…`, `&app_base=…`).
Mỗi người một URL với `jwt` riêng → **per-user mà không cần OAuth**. Header `x-webcake-jwt` thật vẫn ưu tiên
hơn query. ⚠️ Token nằm trong URL có thể lọt vào access/proxy log — **bắt buộc HTTPS** và tắt log query ở
reverse proxy; dùng header (hoặc OAuth) an toàn hơn nếu client hỗ trợ.

### Auth — mỗi request, đa người dùng (không token chung)

Ở stdio JWT lấy từ env. Ở chế độ HTTP, mỗi request mang credential **riêng** của người gọi qua header,
nên server hosted là đa người dùng và không nhúng secret chung:

| Header | Tương ứng | Ghi chú |
|--------|-----------|---------|
| `x-webcake-jwt` (hoặc `Authorization: Bearer <jwt>`) | `WEBCAKE_JWT` | token tài khoản — gửi mỗi request |
| `x-webcake-org-id` | `WEBCAKE_ORG_ID` | org mặc định |
| `x-webcake-api-base` | `WEBCAKE_API_BASE` | thường set 1 lần qua env trên host |
| `x-webcake-app-base` | `WEBCAKE_APP_BASE` | base URL editor/preview |

Header nào thiếu thì fallback về biến env tương ứng — nên cũng chạy **một người dùng** được bằng cách đặt
`WEBCAKE_API_BASE` + `WEBCAKE_JWT` trong env của host và giữ URL riêng tư.

> ⚠️ Tool tham chiếu + generation (`get_generation_guide`, `list_elements`, `validate_page`, …) không cần
> secret; chỉ tool lưu trữ (`create_page`, `update_page`, …) dùng JWT. Request không có JWT thì các tool đó
> trả `missing_env` chứ không gọi mạng.
>
> Lưu ý: dialog claude.ai **không có ô header** (chỉ có OAuth, mà server này **chưa làm**). Hai cách lách:
> để token vào URL dạng `?jwt=<ljwt>` (như trên — per-user, nhưng token lộ trong log), hoặc dùng client hỗ trợ
> header (`mcp-remote --header …`, bên dưới). Đặt token ở env server thì thành **single-account** chung cho mọi người trên URL đó.

### Test ở local (không cần URL public)

`localhost` không dùng được trong dialog claude.ai (Anthropic gọi URL từ server của họ). Để thử server `serve`
chạy trên máy:

- **MCP Inspector** (GUI — dễ nhất): `npx @modelcontextprotocol/inspector` → Transport **Streamable HTTP** →
  URL `http://localhost:8787/mcp` → mục Headers thêm `x-webcake-jwt` (+ `x-webcake-api-base`) → Connect → bấm gọi tool.
- **`mcp-remote`** (dùng server remote từ client stdio như Claude Desktop, kèm header):
  ```json
  { "mcpServers": { "webcake-remote": { "command": "npx",
    "args": ["-y", "mcp-remote", "http://localhost:8787/mcp",
             "--header", "x-webcake-jwt:<ljwt>",
             "--header", "x-webcake-api-base:https://api.webcake.io"] } } }
  ```
- **curl**: `initialize` (đọc header `mcp-session-id` trả về) → `tools/list` → `tools/call`, tất cả kèm
  `Accept: application/json, text/event-stream`.

### Deploy lên VPS

1. **Build + chạy như service** — `/etc/systemd/system/webcake-mcp.service`:
   ```ini
   [Service]
   WorkingDirectory=/opt/webcake-landing-mcp
   ExecStart=/usr/bin/node dist/index.js serve --port 8787
   Environment=WEBCAKE_API_BASE=https://api.webcake.io
   Environment=WEBCAKE_JWT=<ljwt>          # chỉ cho single-account — xem ghi chú auth dưới
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   `sudo systemctl enable --now webcake-mcp` (build 1 lần: `npm install && npm run build`).
2. **HTTPS + domain** (claude.ai bắt buộc https) — vd Caddy tự cấp TLS, `/etc/caddy/Caddyfile`:
   ```
   mcp.yourdomain.com { reverse_proxy localhost:8787 }
   ```
3. **Thêm vào claude.ai** → Remote MCP server URL = `https://mcp.yourdomain.com/mcp`.

**Auth trên server chia sẻ:**
- **Single-account** (dùng được với dialog ngay): đặt `WEBCAKE_JWT` ở env service → mọi người dùng connector
  chung 1 tài khoản Webcake. Giữ URL riêng tư / có cổng chặn; token hết hạn (~90 ngày).
- **Per-user** (mỗi người 1 account): cho mỗi người một URL với `?jwt=<ljwt>` riêng (chạy được qua dialog,
  nhưng token lộ trong log), hoặc dùng client hỗ trợ header (`mcp-remote --header …`), hoặc thêm **OAuth**
  (chưa làm) cho gọn nhất.

## Cài thủ công (local)

```bash
git clone https://github.com/vuluu2k/webcake-landing-mcp.git
cd webcake-landing-mcp
npm install        # postinstall `prepare` tự build dist/
npm run build      # (re)build: tsc -> dist/ + copy src/**/*.json (page-schema.json) vào dist/
npm run smoke      # self-test offline của factory + validator (in "ALL GOOD")
```

Các tool tham chiếu/kiểm tra chạy với **zero config**. Biến môi trường chỉ cần cho các tool lưu trữ
(`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`).

## Kết nối một lần — tự lấy token (`login`)

Thay vì copy JWT bằng tay, chạy:

```bash
# Production — zero config (mặc định: connect qua webcake.io, API qua api.webcake.io):
npx -y webcake-landing-mcp login

# Local dev — trỏ vào SPA (5173) + API (5800) ở máy:
node dist/index.js login \
  --connect-url http://localhost:5173/mcp-connect \
  --api-base http://localhost:5800
```

Nó mở browser → (đăng nhập Webcake nếu cần) → token được lưu vào
`~/.webcake-landing-mcp/auth.json`, server tự đọc.

Bạn đang đăng nhập Webcake sẵn trong browser, nên `login` chỉ mở trang "connect" của Webcake — trang này
đọc cookie **`ljwt`** (landing) và trả token về một callback loopback nội bộ — khỏi copy-paste. Token đã lưu
được dùng bởi **cả** server stdio lẫn deploy `serve` một-người-dùng (env vẫn ưu tiên). Landing JWT sống ~90
ngày nên hiếm khi phải kết nối lại.

Hai URL, đừng nhầm:

- **Trang connect = SPA** (`--connect-url` / `WEBCAKE_CONNECT_URL`): `https://webcake.io/mcp-connect` ở prod,
  `http://localhost:5173/mcp-connect` ở local. Nếu không, suy ra từ `WEBCAKE_APP_BASE` + `/mcp-connect`,
  mặc định `https://webcake.io/mcp-connect`.
- **API base = backend** (`--api-base` / `WEBCAKE_API_BASE`): `https://api.webcake.io` ở prod,
  `http://localhost:5800` ở local. Mặc định `https://api.webcake.io`.

Cờ khác: `--org-id`, `--port`, `--no-open`. Thư mục file lưu: `WEBCAKE_CONFIG_DIR` (mặc định
`~/.webcake-landing-mcp`).

**Endpoint cần thêm ở backend** (trong Webcake backend — nơi giữ cookie session):

```
GET /mcp-connect?redirect_uri=<loopback>&state=<s>
   → đọc cookie `ljwt` (landing token của user đang đăng nhập)
   → 302 tới  <redirect_uri>?token=<ljwt>&state=<s>
   (nếu chưa có cookie: 302 sang trang login trước, xong quay lại đây)
```

Để an toàn, chỉ chấp nhận `redirect_uri` ở `http://127.0.0.1:*` / `http://localhost:*`.
(Mẫu tham khảo: `builderx_spa/src/views/McpConnect.vue` đọc `cookies.get('ljwt')` — nên flow này làm hẳn ở
SPA cũng được, khỏi cần route backend.)

> Remote đa người dùng (dialog claude.ai) không làm được browser loopback này — ở đó mỗi user gửi token riêng
> qua header `x-webcake-jwt` (xem mục remote-connector ở trên).

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|----------|----------|-------------|
| `WEBCAKE_API_BASE` | Không* | Base URL backend, ví dụ `http://localhost:5800`. Cần để lưu trang. |
| `WEBCAKE_JWT` | Không* | JWT tài khoản (auth dashboard). Cần để lưu trang — sẽ hết hạn, làm mới khi cần. |
| `WEBCAKE_ORG_ID` | Không | Organization mặc định cho `create_page` (bị ghi đè bởi tham số `organization_id`). Bỏ trống → trang cá nhân. |
| `WEBCAKE_HOST` | Không | Header `Host` tuỳ chọn (Phoenix route theo host, ví dụ `builder.localhost`). |
| `WEBCAKE_APP_BASE` | Không | Base tuỳ chọn để dựng URL editor/preview trong kết quả. |
| `WEBCAKE_CONNECT_URL` | Không | Trang "connect" (SPA) cho `login` (mặc định `https://webcake.io/mcp-connect`; nếu không thì `WEBCAKE_APP_BASE` + `/mcp-connect`). |
| `WEBCAKE_CONFIG_DIR` | Không | Thư mục chứa `auth.json` do `login` ghi (mặc định `~/.webcake-landing-mcp`). |

> \* `WEBCAKE_API_BASE` và `WEBCAKE_JWT` chỉ cần cho các tool lưu trữ. Các tool tham chiếu và kiểm tra
> (`get_generation_guide`, `list_elements`, `get_element`, `validate_page`, …) chạy không cần chúng.

> Lưu trang sẽ ghi một trang thật vào nơi `WEBCAKE_API_BASE` trỏ tới, dùng JWT làm tài khoản đó.
> Hãy bắt đầu với local/staging.

### Cách lấy `WEBCAKE_JWT`

1. Mở dashboard builder WebCake và đăng nhập
2. Mở DevTools (`F12` hoặc `Cmd + Option + I`)
3. Vào tab **Network** > click một trang bất kỳ
4. Tìm một request API (ví dụ `@me`, `organizations`…)
5. Trong **Request Headers**, copy giá trị sau `Authorization: Bearer ` → đó là `WEBCAKE_JWT`
6. Dùng tool `list_organizations` để liệt kê org và chọn `WEBCAKE_ORG_ID`

---

## Cấu hình theo IDE / công cụ AI

> Thay `/absolute-path/webcake-landing-mcp/dist/index.js` bên dưới bằng đường dẫn thật nơi bạn đã
> clone/build repo. Ví dụ: `/Users/username/webcake-landing-mcp/dist/index.js`.
> Chạy `npm run build` trước để `dist/` tồn tại.

### 1. Claude Desktop

Mở Settings > Developer > Edit Config, hoặc sửa file trực tiếp:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>",
        "WEBCAKE_HOST": "builder.localhost",
        "WEBCAKE_APP_BASE": "http://builder.localhost:5800"
      }
    }
  }
}
```

Khởi động lại Claude Desktop. Các tool MCP sẽ hiện trong ô chat (biểu tượng búa).

---

### 2. Claude Code (CLI)

Chạy trong terminal — bản **local**:

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -e WEBCAKE_HOST=builder.localhost \
  -- node /absolute-path/webcake-landing-mcp/dist/index.js
```

Hoặc **CDN / npx** (không clone):

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -- npx -y webcake-landing-mcp
```

Hoặc tạo `.claude.json` ở thư mục gốc dự án (hoặc `~/.claude.json` toàn cục):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Kiểm tra:
```bash
claude mcp list
```

---

### 3. Cursor

Tạo `.cursor/mcp.json` ở gốc dự án (hoặc `~/.cursor/mcp.json` toàn cục):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại Cursor và xem Settings > MCP Servers để thấy trạng thái **"Connected"**.

---

### 4. Windsurf

Tạo `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại Windsurf. Gõ `@` trong chat Cascade để thấy các tool `webcake-landing`.

---

### 5. Augment (Extension VS Code)

Mở Command Palette: `Cmd + Shift + P` > **"Augment: Edit MCP Settings"**, rồi thêm:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại VS Code.

---

### 6. Codex (OpenAI CLI)

Thêm vào `~/.codex/config.toml`:

```toml
[mcp_servers.webcake-landing]
command = "node"
args = ["/absolute-path/webcake-landing-mcp/dist/index.js"]
env = { "WEBCAKE_API_BASE" = "http://localhost:5800", "WEBCAKE_JWT" = "<your-jwt>" }
```

Kiểm tra:
```bash
codex mcp list
```

---

## Ví dụ sử dụng

### Ví dụ 1: Dựng landing page mới từ một brief

**Prompt:**
```
Dựng cho tôi một landing page WebCake cho "Acme Coffee" — một hero có CTA, một mục 3 tính năng,
và một form đăng ký. Lưu vào org mặc định của tôi.
```

**AI sẽ tự động:**

**Bước 1** — Gọi `get_generation_guide` để học quy ước (canvas, hệ toạ độ, sự kiện, workflow)

**Bước 2** — Gọi `new_page_skeleton` để có source top-level rỗng, rồi `get_element` cho từng loại element nó dùng:

```
get_element({ type: "section" })
get_element({ type: "text-block" })
get_element({ type: "button" })
get_element({ type: "form" })
```

**Bước 3** — Lắp trọn JSON `{ page, popup, settings, options, cartConfigs }`, rồi kiểm tra:

```
validate_page({ source })
→ { ok: false, errors: ["BUTTON-2: event target 'POPUP-9' not found"] }   # sửa hết lỗi, validate lại
validate_page({ source })
→ { ok: true, errors: [] }
```

**Bước 4** — Lưu (dry-run trước, rồi mới thật):

```
list_organizations({})                          → chọn org
create_page({ source })                         → xem trước dry-run (JWT được che)
create_page({ source, dry_run: false })         → { page_id, editor_url, preview_url }
```

Mở trang trong editor và lưu lại để render `app`/`app_css`.

---

### Ví dụ 2: Sửa một trang có sẵn

**Prompt:**
```
Trên landing page "Acme Coffee" của tôi, đổi headline hero thành "Freshly Roasted Daily"
và làm nút CTA màu xanh lá.
```

**AI sửa đúng chỗ — không bao giờ dựng lại cả cây:**

```
# Bước 1: tìm trang
list_pages({})
→ [{ id: "page_42", name: "Acme Coffee", organization_id: "org_1", ... }]

# Bước 2: lấy cây source đã decode
get_page({ page_id: "page_42" })

# Bước 3: chỉ đổi text headline + màu nút, giữ mọi id/toạ độ khác,
#         rồi validate và ghi lại
validate_page({ source })                       → ok
update_page({ page_id: "page_42", source })     → xem trước dry-run
update_page({ page_id: "page_42", source, dry_run: false })
```

---

### Ví dụ 3: Xem chi tiết một loại element trước khi dùng

**Prompt:**
```
Một element form cần những specials gì, và cho tôi xem một ví dụ hợp lệ.
```

**AI gọi:**

```
get_element({ type: "form" })
→ {
    hints: "Mỗi input cần một specials.field_name duy nhất…",
    specials: { ... },
    skeleton: { ... },     # node mặc định hợp lệ về cấu trúc
    example: { ... }       # ví dụ đã điền, thực tế
  }
```

---

## Hướng dẫn dùng tool chi tiết

Các tool chia thành ba nhóm: **tham chiếu** (học mô hình — không cần config),
**generation** (dựng node hợp lệ), và **lưu trữ** (ghi về backend — cần biến môi trường).

### Bước 1: Đọc guide trước — `get_generation_guide`

Luôn gọi cái này **đầu tiên**. Nó trả về hình dạng output, hệ toạ độ (desktop ≈ 960px,
mobile ≈ 420px), bộ từ vựng sự kiện, và workflow đầu-cuối.

```
get_generation_guide({})
→ "## Output shape… ## Canvas… ## Events… ## Workflow…"
```

### Bước 2: Duyệt danh mục element — `list_elements` / `get_element`

```
# Mọi loại element theo nhóm (tóm tắt + khi nào dùng + có phải container?)
list_elements({})
→ { categories: { layout: [...], content: [...], form: [...], ... } }

# Xem sâu một loại — hints, specials chính, skeleton mặc định, ví dụ đã điền
get_element({ type: "button" })
```

### Bước 3: Lấy khối dựng hợp lệ — `new_element` / `new_page_skeleton`

```
# Một node mặc định hợp lệ về cấu trúc cho một loại (id mới)
new_element({ type: "section" })

# Một source top-level rỗng nhưng đầy đủ
new_page_skeleton({})
→ { page: [], popup: [], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }
```

### Bước 4: Xem / kiểm tra — `get_page_schema` / `validate_page`

```
# JSON Schema đầy đủ (Draft 2020-12) của một page source
get_page_schema({})

# Kiểm tra cấu trúc + ngữ nghĩa — sửa hết lỗi trước khi lưu
validate_page({ source })
→ { ok: false, errors: [...], warnings: [...] }
```

`validate_page` **errors là chặn**; warnings (event target lửng lơ, thiếu `field_name`) chỉ là khuyến cáo.

### Bước 5: Lưu — `list_organizations` / `create_page` / `update_page`

```
# Liệt kê các organization của tài khoản — hỏi dùng cái nào; mặc định = org is_default
list_organizations({})
→ [{ id: "org_1", name: "Acme", is_default: true }, ...]

# Tạo trang MỚI (chỉ-source). Mặc định dry_run=true.
create_page({ source, organization_id: "org_1" })       # xem trước
create_page({ source, dry_run: false })                  # tạo thật

# Sửa một trang CÓ SẴN
list_pages({})                                           # tìm trang
get_page({ page_id })                                    # lấy source đã decode
update_page({ page_id, source, dry_run: false })         # ghi đè (mặc định dry_run=true)
```

`create_page` gọi **`POST {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source`** trên backend.
Cả `create_page` và `update_page` đều **mặc định `dry_run=true`** (kiểm tra và trả về request nó *sẽ*
gửi, JWT được che); đặt `dry_run=false` để ghi thật. Kết quả trả về `page_id` + URL editor/preview.

---

## Prompt gợi ý

> Dựng cho tôi một landing page WebCake cho &lt;thương hiệu/ưu đãi&gt;. Dùng MCP webcake-landing:
> gọi `get_generation_guide`, `new_page_skeleton`, rồi `get_element` cho từng loại element bạn dùng,
> lắp JSON `{ page, popup, settings, options }`, `validate_page` đến khi 0 lỗi,
> rồi `create_page` (dry-run trước).

---

## Danh sách tool

### Tham chiếu (không cần config)
| Tool | Mô tả |
|------|-------------|
| `get_generation_guide` | **Đọc ĐẦU TIÊN.** Hình dạng output, hệ toạ độ, bộ sự kiện, workflow. |
| `list_elements` | Mọi loại element theo nhóm (tóm tắt + khi nào dùng + container?). |
| `get_element` | Một loại: hints, `specials` chính, skeleton mặc định, ví dụ đã điền. |
| `get_page_schema` | JSON Schema đầy đủ (Draft 2020-12) của một page source. |

### Generation
| Tool | Mô tả |
|------|-------------|
| `new_element` | Một node mặc định hợp lệ về cấu trúc cho một loại (id mới). |
| `new_page_skeleton` | Một source top-level rỗng nhưng đầy đủ `{ page, popup, settings, options, cartConfigs }`. |
| `validate_page` | Kiểm tra cấu trúc + ngữ nghĩa (ids, event targets, containers, `field_name`). |

### Lưu trữ (cần `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Mô tả |
|------|-------------|
| `list_organizations` | Liệt kê organization của tài khoản (id, name, is_default). Mặc định = org `is_default`. |
| `create_page` | Lưu một source đã sinh thành trang mới (chỉ-source). **Mặc định `dry_run=true`.** |
| `list_pages` | Liệt kê các trang của tài khoản (id, name, organization_id, updated_at) để chọn cái cần sửa. |
| `get_page` | Lấy cây source đã decode của một trang có sẵn để sửa. |
| `update_page` | Ghi đè source của một trang có sẵn bằng cây đã sửa. **Mặc định `dry_run=true`.** |

---

## Ghi chú về mô hình

- **Canvas toạ độ tuyệt đối:** mỗi phần tử con mang `top/left/width/height` dạng số theo từng breakpoint;
  section xếp dọc và tự giữ `height`. Nội dung nằm trong `specials` (`text`, `src`, …), không bao giờ trong `styles`.
- **Source top-level:** `{ page: [sections], popup: [popups], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }`.
  Popup là một mảng top-level **riêng**, không lồng trong `page`.
- Animation theo breakpoint nằm trong `config.animation = { name, delay, duration, repeat }`.
- Màu dạng `rgba()`; `top/left/width/height/fontSize` là số (px); input form cần một `specials.field_name` duy nhất.

Tham khảo: [docs/page-element-schema.md](docs/page-element-schema.md),
[docs/element-specials-reference.md](docs/element-specials-reference.md) (tham chiếu đầy đủ mọi specials/event),
và [src/domains/landing/page-schema.json](src/domains/landing/page-schema.json) (JSON Schema, Draft 2020-12). Schema phản ánh đúng
hình dạng `page_source` thật của editor.
