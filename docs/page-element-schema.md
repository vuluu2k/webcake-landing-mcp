# Webcake Page Element Schema (for LLM page generation)

> Tài liệu này mô tả **mô hình dữ liệu của một trang (page) trong editor Webcake** để một LLM
> có thể **sinh / chỉnh sửa trang tự động** qua API hoặc MCP. Mọi mô tả đều suy ra trực tiếp từ
> code render thật (`assets/render_v4/src/elements/*`), factory tạo element (`assets/editor/factory.js`),
> bộ duyệt cây của agent (`lib/landing_page/ai/source_tools.ex`) và dispatcher sự kiện
> (`assets/render_v4/event/index.js`).
>
> Khi nhúng vào prompt cho LLM: dùng phần **1–6** làm context, dùng `docs/ai/page-schema.json`
> làm `response_format` (structured output), và `LandingPage.Ai.PageSchema` để lấy schema/instruction
> ở phía Elixir.

---

## 1. Mô hình tổng thể

Một trang được lưu dưới dạng **một chuỗi JSON** trong cột `source` của `PageSource`
(xem `LandingPage.Pages` / `lib/landing_page/ai/ai_services.ex`). Cấu trúc gốc:

```jsonc
{
  "page": [ <Section>, <Section>, ... ],   // mảng các SECTION xếp dọc từ trên xuống
  "settings": {                            // cấu hình toàn trang + SEO
    "title": "string",
    "description": "string",
    "keywords": "string",
    "favicon": "string?",
    "lang": "vi"
    // ...các khoá settings khác giữ nguyên nếu có
  }
}
```

- Khoá gốc chứa các section có thể là `page` (chuẩn), hoặc `sections` / `section` (biến thể cũ).
  **Khi sinh mới, luôn dùng `page` là một mảng.**
- `page[i]` là các **Section**, xếp chồng theo chiều dọc theo thứ tự trong mảng (section đầu = trên cùng).
- Mọi thứ khác (text, ảnh, nút, form…) là **con cháu** nằm trong `children` của section.

### Mô hình toạ độ (RẤT QUAN TRỌNG)

Đây là builder kiểu **canvas tuyệt đối (absolute positioning)**, KHÔNG phải flow/flexbox:

- Mỗi element con có `top` / `left` / `width` / `height` (đơn vị **px, kiểu số**) đặt **tuyệt đối**
  bên trong section/container chứa nó.
- **Section** không có `top`/`left`; nó có `height` (chiều cao canvas) và xếp dọc tự động.
- Hai breakpoint độc lập: `desktop` và `mobile`. Mỗi cái có toạ độ + style riêng.
  - Bề rộng canvas tham chiếu: **desktop ≈ 960px**, **mobile ≈ 420px** (lấy từ default của `dynamic_page`).
  - `height` mặc định của section = `800`.
- Vì là absolute, **phải tự tính toạ độ không chồng lấn** giữa các element trong cùng section.

---

## 2. Cấu trúc một Element (node) — chung cho mọi `type`

Mọi element (kể cả section) đều dùng đúng khung này (xem `assets/editor/factory.js`):

```jsonc
{
  "id": "ab12cd34",          // chuỗi id DUY NHẤT, ~8 ký tự [a-z0-9]. Mọi event 'target' tham chiếu id này.
  "type": "text-block",      // một trong các type ở mục 4
  "properties": {
    "name": "Text",          // nhãn hiển thị trong panel layer
    "movable": true,         // section/slide/grid-item/popup thường = false
    "sync": true             // đồng bộ style desktop<->mobile khi sửa
  },
  "responsive": {
    "desktop": { "config": { /* xem 3.2 */ }, "styles": { /* xem 3.1 */ } },
    "mobile":  { "config": { ... },           "styles": { ... } }
  },
  "specials": { /* dữ liệu RIÊNG theo type — đây là nơi chứa NỘI DUNG: text, src ảnh, field_name... */ },
  "children": [ /* chỉ với container: section, group, grid, grid-item, carousel, slide, popup, form... */ ],
  "runtime": {},             // luôn để rỗng khi sinh mới
  "events": [ /* xem mục 5 */ ]
}
```

