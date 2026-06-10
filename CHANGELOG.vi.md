# Changelog

[English](./CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của dự án được ghi lại trong file này.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
và dự án tuân theo [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.52] - 2026-06-10

### Added
- `validate_page` nay báo lỗi khi một element có loại không được renderer hỗ trợ animation (chỉ `group`, `image-block`, `text-block`, `rectangle`, `button`, `countdown`, `line`, `list-paragraph` và `notify` được hỗ trợ) mà lại đặt `config.animation.name` khác `none`; element sẽ render bị kẹt ở trạng thái trước animation, và thông báo lỗi kèm gợi ý sửa bằng `patch_page`.
- `validate_page` nay báo lỗi khi `config.animation.name` được đặt thành giá trị không có trong bộ animate.css của editor; keyframe không xác định sẽ không chạy và element có thể render bị kẹt hoặc mờ.
- `validate_page` nay phát cảnh báo khi `styles.opacity` nhỏ hơn 1 ở bất kỳ breakpoint nào, vì CSS opacity là vĩnh viễn và khiến element cùng toàn bộ nội dung bên trong bị mờ mãi mãi; cảnh báo khuyến nghị dùng rgba() alpha trên thuộc tính `color` hoặc `background` thay thế, hoặc sửa giá trị qua `patch_page`.

### Changed
- Quy tắc animation trong `get_generation_guide` nay liệt kê 9 loại element hỗ trợ animation, liệt kê các nhóm animation entrance phổ biến trong animate.css (`fadeIn*`, `slideIn*`, `zoomIn*`, `bounceIn*`, `backIn*`, `flipIn*`, `lightSpeedIn*`, `rotateIn*`, `rollIn`, `jackInTheBox`), và cấm rõ ràng việc đặt `styles.opacity` dưới 1 cho mục đích tạo hiệu ứng thị giác, hướng tác giả dùng rgba() alpha thay thế.

## [1.0.51] - 2026-06-10

### Added
- Các response dry-run của `create_page`, `update_page` và `add_section` nay đều trả về `draft_id`, đồng thời cả ba công cụ đều nhận `draft_id` làm tham số đầu vào: truyền `draft_id` được trả về cùng `dry_run:false` (hoặc vào lệnh gọi `patch_page` tiếp theo) để xác nhận, thử lại hoặc sửa payload đã cache mà không cần gửi lại toàn bộ source JSON.
- Tất cả các HTTP call tới backend và `search_images` (Pexels trực tiếp và proxy) nay áp dụng timeout (mặc định 60 s, có thể ghi đè qua `WEBCAKE_HTTP_TIMEOUT_MS`); các call bị timeout trả về thông báo lỗi mô tả rõ rằng backend có thể đã hoàn tất thao tác.

### Changed
- `create_page`, `update_page` và `add_section` nay ghi payload đã xác thực vào draft cache TRƯỚC khi thực hiện network call, nên mọi timeout hoặc lỗi mạng luôn trả về `draft_id` có thể dùng để thử lại hoặc sửa mà không cần xây dựng lại source.
- Lỗi xác thực của `update_page` nay trả về `draft_id` kèm theo danh sách lỗi, tương tự hành vi của `create_page`, cho phép dùng `patch_page({ draft_id, patches })` để sửa chỉ các element vi phạm.
- `patch_page` nay xử lý cả ba loại draft: `page` (create thất bại — tạo trang mới), `sections` (payload `add_section` đã cache — append vào trang đang lưu) và `update` (source `update_page` hoặc patch live-page đã cache — ghi đè trang live); `patches` rỗng hoặc bị bỏ qua kèm `draft_id` sẽ commit source đã cache nguyên trạng (bỏ qua bước apply, xác thực lại, tôn trọng `dry_run`) — đây là luồng retry chung cho mọi lần ghi bị timeout.
- `patch_page` ở chế độ `page_id` (live-page) nay cache merged source đã patch trước khi lưu; timeout hoặc lỗi mạng sẽ trả về `draft_id` để retry mà không cần gửi lại patch.
- Hướng dẫn server được cập nhật với quy tắc `RETRY-AFTER-TIMEOUT` bao phủ tất cả các công cụ mutating và quy tắc `DRY-RUN CACHE` mới: mọi công cụ mutating đều cache payload trước network call và trả về `draft_id` khi thất bại; các response dry-run của `create_page`, `update_page` và `add_section` đều trả về `draft_id` để commit mà không cần gửi lại source.

## [1.0.50] - 2026-06-10

### Added
- Công cụ `publish_page` mới giúp đưa trang lên live: đọc source đang lưu của trang, lưu thành phiên bản mới và tạo hoặc cập nhật bản ghi `page_published`; nhận tùy chọn `custom_domain` và `custom_path`; mặc định `dry_run=true` trả về bản xem trước request đã che JWT; khi thành công trả về `published_url` (URL tên miền tùy chỉnh nếu đính kèm, ngược lại là link preview-host) và `preview_url`.

### Changed
- `preview_url` được trả về bởi `create_page`, `update_page` và `add_section` nay được gắn lại vào đúng host preview công khai (preview.localhost:5800 / staging.webcake.me / www.webcake.me) thay vì subdomain builder; biến môi trường `WEBCAKE_PREVIEW_BASE` mới và request header `x-webcake-preview-base` cho phép ghi đè host, và cả ba preset môi trường nay đều có thêm trường `previewBase`.
- Hướng dẫn server nay ghi lại sự khác biệt giữa preview và publish: `preview_url` từ `create_page`/`update_page`/`add_section` render source đang lưu ngay lập tức mà không cần bước publish; chỉ gọi `publish_page` khi người dùng muốn trang được public trên tên miền tùy chỉnh hoặc URL đã publish.
- Mô tả tham số của `patch_page` và `add_section` nay nêu rõ rằng element node và section node có thể ở dạng sparse (server sẽ hydrate `properties`/`runtime`/`events`+`children` rỗng/`config` theo breakpoint từ factory defaults).

## [1.0.49] - 2026-06-10

### Changed
- `get_page` nay trả về source đã compacted theo mặc định: các boilerplate theo factory-default (`properties`, `runtime`, `events`/`children` rỗng, `config` theo breakpoint, và các style key trùng với seed) được loại bỏ khỏi mỗi element trước khi trả về, giữ lại đúng dạng sparse authoring; response bao gồm `compacted:true` và một ghi chú inline; truyền `compact:false` để nhận cây đã lưu nguyên vẹn.
- `get_element` nay trả về skeleton ở dạng sparse authoring: trường `skeleton` chỉ chứa các key mà model thực sự cần emit (`id`, `type`, `styles` của cả hai breakpoint, `specials`, `events` thực có); một ghi chú `authoring` được thêm vào top-level của response để nhắc lại quy tắc.
- `new_element` nay trả về element node ở dạng sparse authoring (chỉ các key cần thiết — không có `properties`, `runtime`, `events`/`config` rỗng) để model có thể sao chép kết quả trực tiếp mà không cần loại bỏ boilerplate.
- Mô tả tham số của `create_page`, `update_page`, `add_section` và `patch_page` nay nêu rõ rằng sparse element node được chấp nhận và `properties`/`runtime`/`events`+`children` rỗng/`config` theo breakpoint nên được bỏ qua; server sẽ hydrate từ factory defaults.
- `get_generation_guide` và hướng dẫn server nay nêu rõ toàn bộ vòng lặp authoring là sparse từ đầu đến cuối: skeleton từ `get_element`, output từ `new_element`, và source từ `get_page` đều ở dạng sparse, nên model chỉ cần chỉnh sửa và gửi lại mà không cần thêm lại boilerplate.
- Các ví dụ trong element descriptor của `text-block`, `image-block`, `button`, `input`, `select` và `popup` nay được viết ở dạng sparse authoring, loại bỏ `properties`, `runtime`, `events` rỗng và `config` theo breakpoint để củng cố format emit mong đợi.

## [1.0.48] - 2026-06-10

### Added
- `create_page` nay lưu source đã expand vào bộ nhớ draft khi xác thực thất bại và trả về `draft_id` kèm theo danh sách lỗi, cho phép agent chỉ sửa các element vi phạm mà không cần xây dựng lại và gửi lại toàn bộ source.
- `patch_page` nay nhận `draft_id` (được trả về bởi `create_page` thất bại) thay thế cho `page_id`: áp dụng các op theo element lên draft đã cache, xác thực lại toàn bộ cây đã merge, giữ lại các sửa đổi một phần qua nhiều vòng patch cho đến khi cây hợp lệ, rồi tạo trang; draft hết hạn sau khoảng 30 phút (tối đa 50 bản ghi trong bộ nhớ).

### Changed
- Workflow chỉnh sửa trong `get_generation_guide` và hướng dẫn server nay ghi lại luồng fix-after-error qua `draft_id`: khi `create_page` thất bại do lỗi xác thực, dùng `draft_id` được trả về cùng với `patch_page({ draft_id, patches, dry_run:false })` để sửa chỉ các element vi phạm và hoàn tất việc tạo trang mà không cần xây dựng lại source.

## [1.0.47] - 2026-06-10

### Added
- Công cụ `patch_page` mới cho phép chỉnh sửa trang hiện có theo element id mà không cần gửi lại toàn bộ source: agent gửi các op theo element (`update`, `replace`, `remove`, `add` được định danh bằng id), MCP tải source hiện tại, áp dụng các op, xác thực toàn bộ cây đã merge (chặn nếu có lỗi) rồi lưu; mặc định `dry_run=true`; cần thông tin xác thực ngay cả khi dry run vì phải tải source thực tế.

### Changed
- Workflow trong `get_generation_guide` được mở rộng từ bốn bước trở lại thành sáu bước: `get_element` được gọi riêng lẻ cho từng element type ở bước 2, hình ảnh được tải theo từng slot ở bước 3b, `validate_page` được khôi phục thành bước 5 bắt buộc trước khi lưu, và `create_page` ở bước 6 nay khuyến nghị xem trước với `dry_run=true` trước khi ghi thật.
- Workflow chỉnh sửa trong `get_generation_guide` và hướng dẫn server nay chỉ định agent ưu tiên dùng `patch_page` cho các chỉnh sửa nhỏ (chỉ gửi id element đã thay đổi kèm op thay vì toàn bộ source) và bổ sung luồng fix-after-error: khi `create_page`, `update_page` hoặc `add_section` báo lỗi xác thực, chỉ cần sửa các element id vi phạm bằng `patch_page` thay vì xây dựng lại toàn bộ source.
- Hướng dẫn server khôi phục yêu cầu bắt buộc phải gọi `validate_page` và sửa mọi lỗi trước khi gọi `create_page` hoặc `update_page`, đảo ngược quy tắc "VALIDATION IS BUILT IN" từ v1.0.45 đã bỏ bước riêng này.
- Hướng dẫn server cập nhật quy tắc `dry_run`: chỉ được bỏ qua bước dry-run trước khi ghi khi `validate_page` đã pass và không còn lỗi nào.

## [1.0.46] - 2026-06-09

### Changed
- `validate_page` nay phát cảnh báo tư vấn khi không có section, button hay text nào trên trang mang màu thực sự (không phải trắng, đen hoặc xám), giúp phát hiện các trang sẽ render ra một mảng phẳng, không màu vì background section chưa được đặt.
- Gợi ý xây dựng section trong `get_generation_guide` nay yêu cầu rõ ràng phải đặt `responsive.<bp>.styles.background` cho mỗi section ở cả hai breakpoint — factory default của section không có background, nên section không được đặt sẽ render trong suốt/trắng — đồng thời chỉ định agent luân phiên các band sáng, tông màu nhạt và tối từ palette đã khóa để các section liên tiếp trông rõ ràng khác biệt nhau.

## [1.0.45] - 2026-06-09

### Changed
- Workflow trong `get_generation_guide` được rút gọn xuống còn bốn bước: việc đọc loại phần tử và tìm ảnh nay được gộp thành các lần gọi batch duy nhất (`get_element({types:[…]})` và `search_images({queries:[…]})`), đồng thời bỏ bước `validate_page` riêng trước `create_page` vì công cụ lưu trang đã tự xác thực và chặn lỗi bên trong.
- Hướng dẫn server thay thế quy tắc "luôn gọi `validate_page` trước khi lưu" bằng ghi chú VALIDATION IS BUILT IN: `create_page`, `update_page` và `add_section` đều tự xác thực source và chặn lỗi, nên chỉ cần gọi `validate_page` riêng khi lắp ráp source mà chưa lưu trong cùng lượt đó.
- Hướng dẫn server cập nhật workflow chỉnh sửa trang để đặt `find_pages` làm bước tra cứu đầu tiên khi chưa có `page_id`, và chỉ định agent gọi `update_page` trực tiếp với `dry_run=false` thay vì chạy bước `validate_page` riêng trước.

## [1.0.44] - 2026-06-09

### Added
- Công cụ `find_pages` mới tìm kiếm các trang trong tài khoản theo tên, domain (khớp với `custom_domain` hoặc `default_domain`), và/hoặc page id (các bộ lọc kết hợp theo AND) qua endpoint chuyên dụng `/api/v1/ai/search_pages` trên backend; mỗi kết quả bao gồm `id`, `name`, `organization_id`, `custom_domain`, `default_domain` và `updated_at` để agent xác định đúng trang trước khi chỉnh sửa — tự fallback về lọc `list_pages` phía client theo tên/id khi backend trả về 404 (lọc theo domain không khả dụng trong luồng fallback này).

### Changed
- Hướng dẫn server nay chỉ định agent gọi `find_pages` làm bước tra cứu khi chưa có `page_id` trước chu trình get→chỉnh sửa→update, đồng thời bổ sung `find_pages` vào danh sách công cụ.

## [1.0.43] - 2026-06-09

### Changed
- Trang hướng dẫn `GET /` được làm mới toàn bộ nội dung: cập nhật tiêu đề trang và meta description, đơn giản hóa câu trả lời FAQ bằng cả tiếng Anh và tiếng Việt, và làm rõ các đoạn văn bản trong phần how-it-works, nhãn sơ đồ luồng và thẻ use-case.

## [1.0.42] - 2026-06-09

### Fixed
- `validate_page` nay phát lỗi khi element `countdown` có `specials.language` là giá trị nằm ngoài tám word-value được hỗ trợ (`vietnam`, `english`, `filipino`, `khmer`, `lao`, `indonesian`, `thai`, `malay`, `custom`); locale code như `"vi"` hay `"en"` sẽ âm thầm làm crash renderer do truyền key không nhận dạng được vào bảng ngôn ngữ nội bộ của renderer.
- `get_element` cho `countdown` nay ghi rõ `specials.language` phải là một trong tám word-value hoặc `"custom"` (không phải locale code như `"vi"`/`"en"`), và `"custom"` yêu cầu `specials.customTranslation` với các chuỗi nhãn `day`, `hour`, `minute` và `second`.
- Seed element `countdown` nay đặt `specials.language` thành `"english"` theo mặc định, giúp các element countdown mới tạo hợp lệ mà không cần cấu hình thủ công.

## [1.0.41] - 2026-06-09

### Changed
- `get_generation_guide` và hướng dẫn server nay yêu cầu agent viết toàn bộ nội dung trang bằng cùng ngôn ngữ người dùng đang nhắn tin, với đầy đủ dấu và ký tự chính xác — đối với tiếng Việt, mọi từ phải mang dấu đúng chuẩn (ví dụ: "Trân Trọng Kính Mời", "Ngày 15 Tháng 08 Năm 2025") và văn bản bỏ dấu kiểu "không dấu" bị cấm rõ ràng.

## [1.0.40] - 2026-06-09

### Added
- Công cụ `ingest_html` mới phân tích cú pháp một chuỗi HTML thành AST tham chiếu thu gọn (~2–5KB) phân loại các section theo vai trò (header, hero, features, form, cta, footer, v.v.) và trích xuất tiêu đề, CTA, hình ảnh, trường form cùng gợi ý thương hiệu (màu sắc chủ đạo, phông chữ), giúp agent sử dụng layout trang hiện có làm điểm neo mà không cần đọc HTML thô từng token.
- Công cụ `ingest_url` mới tải về một trang HTTP(S) công khai (timeout 10s, giới hạn 2MB) và xử lý qua cùng pipeline AST của `ingest_html`, kèm cảnh báo khi trang có vẻ được render phía client (`<body>` gần như trống).

### Changed
- `get_element` nay hỗ trợ chế độ batch qua tham số mảng `types` — lấy tất cả element type mà một section cần trong một lần gọi duy nhất (vd. `types:['section','text-block','image-block','button']`) và nhận về `{ elements: { [type]: details } }`; cú pháp gọi đơn với `type` giữ nguyên để tương thích ngược.
- `search_images` nay hỗ trợ chế độ batch qua tham số mảng `queries` — chạy song song một truy vấn cho mỗi slot hình ảnh trong một lần gọi duy nhất, với `pick='best'` (mặc định) trả về ảnh tốt nhất mỗi truy vấn dưới dạng gọn để điền thẳng vào `specials.src`, và `pick='all'` trả về toàn bộ kết quả mỗi truy vấn; bổ sung thêm các tham số lọc `orientation`, `size` và `color`.
- `create_page`, `update_page`, `add_section` và `validate_page` nay mở rộng (expand) các element node rút gọn trước khi xác thực/lưu: agent có thể bỏ qua các trường boilerplate (`properties`, `runtime`, `events`/`children` rỗng, `config` theo breakpoint) và server sẽ tự hydrate mỗi node từ seed mặc định của loại đó, giảm khoảng một nửa lượng JSON agent phải emit cho mỗi phần tử.
- `add_section` nay gửi section mới trực tiếp tới backend qua endpoint chuyên dụng `/api/v1/ai/append_section` (append phía server — không cần get+put toàn bộ source), chỉ fallback về luồng get→merge→validate→put khi endpoint đó trả về 404 (backend cũ).
- `validate_page` nay phát cảnh báo tư vấn khi các section có lề trái không nhất quán (chênh lệch hơn 48px trên desktop), chỉ rõ các section vi phạm và giá trị lề của chúng nhằm phát hiện lỗi căn chỉnh trang phổ biến nhất.
- Hướng dẫn server nay chỉ định agent gọi `get_element({types:[...]})` và `search_images({queries:[...]})` theo batch khi một section cần nhiều element type hoặc nhiều hình ảnh, đồng thời bổ sung phần REFERENCE INPUT mô tả ba chế độ nhập liệu tham chiếu: ảnh chụp màn hình trong chat (phân tích natively), chuỗi HTML qua `ingest_html`, và URL qua `ingest_url`.
- Hướng dẫn server nay làm rõ khi nào bỏ qua dry-run: gọi `create_page`/`update_page` với `dry_run=false` trực tiếp khi ý định người dùng đã rõ ràng và `validate_page` đã pass, thay vì luôn phải xem trước trước.

## [1.0.39] - 2026-06-08

### Internal
- Thêm manifest MCP Registry `server.json` (namespace `io.github.vuluu2k/webcake-landing-mcp`) và trường `mcpName` tương ứng trong `package.json` để MCP Registry chính thức có thể xác minh quyền sở hữu gói npm.

## [1.0.38] - 2026-06-08

### Added
- Công cụ `add_section` mới cho phép gắn thêm một hoặc nhiều section vào trang hiện có mà không cần gửi lại toàn bộ source: server lấy trang hiện tại, gắn thêm section mới, xác thực toàn bộ cây đã ghép (lỗi sẽ chặn lưu; cảnh báo chỉ mang tính tham khảo) rồi lưu lại — cho phép xây dựng trang lớn theo từng bước (`create_page` với skeleton nhỏ, sau đó gọi `add_section` một lần cho mỗi section) để tránh mất kết nối khi payload `create_page` quá lớn.

### Changed
- `get_generation_guide` và hướng dẫn server nay định vị agent là nhà thiết kế landing page chuyên nghiệp: trước khi dựng bất kỳ phần tử nào, agent phải khóa một design system (palette màu chính xác, thang chữ, lưới khoảng cách 8px và thông số button/card dẫn xuất từ màu chủ đạo của khách hàng) để toàn bộ trang nhất quán và trông như sản phẩm của một studio.
- `get_generation_guide` nay bổ sung phần PREMIUM CRAFT với hướng dẫn cụ thể về khoảng trắng, phân cấp chữ, kỷ luật màu sắc, nhịp khoảng cách 8px, tính nhất quán của component và trọng lượng nút CTA nhằm nâng cao chất lượng trang được tạo ra.
- `get_generation_guide` mở rộng quy tắc page margin thành một trục ngang dùng chung cho toàn trang (lề trái 80 desktop / 20 mobile, chiều rộng nội dung 800 / 380) áp dụng nhất quán cho header và mọi section, đồng thời cập nhật gợi ý dựng HEADER để neo logo và CTA vào đúng trục này.
- `get_generation_guide` và hướng dẫn server nay yêu cầu agent giao tiếp với khách hàng bằng ngôn ngữ đời thường, không dùng thuật ngữ kỹ thuật, và mô tả lại thiết kế đề xuất bằng ngôn ngữ thông thường trước khi bắt đầu tạo trang.
- `get_generation_guide` thêm bước 0b trong workflow, yêu cầu agent khóa design system (palette, thang chữ, thang khoảng cách và thông số component) ngay sau khi khách hàng xác nhận outline, trước khi lắp ráp JSON.
- Hướng dẫn server bổ sung quy tắc xây dựng tăng dần cho trang lớn (4+ section): dùng `create_page` với skeleton nhỏ rồi gọi `add_section` mỗi lần một section; `add_section` nay được liệt kê trong danh sách công cụ.
- `get_element` cho `text-block` nay cảnh báo rõ ràng rằng màu chữ phải luôn tương phản với band section bên dưới, và màu tiêu đề mặc định trong seed của phần tử thay đổi từ trắng (`rgba(255,255,255,1)`) sang gần đen (`rgba(26,32,44,1)`) để tránh chữ bị ẩn trên band sáng.

## [1.0.37] - 2026-06-08

### Changed
- `get_generation_guide` nay bổ sung gợi ý dựng section HEADER yêu cầu agent đặt mọi phần tử con trong header (logo, tên thương hiệu, nút CTA) trên cùng một đường trung tâm dọc bằng cách khớp `top + height/2` giữa tất cả các phần tử con, đồng thời giữ margin trái/phải của header nhất quán với các section bên dưới.
- `get_generation_guide` nay mở rộng quy tắc CONTRAST để bao phủ rõ ràng các band section có màu bão hòa và màu trung gian (vàng, cam, xanh ngọc, hồng): agent phải chọn màu chữ theo độ sáng của band — gần đen trên band sáng hoặc band trung gian rực rỡ, gần trắng trên band tối — và quy tắc nay cấm rõ ràng chữ có alpha thấp (dưới ~0,85), xám nhạt hoặc gần trắng trên band có màu; icon và chú thích đi kèm cũng phải tuân theo quy tắc tương tự như chữ bên cạnh chúng.

## [1.0.36] - 2026-06-08

### Changed
- Trang hướng dẫn `GET /` nay hiển thị "Claude · Codex · Cursor, v.v." thay vì chỉ "Claude · Cursor" trong sơ đồ luồng AI assistant, phản ánh danh sách rộng hơn các AI client được hỗ trợ.

## [1.0.35] - 2026-06-08

### Changed
- `get_generation_guide` nay bổ sung bước workflow rõ ràng (3b) yêu cầu agent gọi `search_images` cho mọi hình ảnh trang cần (hero, sản phẩm, giới thiệu, tính năng, gallery), đặt URL trả về vào `specials.src` hoặc `link` của gallery item với `src.large` cho hero/banner và `src.medium` cho card/thumbnail, trong đó `avg_color` được ghi chú là gợi ý chọn màu nền section phù hợp; `https://placehold.co/<width>x<height>` nay được ghi lại là fallback chỉ khi `search_images` trả về `ok:false`.

## [1.0.34] - 2026-06-08

### Added
- Công cụ `search_images` mới truy vấn ảnh stock Pexels theo chủ đề tiếng Anh ngắn gọn và trả về các URL sẵn sàng hotlink ở nhiều kích thước; dùng `src.large` cho ảnh hero/banner và `src.medium` cho card/thumbnail — hoạt động ngay lập tức qua shared hosted proxy, hoặc đặt `PEXELS_API_KEY` (env) hay header `x-pexels-key` để dùng quota Pexels riêng (miễn phí tại pexels.com/api).
- HTTP server nay cung cấp endpoint `GET /api/images/search` như một shared image proxy, cho phép người dùng `npx` không có Pexels API key cục bộ vẫn lấy được ảnh stock thực thông qua server được host.
- Khi khởi động, server nay đọc file `.env` cục bộ (trong thư mục hiện tại hoặc cạnh file binary) cho các biến môi trường như `PEXELS_API_KEY`; biến môi trường thực tế và header per-request vẫn được ưu tiên hơn.

### Changed
- Hướng dẫn server nay chỉ dẫn agent gọi `search_images` trước và đặt URL ảnh Pexels thực vào `specials.src`, chỉ fallback về `https://placehold.co/<width>x<height>` khi `search_images` trả về `ok: false`.

## [1.0.33] - 2026-06-08

### Fixed
- `get_element` cho `country-select` nay đánh dấu `specials.field_placeholder` là bắt buộc (renderer sẽ crash nếu thiếu trường này), và seed phần tử nay xuất giá trị mặc định.
- `get_element` cho `group-select-item` nay đánh dấu `specials.field_placeholder` là bắt buộc (renderer sẽ crash nếu thiếu trường này), và seed phần tử nay xuất giá trị mặc định.
- `validate_page` nay báo lỗi khi `specials.field_placeholder` vắng mặt trên phần tử `country-select` hoặc `group-select-item`, mở rộng phạm vi kiểm tra từ `select` đã được thêm ở phiên bản 1.0.32.

## [1.0.32] - 2026-06-08

### Fixed
- `get_element` cho `select` nay đánh dấu `specials.field_placeholder` là bắt buộc (renderer đã xuất bản sẽ crash nếu thiếu trường này), seed phần tử nay xuất giá trị mặc định, và `validate_page` nay báo lỗi khi trường này vắng mặt, đồng thời cảnh báo khi dùng nhầm key `specials.placeholder` thay vì `specials.field_placeholder`.
- `get_element` cho `select`, `radio` và `checkbox-group` nay ghi lại rõ rằng các item trong `specials.options` phải dùng cấu trúc `{id, name}` — không phải kiểu HTML `{label, value}` — và `validate_page` nay báo lỗi với bất kỳ option nào thiếu trường `name` kiểu chuỗi, kèm gợi ý chẩn đoán khi phát hiện các key `label`/`value`.

## [1.0.31] - 2026-06-08

### Fixed
- `get_element` cho `spin_wheel` nay ghi lại đúng `specials.code` là chuỗi phân cách bằng dấu xuống dòng (mỗi dòng một segment theo định dạng `couponCode|Tên giải|percent`), không phải mảng, và `specials.message` là chuỗi template cho popup kết quả (không phải mảng nhãn segment); seed phần tử nay xuất cả hai trường đúng định dạng để trang được render chính xác.
- `get_element` cho `gallery` nay ghi lại đúng `specials.media` là mảng các media object (`{type, link, linkVideo, typeVideo, imageCompression}`), không phải mảng URL thuần; seed phần tử, `get_generation_guide` và hướng dẫn server đều đã cập nhật cấu trúc object đúng để gallery hiển thị ảnh thay vì render trắng.

## [1.0.30] - 2026-06-08

### Changed
- Hướng dẫn cho agent nay yêu cầu thu thập toàn bộ kết quả `get_element` và `get_generation_guide` trước khi lắp ráp nguồn trang, xây dựng cây phần tử đầy đủ trong một lần duy nhất, và không xen kẽ các lời gọi tham chiếu giữa các lần preview `create_page` hoặc `update_page`.
- Hướng dẫn cho agent nay quy định chỉ chạy dry-run một lần duy nhất: gọi `create_page` hoặc `update_page` với `dry_run=true` đúng một lần, hiển thị kết quả cho người dùng, và chỉ gửi `dry_run=false` sau khi được xác nhận; nếu dry-run phát sinh lỗi validation thì sửa qua `validate_page` và chạy lại một lần — không được lặp nhiều dry-run để "kiểm tra" nguồn.

## [1.0.29] - 2026-06-08

### Fixed
- Trang hướng dẫn `GET /` nay kiểm soát hoàn toàn việc khôi phục vị trí cuộn sau reload: tính năng scroll restoration tự nhiên của trình duyệt bị tắt trong script ở `<head>`, vị trí `window.scrollY` chính xác được lưu vào `sessionStorage` khi `beforeunload`/`pagehide` và được khôi phục ở cuối thẻ `<body>`, nhờ đó vị trí không bị lệch do các animation reveal và hero chưa kịp settle.
- Ảnh OG social card nay hiển thị đúng lệnh cài đặt (`npx -y webcake-landing-mcp install`) thay vì dạng rút gọn thiếu cờ `-y` và subcommand `install`.

## [1.0.28] - 2026-06-08

### Fixed
- Trang hướng dẫn `GET /` không còn tạo hiệu ứng cuộn cho quá trình trình duyệt khôi phục vị trí cuộn khi tải lại trang; smooth scrolling nay chỉ được bật sau một animation frame kể từ khi trang load xong, giữ nguyên cuộn mượt cho điều hướng anchor link mà không gây hiện tượng giật khi reload trang.

## [1.0.27] - 2026-06-08

### Fixed
- Route `GET /` của HTTP server nay phục vụ trang hướng dẫn HTML đầy đủ cho các crawler mạng xã hội và công cụ tìm kiếm (Facebook, Zalo, Twitter/X, LinkedIn, Slack, Telegram, WhatsApp, Discord, Google, Bing và các nền tảng khác) gửi `Accept: */*` thay vì `text/html`, nhờ đó link xem trước và các thẻ Open Graph được các bot này nhận diện đúng.

## [1.0.26] - 2026-06-07

### Added
- HTTP server nay phục vụ ảnh social card PNG được render sẵn 1200×630 tại `GET /og.png`; các meta tag `og:image` và `twitter:image` của trang hướng dẫn nay trỏ đến PNG để link xem trước hiển thị đúng trên Facebook, X, LinkedIn và Zalo — các nền tảng này không render asset `og:image` dạng SVG.
- Phần `<head>` của trang hướng dẫn nay bổ sung các meta tag `og:image:type`, `og:image:alt` và `twitter:image:alt` để hoàn thiện thông tin Open Graph và Twitter Card.

## [1.0.25] - 2026-06-07

### Changed
- `currency` đã được chuyển từ `options.currency` sang `settings.currency` trong mô hình nguồn trang; `new_page_skeleton` giờ xuất đúng vị trí, `get_generation_guide` ghi lại thay đổi, và `validate_page` kiểm tra theo schema đã sửa.
- `new_page_skeleton` giờ xuất `dynamic_pages: []` và `svariations: []` ở cấp cao nhất để việc chỉnh sửa round-trip không làm mất dữ liệu thương mại; `cartConfigs` được khởi tạo thành `{isActive: false}` thay vì `{}`.
- Skeleton `settings` của `new_page_skeleton` nay bao gồm các trường `robots`, `canonical`, `bhet` (code tùy chỉnh chèn cuối thẻ `<head>`) và `bbet` (code tùy chỉnh chèn trước `</body>`).
- `get_generation_guide` nay ghi lại các trường `settings.robots`, `settings.canonical`, `settings.bhet` và `settings.bbet`, đồng thời mô tả cấu trúc cấp cao nhất đầy đủ đã được sửa, bao gồm `dynamic_pages` và `svariations`.
- `get_element` cho `group-select-item` nay ghi lại các specials key `field_placeholder` và `options`, đồng thời làm rõ rằng item số lượng dùng mảng `options` tĩnh trong khi item thuộc tính lấy dữ liệu từ catalog sản phẩm lúc runtime.
- `get_element` cho `otp-phone` nay ghi lại specials key `message_otp_wrong` để tùy chỉnh thông báo lỗi hiển thị khi người dùng nhập OTP sai.

## [1.0.24] - 2026-06-07

### Changed
- Các bước cài đặt được đánh số trên trang hướng dẫn `GET /` nay hiển thị đường kết nối dọc mờ giữa các số thứ tự, tạo giao diện stepper rõ ràng.
- Các nút bên trong bước cài đặt trên trang hướng dẫn `GET /` nay hiển thị trên dòng riêng căn trái thay vì nằm inline bên cạnh nội dung bước.
- Ghi chú cài đặt và lệnh "cấu hình mọi IDE một phát" trên trang hướng dẫn `GET /` nay được nhóm chung trong một hộp tip có định dạng riêng, làm rõ mối liên hệ giữa ghi chú và lệnh.

## [1.0.23] - 2026-06-07

### Added
- Trang hướng dẫn `GET /` nay có nút chuyển chế độ sáng/tối trong header; lựa chọn được lưu vào `localStorage` và áp dụng trước khi trang hiển thị để tránh hiện tượng nhấp nháy giao diện.
- Mỗi khối code `<pre>` trên trang hướng dẫn `GET /` nay có nút sao chép nội dung một chạm.

### Changed
- Trang hướng dẫn `GET /` nay hiển thị đúng trên màn hình nhỏ (≤640 px): sơ đồ luồng pipeline xếp theo chiều dọc, header xuống dòng gọn gàng, và các phần tử `<code>` inline không còn tràn khung nữa.
- Lệnh cài đặt "cấu hình mọi IDE một phát" trên trang hướng dẫn `GET /` nay được hiển thị thành khối `<pre>` riêng thay vì code inline, giúp dễ sao chép bằng nút copy mới.

## [1.0.22] - 2026-06-07

### Added
- Biến môi trường `WEBCAKE_BUILDER_BASE` mới, HTTP header `x-webcake-builder-base`, và tham số truy vấn `?builder_base=` cho phép đặt host của page-builder dùng cho link editor và preview được trả về bởi `create_page` và `update_page`; mỗi preset môi trường (`local`, `staging`, `prod`) nay mang sẵn builder base mặc định, và khi không có giá trị nào được cung cấp, host sẽ được tự động suy ra từ API base (`api.<domain>` → `builder.<domain>`).
- Trang hướng dẫn `GET /` của HTTP server nay có sơ đồ luồng động song ngữ (vi/en) minh hoạ pipeline từ ý tưởng đến trang thật: Bạn → Trợ lý AI → MCP → WebCake.

### Fixed
- `create_page` và `update_page` nay trả về link editor và preview được đặt đúng gốc trên host page-builder thay vì SPA base (`WEBCAKE_APP_BASE`), nhờ đó link mở đúng trong trình soạn thảo trang thay vì SPA.

## [1.0.21] - 2026-06-07

### Added
- Trang hướng dẫn `GET /` của HTTP server nay hỗ trợ song ngữ (vi/en): thêm `?lang=en` vào URL để chuyển sang tiếng Anh (mặc định là tiếng Việt), kèm nút chuyển ngôn ngữ trong header của trang và các thẻ `<link rel="alternate" hreflang>` để công cụ tìm kiếm lập chỉ mục cả hai phiên bản ngôn ngữ.
- HTTP server nay phục vụ ảnh social card tại `GET /og.svg`, được tham chiếu bởi các meta tag `og:image` và `twitter:image` trên trang hướng dẫn, để link chia sẻ trên mạng xã hội và chat hiển thị ảnh xem trước có thương hiệu.
- Trang `GET /` nay có `<head>` SEO đầy đủ (Open Graph, Twitter Card, và dữ liệu có cấu trúc JSON-LD theo schema SoftwareApplication, WebSite và FAQPage) để URL server được lập chỉ mục và xem trước link hiển thị đúng khi chia sẻ.

## [1.0.19] - 2026-06-07

### Changed
- `get_generation_guide` nay có thêm khối "Section Playbook" liệt kê bộ section thường dùng cho trang thu lead và bán hàng COD (header, hero, tính năng/lợi ích, sản phẩm/ưu đãi, social proof, form thu lead, footer), giải thích khi nào nên thêm hoặc bỏ từng dải, và hướng dẫn dựng từng section (cách thể hiện hero, căn giữa hàng tính năng, đặt tên trường form, quy tắc nội dung footer) — đồng thời nhấn mạnh toạ độ vẫn phải suy ra từ phép tính căn giữa và điều chỉnh theo từng sản phẩm, thương hiệu.

## [1.0.18] - 2026-06-07

### Changed
- `new_element` cho `list-product` nay gán sẵn `styles.colorBtn` mặc định (`rgba(246,4,87,1)`) để nhãn nút của danh sách sản phẩm có màu nhấn nhìn thấy được mà không phải chỉnh style thủ công.
- `new_element` cho `survey` nay gán sẵn các style viền (`borderColor`, `borderStyle`, `borderWidth`, `margin`, `padding`) và điền sẵn `specials.selectedBackground` cùng `specials.selectedBorder` để thẻ lựa chọn hiển thị có khoảng cách và trạng thái chọn ngay từ đầu.

## [1.0.17] - 2026-06-07

### Fixed
- `get_element` và `get_generation_guide` không còn gợi ý `https://picsum.photos` làm ảnh placeholder thay thế; agent nay được hướng dẫn chỉ dùng `https://placehold.co/<width>x<height>` cho `specials.src` của `image-block`, nhất quán với mô tả `keySpecials` sẵn có trong catalog.

## [1.0.16] - 2026-06-06

### Changed
- Icon server (phục vụ tại `/favicon.svg` và nhúng trong `serverInfo.icons`) đã được tinh chỉnh về đúng logo thương hiệu Webcake: ô bo góc gradient xanh (#3FBB57 → #108B67) với chữ "W" trắng đúng nét và chấm nhấn màu đào (#FFD591).
- Trang `GET /` phục vụ cho trình duyệt nay là một hướng dẫn phong phú, tự chứa, giải thích MCP làm gì, liệt kê hai cách kết nối (cài npx local và URL remote) và hiển thị endpoint trực tiếp; URL hiển thị tự thích ứng theo hostname công khai thật qua header `x-forwarded-host` và `x-forwarded-proto` nên vẫn đúng khi chạy sau reverse proxy (Coolify, Traefik, Cloudflare).

## [1.0.15] - 2026-06-06

### Changed
- Icon server (phục vụ tại `/favicon.svg` và nhúng trong `serverInfo.icons`) đã được đổi từ placeholder hình tia chớp sang chữ "W" thương hiệu Webcake (ô bo góc xanh với chữ "W" trắng), khớp với logo dùng trong SPA Webcake.

## [1.0.14] - 2026-06-06

### Added
- HTTP server nay phục vụ SVG tia chớp xanh Webcake tại `/favicon.svg`, `/favicon.ico` và `/icon.svg` để các MCP client lấy favicon từ origin server hiển thị icon thương hiệu thay vì quả địa cầu chung chung.
- Bước bắt tay `initialize` của MCP nay kèm mục `serverInfo.icons` mang data URI tự chứa của icon Webcake, để các client có render icon server (ví dụ giao diện custom-connector của claude.ai) hiển thị icon thương hiệu mà không cần URL công khai.
- `GET /` trên HTTP server nay trả về một trang HTML tối giản có link favicon khi request kèm `Accept: text/html`; client kiểm tra sức khoẻ theo chương trình vẫn nhận JSON `{ ok: true }`.

## [1.0.13] - 2026-06-06

### Changed
- Lệnh con `login` nay tự đưa terminal trở lại tiêu điểm trên macOS sau khi trình duyệt trả token, nên người dùng không phải tự chuyển cửa sổ lại sau khi kết nối.
- Trang thành công hiển thị sau khi `login` hoàn tất đã được thiết kế lại với bố cục thẻ động hiện đại, huy hiệu dấu tích SVG và hỗ trợ dark mode đầy đủ.

## [1.0.12] - 2026-06-06

### Added
- Lệnh con `help` mới (`webcake-landing-mcp help`) in tóm tắt cách dùng cấp cao bao quát mọi lệnh con (`install`, `uninstall`, `login`, `serve`), tuỳ chọn toàn cục `--env`, và link tới repo GitHub.

### Changed
- Cờ `--help` và `-h` nay in phần trợ giúp cấp cao mới thay vì uỷ quyền cho `--help` của trình cài; các cờ riêng của install vẫn truy cập được qua `webcake-landing-mcp install --help`.

## [1.0.11] - 2026-06-06

### Removed
- Biến môi trường `WEBCAKE_HOST`, cờ cài `--host`, header request `x-webcake-host` và query `?host=` đã bị gỡ; không còn hỗ trợ định tuyến host Phoenix qua header `Host` tuỳ chỉnh.
- Biến môi trường `WEBCAKE_CONNECT_URL` không còn được lệnh con `login` chấp nhận; URL connect nay luôn suy ra từ preset môi trường đang dùng theo dạng `<appBase>/mcp-connect`, chỉ còn tuỳ chọn `--connect-url` tường minh là được phép ghi đè.

## [1.0.10] - 2026-06-06

### Added
- Biến môi trường mới `WEBCAKE_ENV=local|staging|prod` chọn một preset triển khai có tên, tự điền cả `WEBCAKE_API_BASE` lẫn `WEBCAKE_APP_BASE`, nên các tool lưu trữ (`create_page`, `update_page`, `list_pages`,…) kết nối đúng backend mà không phải đặt riêng hai biến URL.
- Cờ CLI toàn cục mới `--env <name>` (cũng chấp nhận `--env=<name>`) áp dụng một môi trường có tên trước khi đọc config; giá trị không hợp lệ truyền qua cờ sẽ thoát ngay kèm danh sách tên hợp lệ, trong khi `WEBCAKE_ENV` không hợp lệ bị bỏ qua âm thầm để các ghi đè base-URL tường minh vẫn hiệu lực.
- HTTP server nay chấp nhận `x-webcake-env` làm header theo từng request và `?env=<name>` làm query URL, cho từng caller chọn môi trường có tên mà không đổi môi trường của chính server.

### Changed
- Wizard `install` tương tác nay hiển thị bộ chọn môi trường (local / staging / prod) thay cho ô nhập URL `WEBCAKE_API_BASE` thô, và đề xuất đăng nhập qua trình duyệt (qua `login`) làm bước xác thực đầu tiên mặc định; `WEBCAKE_ENV` được ghi vào khối env của IDE thay cho `WEBCAKE_API_BASE`.
- Lệnh con `login` nay suy ra cả URL connect lẫn API base từ preset môi trường đang dùng và lưu `appBase` (URL SPA) vào `auth.json` cạnh `base` (URL API), nên không cần `WEBCAKE_APP_BASE` riêng sau khi đăng nhập qua trình duyệt.

## [1.0.9] - 2026-06-06

### Changed
- HTTP server nay chấp nhận thông tin xác thực Webcake (`jwt`, `api_base`, `org_id`, `host`, `app_base`) dưới dạng query URL (ví dụ `.../mcp?jwt=<token>`) bên cạnh các header `x-webcake-*` / `Authorization: Bearer` sẵn có, giúp các client như dialog custom connector của claude.ai (không đặt được header tuỳ chỉnh) xác thực mà không cần biến môi trường.

## [1.0.8] - 2026-06-06

### Added
- Lệnh con mới `webcake-landing-mcp login` xác thực qua trình duyệt tự động: mở server callback loopback, khởi chạy trang connect Webcake, và lưu JWT nhận được vào `~/.webcake-landing-mcp/auth.json`, loại bỏ việc copy-paste token thủ công.
- Lệnh con mới `webcake-landing-mcp serve [--port N]` (cũng nhận biến env `PORT`) khởi động server Streamable-HTTP tại `/mcp`, cho phép chạy server như một custom connector của Claude truy cập qua URL công khai, hỗ trợ đa người dùng.
- Endpoint `/health` (`GET /` hoặc `GET /health`) có sẵn trên HTTP server cho việc kiểm tra sức khoẻ của nền tảng hosting.

### Changed
- Việc phân giải thông tin xác thực trong `readConfig` nay theo ba mức ưu tiên: ghi đè bằng header HTTP theo request trước, rồi biến môi trường, rồi file `~/.webcake-landing-mcp/auth.json` do `login` ghi — nên một lần connect qua trình duyệt thay cho việc dán `WEBCAKE_JWT` vào môi trường.
- Cả năm tool lưu trữ (`list_organizations`, `create_page`, `list_pages`, `get_page`, `update_page`) nay đọc JWT Webcake của caller từ header `x-webcake-jwt` hoặc `Authorization: Bearer` ở chế độ remote/HTTP, nên server đã host là đa người dùng mà không cần nhúng token chung vào môi trường.
- Thông báo lỗi thiếu thông tin xác thực và gợi ý dry-run từ các tool lưu trữ nay nhắc tới header `x-webcake-jwt` như một lựa chọn thay cho biến env `WEBCAKE_JWT`.

## [1.0.7] - 2026-06-06

### Changed
- `get_generation_guide` và phần instructions của server nay ghi rõ hành vi overlay của header sticky/fixed: một section có `config.sticky` sẽ phủ lên trang và không đẩy nội dung bên dưới xuống, nên agent được hướng dẫn dời các phần tử trên cùng của section đầu tiên xuống một khoảng bằng chiều cao header (~60–72 px) ở cả hai breakpoint, và tránh lặp tên shop ở cả header lẫn hero.
- Phần instructions về intake trong `get_generation_guide` và instructions server được siết chặt để bắt buộc thu thập câu trả lời trước khi sinh trang kể cả với trang "nhanh" hay "thử"; agent phải nêu lại một dàn ý ngắn (các section + CTA + màu) và chờ người dùng xác nhận rõ ràng trước khi gọi `new_page_skeleton` hay `create_page`.
- Quy tắc cấm bịa dữ liệu được mở rộng thành một instruction riêng bao gồm điện thoại/hotline/Zalo, giá (và giá gốc), địa chỉ, tên shop/thương hiệu, link/URL, email, giờ mở cửa, và các con số social-proof; agent được hướng dẫn hỏi mọi giá trị còn thiếu và chỉ được dùng placeholder ghi nhãn rõ ràng khi người dùng từ chối cung cấp.
- Danh sách câu hỏi intake trong `get_generation_guide` thêm câu hỏi bắt buộc "Sản phẩm + giá" cho trang bán hàng và quảng cáo, và diễn đạt lại câu hỏi về các section để mời đề xuất một bố cục mặc định hợp lý cho người dùng xác nhận.

## [1.0.6] - 2026-06-06

### Internal

- `src/index.ts`, `src/library.ts` và `src/factory.ts` nguyên khối được thay bằng cấu trúc module phân lớp: `src/core/` (primitive độc lập miền — `element.ts`, `descriptor.ts`, `domain.ts`), `src/domains/landing/` (toàn bộ logic riêng của landing), `src/tools/` (12 tool MCP tách thành `reference.ts`, `generation.ts`, `persistence.ts`), `src/mcp/response.ts` (helper `text()`), và `src/persistence/` (`config.ts`, `types.ts`, `webcake-client.ts`).
- Catalog element được tách từ một `library.ts` duy nhất thành năm file descriptor theo nhóm (`layout.ts`, `content.ts`, `form.ts`, `commerce.ts`, `marketing.ts`) dưới `src/domains/landing/elements/`, với `index.ts` suy ra `LIBRARY`, `CONTAINER_TYPES`, `FIELD_TYPES`, `ELEMENT_TYPES`, và `createElement` từ chúng.
- `src/server.ts` tách phần dựng `McpServer` khỏi entry point, để lại `src/index.ts` như một bộ điều phối lệnh con mỏng.
- `page-schema.json` chuyển từ `src/` sang `src/domains/landing/` cạnh `validate.ts`.
- `src/webcake.ts` đổi tên thành `src/persistence/webcake-client.ts`, với config HTTP và type API của Webcake tách ra `config.ts` và `types.ts`.
- Không có tên tool, tham số, hình dạng output, hay hành vi runtime nào thay đổi.

## [1.0.5] - 2026-06-06

### Internal

- `CONTAINER_TYPES` nay được suy ra từ cờ `container` trên mỗi mục `LIBRARY` trong `library.ts` thay vì một danh sách hardcode riêng trong `factory.ts`, loại bỏ rủi ro lệch âm thầm khi thêm loại element mới; `factory.ts` re-export cả `CONTAINER_TYPES` và `FIELD_TYPES` để tương thích ngược.
- `FIELD_TYPES` chuyển sang `library.ts`, đặt cạnh `LIBRARY` như nguồn sự thật duy nhất cho các cờ cấu trúc element.
- Cổng smoke nay khẳng định enum `elementType` trong `page-schema.json` khớp chính xác với các key của `LIBRARY`, nên thêm một loại vào file này mà quên file kia sẽ làm `npm run smoke` fail ngay thay vì lệch âm thầm.

## [1.0.4] - 2026-06-06

### Added
- `get_generation_guide` nay trả về ba từ điển action theo trigger riêng bên cạnh `click_actions` và `hover_actions` sẵn có: `success_actions` (12 action khả dụng trên sự kiện `success` của form sau khi gửi thành công, gồm `phone_call`, `download_file`, `change_tab`), `error_actions` (3 action khả dụng trên sự kiện `error` của form khi validate thất bại), và `delay_actions` (`show_element` và `hide_element`, kích hoạt khi một element cuộn vào tầm nhìn).

### Changed
- Các mục action click và hover trong `get_generation_guide` nay kèm trường `Extra:` liệt kê các key event-object riêng của renderer cho từng action (ví dụ `open_link→targetURL/delayTime`, `scroll_to→scrollMore`, `change_tab→moveTo/tabIndex`, `show_hide_element→onlyMode/animation/animationOut`, `open_app→appTarget`+các trường provider, `set_field_value→set_value`, `custom_js→custom_js`).
- Quy tắc mục events của `GENERATION_GUIDE` được mở rộng: nay nêu cả năm loại trigger (`click`, `hover`, `success`, `error`, `delay`) cùng phạm vi áp dụng và tham chiếu chéo tới các map action theo trigger mà `get_generation_guide` trả về.

### Fixed
- `validate_page` nay cảnh báo khi cùng một `field_name` xuất hiện ở nhiều input trong cùng một form, ngăn va chạm dữ liệu âm thầm khi submit.
- `validate_page` nay cảnh báo khi một mục `specials.options[].events_option` loại `showhide` hoặc `collapse` mang `promoId` không khớp với id element nào.
- `validate_page` nay cảnh báo khi `specials.connectedSurvey` hoặc `specials.connectedForm` tham chiếu một id element không tồn tại trong trang.
- `validate_page` nay cảnh báo khi một sự kiện `set_field_value` dùng target tiền tố `w-` không khớp với id element nào.
- `validate_page` nay cảnh báo target action `collapse` lửng lơ; `collapse` trước đó bị thiếu trong phần kiểm tra id element.

## [1.0.3] - 2026-06-06

### Added
- Hai trigger sự kiện mới: `error` (kích hoạt khi validate form thất bại) và `delay` (trigger hẹn giờ), mở rộng bộ từ vựng mà `get_generation_guide` trả về và hợp lệ trong mảng events của element.
- Bốn click action mới: `open_sms`, `send_email`, `download_file`, và `close_webview`, nay có trong bộ từ vựng action mà `get_generation_guide` trả về.
- Thuộc tính `svariations` được chấp nhận ở cấp cao nhất của schema trang như một passthrough mở; agent nên giữ nguyên văn nó qua `get_page` → sửa → `update_page` trên trang giỏ hàng hoặc thương mại.

### Changed
- Thư viện element (`get_element`, `list_elements`) được mở rộng toàn diện cho 29 element trước đây có gợi ý specials thưa hoặc rỗng: `form`, `input`, `select`, `checkbox-group`, `radio`, `group-select`, `group-select-item`, `survey`, `video`, `gallery`, `countdown`, `timegroup`, `auto-number`, `random-number`, `notify`, `spin-wheel`, `list-product`, `cart-quantity`, `table`, `verify-code`, `address`, `country-select`, `input-datetime`, `input-file`, `text-block`, `button`, `image-block`, `html-box`, và `editor-blog`.
- `alertMessage` được sửa từ một element trang thành một hàm tiện ích nội bộ; `get_element` nay cảnh báo rằng node loại này không được đặt lên trang hay popup.
- `product-select` được sửa thành một stub cũ không có renderer hoạt động; `get_element` nay cảnh báo không đặt nó và khuyến nghị dùng `list-product` hoặc `form` thay thế.
- Click action `back_home` bị gỡ; mô tả các action `back_to`, `play_audio`, `stop_audio`, `share`, `copy`, và `open_app` được sửa cho khớp hành vi renderer thực tế.
- Hover action `change_image` bị gỡ vì không được hiện thực trong renderer hiện tại.
- Gợi ý `text-block` và `button` được mở rộng với đầy đủ bộ biến template (`{{today}}`, `{{cart_total_price}}`, `{{formId__fieldName}}`,…), chế độ công thức, chèn URL-param và các specials định dạng ngày.
- Gợi ý `form` được mở rộng với định tuyến submit (popup thành công, redirect URL, các chế độ app-redirect), tracking pixel (Facebook, TikTok, Google Ads), liên kết đa form, và bộ từ vựng action success/error của `events[]`.
- Gợi ý element `group` được mở rộng với các specials bộ chọn biến thể sản phẩm giỏ hàng (`sprod`, `ctype`, `sprod_attr`, `sprod_val`, `squantity`, `svariant`).
- Gợi ý `grid` và `carousel` được mở rộng với binding dataset (`datasetId`), phân trang và cấu hình autoplay.
- Gợi ý Section được mở rộng với các specials hiển thị theo điều kiện khi tải trang (`pageLoadEvent`, `pageLoadEventDelay`, `afterPageLoadEvent`, và các trường liên quan).
- `GENERATION_GUIDE` nay ghi lại các key config xuyên suốt theo breakpoint (định vị sticky, animation, hide, lock) và tham chiếu tham khảo specials đầy đủ tại `docs/element-specials-reference.md`.

### Fixed
- `validate_page` không còn báo cảnh giả dangling-reference cho sự kiện `play_audio` và `stop_audio`; `target` của chúng là URL file âm thanh, không phải id element, và nay được loại khỏi kiểm tra tồn-tại-id.
- `gallery` nay được phân loại đúng là element lá; `new_element` không còn sinh mảng `children` rỗng trên node gallery (nội dung gallery hoàn toàn đến từ `specials.media`).
- `new_element` cho `cart-quantity` nay gán sẵn `specials.field_name` dù loại này không nằm trong `FIELD_TYPES`; renderer yêu cầu trường này.
- `new_element` cho `countdown` nay gán sẵn đầy đủ object specials gồm `repeat`, `customize`, `customMessage`, `dailyStart`, và `dailyEnd`.
- `new_element` cho `html-code` và `html-box` nay gán sẵn `specials.html` thành chuỗi rỗng.
- Phản hồi lỗi của `create_page` và `update_page` nay kèm trường `message` hoặc `reason` của backend khi server trả về, thay vì chỉ một mã trạng thái HTTP trơ.

## [1.0.2] - 2026-06-05

### Added
- Lệnh con `install` / `uninstall` đi kèm: chạy `npx -y webcake-landing-mcp install` tương tác (hoặc không tương tác qua các cờ `--ide`, `--jwt`, `--api-base` và liên quan) ghi mục server MCP `webcake-landing` vào file cấu hình của Claude Desktop, Claude Code, Cursor, Windsurf, Augment (VS Code), và Codex mà không cần clone local.
- Lệnh con `uninstall` gỡ mục `webcake-landing` khỏi mọi file cấu hình IDE được hỗ trợ trong một bước.
- Lệnh install tự nhận biết được chạy qua `npx` hay từ clone local và ghi dạng khởi chạy phù hợp (`npx -y webcake-landing-mcp` so với `node <path>/dist/index.js`); ghi đè bằng `--npx` hoặc `--local`.

## [1.0.1] - 2026-06-05

### Added
- Server nay gửi instructions workflow khi `initialize` MCP, cho các AI client luôn-bật các quy tắc về intake, validate-trước-khi-lưu, xác nhận dry-run, sửa đúng chỗ, và phạm vi tổ chức.
- `new_element` nay điền sẵn `specials.src` (image-block), `specials.img` (video), và `specials.media` (gallery) bằng URL placeholder `placehold.co` có kích thước, để trang sinh ra hiển thị nội dung ngay thay vì ô ảnh trống.
- `validate_page` nay phát cảnh báo vượt khung khi `left + width` hoặc `top + height` của một element tràn ra ngoài canvas, và gợi ý giá trị căn giữa đã sửa ngay tại chỗ.

### Changed
- Gợi ý của generation guide và thư viện element nay kèm phép tính căn giữa tường minh (`left = round((canvas - width) / 2)`) và một quy tắc CONTRAST để giảm lỗi bố cục lệch tâm và chữ vô hình trong trang sinh ra.
- Gợi ý element `image-block`, `video`, và `gallery` được cập nhật để yêu cầu URL placeholder khi chưa có ảnh thật và cảnh báo không để trống `specials.src` hay `specials.media`.
- Gợi ý dùng `countdown` được sửa để mô tả đúng bố cục flex bốn ô cố định: ẩn một ô qua `specials.showDay` hay `specials.showSecond` để lại khoảng trống thay vì dồn lại hàng, nên cả hai nên giữ `true` để lấp đều hàng.

## [1.0.0] - 2026-06-05

### Added

- Phát hành lần đầu server MCP `webcake-landing-mcp`.
- Tool tham chiếu: `get_generation_guide`, `list_elements`, `get_element`, và `get_page_schema` cung cấp catalog element, gợi ý `specials` theo từng element, và JSON Schema trang đầy đủ (Draft 2020-12).
- Tool generation: `new_element` và `new_page_skeleton` trả về node mặc định hợp lệ về cấu trúc, và `validate_page` thực hiện kiểm tra cấu trúc + ngữ nghĩa.
- Tool lưu trữ: `list_organizations`, `create_page`, `list_pages`, `get_page`, và `update_page` tạo hoặc sửa trang trên backend Webcake, mặc định `dry_run=true`.
