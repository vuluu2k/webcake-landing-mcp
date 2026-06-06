<!-- Tiếng Việt · English version: ./usage-examples.md -->

# Ví dụ sử dụng

Các luồng đầy đủ minh hoạ cách một AI điều khiển bộ tool Webcake Landing MCP.
Xem [README](../README.vi.md) để cài đặt, và [Hướng dẫn dùng tool chi tiết](../README.vi.md#hướng-dẫn-dùng-tool-chi-tiết) để tra từng tool.

## Ví dụ 1: Dựng landing page mới từ một brief

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

## Ví dụ 2: Sửa một trang có sẵn

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

## Ví dụ 3: Xem chi tiết một loại element trước khi dùng

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