Quy tắc:
- `id` phải duy nhất trên toàn trang. Dùng để liên kết events (`target`) và `set_field_value`.
- `children` chỉ xuất hiện ở các **container**. Element lá (text, button, image…) không có `children`.
- Nội dung mà người dùng nhìn thấy nằm trong **`specials`** (vd `specials.text`, `specials.src`),
  KHÔNG nằm trong `styles`.

---

## 3. `responsive` — styles & config

### 3.1 `styles` (các khoá CSS phổ biến)

`styles` được render thành CSS (kebab-case) cho từng breakpoint (xem `assets/editor/exporter.js`).
`additionalProperties` được phép — bất kỳ CSS property nào (camelCase) đều dùng được. Các khoá hay dùng:

| Nhóm | Khoá | Kiểu | Ghi chú |
|------|------|------|---------|
| Vị trí | `top`, `left` | Number | px, tuyệt đối trong container. Section KHÔNG có. |
| Kích thước | `width`, `height` | Number | px. Section dùng `height` làm chiều cao canvas. |
| Xếp lớp | `position` | String | `"absolute"` (con) / `"relative"` (section, image-block) |
| | `zIndex` | Number | thứ tự chồng |
| Nền | `background` | String | màu `rgba(...)` hoặc gradient |
| | `backgroundImage` | String | `url(...)` (ảnh nền của image-block / section) |
| Chữ | `color` | String | `rgba(r,g,b,a)` |
| | `fontSize` | Number | px |
| | `fontFamily` | String | vd `"'Roboto', sans-serif"` |
| | `fontWeight` | String/Number | `"normal"`, `"bold"`, `400`… |
| | `fontStyle` | String | `"italic"` |
| | `textAlign` | String | `"start"`/`"center"`/`"end"`/`"justify"` |
| | `lineHeight`, `letterSpacing` | Number/String | |
| | `textTransform`, `textDecoration` | String | |
| Viền | `borderStyle` | String | `"solid"`/`"dashed"`/`"none"` |
| | `borderWidth` | Number | px |
| | `borderColor` | String | `rgba(...)` |
| | `borderRadius` | String/Number | vd `"13px"` hoặc `8` |
| | `boxShadow` | String | vd `"4px 4px 9px 0px rgba(0,0,0,.2)"` |
| Hiệu ứng | `opacity` | Number | 0–1 |
| | `mixBlendMode`, `transform` | String | |
| | `padding`, `margin` | Number/String | |

Màu **luôn dùng định dạng `rgba(r, g, b, a)`** (theo dữ liệu thật trong repo).

### 3.2 `config` (theo breakpoint, không phải CSS thuần)

| Khoá | Dùng ở | Ý nghĩa |
|------|--------|---------|
| `notloaded` | mọi element | cờ lazy-load nội bộ; sinh mới đặt `false` ở breakpoint hiện hành, để trống cái kia |
| `virtualHeight` | text-block, section | chiều cao text được tính sẵn (không bắt buộc) |
| `overlay` | section, image-block | màu lớp phủ `rgba(...)` |
| `column`, `row` | grid | số cột / hàng |
| `slideWidth` | carousel | bề rộng mỗi slide (px) |
| `iconSize`, `iconTop`, `linePaddingLeft` | list-paragraph | căn chỉnh bullet |
| `topBgImage`, `leftBgImage`, `widthBgImage`, `heightBgImage` | image-block | vị trí/scale ảnh nền |
| `language`, `layout`, `showDay`, `showSecond`, `showText` | countdown | tuỳ chọn hiển thị |

---

## 4. Danh mục Element (`type`) và `specials`

> Cột "Container" = có `children`. Các khoá `specials` liệt kê là khoá **hay gặp / mang nội dung**;
> còn nhiều khoá nâng cao khác — `specials` cho phép thêm khoá tuỳ ý.

### 4.1 Bố cục / Container

