# <img src="docs/assets/webcake-icon.svg" alt="Webcake" width="26" height="26" align="absmiddle"> WebCake Landing MCP

[English](./README.md) · **Tiếng Việt**

[![npm version](https://img.shields.io/npm/v/webcake-landing-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/webcake-landing-mcp)
[![npm downloads](https://img.shields.io/npm/dm/webcake-landing-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/webcake-landing-mcp)
[![GitHub stars](https://img.shields.io/github/stars/vuluu2k/webcake-landing-mcp?style=social)](https://github.com/vuluu2k/webcake-landing-mcp/stargazers)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-6E56CF)](https://modelcontextprotocol.io)

> **Mô tả landing page bằng lời nói — AI tự dựng, tự kiểm tra và đẩy thẳng lên WebCake.**

> ⭐ **Nếu nó giúp bạn đỡ cả buổi kéo-thả từng khối, [thả cho mình một star](https://github.com/vuluu2k/webcake-landing-mcp) nhé — dự án một-mình-làm, mỗi star là một liều động viên giữ nó sống.**

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

## ✨ Bạn dựng được những gì

Một câu nói cho AI → một trang WebCake hoàn chỉnh, **sửa được**. Vài thứ người ta dựng bằng nó:

| | Chỉ cần nói… |
|---|---|
| 🧲 **Trang thu lead** | *"Trang waitlist cho SaaS — hero, 3 lợi ích, form thu email."* |
| 🛒 **Bán hàng COD / online** | *"Trang một sản phẩm cho serum dưỡng da — gallery, giá, biến thể, form đặt hàng có giỏ."* |
| 🎟️ **Sự kiện / webinar** | *"Trang đăng ký cho webinar tối thứ Bảy — đếm ngược, agenda, form đăng ký."* |
| 💌 **Thiệp mời** | *"Thiệp cưới — tên, ngày, bản đồ, form RSVP."* |
| 📱 **Quảng bá app** | *"Trang cho app gym — mockup điện thoại, danh sách tính năng, nút App Store + Google Play."* |
| ⚡ **Flash sale** | *"Trang flash-sale — đồng hồ đếm ngược to, lưới sản phẩm giảm giá, nút Mua dính (sticky)."* |
| 🔗 **Link-in-bio** | *"Link-in-bio cho profile creator — avatar, bio ngắn, 5 nút link, mạng xã hội."* |
| 🎉 **Ra mắt sản phẩm** | *"Trang ra mắt bản v2 — hero, danh sách điểm mới, form đăng ký dùng sớm."* |

…rồi **"đổi nút CTA sang xanh"** hay **"thêm tính năng thứ 4"** thì nó chỉ sửa *đúng* khối đó — mọi id và toạ độ khác giữ nguyên vị trí.

> 🤖 Chạy được trong **Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex**, hay bất kỳ client hỗ trợ MCP nào — và **tool tham chiếu + generation không cần cấu hình gì**, nên bạn thử được trước cả khi dán token.

---

## Bản chất kỹ thuật

Server MCP (Model Context Protocol) dạy AI cách dựng trọn **JSON nguồn (page_source) của landing page WebCake**
từ một yêu cầu — và lưu nó về backend WebCake.

Nó expose danh mục element, gợi ý dùng từng element + `specials`, JSON Schema đầy đủ của trang, skeleton
element/trang hợp lệ, bộ kiểm tra trang, và các tool để tạo/sửa trang trên backend. AI dựng trọn JSON
`{ page, popup, settings, options, cartConfigs }`; `create_page` lưu nó (chỉ-source — trang mở trong editor,
lưu lại sẽ render).

## Hai cách chạy

| Cách | Hợp cho | Auth |
|------|---------|------|
| **npx (local)** — chạy trên máy bạn | Dùng cá nhân hằng ngày, toàn quyền | browser `login`, JWT, hoặc không cần (tool tham chiếu) |
| **URL đã host sẵn** — dùng server tụi mình, không cài gì | Máy không có Node.js, dùng nhóm, dialog claude.ai | link `?jwt=` cá nhân / header `x-webcake-jwt` |

Các **tool tham chiếu + generation** (`get_generation_guide`, `list_elements`, `validate_page`, …) chạy **zero config**; chỉ **tool lưu trữ** (`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`) mới cần token. Token ưu tiên theo thứ tự: **header mỗi request → biến env → file `auth.json`** (`login`).

> 🛠️ Cần script cài (install.sh/.ps1), build từ clone, hay cấu hình IDE thủ công? Xem **[docs/manual-install.vi.md](docs/manual-install.vi.md)**.

## 🚀 Kết nối — 2 cách chính

Chọn **một** trong hai. Cả hai đều đưa toàn bộ bộ công cụ dựng landing Webcake vào AI của bạn (Claude, Cursor, …). Không cần code.

### ① `npx` — chạy ngay trên máy bạn (nên dùng cho cá nhân)

Không cần cài đặt, luôn bản mới nhất. **Một dòng** vừa lấy token vừa ghi cấu hình IDE:

```bash
npx -y webcake-landing-mcp install
```

Chỉ muốn chạy server (tự cấu hình sau)?

```bash
npx -y webcake-landing-mcp
```

✅ Hợp cho: dùng cá nhân hằng ngày, dev local, toàn quyền kiểm soát. Cần Node.js 18+.

### ② URL remote `…/mcp?jwt=` — đã host sẵn, không cần cài gì

Dùng server tụi mình đã host. Lấy **link cá nhân của bạn** (token gắn sẵn trong link) rồi dán vào ô *Add custom connector* / file cấu hình của client:

```
https://mcp.toolvn.io.vn/mcp?jwt=<TOKEN_CỦA_BẠN>
```

Hai cách lấy link:
- **Dễ nhất** — mở **<https://webcake.io/mcp-remote>** trong dashboard Webcake → nó tự tạo & copy link cho bạn.
- **Thủ công** — xem hướng dẫn từng bước bên dưới.

Có thể thêm tham số: `&env=prod`, `&org_id=…`, `&api_base=…`.

✅ Hợp cho: máy không có Node.js, dùng nhóm/chia sẻ, và **dialog connector của claude.ai** (chỉ nhập URL, không có header).
⚠️ Link chứa token cá nhân — coi như mật khẩu, luôn dùng **HTTPS**.

> 📖 **Hướng dẫn cấu hình thủ công đầy đủ cho mọi IDE** (Claude Desktop, Claude Code, Cursor, Windsurf, claude.ai…)
> ở file riêng → **[docs/ket-noi-mcp.md](docs/ket-noi-mcp.md)** · English: **[docs/connect-mcp.md](docs/connect-mcp.md)**.

## Cài đặt (npx)

Sau khi đã publish lên npm, server chạy thẳng từ registry — không clone, không build:

```bash
npx -y webcake-landing-mcp
```

Hoặc chạy bản mới nhất từ GitHub (npx tự clone + build qua script `prepare`):

```bash
npx -y github:vuluu2k/webcake-landing-mcp
```

### Tự cấu hình IDE (lệnh con `install`)

`npx` chỉ **chạy** server — khác với [script cài đặt](docs/manual-install.vi.md), nó không ghi cấu hình MCP vào IDE.
Lệnh con `install` đi kèm sẽ làm hộ bạn bước đó, không cần clone:

```bash
# Tương tác — chọn môi trường, đăng nhập qua trình duyệt (hoặc dán JWT), chọn IDE
npx -y webcake-landing-mcp install

# Không tương tác — cấu hình mọi IDE hỗ trợ cùng lúc (env + token qua cờ)
npx -y webcake-landing-mcp install --ide all --env prod --jwt <your-jwt>

# Local dev — trỏ vào stack local của bạn (localhost:5800 / :5173)
npx -y webcake-landing-mcp install --ide cursor --env local --jwt <your-jwt>

# Gỡ server khỏi mọi cấu hình IDE
npx -y webcake-landing-mcp uninstall
```

Nó ghi entry `webcake-landing` (dùng dạng khởi chạy `npx` bên dưới) vào đúng file cấu hình của từng IDE:
`claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment` (VS Code), `codex`, hoặc `all`. Khi tương
tác, nó hỏi **môi trường** (`local`/`staging`/`prod` — mặc định `prod`, dùng để đặt API + app URL) và cho
chọn **đăng nhập qua trình duyệt hay dán JWT**. Cờ: `--ide`, `--env`, `--jwt`, `--org-id`,
`--api-base`/`--app-base` (ghi đè nâng cao), `--npx`/`--local`, `-y`. Chạy
`npx -y webcake-landing-mcp install --help` để xem đầy đủ.

### Cấu hình thủ công

Cấu hình MCP giống bản local, chỉ khác `command`/`args` trỏ tới `npx` thay vì file đã build:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_ENV": "prod",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

> npx cache lại package sau lần chạy đầu, nên các lần sau khởi động nhanh. Dùng phiên bản ghim
> (`webcake-landing-mcp@1.0.0`) nếu cần build tái lập được.

## Dùng server đã host sẵn — không cần cài gì

Server **đã chạy sẵn** tại **`https://mcp.toolvn.io.vn/mcp`** — tụi mình lo hết. Không phải dựng server,
không phải giữ máy luôn bật. Chỉ cần trỏ AI của bạn vào URL là xong.

**Lấy link cá nhân** (token gắn sẵn) cách dễ nhất → mở **<https://webcake.io/mcp-remote>** rồi bấm **Copy**:

```
https://mcp.toolvn.io.vn/mcp?jwt=<TOKEN_CỦA_BẠN>
```

Tham số thêm: `&env=prod`, `&org_id=…`, `&api_base=…`. Mỗi đồng đội một link với `jwt` riêng → mỗi người một
tài khoản, không cần OAuth. ⚠️ Link chứa token cá nhân — coi như mật khẩu, luôn dùng **HTTPS**.

### Gửi token qua header (an toàn hơn)

Client nào set được header thì nên gửi token qua header thay vì nhét vào URL (token không lọt vào log).
Header nào thiếu sẽ fallback về biến env tương ứng:

| Header | Tương ứng | Ghi chú |
|--------|-----------|---------|
| `x-webcake-jwt` (hoặc `Authorization: Bearer <jwt>`) | `WEBCAKE_JWT` | token tài khoản — gửi mỗi request |
| `x-webcake-env` | `WEBCAKE_ENV` | môi trường có tên (`local`/`staging`/`prod`) |
| `x-webcake-org-id` | `WEBCAKE_ORG_ID` | org mặc định |
| `x-webcake-api-base` | `WEBCAKE_API_BASE` | ghi đè API base của preset |
| `x-webcake-app-base` | `WEBCAKE_APP_BASE` | ghi đè SPA base của preset (trang connect khi `login`) |
| `x-webcake-builder-base` | `WEBCAKE_BUILDER_BASE` | ghi đè host builder dùng cho link editor/preview |

> Tool tham chiếu + generation (`get_generation_guide`, `list_elements`, `validate_page`, …) **không cần
> token** — chỉ tool lưu trữ (`create_page`, `update_page`, …) mới dùng. Không có JWT thì các tool đó trả
> `missing_env` chứ không gọi mạng.

> 📖 **Hướng dẫn từng bước cho mọi IDE** (Claude Desktop, Claude Code, Cursor, Windsurf, claude.ai) →
> **[docs/ket-noi-mcp.md](docs/ket-noi-mcp.md)** · English: **[docs/connect-mcp.md](docs/connect-mcp.md)**.

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
sẽ được tự đọc (env vẫn ưu tiên). Landing JWT sống ~90 ngày nên hiếm khi phải kết nối lại.

Hai URL, đừng nhầm:

- **Trang connect = SPA** (`--connect-url`): suy ra từ app base của `--env` + `/mcp-connect`
  (`https://webcake.io/mcp-connect` ở prod, `http://localhost:5173/mcp-connect` ở local). Ghi đè bằng `--connect-url`.
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
> qua header `x-webcake-jwt` (xem mục server đã host sẵn ở trên).

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|----------|----------|-------------|
| `WEBCAKE_ENV` | Không | Môi trường có tên: `local` \| `staging` \| `prod`. Điền sẵn `WEBCAKE_API_BASE` + `WEBCAKE_APP_BASE` từ preset (xem bảng bên dưới). Cũng đặt được qua cờ `--env <name>`. Biến tường minh sẽ thắng. |
| `WEBCAKE_API_BASE` | Không* | Base URL backend, ví dụ `http://localhost:5800`. Cần để lưu trang (hoặc đặt `WEBCAKE_ENV`). |
| `WEBCAKE_JWT` | Không* | JWT tài khoản (auth dashboard). Cần để lưu trang — sẽ hết hạn, làm mới khi cần. |
| `WEBCAKE_ORG_ID` | Không | Organization mặc định cho `create_page` (bị ghi đè bởi tham số `organization_id`). Bỏ trống → trang cá nhân. |
| `WEBCAKE_APP_BASE` | Không | SPA base tuỳ chọn — dùng cho trang connect khi `login` qua trình duyệt. |
| `WEBCAKE_BUILDER_BASE` | Không | Host builder tuỳ chọn cho link editor/preview trong kết quả. Mặc định lấy theo preset môi trường, nếu không thì suy ra từ host API (`api.x`→`builder.x`). |
| `WEBCAKE_CONFIG_DIR` | Không | Thư mục chứa `auth.json` do `login` ghi (mặc định `~/.webcake-landing-mcp`). |

> \* `WEBCAKE_API_BASE` và `WEBCAKE_JWT` chỉ cần cho các tool lưu trữ. Các tool tham chiếu và kiểm tra
> (`get_generation_guide`, `list_elements`, `get_element`, `validate_page`, …) chạy không cần chúng.

> Lưu trang sẽ ghi một trang thật vào nơi `WEBCAKE_API_BASE` trỏ tới, dùng JWT làm tài khoản đó.
> Hãy bắt đầu với local/staging.

### Môi trường (`--env` / `WEBCAKE_ENV`)

Thay vì đặt thủ công cả hai base URL, hãy chọn một môi trường có tên — một nguồn sự thật duy nhất
cho API + app base (mặc định là `prod`):

| `--env` / `WEBCAKE_ENV` | API base (`WEBCAKE_API_BASE`) | App base (`WEBCAKE_APP_BASE`) | Builder base (`WEBCAKE_BUILDER_BASE`) |
|-------------------------|-------------------------------|-------------------------------|----------------------------------------|
| `local` | `http://localhost:5800` | `http://localhost:5173` | `http://builder.localhost:5800` |
| `staging` | `https://api.staging.webcake.io` | `https://staging.webcake.io` | `https://builder.staging.webcake.io` |
| `prod` *(mặc định)* | `https://api.webcake.io` | `https://webcake.io` | `https://builder.webcake.io` |

> **Link editor/preview** trả về sau `create_page`/`update_page` mở trên **host builder** (bảng trên), không phải API hay SPA base.

```bash
npx -y webcake-landing-mcp login --env local       # đăng nhập vào SPA + API local
WEBCAKE_ENV=staging npx -y webcake-landing-mcp      # chạy trỏ backend staging
WEBCAKE_ENV=prod npx -y webcake-landing-mcp         # prod (dạng biến môi trường)
```

`WEBCAKE_API_BASE` / `WEBCAKE_APP_BASE` (hoặc `--api-base`) tường minh vẫn ghi đè preset theo từng
trường. Trên server đã host sẵn, bạn có thể ghi đè môi trường theo từng request bằng header
**`x-webcake-env`** hoặc query **`?env=`** (ví dụ `…/mcp?jwt=<token>&env=staging`).

### Cách lấy `WEBCAKE_JWT`

1. Mở dashboard builder WebCake và đăng nhập
2. Mở DevTools (`F12` hoặc `Cmd + Option + I`)
3. Vào tab **Network** > click một trang bất kỳ
4. Tìm một request API (ví dụ `@me`, `organizations`…)
5. Trong **Request Headers**, copy giá trị sau `Authorization: Bearer ` → đó là `WEBCAKE_JWT`
6. Dùng tool `list_organizations` để liệt kê org và chọn `WEBCAKE_ORG_ID`

---

## Cấu hình theo IDE

Lệnh con `install` của npx (xem trên) tự ghi cấu hình đúng cho từng IDE. Nếu muốn tự viết tay cấu hình cho Claude Desktop, Claude Code, Cursor, Windsurf, Augment, hay Codex — và cả dạng dùng file build từ clone — xem **[docs/manual-install.vi.md](docs/manual-install.vi.md#cấu-hình-theo-ide--công-cụ-ai)**.

## Ví dụ sử dụng

Ba luồng đầy đủ — dựng trang từ brief, sửa trang đúng chỗ, và xem chi tiết một loại element —
nằm ở **[docs/usage-examples.vi.md](docs/usage-examples.vi.md)**.

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

---

## ⭐ Thấy hay? Thả cho mình một star

Đây là dự án mã nguồn mở một-mình-làm — mỗi ⭐ thật sự giúp nó đi tiếp và giúp người khác tìm thấy nó.

- ⭐ **[Star repo](https://github.com/vuluu2k/webcake-landing-mcp)** — 2 giây thôi, mà động viên cực lớn.
- 🐛 **[Mở issue](https://github.com/vuluu2k/webcake-landing-mcp/issues)** — báo lỗi, thiếu loại element, hay chỉ là một ý tưởng.
- 🔁 **Chia sẻ** cho ai vẫn đang dựng landing page bằng tay từng khối.

[![Star History Chart](https://api.star-history.com/svg?repos=vuluu2k/webcake-landing-mcp&type=Date)](https://star-history.com/#vuluu2k/webcake-landing-mcp&Date)

> Làm với ❤️ cho cộng đồng WebCake. Cảm ơn bạn đã ghé qua.
