# Webcake Landing — trạng thái chuẩn bị public

Kiểm tra ngày 2026-10-15 (Asia/Ho_Chi_Minh). **Chưa upload, submit, approve hoặc
publish.** ZIP là bản chuẩn bị; chưa đủ review materials để gọi là ready to submit.

## Thông tin đã xác nhận

- Publisher cá nhân: **Vũ Lưu** (người dùng xác nhận; chưa kiểm tra OpenAI identity verification).
- Tất cả quốc gia khả dụng: `publication.countries: []`.
- Không thanh toán/mua hàng trong plugin: `review.commerce: false`.
- Dùng icon hiện có, không thêm dark-mode assets/màu thương hiệu.
- URL hỗ trợ lấy từ trường `bugs.url` của repo: GitHub Issues, đã mở kiểm tra.

## Kiểm tra đã thực hiện

| Hạng mục | Kết quả | Bằng chứng và giới hạn |
|---|---|---|
| TypeScript build | Passed | `npm run build`, exit 0 |
| Smoke repo | Passed | `npm run smoke`, kết thúc `ALL GOOD` |
| MCP metadata local | Passed | MCP SDK Client + InMemoryTransport đọc 23 tool; đủ 3 boolean annotations; mọi read-only tool có destructiveHint false |
| Tên tool trong review cases | Passed | Đối chiếu từng tools_triggered với danh sách tool thực qua MCP |
| Skeleton/layout | Passed (local protocol) | Canvas 1200/360; ba card 300×160 nằm trong canvas, mobile xếp dọc; skeleton rỗng bị validation từ chối, thêm section thì hợp lệ |
| Inline HTML fixture | Passed (local protocol) | Fixture trong positive case 4 trích được hai section, tiêu đề, Arial và màu #123524 |
| OAuth local | Passed, 13/13 | `scripts/oauth-smoke.mjs` chạy trên server loopback tạm thời: discovery, DCR, PKCE, callback giả lập, token/refresh, 401 và initialize có token |
| OAuth production bằng tài khoản thật | Not run | Không có development session/tài khoản demo đã chọn để kiểm thử; kiểm tra local dùng credential giả lập và không chứng minh Webcake login thực |
| ZIP inventory/bytes | Passed | `npm run pack:plugin`; đọc lại danh sách và từng byte của 5 file trong ZIP, `unzip -t` thành công |
| Manifest schema | Passed | `plugin.json` qua Agent Plugins 1.0 JSON Schema bằng AJV |
| MCP transport schema | Passed riêng phần portable | `type`/`url` qua schema portable khi tách OpenAI extension; xem khác biệt schema bên dưới |
| OpenAI listing/auth checks | Passed locally | Script kiểm tra length, 4 HTTPS URL, icons PNG, DCR/scopes và 5/3 cases; không thay portal validation |

Public endpoint probes (không gửi credentials, không ghi trang):

| URL/path | Quan sát |
|---|---|
| `https://mcp.toolvn.io.vn/health` | 200 JSON, ok true |
| `/` với Accept text/html | 200 HTML, đúng trang giới thiệu Webcake Landing MCP |
| `/privacy` | 200, nội dung privacy của connector, có data categories/recipients/retention/contact |
| `/terms` | 200, nội dung terms của connector |
| `https://github.com/vuluu2k/webcake-landing-mcp/issues` | 200, đúng repo, có giao diện Issues/New issue |
| `/.well-known/oauth-protected-resource` | 200, resource là HTTPS MCP endpoint, issuer đúng host, scopes landing:read/landing:write |
| `/.well-known/oauth-authorization-server` | 200, authorize/token/register/revoke, PKCE S256, public-client auth none |
| `/mcp` không credentials | 401 và WWW-Authenticate trỏ resource metadata |
| `/support` | 404; **không dùng URL này** trong manifest |

Các URL đã được đọc nội dung, không chỉ kiểm tra status. Chưa xác minh danh tính
publisher trên public website có khớp identity mà portal sẽ hiển thị hay không.
Privacy/terms giữ nguyên bản đang công khai; publisher cần xác nhận các cam kết
đúng với cấu hình lưu trữ/logging/revoke đang deploy. Không coi policy là đã audit.