| `type` | Container | `specials` chính | Ghi chú |
|--------|:--------:|------------------|--------|
| `section` | ✓ | `globalSection` (bool), `globalSectionName`, `video_background_thumbnail`, `custom_class`, `imageCompression` | Khối dọc gốc. `movable:false`, `position:"relative"`, có `height`. `styles.background` = nền section. |
| `dynamic_page` | ✓ | `imageCompression` | Như section nhưng cho trang động (data-binding). desktop w=960, mobile w=420. |
| `group` | ✓ | — | Nhóm gộp nhiều element để di chuyển/định vị cùng nhau. `position:"absolute"`. |
| `grid` | ✓ | — | Lưới; `config.column`/`config.row`. `children` là các `grid-item`. |
| `grid-item` | ✓ | — | Ô trong grid; `movable:false`. |
| `carousel` | ✓ | — | Băng chuyền; `config.slideWidth`. `children` là các `slide`. |
| `slide` | ✓ | — | Một slide; `movable:false`. |
| `popup` | ✓ | — | Cửa sổ bật lên; `movable:false`. Hiện/ẩn qua event `open_popup`/`close_popup` (target = id popup). |

### 4.2 Nội dung

| `type` | Container | `specials` chính | Ghi chú |
|--------|:--------:|------------------|--------|
| `text-block` | – | `text` (HTML string), `tag` (`"p"`/`"h1"`…`"h6"`/`"span"`) | Khối văn bản. Style chữ ở `styles`. `specials.text` có thể chứa HTML inline. |
| `list-paragraph` | – | `text` (chuỗi các `<li>…</li>`) | Danh sách gạch đầu dòng. Mỗi item là 1 `<li>`. |
| `image-block` | – | `src` (URL ảnh), `resize` | Ảnh. Ảnh thật cũng có thể ở `styles.backgroundImage`. `config.overlay` để phủ màu. |
| `rectangle` | – | — | Hình khối/màu nền; dùng làm divider, badge, lớp nền. |
| `line` | – | — | Đường kẻ ngang. |
| `button` | – | `text` (nhãn nút), `required`, `format`, `connectedSurvey` | Nút bấm. Hành vi đặt trong `events` (click → open_link/scroll_to/open_popup/submit…). |
| `video` | – | `typeVideo` (youtube/upload…), `video_cdn`, `img` (thumbnail), `autoReplay` | Trình phát video. |
| `gallery` | ✓ | `media` (mảng URL/đối tượng ảnh) | Thư viện nhiều ảnh. |
| `html-box` | – | (HTML tuỳ ý) | Nhúng HTML thô. |
| `editor-blog` | – | — | Nội dung bài viết (rich text dài). |

### 4.3 Form & input (đặt trong `form`)

| `type` | Container | `specials` chính | Ghi chú |
|--------|:--------:|------------------|--------|
| `form` | ✓ | `field_type`, `form_type`, `sheetOrder`, `validate`, `submit_success`, `fb_event_type`, `fb_conversion_value`, `fb_tracking_currency`, `tiktok_conversion_value`, `tiktok_tracking_currency` | Bọc các input. Submit → tạo `FormData`/lead. Tracking pixel cấu hình tại đây. |
| `input` | – | `field_name` (KHOÁ dữ liệu), `field_placeholder`, `field_type` (`text`/`email`/`phone`/`number`), `required`, `formula` | Ô nhập 1 dòng. **`field_name` là tên cột dữ liệu submit.** |
| `textarea` | – | `field_name`, `field_placeholder` | Ô nhập nhiều dòng. |
| `select` | – | `field_name`, `options` | Dropdown. |
| `checkbox` | – | `field_name` | 1 ô tick. |
| `checkbox-group` | ✓ | `field_name`, `options` | Nhiều lựa chọn. |
| `radio` | ✓ | `field_name`, `options` | Chọn 1 trong nhiều. |
| `address` | – | `field_name`, `detectAddress`, `hidden_commune` | Tỉnh/Quận/Phường (đa quốc gia). |
| `country-select` | – | `field_name` | Chọn quốc gia. |
| `quantity_input` | – | `field_name` | Bộ tăng/giảm số lượng. |
| `input-datetime` | – | `field_name` | Chọn ngày/giờ. |
| `input-file` (Upload) | – | `field_name` | Tải tệp lên. |
| `signature` | – | `field_name` | Ký tay. |
| `verify-code` | – | `field_name` | Mã OTP/xác thực. |
| `group-select` | ✓ | — | Nhóm chọn thuộc tính (vd biến thể sản phẩm). |
| `group-select-item` | – | `field_placeholder`, `field_quantity` (bool), `options` | Mục trong group-select. |

