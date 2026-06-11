# Tool — tham chiếu đầy đủ & workflow

[English](./tools.md) · **Tiếng Việt** · quay lại [README](../README.vi.md)

Các tool chia thành năm nhóm: **tham chiếu** (học mô hình — không cần config),
**generation** (dựng node hợp lệ), **media** (ảnh stock), **ingest** (tái tạo trang có sẵn),
và **lưu trữ** (ghi về backend — cần biến môi trường, xem
[docs/configuration.vi.md](./configuration.vi.md)).

Các luồng đầy đủ đầu-cuối (dựng từ brief, sửa đúng chỗ, xem một loại element) nằm ở
[docs/usage-examples.vi.md](./usage-examples.vi.md).

---

## Workflow từng bước

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
# Liệt kê organization của tài khoản.
# 1 org → create_page tự chọn. 2+ org → hiện danh sách, hỏi người dùng, truyền organization_id.
# Truyền organization_id:"personal" chỉ khi người dùng muốn lưu không thuộc org nào.
list_organizations({})
→ [{ id: "org_1", name: "Acme", is_default: true }, ...]

# Tạo trang MỚI (chỉ-source). Mặc định dry_run=true.
create_page({ source, organization_id: "org_1" })       # org tường minh — xem trước
create_page({ source, dry_run: false })                  # bỏ trống org → tự giải quyết qua list_organizations

# Sửa một trang CÓ SẴN
list_pages({})                                           # tìm trang
get_page({ page_id })                                    # lấy source đã decode
update_page({ page_id, source, dry_run: false })         # ghi đè (mặc định dry_run=true)

# Dựng trang LỚN theo kiểu tăng dần (tránh payload create_page khổng lồ
# có thể làm rớt kết nối): skeleton nhỏ trước, rồi từng section một.
create_page({ source: smallSkeleton, dry_run: false })   # → page_id
add_section({ page_id, sections: heroSection })          # dry_run=true → kiểm tra + trả draft_id
add_section({ page_id, draft_id, dry_run: false })       # chạy lại với draft_id — khỏi gửi lại sections
add_section({ page_id, sections: [formSection, footerSection], dry_run: false })  # hoặc bỏ qua dry-run

