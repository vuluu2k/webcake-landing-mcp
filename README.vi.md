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

> 🤖 Chạy được trong **Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex, Antigravity, Gemini CLI, Cline, Kiro, OpenCode**, hay bất kỳ client hỗ trợ MCP nào — và **tool tham chiếu + generation không cần cấu hình gì**, nên bạn thử được trước cả khi dán token.

---

## Bản chất kỹ thuật

Server MCP (Model Context Protocol) dạy AI cách dựng trọn **JSON nguồn (page_source) của landing page WebCake**
từ một yêu cầu — và lưu nó về backend WebCake.

Nó expose danh mục element, gợi ý dùng từng element + `specials`, JSON Schema đầy đủ của trang, skeleton
element/trang hợp lệ, bộ kiểm tra trang, và các tool để tạo/sửa trang trên backend. AI dựng trọn JSON
`{ page, popup, settings, options, cartConfigs }`; `create_page` lưu nó (chỉ-source — trang mở trong editor,
lưu lại sẽ render).

| Cách | Hợp cho | Auth |
|------|---------|------|
| **npx (local)** — chạy trên máy bạn | Dùng cá nhân hằng ngày, toàn quyền | browser `login`, JWT, hoặc không cần (tool tham chiếu) |
| **URL đã host sẵn** — dùng server tụi mình, không cài gì | Máy không có Node.js, dùng nhóm, dialog claude.ai | link `?jwt=` cá nhân / header `x-webcake-jwt` |

Các **tool tham chiếu + generation** (`get_generation_guide`, `list_elements`, `validate_page`, …) và **tool ingest** (`ingest_html`, `ingest_url` — biến HTML/URL có sẵn thành mỏ neo layout để AI tái tạo) chạy **zero config**; chỉ **tool lưu trữ** (`create_page`, `update_page`, `add_section`, `patch_page`, `publish_page`, `list_pages`, `find_pages`, `get_page`, `list_organizations`) mới cần token. Token ưu tiên theo thứ tự: **header mỗi request → biến env → file `auth.json`** (`login`).

---

## 🚀 Kết nối — 2 cách chính

Chọn **một** trong hai. Cả hai đều đưa toàn bộ bộ công cụ dựng landing Webcake vào AI của bạn (Claude, Cursor, …). Không cần code.

### ① `npx` — chạy ngay trên máy bạn (nên dùng cho cá nhân)

Không cần cài đặt, luôn bản mới nhất, cần Node.js 18+. **Một dòng** vừa lấy token vừa ghi cấu hình IDE:

```bash
# Tương tác — chọn môi trường, đăng nhập qua trình duyệt (hoặc dán JWT), chọn IDE
npx -y webcake-landing-mcp install

# Không tương tác — cấu hình mọi IDE hỗ trợ cùng lúc (env + token qua cờ)
npx -y webcake-landing-mcp install --ide all --env prod --jwt <your-jwt>

# Gỡ server khỏi mọi cấu hình IDE
npx -y webcake-landing-mcp uninstall
```

Nó ghi entry `webcake-landing` vào đúng file cấu hình của từng IDE: `claude-desktop`, `claude-code`,
`cursor`, `windsurf`, `augment` (VS Code), `codex`, `antigravity`, `gemini` (Gemini CLI), `cline`,
`kiro`, `opencode`, hoặc `all`. Cờ: `--ide`, `--env`, `--jwt`, `--org-id`, `--api-base`/`--app-base`,
`--npx`/`--local`, `-y` — xem `install --help`.

Chỉ muốn chạy server (tự cấu hình sau)? `npx -y webcake-landing-mcp`

> 🛠️ Cấu hình IDE viết tay, script cài (`install.sh`/`install.ps1`), hay build từ clone →
> **[docs/manual-install.vi.md](docs/manual-install.vi.md)**.

### ② URL remote `…/mcp?jwt=` — đã host sẵn, không cần cài gì

Server **đã chạy sẵn** tại `https://mcp.toolvn.io.vn/mcp` — không cần Node.js, không phải giữ máy luôn bật.
Lấy **link cá nhân của bạn** (token gắn sẵn trong link) rồi dán vào ô *Add custom connector* / file cấu hình của client:

```
https://mcp.toolvn.io.vn/mcp?jwt=<TOKEN_CỦA_BẠN>
```

Hai cách lấy link:
- **Dễ nhất** — mở **<https://webcake.io/mcp-remote>** trong dashboard Webcake → nó tự tạo & copy link cho bạn.
- **Thủ công** — xem hướng dẫn từng bước: **[docs/ket-noi-mcp.md](docs/ket-noi-mcp.md)**.