### 4.4 Thương mại điện tử

| `type` | Container | `specials` chính | Ghi chú |
|--------|:--------:|------------------|--------|
| `list-product` | – | `format_title` (`"sku"`…), `numerical_order` (bool), `remain_quantity_text` | Danh sách sản phẩm (bind dataset). |
| `search-list-product` | – | — | Ô tìm + danh sách sản phẩm. |
| `cart-items` | – | — | Các mục trong giỏ. |
| `cart-quantity` | – | — | Tổng số lượng giỏ. |
| `product-select` | – | — | Chọn sản phẩm/biến thể. |
| `table` | – | (dữ liệu bảng) | Bảng. |

### 4.5 Marketing / động

| `type` | Container | `specials` chính | Ghi chú |
|--------|:--------:|------------------|--------|
| `countdown` | – | `type` (`"minute"`/`"endTime"`/`"daily"`), `duration`, `startTime`, `endTime`, `showDay`, `showSecond`, `showText`, `language`, `customTranslation` | Đồng hồ đếm ngược. |
| `timegroup` | – | — | Hiển thị giờ/ngày hiện tại. |
| `auto-number` | – | — | Số tự tăng (vd lượt xem giả lập). |
| `random-number` | – | — | Số ngẫu nhiên. |
| `notify` | – | (cấu hình thông báo) | Pop thông báo "vừa mua hàng…". |
| `spin-wheel` | – | (cấu hình vòng quay + giải) | Vòng quay may mắn. |
| `survey` | – | `options` (mảng {id,image,title,value,field_name}), `type` (`"text-image"`…), `multiOption`, `selectedBackground`, `selectedBorder` | Khảo sát/chọn ảnh. |
| `alertMessage` | – | (nội dung cảnh báo) | Băng thông báo. |

---

## 5. `events` — tương tác

Mỗi phần tử trong mảng `events`:

```jsonc
{
  "id": "ixxh483t",        // id sự kiện, ~8 ký tự duy nhất
  "type": "click",         // loại trigger: "click" | "hover" | "success" | "unset"
  "action": "open_link",   // hành động, xem bảng dưới
  "target": "..."          // ý nghĩa phụ thuộc action (id element / URL / text)
  // một số action cần khoá thêm, vd set_value cho 'set_field_value'
}
```

### Trigger (`type`)
- `click` — khi bấm (phổ biến nhất, dùng cho button/ảnh/text).
- `hover` — khi rê chuột (đổi màu/nền/chữ, animation).
- `success` — sau khi form submit thành công.
- `unset` — trạng thái mặc định/khởi tạo (vd ẩn element ban đầu).