# Lên SÓNG — publish_page gọi build host (prod mặc định https://build.webcake.io) để sinh
# app/app_css cho trang render ngay, rồi gắn domain/set trạng thái live.
# Không có build host: publish chỉ-source, trang trắng cho đến khi lưu lại trong editor.
publish_page({ page_id, custom_domain: "shop.example.com", custom_path: "sale", dry_run: false })
```

`create_page` gọi **`POST {WEBCAKE_API_BASE}/api/v1/ai/create_page_from_source`** trên backend.
Cả `create_page` và `update_page` đều **mặc định `dry_run=true`** (kiểm tra và trả về request nó *sẽ*
gửi, JWT được che); đặt `dry_run=false` để ghi thật. Kết quả trả về `page_id` + URL editor/preview.

---

## Danh sách tool

### Tham chiếu (không cần config)
| Tool | Mô tả |
|------|-------------|
| `get_generation_guide` | **Đọc ĐẦU TIÊN.** Hình dạng output, hệ toạ độ, bộ sự kiện, workflow. |
| `list_elements` | Mọi loại element theo nhóm (tóm tắt + khi nào dùng + container?). |
| `get_element` | Một loại (hoặc nhiều loại cùng lúc): hints, `specials` chính, skeleton DẠNG THƯA (đúng hình dạng cần emit — server tự bù boilerplate đã lược), ví dụ đã điền. |
| `get_page_schema` | JSON Schema đầy đủ (Draft 2020-12) của một page source. |

### Generation
| Tool | Mô tả |
|------|-------------|
| `new_element` | Một node mặc định cho một loại (id mới) ở DẠNG THƯA — copy nguyên xi; boilerplate đã lược được server tự bù. |
| `new_page_skeleton` | Một source top-level rỗng nhưng đầy đủ `{ page, popup, settings, options, cartConfigs }`. |
| `validate_page` | Kiểm tra cấu trúc + ngữ nghĩa (ids, event targets, containers, `field_name`). |

### Media (chạy sẵn không cần setup; key Pexels tuỳ chọn)
| Tool | Mô tả |
|------|-------------|
| `search_images` | Tìm ảnh stock THẬT (Pexels) cho trang — trả URL hotlink nhiều cỡ để gắn vào `specials.src` của element ảnh. Chạy **không cần setup** (proxy hosted chung cấp ảnh); đặt env `PEXELS_API_KEY` hoặc header `x-pexels-key` để dùng [key Pexels miễn phí](https://www.pexels.com/api/) / quota riêng. |
| `upload_images` | Chuyển URL ảnh ngoài (từ kết quả `ingest_html`/`ingest_url`) hoặc `data:` URI thành URL do Webcake host (`statics.pancake.vn`) để dùng trong `specials.src`. Xử lý đến 20 URL/lần song song, giới hạn 8 MB/ảnh. Không cần Webcake credentials. **Mặc định `dry_run=true`.** Dùng khi clone trang hoặc khi người dùng cung cấp ảnh riêng; dùng `search_images` cho ảnh stock. |

### Ingest (không cần config)
| Tool | Mô tả |
|------|-------------|
| `ingest_html` | Parse HTML thô thành AST layout tham chiếu (sections phân loại theo vai trò, heading, CTA, trường form, màu sắc/font hàng đầu, bảng màu CSS custom-property, background_images từ stylesheet). `detail:'compact'` (mặc định) trả ~2-5 KB; `detail:'full'` trả AST giàu hơn gồm blocks lặp lại theo section (card/tile/bước với title/body/image/cta), danh sách li, gradient, và images dạng `{ src, alt }` — dùng khi clone trung thực. URL ảnh trong kết quả (`images`, `background_images`, `og_image`) nên được re-host qua `upload_images` khi clone. |
| `ingest_url` | Fetch URL công khai rồi chạy cùng bộ trích xuất như `ingest_html`. Hỗ trợ cùng tham số `detail`. Trả cảnh báo khi trang là client-rendered để caller có thể dùng screenshot thay thế (Claude phân tích screenshot natively). |

### Lưu trữ (cần `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Mô tả |
|------|-------------|
| `list_organizations` | Liệt kê organization của tài khoản (id, name, is_default). Mặc định = org `is_default`. |
| `create_page` | Lưu một source đã sinh thành trang mới (chỉ-source). Kiểm tra, cache source thành `draft_id`, rồi tạo. `organization_id` nhận id org hoặc chuỗi `"personal"` (tường minh không org). Khi bỏ trống và không có env mặc định, tự gọi `list_organizations`: 1 org → tự chọn (`organization_auto_selected:true`); 2+ org → trả danh sách org, yêu cầu re-call với `organization_id` (không đoán); 0 org hoặc lookup lỗi → personal. Lỗi kiểm tra / timeout / lỗi mạng vẫn giữ draft — thử lại bằng `create_page({ draft_id, dry_run:false })` hoặc sửa bằng `patch_page({ draft_id, patches })`. **Mặc định `dry_run=true`.** |
| `list_pages` | Liệt kê các trang của tài khoản (id, name, organization_id, updated_at) để chọn cái cần sửa. |
| `find_pages` | Tìm trang theo tên, domain, và/hoặc page id (kết hợp AND) để định vị trang cần sửa; trả id, name, org, domain custom/mặc định, updated_at. |
| `get_page` | Lấy cây source đã decode của một trang, ĐÃ NÉN về dạng thưa (lược boilerplate mặc định — ít token hơn hẳn; `compact:false` để lấy cây thô). Sửa xong gửi lại nguyên dạng. |
| `update_page` | Ghi đè source của một trang bằng cây đã sửa. Kiểm tra, cache thành `draft_id`, rồi lưu. Timeout / lỗi vẫn giữ draft — thử lại bằng `update_page({ draft_id, dry_run:false })` hoặc `patch_page({ draft_id, dry_run:false })` (không patches). **Mặc định `dry_run=true`.** |
| `add_section` | Nối thêm section vào trang có sẵn mà không gửi lại cả source (đường dựng tăng dần). Luôn cache batch thành `draft_id`; chạy lại với `{ page_id, draft_id, dry_run:false }` — khỏi gửi lại sections. Lỗi kiểm tra / timeout cũng giữ draft — sửa bằng `patch_page({ draft_id, patches })`. **Mặc định `dry_run=true`.** |
| `patch_page` | Sửa trang theo id element mà không gửi lại cả source. Nhắm trang live (`page_id`) HOẶC draft đã cache (`draft_id`). Loại draft: `create_page` (tạo trang khi hợp lệ), `add_section` (nối khi hợp lệ), `update_page`/live-patch (thử lại updatePageSource). **Patches rỗng/bỏ trống + `draft_id` = commit nguyên trạng (đường thử-lại-timeout vạn năng).** **Mặc định `dry_run=true`.** |
| `publish_page` | Publish một trang: gọi build host của Webcake (`POST <buildBase>/render/build`) để sinh `app`/`app_css` — prod mặc định `https://build.webcake.io`, tuỳ chỉnh qua `WEBCAKE_BUILD_BASE` env / header `x-webcake-build-base` — giúp trang render ngay mà không cần mở editor. Không có build host thì publish chỉ-source, trang sẽ trắng cho đến khi lưu lại trong editor. Kết quả trả `rendered:true/false`. **Mặc định `dry_run=true`** (không gọi build host khi dry_run). |

---

## Ghi chú về mô hình

- **Canvas toạ độ tuyệt đối:** mỗi phần tử con mang `top/left/width/height` dạng số theo từng breakpoint;
  section xếp dọc và tự giữ `height`. Nội dung nằm trong `specials` (`text`, `src`, …), không bao giờ trong `styles`.
- **Source top-level:** `{ page: [sections], popup: [popups], settings: {…}, options: { currency, mobileOnly, versionID }, cartConfigs: {} }`.
  Popup là một mảng top-level **riêng**, không lồng trong `page`.
- Animation theo breakpoint nằm trong `config.animation = { name, delay, duration, repeat }`.
- Màu dạng `rgba()`; `top/left/width/height/fontSize` là số (px); input form cần một `specials.field_name` duy nhất.

Tham khảo: [docs/page-element-schema.md](./page-element-schema.md),
[docs/element-specials-reference.md](./element-specials-reference.md) (tham chiếu đầy đủ mọi specials/event),
và [src/domains/landing/page-schema.json](../src/domains/landing/page-schema.json) (JSON Schema, Draft 2020-12). Schema phản ánh đúng
hình dạng `page_source` thật của editor.