Tham số thêm: `&env=prod`, `&org_id=…`, `&api_base=…`. Mỗi đồng đội một link với `jwt` riêng → mỗi người một
tài khoản, không cần OAuth. Client nào set được header thì nên gửi token qua header **`x-webcake-jwt`** thay vì
nhét vào URL — bảng header ↔ env đầy đủ ở **[docs/configuration.vi.md](docs/configuration.vi.md#header-mỗi-request-server-hosted--remote)**.

✅ Hợp cho: máy không có Node.js, dùng nhóm/chia sẻ, và **dialog connector của claude.ai** (chỉ nhập URL, không có header).
⚠️ Link chứa token cá nhân — coi như mật khẩu, luôn dùng **HTTPS**.

---

## ⚙️ Cấu hình

Bản nhanh — chỉ **tool lưu trữ** mới cần các thứ này:

```bash
npx -y webcake-landing-mcp login    # mở browser một lần, lưu token vào ~/.webcake-landing-mcp/auth.json
```

…hoặc đặt `WEBCAKE_ENV` (`local` | `staging` | `prod` — tự điền mọi base URL) + `WEBCAKE_JWT`.

Mọi thứ còn lại — bảng biến env đầy đủ, preset môi trường, header per-request cho server hosted,
flow `login` qua browser (+ contract backend), và cách lấy JWT bằng tay — nằm ở
**[docs/configuration.vi.md](docs/configuration.vi.md)**.

---

## 📚 Tài liệu

| Hướng dẫn | Nội dung |
|-----------|----------|
| **[Kết nối IDE / claude.ai](docs/ket-noi-mcp.md)** | Kết nối từng bước cho mọi client (npx & URL hosted), bảng xử lý sự cố. |
| **[Cấu hình](docs/configuration.vi.md)** | Biến env, preset `--env`, `login` qua browser, header per-request, cách lấy JWT. |
| **[Tham chiếu tool](docs/tools.vi.md)** | Chi tiết cả 19 tool + workflow từng bước + ghi chú mô hình. |
| **[Ví dụ sử dụng](docs/usage-examples.vi.md)** | Ba luồng đầu-cuối: dựng từ brief, sửa đúng chỗ, xem một loại element. |
| **[Cài thủ công / nâng cao](docs/manual-install.vi.md)** | Script cài, build từ clone, cấu hình IDE viết tay. |
| **[Schema page-element](docs/page-element-schema.md)** | Tham chiếu đầy đủ mô hình element (+ [mọi special/event](docs/element-specials-reference.md)). |

---

## 🧰 Tool nhìn nhanh

20 tool trong năm nhóm — mô tả đầy đủ ở **[docs/tools.vi.md](docs/tools.vi.md)**:

| Nhóm | Tools | Cần gì |
|------|-------|--------|
| **Tham chiếu** | `get_generation_guide` · `list_elements` · `get_element` · `get_page_schema` | không cần gì |
| **Generation** | `new_element` · `new_page_skeleton` · `validate_page` · `layout` | không cần gì |
| **Media** | `search_images` (ảnh stock Pexels thật) | không cần gì (key riêng tuỳ chọn) |
| **Ingest** | `ingest_html` · `ingest_url` (tái tạo trang có sẵn) | không cần gì |
| **Lưu trữ** | `list_organizations` · `create_page` · `list_pages` · `find_pages` · `get_page` · `update_page` · `add_section` · `patch_page` · `publish_page` | `WEBCAKE_API_BASE` + `WEBCAKE_JWT` |

Mọi thao tác ghi đều **mặc định `dry_run=true`** — nó xem trước đúng request sẽ gửi (token được che)
và chỉ đụng tài khoản của bạn khi chạy lại với `dry_run=false`.

## Prompt gợi ý

> Dựng cho tôi một landing page WebCake cho &lt;thương hiệu/ưu đãi&gt;. Dùng MCP webcake-landing:
> gọi `get_generation_guide`, `new_page_skeleton`, rồi `get_element` cho từng loại element bạn dùng,
> lắp JSON `{ page, popup, settings, options }`, `validate_page` đến khi 0 lỗi,
> rồi `create_page` (dry-run trước).

---

## ⭐ Thấy hay? Thả cho mình một star

Đây là dự án mã nguồn mở một-mình-làm — mỗi ⭐ thật sự giúp nó đi tiếp và giúp người khác tìm thấy nó.

- ⭐ **[Star repo](https://github.com/vuluu2k/webcake-landing-mcp)** — 2 giây thôi, mà động viên cực lớn.
- 🐛 **[Mở issue](https://github.com/vuluu2k/webcake-landing-mcp/issues)** — báo lỗi, thiếu loại element, hay chỉ là một ý tưởng.
- 🔁 **Chia sẻ** cho ai vẫn đang dựng landing page bằng tay từng khối.

[![Star History Chart](https://api.star-history.com/svg?repos=vuluu2k/webcake-landing-mcp&type=Date)](https://star-history.com/#vuluu2k/webcake-landing-mcp&Date)

> Làm với ❤️ cho cộng đồng WebCake. Cảm ơn bạn đã ghé qua.