### Action click phổ biến (`action`) — từ `assets/render_v4/event/index.js`
| `action` | `target` chứa gì | Mô tả |
|----------|------------------|------|
| `none` | – | Không làm gì |
| `open_link` | URL | Mở liên kết (thường kèm khoá `target`/`blank` mở tab mới) |
| `open_popup` | id popup | Mở popup |
| `close_popup` | id popup | Đóng popup |
| `scroll_to` | id element/section | Cuộn tới phần tử |
| `show_section` / `hide_section` | id section | Hiện/ẩn section |
| `show_hide_element` | id element | Bật/tắt hiển thị element |
| `change_tab` | id | Đổi tab |
| `lightbox` | id/URL ảnh | Mở ảnh phóng to |
| `copy` | text cần copy | Sao chép vào clipboard |
| `collapse` | id | Thu gọn/mở rộng |
| `set_field_value` | field_name (kèm `set_value`) | Gán giá trị cho field form |
| `back_to` / `back_home` | – / URL | Quay lại / về trang chủ |
| `share` | URL/mạng XH | Chia sẻ |
| `play_audio` / `stop_audio` | id | Điều khiển audio |
| `open_cart` / `add_to_cart` | id sản phẩm | Giỏ hàng |
| `open_app` | provider | Mở app/chat: `botcake`/`whatsapp`/`mess_prefill`/`tiktok_prefill`/`line_prefill` |
| `change_color` / `custom_js` | (tuỳ) | Đổi màu / chạy JS tuỳ chỉnh |

### Action hover phổ biến
`change_color`, `change_background`, `change_text_color`, `change_underline`, `change_overline`,
`change_image`, `animation_hover`, `show_hide_element`.

> `target` khi trỏ tới element có thể có tiền tố `w-`/`#w-` ở runtime; **khi sinh mới chỉ cần đặt đúng `id`** của element đích.

---

## 6. Ví dụ tối thiểu (hero + CTA + popup cảm ơn)

```jsonc
{
  "page": [
    {
      "id": "sec00001",
      "type": "section",
      "properties": { "name": "Hero", "movable": false, "sync": true },
      "responsive": {
        "desktop": { "config": {}, "styles": { "position": "relative", "height": 600, "background": "rgba(17,24,39,1)" } },
        "mobile":  { "config": {}, "styles": { "position": "relative", "height": 520, "background": "rgba(17,24,39,1)" } }
      },
      "specials": { "imageCompression": true },
      "runtime": {},
      "events": [],
      "children": [
        {
          "id": "txt00001",
          "type": "text-block",
          "properties": { "name": "Headline", "movable": true, "sync": true },
          "responsive": {
            "desktop": { "config": {}, "styles": { "top": 120, "left": 180, "width": 600, "fontSize": 44, "fontWeight": "bold", "color": "rgba(255,255,255,1)", "textAlign": "center" } },
            "mobile":  { "config": {}, "styles": { "top": 90,  "left": 20,  "width": 380, "fontSize": 28, "fontWeight": "bold", "color": "rgba(255,255,255,1)", "textAlign": "center" } }
          },
          "specials": { "text": "Bánh mì nóng giòn, giao trong 30 phút", "tag": "h1" },
          "runtime": {}, "events": []
        },
        {
          "id": "btn00001",
          "type": "button",
          "properties": { "name": "CTA", "movable": true, "sync": true },
          "responsive": {
            "desktop": { "config": {}, "styles": { "top": 260, "left": 405, "width": 150, "height": 44, "background": "rgba(246,4,87,1)", "color": "rgba(255,255,255,1)", "borderRadius": "8px", "textAlign": "center" } },
            "mobile":  { "config": {}, "styles": { "top": 200, "left": 135, "width": 150, "height": 44, "background": "rgba(246,4,87,1)", "color": "rgba(255,255,255,1)", "borderRadius": "8px", "textAlign": "center" } }
          },
          "specials": { "text": "Đặt ngay" },
          "runtime": {},
          "events": [
            { "id": "evt00001", "type": "click", "action": "open_popup", "target": "pop00001" }
          ]
        }
      ]
    },
    {
      "id": "pop00001",
      "type": "popup",
      "properties": { "name": "Thank you", "movable": false, "sync": true },
      "responsive": {
        "desktop": { "config": {}, "styles": { "width": 420, "height": 220, "background": "rgba(255,255,255,1)", "borderRadius": "12px" } },
        "mobile":  { "config": {}, "styles": { "width": 360, "height": 220, "background": "rgba(255,255,255,1)", "borderRadius": "12px" } }
      },
      "specials": {}, "runtime": {}, "events": [],
      "children": [
        {
          "id": "txt00002",
          "type": "text-block",
          "properties": { "name": "text", "movable": true, "sync": true },
          "responsive": {
            "desktop": { "config": {}, "styles": { "top": 40, "left": 40, "width": 340, "fontSize": 24, "fontWeight": "bold", "textAlign": "center" } },
            "mobile":  { "config": {}, "styles": { "top": 40, "left": 20, "width": 320, "fontSize": 22, "fontWeight": "bold", "textAlign": "center" } }
          },
          "specials": { "text": "Cảm ơn bạn!", "tag": "p" },
          "runtime": {}, "events": []
        },
        {
          "id": "btn00002",
          "type": "button",
          "properties": { "name": "Close", "movable": true, "sync": true },
          "responsive": {
            "desktop": { "config": {}, "styles": { "top": 140, "left": 160, "width": 100, "height": 40, "background": "rgba(76,175,80,1)", "color": "rgba(255,255,255,1)", "borderRadius": "8px", "textAlign": "center" } },
            "mobile":  { "config": {}, "styles": { "top": 140, "left": 130, "width": 100, "height": 40, "background": "rgba(76,175,80,1)", "color": "rgba(255,255,255,1)", "borderRadius": "8px", "textAlign": "center" } }
          },
          "specials": { "text": "Đóng" },
          "runtime": {},
          "events": [
            { "id": "evt00002", "type": "click", "action": "close_popup", "target": "pop00001" }
          ]
        }
      ]
    }
  ],
  "settings": {
    "title": "Bánh Mì Ông Bụt — Giao nhanh 30 phút",
    "description": "Đặt bánh mì online, giao trong 30 phút nội thành.",
    "keywords": "bánh mì, giao nhanh, đặt online",
    "lang": "vi"
  }
}
```

