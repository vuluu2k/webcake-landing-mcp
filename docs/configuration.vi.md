# Cấu hình — môi trường, token & `login`

[English](./configuration.md) · **Tiếng Việt** · quay lại [README](../README.vi.md)

Cách server tìm backend WebCake và token tài khoản của bạn. Token ưu tiên theo thứ tự:
**header mỗi request → biến env → file `auth.json`** (do `login` ghi). Chỉ **tool lưu trữ**
(`create_page`, `update_page`, …) mới cần các thứ này — tool tham chiếu, generation, media,
và ingest chạy zero config.

---

## Kết nối một lần — tự lấy token (`login`)

Thay vì copy JWT bằng tay, chạy:

```bash
# Production — zero config (mặc định: connect qua webcake.io, API qua api.webcake.io):
npx -y webcake-landing-mcp login

# Local dev / staging — chọn môi trường có tên (xem Môi trường bên dưới):
node dist/index.js login --env local      # SPA :5173 + API :5800
node dist/index.js login --env staging    # staging.webcake.io + api.staging.webcake.io

# …hoặc trỏ URL tuỳ chỉnh tường minh (ghi đè --env):
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
> qua header `x-webcake-jwt` (xem [Header mỗi request](#header-mỗi-request-server-hosted--remote) bên dưới).

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|----------|----------|-------------|
| `WEBCAKE_ENV` | Không | Môi trường có tên: `local` \| `staging` \| `prod`. Điền sẵn `WEBCAKE_API_BASE` + `WEBCAKE_APP_BASE` từ preset (xem bảng bên dưới). Cũng đặt được qua cờ `--env <name>`. Biến tường minh sẽ thắng. |
| `WEBCAKE_API_BASE` | Không* | Base URL backend, ví dụ `http://localhost:5800`. Cần để lưu trang (hoặc đặt `WEBCAKE_ENV`). |
| `WEBCAKE_JWT` | Không* | JWT tài khoản (auth dashboard). Cần để lưu trang — sẽ hết hạn, làm mới khi cần. |
| `WEBCAKE_ORG_ID` | Không | Organization mặc định cho `create_page` (bị ghi đè bởi tham số `organization_id`). Bỏ trống → trang cá nhân. |
| `WEBCAKE_APP_BASE` | Không | SPA base tuỳ chọn — dùng cho trang connect khi `login` qua trình duyệt. |
| `WEBCAKE_BUILDER_BASE` | Không | Host builder tuỳ chọn cho link editor/preview trong kết quả. Mặc định lấy theo preset môi trường, nếu không thì suy ra từ host API (`api.x`→`builder.x`). |
| `WEBCAKE_PREVIEW_BASE` | Không | Host preview public tuỳ chọn cho link `/preview/<id>` — KHÔNG phải subdomain builder. Mặc định theo preset (`preview.localhost:5800` local / `staging.webcake.me` staging / `www.webcake.me` prod). |
| `WEBCAKE_CONFIG_DIR` | Không | Thư mục chứa `auth.json` do `login` ghi (mặc định `~/.webcake-landing-mcp`). |

> \* `WEBCAKE_API_BASE` và `WEBCAKE_JWT` chỉ cần cho các tool lưu trữ. Các tool tham chiếu và kiểm tra
> (`get_generation_guide`, `list_elements`, `get_element`, `validate_page`, …) chạy không cần chúng.

> Lưu trang sẽ ghi một trang thật vào nơi `WEBCAKE_API_BASE` trỏ tới, dùng JWT làm tài khoản đó.
> Hãy bắt đầu với local/staging.

## Môi trường (`--env` / `WEBCAKE_ENV`)

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

## Cách lấy `WEBCAKE_JWT`

1. Mở dashboard builder WebCake và đăng nhập
2. Mở DevTools (`F12` hoặc `Cmd + Option + I`)
3. Vào tab **Network** > click một trang bất kỳ
4. Tìm một request API (ví dụ `@me`, `organizations`…)
5. Trong **Request Headers**, copy giá trị sau `Authorization: Bearer ` → đó là `WEBCAKE_JWT`
6. Dùng tool `list_organizations` để liệt kê org và chọn `WEBCAKE_ORG_ID`

## Header mỗi request (server hosted / remote)

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
| `x-webcake-preview-base` | `WEBCAKE_PREVIEW_BASE` | ghi đè host preview public cho link `/preview/<id>` |

> Tool tham chiếu + generation (`get_generation_guide`, `list_elements`, `validate_page`, …) **không cần
> token** — chỉ tool lưu trữ (`create_page`, `update_page`, …) mới dùng. Không có JWT thì các tool đó trả
> `missing_env` chứ không gọi mạng.

> 📖 Kết nối IDE hay claude.ai vào server hosted, từng bước → **[docs/ket-noi-mcp.md](./ket-noi-mcp.md)**.
