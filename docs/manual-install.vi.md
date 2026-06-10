# Cài đặt thủ công & nâng cao

[English](./manual-install.md) · **Tiếng Việt**

> Con đường nhanh nhất là lệnh con **npx `install`** (và remote connector) — xem [README](../README.vi.md). Trang này giữ lại các tuỳ chọn **thủ công / nâng cao**: script cài, build từ clone, cập nhật clone, và cấu hình IDE viết tay.

Tất cả đều cấu hình cùng một MCP server `webcake-landing`; chọn cách phù hợp với setup của bạn.

## Các cách setup (chọn một)

| # | Cách | Hợp cho | Auth | Xem |
|---|------|---------|------|-----|
| 1 | **Local stdio** — gắn vào IDE (Claude Desktop / Cursor / …) qua `npx` hoặc file build | Dùng hằng ngày trên máy | env `WEBCAKE_JWT`, hoặc `login`, hoặc không cần (tool tham chiếu) | [Cấu hình IDE](#cấu-hình-theo-ide--công-cụ-ai) |
| 2 | **`login`** — tự lấy token qua browser (khỏi copy-paste) | Khỏi dán token tay (stdio / remote 1 người) | session browser → file `auth.json` | [Cấu hình](./configuration.vi.md#kết-nối-một-lần--tự-lấy-token-login) |
| 3 | **Remote HTTP (`serve`)** — chạy như HTTP server, test bằng MCP Inspector / `mcp-remote` / curl | Thử transport remote ở local | header `x-webcake-jwt` mỗi request, hoặc env | [Hướng dẫn kết nối](./ket-noi-mcp.md) + [header](./configuration.vi.md#header-mỗi-request-server-hosted--remote) |
| 4 | **VPS + claude.ai connector** — deploy HTTPS public, thêm làm custom connector | Chia sẻ 1 server hosted | single-account (token env); per-user cần OAuth (chưa có) | [Hướng dẫn kết nối](./ket-noi-mcp.md) |

Hai **dạng chạy** áp dụng cho mọi cách: **`npx -y webcake-landing-mcp …`** (không clone, tự cập nhật) hoặc **`node /abs/path/dist/index.js …`** (bản đã clone & build — chạy `npm run build` trước). Cấu hình IDE bên dưới dùng dạng local; đổi `command`/`args` sang dạng npx để dùng CDN.

Các **tool tham chiếu + generation** (`get_generation_guide`, `list_elements`, `validate_page`, …) chạy **zero config**; chỉ **tool lưu trữ** (`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`) mới cần token. Token ưu tiên theo thứ tự: **header mỗi request → biến env → file `auth.json`** (`login`).

## Script cài nhanh (install.sh / install.ps1)

Chạy script tự cài — lo trọn gói: clone, cài dependencies, build, và cấu hình IDE của bạn.

### macOS / Linux

Nếu bạn đã clone repo:
```bash
./install.sh
```

Hoặc tải & chạy trực tiếp:
```bash
curl -fsSL https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.sh -o install.sh && bash install.sh
```

Trình cài tương tác: hỏi nơi cài (mặc định `~/.webcake-landing-mcp`), hỏi các biến môi trường
(`WEBCAKE_API_BASE`, `WEBCAKE_JWT`, `WEBCAKE_ORG_ID` — đều tuỳ chọn, Enter để bỏ qua), rồi cho bạn chọn
IDE cần cấu hình: `claude-desktop`, `claude-code`, `cursor`, `windsurf`, `augment`, `codex`, `antigravity`, `gemini` (Gemini CLI), `cline`, `kiro`, `opencode`, hoặc tất cả.

Gỡ cài (xoá entry MCP server khỏi mọi IDE đã cấu hình):
```bash
./install.sh --uninstall
```

### Windows (PowerShell)

Nếu bạn đã clone repo:
```powershell
.\install.ps1
```

Hoặc tải & chạy trực tiếp:
```powershell
irm https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.ps1 -OutFile install.ps1; .\install.ps1
```

Gỡ cài:
```powershell
.\install.ps1 --uninstall
```

## Cài thủ công (clone + build local)

```bash
git clone https://github.com/vuluu2k/webcake-landing-mcp.git
cd webcake-landing-mcp
npm install        # postinstall `prepare` tự build dist/
npm run build      # (re)build: tsc -> dist/ + copy src/**/*.json (page-schema.json) vào dist/
npm run smoke      # self-test offline của factory + validator (in "ALL GOOD")
```

Các tool tham chiếu/kiểm tra chạy với **zero config**. Biến môi trường chỉ cần cho các tool lưu trữ
(`create_page`, `update_page`, `list_pages`, `get_page`, `list_organizations`).

## Cập nhật bản đã clone

```bash
cd ~/.webcake-landing-mcp   # hoặc nơi bạn đã cài
git pull
npm install
npm run build
```

Rồi khởi động lại IDE.

## Cấu hình theo IDE / công cụ AI

> Thay `/absolute-path/webcake-landing-mcp/dist/index.js` bên dưới bằng đường dẫn thật nơi bạn đã
> clone/build repo. Ví dụ: `/Users/username/webcake-landing-mcp/dist/index.js`.
> Chạy `npm run build` trước để `dist/` tồn tại.
>
> Các ví dụ dùng URL tường minh; bạn có thể thay `WEBCAKE_API_BASE`/`WEBCAKE_APP_BASE` bằng một biến duy nhất `WEBCAKE_ENV` (`local` | `staging` | `prod`) — xem bảng Môi trường trong README.

### 1. Claude Desktop

Mở Settings > Developer > Edit Config, hoặc sửa file trực tiếp:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>",
        "WEBCAKE_APP_BASE": "http://builder.localhost:5800"
      }
    }
  }
}
```

Khởi động lại Claude Desktop. Các tool MCP sẽ hiện trong ô chat (biểu tượng búa).

---

### 2. Claude Code (CLI)

Chạy trong terminal — bản **local**:

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -- node /absolute-path/webcake-landing-mcp/dist/index.js
```