---

## 7. Quy tắc khi LLM sinh trang (checklist)

1. **Luôn** xuất root `{ "page": [...], "settings": {...} }`. Phần tử cấp 1 của `page` **phải** là `type:"section"` (hoặc `dynamic_page` / `popup`).
2. `id` duy nhất toàn trang; mọi `event.target` phải trỏ tới `id` có thật.
3. Mỗi element có ĐỦ cả `responsive.desktop` và `responsive.mobile`; element con phải có `top/left/width` ở cả hai.
4. Toạ độ tuyệt đối, không chồng lấn; tham chiếu canvas desktop ≈ 960px, mobile ≈ 420px; section dùng `height`.
5. Nội dung text/ảnh đặt trong `specials` (`text`, `src`, `media`…), KHÔNG đặt trong `styles`.
6. Màu dùng `rgba(...)`. `fontSize`/`borderWidth`/`top`/`left`/`width`/`height` là **số** (px).
7. Mọi `input`/`select`/`checkbox`… trong `form` phải có `specials.field_name` duy nhất.
8. `runtime` luôn `{}`; chỉ container mới có `children`.
9. Không bịa giá, số điện thoại, địa chỉ, số liệu (theo `Prompt` hiện có của repo).

---

## 8. Tích hợp trong repo

- **Elixir / structured output**: `LandingPage.Ai.PageSchema`
  - `PageSchema.generate_page_system_instruction/0` → system prompt (mục 1–7 cô đọng).
  - `PageSchema.generate_page_response_schema/0` → JSON Schema map để truyền vào
    `AgentConnector.run_chat_completion(messages, response_format)` (`response_format` kiểu OpenAI / `responseJsonSchema`).
  - `PageSchema.element_catalog/0` → danh mục type cô đọng (cho prompt / liệt kê qua MCP).
- **MCP / API ngoài**: dùng file `docs/ai/page-schema.json` (JSON Schema Draft 2020-12) làm
  định nghĩa tool / `response_format`.
- **Luồng hiện tại** (`lib/landing_page/ai/ai_services.ex`) là *rewrite từ template* (giữ layout, đổi chữ).
  Generate **từ đầu** = LLM sinh cây element theo schema này; sau đó lưu qua `Pages.create_source/1`
  giống `build_page_multi/2` (`source` = `Jason.encode!(%{"page" => ..., "settings" => ...})`).
