# Quay demo Webcake Landing cho OpenAI

Trạng thái: **chưa quay, chưa có recording URL**. Đây là walkthrough để quay
tương tác thực; không phải bằng chứng một demo đã chạy thành công.

## Chuẩn bị

1. Dùng tài khoản Webcake demo riêng, organization có quyền tạo/sửa/build trang.
   Chỉ dùng dữ liệu mẫu. Không quay password, token, email riêng hay trang production.
2. Dùng connection Webcake đang có trong ChatGPT nếu có. Nếu chưa có, thêm custom
   MCP server `https://mcp.toolvn.io.vn/mcp` trong Plugins, chọn OAuth, hoàn tất
   đăng nhập Webcake qua giao diện host rồi mở chat mới với plugin đã chọn.
   Đây là development connection; không cần upload submission chỉ để quay demo.
3. Chạy thử walkthrough bên dưới trước khi quay. Ghi nhận lỗi và sửa trước.
4. Bắt đầu screen recorder của máy, chọn cửa sổ ChatGPT và trình duyệt preview.
   Có thể nhờ trợ lý thao tác phần walkthrough nếu công cụ điều khiển máy có sẵn;
   người quay vẫn cần khởi động/dừng recorder nếu không có công cụ ghi video.
   Chụp màn hình không thay cho bản ghi video.

## Walkthrough (khoảng 3–5 phút; thời gian thực có thể dài hơn)

### 1. Tạo trang với phê duyệt rõ ràng

Prompt:

> Tạo landing page Webcake tiếng Anh tên MCP Review Demo cho workshop thiết kế
> giả lập. Hero, ba lợi ích, phần liên hệ; xanh lá và trắng; có desktop và mobile.
> Nút Contact us cuộn tới phần liên hệ. Không thêm giá, số điện thoại, địa chỉ,
> số liệu hay lời chứng thực. Hỏi các chi tiết còn thiếu, rồi cho xem trước khi lưu.

Trả lời intake bằng dữ liệu mẫu và chọn demo organization. Xác nhận outline.
Quay rõ validation và dry run; sau khi xem, nói rõ “Tôi xác nhận lưu trang này”.
Quay kết quả thật có editor URL và trạng thái build/preview. Mở preview ngay khi
còn hiệu lực, kiểm tra desktop và mobile. Không che lỗi bằng cách chuyển sang mockup.

### 2. Sửa đúng một thành phần

Prompt:

> Trên MCP Review Demo, chỉ đổi nhãn nút hero từ Contact us thành Explore the
> workshop. Giữ nguyên đích đến, vị trí và mọi phần khác. Cho xem trước, chưa lưu.

Quay việc tìm/đọc trang, đề xuất đúng button ID và dry run. Nếu muốn minh họa
lưu sửa, xác nhận riêng sau preview, rồi thể hiện kết quả thật. Muốn publish lại
cũng cần xem và xác nhận hiệu ứng publish. Không nói preview là URL vĩnh viễn.

### 3. Ranh giới chức năng

Prompt:

> Dùng Webcake Landing hoàn tiền giao dịch gần nhất và xuất hóa đơn thuế mới.

Quay lời giải thích rằng plugin không có công cụ hoàn tiền/hóa đơn và không
gọi tool Webcake. Không nhập dữ liệu thanh toán thật.

## Kiểm tra và host

- Dừng quay và phát lại file: chữ đọc được, thao tác thật, có kết quả cuối,
  không lộ secrets hay dữ liệu ngoài demo. Nếu có lỗi, giữ trạng thái đúng và
  quay lại sau khi sửa; không gọi kịch bản chưa chạy là thành công.
- Host video tại nơi người gửi có quyền dùng (ví dụ dịch vụ video hoặc file
  hosting cho phép reviewer phát mà không cần xin quyền). Kiểm tra bằng cửa sổ
  không đăng nhập, bao gồm âm thanh nếu có và khả năng tua/phát.
- Cung cấp URL thực sau khi quay. Ghi nó vào
  `plugins/webcake-landing/plugin.json` →
  `extensions.com.openai.review.demo_recording_url`, rồi rebuild ZIP.
- Chưa có video xem được thì mục demo vẫn **incomplete**; file local hoặc tài
  liệu này không hoàn thành trường recording URL.

## Tài khoản reviewer

Chuẩn bị account demo, login URL thực, organization/workspace, quyền truy cập và
các bước đăng nhập để reviewer chạy đủ 5/3 cases mà không tự đăng ký/cấu hình.
Đảm bảo login không phụ thuộc mailbox/điện thoại cá nhân hoặc mạng nội bộ.
Chỉ nhập credentials vào trường bảo mật **Review details** trong OpenAI portal;
không đưa vào repo, ZIP, video hoặc chat. Giữ account và dữ liệu mẫu hoạt động
cho những lần review sau.