### Khác biệt giữa schema portable và OpenAI extension

Schema MCP công khai tại Agent Plugins 1.0 hiện đặt `additionalProperties:false`
trong remote server, nên **full mcp.json không qua schema upstream** khi chứa
`extensions.com.openai.auth`. Không xóa OAuth để làm schema này xanh: [OpenAI
package reference](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication)
yêu cầu chính cấu trúc extension đó và tài liệu DCR tương ứng. Giữ cấu hình theo
OpenAI; kiểm tra portable transport và OpenAI auth riêng. Chưa chạy validator của
portal, vì vậy không tuyên bố đã được OpenAI chấp nhận.

## 5 positive + 3 negative cases

Các prompt, setup và pass conditions nằm trực tiếp trong
`plugins/webcake-landing/plugin.json` → `extensions.com.openai.review.test_cases`.
Không thêm trường status tự chế vào manifest.

| Case | Nội dung | Trạng thái trong ChatGPT |
|---|---|---|
| P1 | Intake → outline → validation → dry run → xác nhận → tạo demo page | Not run — cần demo login |
| P2 | Tìm/đọc trang demo sở hữu, trả sections và editor URL | Not run — cần fixture từ P1 |
| P3 | Đổi đúng nhãn button, chỉ dry run, bảo toàn source còn lại | Not run — cần fixture từ P1 |
| P4 | Phân tích inline HTML, không ghi | Not run trong host; local tool fixture đã Passed |
| P5 | Skeleton 1200/360 và row→stack layout, không ghi | Not run trong host; local protocol đã Passed |
| N1 | Không mua vé hoặc charge thẻ | Not run — cần host/model evaluation |
| N2 | Không hoàn tiền hoặc xuất hóa đơn | Not run — cần host/model evaluation |
| N3 | Không gửi email campaign | Not run — cần host/model evaluation |

Kiểm tra tool trực tiếp không chứng minh host/model chọn đúng tool, biết hỏi
intake hoặc chờ xác nhận. Chạy lại toàn bộ trên connection và saved version thật.

## Việc tiếp theo, theo thứ tự

1. **Demo account và development connection:** đăng nhập account demo qua OAuth
   trong ChatGPT, chọn organization có quyền tạo/sửa/build. Không gửi password
   hoặc JWT qua chat. Làm theo [walkthrough](plugin-demo.md) để chạy thử và quay.
2. **Recording:** quay tương tác thật, xem lại, host ở URL reviewer phát được,
   kiểm tra không đăng nhập; ghi `review.demo_recording_url` rồi rebuild ZIP.
3. **Chạy cases:** ghi Passed/Failed/Blocked cùng bằng chứng thật; sửa lỗi nếu có.
   Tài khoản demo và fixture cần tồn tại cho reviewer, không chứa dữ liệu thật.
4. **Server production:** deploy phần annotation đã sửa rồi scan lại; kiểm tra
   OAuth end-to-end, resource/audience binding theo MCP auth contract, refresh/
   revoke và quyền theo từng người dùng. Bộ 13 kiểm tra local chỉ kiểm tra flow
   hiện có, không phải audit OAuth đầy đủ.
5. **Publisher và portal:** xác minh identity cá nhân, organization/project,
   quyền submit, publisher hiển thị trên website, domain challenge do portal cấp,
   auth connection, tool/skill scans và imported metadata.
6. **Reviewer access:** nhập account/login URL/workspace/instructions vào trường
   bảo mật Review details, không vào repo/ZIP. Người có thẩm quyền hoàn tất policy
   attestations sau khi đã đọc và xác nhận đúng; rồi mới submit và publish sau approval.

## Build lại

```sh
npm run build
npm run smoke
npm run pack:plugin
```

ZIP nằm ở `artifacts/plugins/webcake-landing-0.1.0.zip` (gitignored). Khi đã upload
phiên bản đầu, tăng version trước khi đóng gói thay đổi metadata/skill lần sau.
Chỉ đóng gói thư mục plugin; không zip toàn bộ repo, dist hay node_modules.
