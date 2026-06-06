<!-- Tiếng Việt · English version: ./connect-mcp.md -->

# <img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> Biến AI của bạn thành một designer landing page — trong 60 giây

> Bạn gõ yêu cầu. AI dựng nguyên cái landing page. Bạn bấm xuất bản.
> Không kéo thả, không template cũ kỹ, không thuê designer.

Đây là **Webcake Landing MCP** — cây cầu nối thẳng Claude / Cursor / bất kỳ AI nào tới tài khoản Webcake của bạn. Kết nối **một lần**, từ đó chỉ cần *nói chuyện* để ra trang.

**Dán link này cho bạn bè là họ chạy được ngay** 👇

```
https://mcp.toolvn.io.vn/mcp?jwt=<TOKEN_CỦA_BẠN>
```

---

## ✨ Sau khi kết nối, bạn nói được những câu kiểu này

- *"Dựng cho tôi landing bán khoá học tiếng Anh, tông xanh dương, có form đăng ký + nút Zalo."*
- *"Mở trang `sale-mùa-hè` ra, đổi tiêu đề thành 'Giảm 50%' và đổi nút sang màu đỏ."*
- *"Thêm section đếm ngược + 3 testimonial khách hàng vào cuối trang."*

AI tự lo phần khó: bố cục, toạ độ, màu, validate, lưu về Webcake. Bạn chỉ duyệt.

---

## 🚀 2 cách kết nối — chọn 1

| | Cách ① `npx` | Cách ② URL remote |
|---|---|---|
| **Cài gì?** | Cần Node.js 18+ | Không cài gì cả |
| **Chạy ở đâu?** | Trên máy bạn | Trên server tụi mình |
| **Hợp với** | Dùng cá nhân, toàn quyền | Máy yếu, dùng nhóm, claude.ai |
| **Lấy nhanh** | `npx -y webcake-landing-mcp install` | Mở <https://webcake.io/mcp-remote> trong dashboard → copy |

> 💡 Không rành kỹ thuật? **Chọn Cách ②** — chỉ copy 1 cái link là xong.

---

## 🔑 Lấy token (làm 1 lần)

Token là "chìa khoá" để AI dùng đúng tài khoản Webcake của bạn. Lấy theo 1 trong 2:

1. **Dễ nhất** — đăng nhập Webcake → mở trang **<https://webcake.io/mcp-remote>** → bấm **Copy**. Link đã gắn sẵn token.
2. **Tự động qua trình duyệt:**
   ```bash
   npx -y webcake-landing-mcp login
   ```
   Một tab trình duyệt mở ra, xác nhận, xong — token tự lưu vào máy.

> ⚠️ Token = mật khẩu. Đừng đăng công khai, đừng commit lên Git. Luôn dùng **HTTPS**.

---

## 🅰️ CÁCH ① — `npx` (chạy trên máy bạn)

### Nhanh nhất: để nó tự cấu hình IDE

```bash
# Tương tác: chọn môi trường, đăng nhập, chọn IDE
npx -y webcake-landing-mcp install

# Một phát ăn ngay: cấu hình mọi IDE
npx -y webcake-landing-mcp install --ide all --env prod --jwt <TOKEN>

# Gỡ khỏi mọi IDE
npx -y webcake-landing-mcp uninstall
```

### Hoặc dán tay vào file cấu hình

