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

Luôn gọi cái này **đầu tiên**. Nó trả về hình dạng output, hệ toạ độ (canvas desktop 960 hoặc 1200px — lựa chọn ở `settings.width_section`; chọn 1200 cho layout rộng/nhiều cột hoặc khi clone thiết kế rộng hơn 960; mobile 420 hoặc 360px), bộ từ vựng sự kiện, và workflow đầu-cuối.

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

`validate_page` **errors là chặn**; warnings (chữ tràn đè phần tử bên dưới, vượt canvas, dải trống cuối section, event target lửng lơ, thiếu `field_name`) không chặn lưu nhưng là **lỗi hiển thị phải sửa** — mọi response có warnings đều kèm `warnings_notice` yêu cầu model sửa và validate lại đến khi danh sách rỗng (chỉ được giữ lại warning chứng minh được là false positive).

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
# app/app_css, rồi publish qua route publish_html của editor (route DUY NHẤT tạo bản ghi
# PagePublishedV2 mà mọi đường serve công khai đọc). custom_domain cho trang URL vĩnh viễn;
# KHÔNG có domain thì chỉ còn /preview/<page_id> — link này hết hạn ~10 phút sau khi publish.
# Không có build host: rơi về lưu chỉ-source (không có gì lên sóng).
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
| `get_icon_svg` | Chuyển TÊN icon-font — Material Symbols `ms:<tên>`, Font Awesome `fa:<tên>` (chính là `block.icon` từ ingest), id Iconify, hoặc tên trần — thành `<svg>` inline thật qua [Iconify API](https://iconify.design), để clone tái tạo icon của reference (nhất là Google Stitch dùng **class** icon-font) đúng và tự chứa. Material Symbols lấy biến thể OUTLINED (fallback filled). Render mỗi svg bằng element icon gốc của Webcake — **rectangle**: đặt svg vào CẢ `responsive.desktop.config.svgMask` lẫn `responsive.mobile.config.svgMask`, set `styles.background` = màu icon, box VUÔNG (svg chỉ là mask nên trắng nếu thiếu background, méo nếu không vuông; `validate_page` cảnh báo từng lỗi). Không cần credentials. |
| `upload_images` | Chuyển URL ảnh ngoài (từ kết quả `ingest_html`/`ingest_url`), `data:` URI, hoặc **đường dẫn file cục bộ trên máy người dùng** (`/abs/path.jpg`, `~/Pictures/logo.png`, `file:///…`, `C:\…`) thành URL do Webcake host (`statics.pancake.vn`) để dùng trong `specials.src`. Truyền thẳng đường dẫn cục bộ vào `urls` — KHÔNG dùng dịch vụ bên thứ ba (catbox, imgur…) để chuyển file của người dùng. Sử dụng multipart upload (giới hạn backend 200 MB). Xử lý đến 20 entry/lần song song. Không cần Webcake credentials. **Upload thật theo mặc định (`dry_run` mặc định `false`)** — khác các tool persistence trang, tool này không đụng dữ liệu tài khoản nên mặc định là upload thật: chờ map `images`, rồi đặt từng `images[<url gốc>].url` vào mọi element đang dùng `<url gốc>` (slot upload thành công không bao giờ được dùng placeholder). Chỉ truyền `dry_run:true` khi muốn xem trước không-thao-tác (với file cục bộ, nó báo file có tồn tại không và kích thước). Đường dẫn cục bộ chỉ được phép khi server chạy ở chế độ stdio (máy cục bộ); trên HTTP transport từ xa sẽ bị từ chối theo từng entry. Ảnh trong reference là tài sản của người dùng — dùng tool này cho CẢ HAI intent (adapt VÀ clone) khi trang được dựng từ HTML/URL tham chiếu, khi người dùng cung cấp URL ảnh, hoặc khi người dùng cung cấp file ảnh trên máy; `search_images` chỉ lấp các slot không có ảnh nguồn. |
| `render_preview` | Chụp một URL CÔNG KHAI thành PNG và trả về dưới dạng **ảnh** để model THẤY được kết quả render và so sánh trực quan với reference — bước kiểm tra độ giống của vòng clone (dựng → xem → `patch_page` → kiểm lại). Truyền `page_id` để chụp `/preview/<id>` của trang đã tạo, hoặc `url` cho bất kỳ trang công khai nào (vd reference đang clone); `full_page` mặc định true. **Ưu tiên agent:** nếu bạn đã có khả năng tự chụp (shell + headless browser, hoặc tool screenshot), hãy tự chụp URL đó (tươi + không giới hạn) và chỉ dùng tool này khi không thể. Engine zero-config qua free tier của Microlink (giới hạn **~50/ngày mỗi IP** — lặp nhiều có thể dính HTTP 429, khi đó trả `ok:false` và nên BỎ QUA lần kiểm đó, đừng fail); host có thể đặt `RENDER_SCREENSHOT_BASE` (hoặc header `x-render-screenshot-base`) trỏ tới proxy có key, hoặc `MICROLINK_API_KEY` / `x-microlink-key` để tăng quota. Link `/preview/<id>` không có domain chỉ render ~10 phút sau lần publish cuối — gọi sớm và re-publish nếu đã nguội. Không cần Webcake credentials. |

### Ingest (không cần config)
| Tool | Mô tả |
|------|-------------|
| `ingest_html` | Parse HTML thô thành AST layout tham chiếu (sections phân loại theo vai trò, heading, CTA, trường form, màu sắc/font hàng đầu, `palette` đặt tên theo token + `design_tokens`, background_images từ stylesheet, và `size_hint` cho từng section — chiều cao desktop (px) lấy từ CSS nguồn khi có khai báo tường minh (`basis:'css'`, giá trị gốc trong `css`, ví dụ `100vh`) hoặc ước lượng theo khối lượng nội dung (`basis:'estimate'`); dùng nó làm chiều cao desktop của section dựng lại). Với **trang dùng Tailwind-CDN (output Google Stitch)** toàn bộ design system nằm trong khối `tailwind.config` chứ không trong CSS: nó được trích thành `palette` (mọi color token theo tên, ví dụ `primary`→`#a43b38`), `colors` xếp hạng theo mức dùng, và `design_tokens` = `{ spacing, radius, font_size, font_family }` (lưới spacing + bo góc + thang chữ đã resolve, ví dụ `display-lg`→`48px`, `xl`→`80px`) — dựng lại kích thước/spacing/màu TỪ các token này. Tiện ích **gradient** Tailwind (`bg-gradient-to-* from-* to-*`) được tái dựng vào mảng `gradients` dạng `linear-gradient(...)` với màu đã resolve (nút CTA/hero của Stitch), và mỗi section mang `hover_effects` (`scale`/`image-zoom`/`lift`/`underline`/`*-color-change`) lấy từ class `hover:`/`group-hover:` — tái tạo bằng hover event của Webcake để bản clone không bị tĩnh. (Thẻ `<main>` được làm phẳng để section bên trong không bị gộp; font icon như Material Symbols bị loại khỏi `fonts`; nút `<a>` kiểu pill của Tailwind vẫn được nhận là CTA dù không có class btn/cta; icon-font (Material Symbols / Font Awesome) được trích thành `block.icon` `"ms:<tên>"`/`"fa:<tên>"` — tái tạo bằng cách nạp font qua `settings.bhet` rồi render mỗi icon thành text-block/html-box chứa span; thanh `<nav>` trên cùng (không có thẻ `<header>`) được nhận là `header`, lưới 2 cột là `features`, dải kêu gọi hành động không ảnh là `cta` — nên trang Stitch map sạch, gần như không còn section `unknown`.) `detail:'compact'` (mặc định) trả ~2-5 KB; `detail:'full'` trả AST giàu hơn gồm blocks lặp lại theo section (card/tile/bước với title/body/image/cta), danh sách li, gradient, images dạng `{ src, alt }`, và `widgets` = `{ hint, html, css? }` — HTML nguồn (đã làm sạch) + các rule CSS khớp của khối hiển thị phức hợp (mockup điện thoại/thiết bị, luồng chat, dashboard, khung trình duyệt), để dựng lại NGUYÊN VĂN bằng MỘT `html-box` (inline css vào html) — dùng khi clone trung thực. URL ảnh trong kết quả (`images`, `background_images`, `og_image`) là tài sản của người dùng — re-host qua `upload_images` và dùng lại cho CẢ HAI intent (adapt chỉ viết lại chữ, không thay ảnh). **Trang xuất từ builder dạng canvas tuyệt đối** (họ LadiPage / HTML do Webcake publish — các div định vị tuyệt đối, layout nằm trong CSS theo từng `#id`) được TỰ PHÁT HIỆN và chuyển đổi **TẤT ĐỊNH** thành một `source` Webcake sẵn-sàng-lưu (gắn vào kết quả dạng `source` + `clone_notes` + `clone_notice`): bản **clone 1:1** trung thực trên canvas 420/960 trùng khớp (đúng box/style/ảnh/hành vi). **Lưu thẳng bằng `create_page`** (dry_run:true trước để validate + xem trước, rồi dry_run:false) thay vì dựng lại bằng tay; ảnh ngoài trong `source` **tự host khi lưu** (không cần gọi `upload_images` trước), và `clone_notes` liệt kê vài chỗ xấp xỉ có mất mát (element fixed/nổi được đưa về in-flow, shape không có svg → hình chữ nhật, toast `notify` bằng-chứng-xã-hội bị bỏ, carousel → gallery) để `patch_page` sau. Hình học chi tiết từng element được tóm tắt thành `canvas_summary` = `{ builder, width, mobile_only, element_count, sections: [{ id, height, elements }], popups }`. Trang lớn có thể trả `canvas_summary.truncated:true` (style bị rút cho vừa cap) — gọi lại với `sections:[id]` (id lấy từ `canvas_summary.sections[].id`; `'SECTION_POPUP'` chọn popup) để nhận `source` của section đó ĐẦY ĐỦ không cắt (truyền `source.page[0]` của nó cho `add_section`). Tiếng Việt bị mojibake (UTF-8 đọc nhầm Latin-1) được tự sửa kèm cảnh báo. |
| `ingest_url` | Fetch URL công khai rồi chạy cùng bộ trích xuất như `ingest_html` (gồm cả tự phát hiện canvas tuyệt đối → `source` tất định sẵn-sàng-lưu + `clone_notes`, kèm `canvas_summary`). Hỗ trợ cùng tham số `detail`. Trả cảnh báo khi trang là client-rendered để caller có thể dùng screenshot thay thế (Claude phân tích screenshot natively). |

### Lưu trữ (cần `WEBCAKE_API_BASE` + `WEBCAKE_JWT`)
| Tool | Mô tả |
|------|-------------|
| `list_organizations` | Liệt kê organization của tài khoản (id, name, is_default). Mặc định = org `is_default`. |
| `create_page` | Lưu một source đã sinh thành trang mới, rồi **tự động publish** (build host + `publish_html`) để preview render ngay — `publish:false` để bỏ qua; publish lỗi không làm hỏng create (`result.publish` chỉ cách thử lại); link preview không domain vẫn hết hạn ~10 phút sau mỗi lần publish. Kiểm tra, cache source thành `draft_id`, rồi tạo. `organization_id` nhận id org hoặc chuỗi `"personal"` (tường minh không org). Khi bỏ trống và không có env mặc định, tự gọi `list_organizations`: 1 org → tự chọn (`organization_auto_selected:true`); 2+ org → trả danh sách org, yêu cầu re-call với `organization_id` (không đoán); 0 org hoặc lookup lỗi → personal. Lỗi kiểm tra / timeout / lỗi mạng vẫn giữ draft — thử lại bằng `create_page({ draft_id, dry_run:false })` hoặc sửa bằng `patch_page({ draft_id, patches })`. **Tự host ảnh ngoài:** trước khi lưu, mọi URL ảnh ngoài trong source (`specials.src`, nền `url(...)`, gallery `item.link`, poster video) được tải về và re-host lên Webcake CDN rồi viết lại trong cây (kết quả `rehost` = `{candidates,rehosted,failed,skipped}`; có cache, khử trùng lặp, URL lỗi giữ nguyên URL gốc và không chặn lưu) — nên clone không cần gọi `upload_images` trước cho ảnh tham chiếu/web. **Mặc định `dry_run=true`.** |
| `list_pages` | Liệt kê các trang của tài khoản (id, name, organization_id, updated_at) để chọn cái cần sửa. |
| `find_pages` | Tìm trang theo tên, domain, và/hoặc page id (kết hợp AND) để định vị trang cần sửa; trả id, name, org, domain custom/mặc định, updated_at. |
| `get_page` | Lấy cây source đã decode của một trang, ĐÃ NÉN về dạng thưa (lược boilerplate mặc định — ít token hơn hẳn; `compact:false` để lấy cây thô). Sửa xong gửi lại nguyên dạng. |
| `update_page` | Ghi đè source của một trang bằng cây đã sửa. Kiểm tra, cache thành `draft_id`, rồi lưu. Timeout / lỗi vẫn giữ draft — thử lại bằng `update_page({ draft_id, dry_run:false })` hoặc `patch_page({ draft_id, dry_run:false })` (không patches). **Mặc định `dry_run=true`.** |
| `add_section` | Nối thêm section vào trang có sẵn mà không gửi lại cả source (đường dựng tăng dần). Luôn cache batch thành `draft_id`; chạy lại với `{ page_id, draft_id, dry_run:false }` — khỏi gửi lại sections. Lỗi kiểm tra / timeout cũng giữ draft — sửa bằng `patch_page({ draft_id, patches })`. **Mặc định `dry_run=true`.** |
| `patch_page` | Sửa trang theo id element mà không gửi lại cả source. Nhắm trang live (`page_id`) HOẶC draft đã cache (`draft_id`). Loại draft: `create_page` (tạo trang khi hợp lệ), `add_section` (nối khi hợp lệ), `update_page`/live-patch (thử lại updatePageSource). **Patches rỗng/bỏ trống + `draft_id` = commit nguyên trạng (đường thử-lại-timeout vạn năng).** **Mặc định `dry_run=true`.** |
| `publish_page` | Publish một trang LÊN SÓNG: gọi build host của Webcake (`POST <buildBase>/render/build`; prod mặc định `https://build.webcake.io`, tuỳ chỉnh qua `WEBCAKE_BUILD_BASE` env / header `x-webcake-build-base`) để sinh `app`/`app_css`, rồi publish qua route `publish_html` của editor — route duy nhất ghi bản ghi PagePublishedV2 mà mọi đường serve công khai đọc. Có `custom_domain` thì trang live vĩnh viễn tại domain đó; **không có domain thì chỉ còn `/preview/<page_id>` — hết hạn ~10 phút sau khi publish**. Không có build host thì rơi về lưu chỉ-source kiểu cũ (không có gì lên sóng). Kết quả trả `live` + `rendered`. **Mặc định `dry_run=true`** (không gọi build host khi dry_run). |

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