Hoặc **CDN / npx** (không clone):

```bash
claude mcp add webcake-landing \
  -e WEBCAKE_API_BASE=http://localhost:5800 \
  -e WEBCAKE_JWT=<your-jwt> \
  -- npx -y webcake-landing-mcp
```

Hoặc tạo `.claude.json` ở thư mục gốc dự án (hoặc `~/.claude.json` toàn cục):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Kiểm tra:
```bash
claude mcp list
```

---

### 3. Cursor

Tạo `.cursor/mcp.json` ở gốc dự án (hoặc `~/.cursor/mcp.json` toàn cục):

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại Cursor và xem Settings > MCP Servers để thấy trạng thái **"Connected"**.

---

### 4. Windsurf

Tạo `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại Windsurf. Gõ `@` trong chat Cascade để thấy các tool `webcake-landing`.

---

### 5. Augment (Extension VS Code)

Mở Command Palette: `Cmd + Shift + P` > **"Augment: Edit MCP Settings"**, rồi thêm:

```json
{
  "mcpServers": {
    "webcake-landing": {
      "command": "node",
      "args": ["/absolute-path/webcake-landing-mcp/dist/index.js"],
      "env": {
        "WEBCAKE_API_BASE": "http://localhost:5800",
        "WEBCAKE_JWT": "<your-jwt>"
      }
    }
  }
}
```

Khởi động lại VS Code.

---

### 6. Codex (OpenAI CLI)

Thêm vào `~/.codex/config.toml`:

```toml
[mcp_servers.webcake-landing]
command = "node"
args = ["/absolute-path/webcake-landing-mcp/dist/index.js"]
env = { "WEBCAKE_API_BASE" = "http://localhost:5800", "WEBCAKE_JWT" = "<your-jwt>" }
```

Kiểm tra:
```bash
codex mcp list
```