Mẫu chung (chỉnh đường dẫn file theo IDE bên dưới):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": ["-y", "webcake-landing-mcp"],
      "env": {
        "WEBCAKE_ENV": "prod",
        "WEBCAKE_JWT": "<TOKEN_CỦA_BẠN>"
      }
    }
  }
}
```

| IDE | Dán vào file |
|-----|--------------|
| **Claude Desktop** (Mac) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | `.mcp.json` ở thư mục dự án (hoặc `claude mcp add`) |
| **Cursor** | `~/.cursor/mcp.json` (hoặc `.cursor/mcp.json` trong dự án) |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |

> Lưu file → **khởi động lại IDE** → thấy `webcake-landing` trong danh sách MCP là xong. 🎉

---

## 🅱️ CÁCH ② — URL remote (không cài gì)

### claude.ai (web) — dialog "Add custom connector"

1. Vào **Settings → Connectors → Add custom connector**.
2. **Name:** `Webcake Landing`
3. **URL:** dán link cá nhân của bạn:
   ```
   https://mcp.toolvn.io.vn/mcp?jwt=<TOKEN_CỦA_BẠN>
   ```
4. Bấm **Add** → đợi kết nối → xong. Icon <img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> xanh Webcake sẽ hiện lên.

> Dialog của claude.ai **không có ô header**, nên token phải nằm trong URL (`?jwt=`). Mỗi người một link = mỗi người một tài khoản, không cần OAuth.

### Claude Code / Cursor (hỗ trợ HTTP native)

```json
{
  "mcpServers": {
    "webcake-landing": {
      "type": "http",
      "url": "https://mcp.toolvn.io.vn/mcp",
      "headers": { "x-webcake-jwt": "<TOKEN_CỦA_BẠN>" }
    }
  }
}
```

> Cách này gửi token qua **header** (an toàn hơn — không lộ trong log) thay vì nhét vào URL.

### Claude Desktop (chỉ chạy stdio) → cầu nối `mcp-remote`

Claude Desktop chưa nói được HTTP remote, nên dùng `mcp-remote` làm cầu:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://mcp.toolvn.io.vn/mcp",
        "--header", "x-webcake-jwt:<TOKEN_CỦA_BẠN>"
      ]
    }
  }
}
```

---

## 🎛️ Tham số nâng cao (tuỳ chọn)

Gắn vào URL (`&khoá=giá-trị`) hoặc đặt làm env / header:

| Tham số URL | Header | Ý nghĩa |
|-------------|--------|---------|
| `?jwt=` | `x-webcake-jwt` | Token tài khoản (bắt buộc cho tool lưu trang) |
| `&env=` | `x-webcake-env` | Môi trường: `prod` (mặc định) · `staging` · `local` |
| `&org_id=` | `x-webcake-org-id` | Tổ chức mặc định khi tạo trang |
| `&api_base=` | `x-webcake-api-base` | Ghi đè API base |

> Các tool **tham chiếu** (`list_elements`, `get_generation_guide`, `validate_page`…) chạy **không cần token**. Chỉ tool **lưu trang** (`create_page`, `update_page`…) mới cần.

---

## 🆘 Gặp lỗi? Bảng cứu hộ nhanh

| Hiện tượng | Nguyên nhân thường gặp | Cách xử |
|-----------|------------------------|---------|
| Icon là **quả cầu trắng** | Client cache icon cũ | Xoá connector → thêm lại |
| **"Couldn't register… sign-in service"** | Server đang sập / chưa reachable | Kiểm tra `https://mcp.toolvn.io.vn/health` phải trả `{"ok":true}` |
| Tool lưu trang báo **`missing_env`** | Thiếu token | Thêm `?jwt=` hoặc `x-webcake-jwt` |
| Tạo trang vào **nhầm tài khoản** | Token sai / hết hạn | Lấy token mới (`login` hoặc <https://webcake.io/mcp-remote>) |
| `localhost` không add được vào claude.ai | claude.ai fetch từ server của họ | Phải dùng URL **HTTPS public** |

Tự kiểm tra server sống chưa:
```bash
curl https://mcp.toolvn.io.vn/health      # → {"ok":true, ...}
```

---

## 💚 Thấy hay thì share

Bạn vừa cho AI khả năng dựng landing page thật. Một người bạn của bạn cũng đang cần đúng thứ này.

> **Copy đoạn này gửi họ:**
> *"Tao mới cho Claude tự dựng landing page xong 😂 Mày dán link này vào Claude là chạy: https://mcp.toolvn.io.vn — bộ tool Webcake Landing MCP, miễn phí."*

<img src="assets/webcake-icon.svg" alt="Webcake" width="22" height="22" align="absmiddle"> *Made with Webcake — bớt việc, nhiều trang.*
