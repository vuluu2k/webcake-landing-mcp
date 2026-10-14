# Deploy lên VPS IP nội bộ + nginx/OpenResty

[English](README.md) · **Tiếng Việt**

```
Client ──https──▶ OpenResty (IP public, TLS) ──http──▶ VPS 10.0.0.5:8787 ──▶ container webcake-mcp
                                                                     ├─ redis    (cache)
                                                                     └─ postgres (OAuth store)
```

Files trong thư mục này:

| File | Dùng ở đâu |
|------|-----------|
| `docker-compose.yml` | VPS nội bộ: MCP + Redis + Postgres (dùng lại `deploy/coolify/Dockerfile`) |
| `Makefile` | `make deploy` / `update` / `logs`… (lệnh tắt deploy tay) |
| `.env.example` | Mẫu `.env` (IP nội bộ, mật khẩu Postgres, key tuỳ chọn) |
| `nginx.conf` | Site config cho con OpenResty/nginx public |
| `../../.github/workflows/deploy-vps.yml` | Auto-deploy qua self-hosted runner trên VPS |

## 1. Chuẩn bị VPS nội bộ

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh

# Chỉ con proxy được gọi vào port 8787
ufw allow from <IP-openresty> to any port 8787 proto tcp
```

## 2a. Deploy tự động (GitHub Actions + self-hosted runner) — khuyến nghị

**Cài runner trên VPS** — GitHub repo → *Settings → Actions → Runners → New self-hosted runner → Linux*,
chạy đúng các lệnh GitHub đưa (download + `./config.sh`). Khi `config.sh` hỏi **labels**, nhập `webcake-vps`.
Sau đó cài thành service để tự chạy khi reboot:

```bash
sudo useradd -m -s /bin/bash gh-runner && sudo usermod -aG docker gh-runner
# (giải nén + ./config.sh dưới user gh-runner, trong /home/gh-runner/actions-runner)
cd /home/gh-runner/actions-runner
sudo ./svc.sh install gh-runner && sudo ./svc.sh start
```

Runner chỉ kết nối **ra ngoài** tới GitHub — VPS không cần IP public hay mở port.

**Khai báo biến** — repo → *Settings → Secrets and variables → Actions*:

| Loại | Tên | Giá trị |
|------|-----|---------|
| Variable | `BIND_IP` | IP nội bộ của VPS, vd `10.0.0.5` |
| Variable | `HOST_PORT` | (tuỳ chọn) mặc định `8787` |
| Variable | `WEBCAKE_ENV` | (tuỳ chọn) `prod` / `staging` |
| Secret | `PG_PASSWORD` | `openssl rand -hex 16` — **đặt 1 lần, đừng đổi** (Postgres chỉ nhận mật khẩu lúc khởi tạo volume) |
| Secret | `PEXELS_API_KEY`, `MICROLINK_API_KEY` | (tuỳ chọn) |

Workflow dùng environment `production` — tạo nó ở *Settings → Environments* (có thể bật *Required reviewers* để duyệt tay trước mỗi deploy).

**Chạy** — thay đổi `src/**` trên `main` tự deploy **sau khi Auto Release chạy thành công** (VPS chạy đúng version đã bump, release lỗi thì không deploy); push chỉ đổi `deploy/vps/**`, `scripts/**`, deps thì deploy ngay; hoặc *Actions → Deploy VPS → Run workflow*.

> ⚠️ Repo public: workflow cố ý **không** có trigger `pull_request` — PR từ fork sẽ chạy code tuỳ ý trên VPS.
> Đừng thêm. Nên bật thêm *Settings → Actions → General → Fork pull request workflows → Require approval for all outside collaborators*.

## 2b. Deploy tay (không dùng Actions)

```bash
git clone https://github.com/<owner>/webcake-landing-mcp.git /opt/webcake-mcp
cd /opt/webcake-mcp/deploy/vps
make env && nano .env                  # tạo .env với PG_PASSWORD ngẫu nhiên; sửa BIND_IP
make deploy                            # build + chạy + health check
```

| Lệnh | Tác dụng |
|------|----------|
| `make deploy` | build + (re)start + health check + dọn image cũ |
| `make update` | `git pull --ff-only` rồi `make deploy` |
| `make logs` / `make ps` | xem log server / trạng thái container |
| `make restart` / `make down` | restart server / dừng stack (giữ volume) |
| `make health` | curl `http://BIND_IP:HOST_PORT/health` |

Máy chưa có `make`? `apt install make`, hoặc dùng thẳng `docker compose up -d --build`.

## 3. Cấu hình OpenResty/nginx (con public)

```bash
# Copy nginx.conf, sửa mcp.example.com + 10.0.0.5 + đường dẫn cert
sudo cp nginx.conf /usr/local/openresty/nginx/conf/conf.d/webcake-mcp.conf   # hoặc /etc/nginx/conf.d/
sudo openresty -t && sudo openresty -s reload                                 # nginx: nginx -t && nginx -s reload
```

Chưa có cert: `certbot certonly --webroot -w /var/www/certbot -d mcp.example.com` (block port 80 đã chừa sẵn `/.well-known/acme-challenge/`).

Ba thứ **bắt buộc** trong config (đừng xoá):

- `X-Forwarded-Host` + `X-Forwarded-Proto` — server dựng URL public (OAuth issuer, callback) từ đây; thiếu thì nó quảng cáo `http://10.0.0.5:8787` và Claude connector không login được.
- `proxy_buffering off` + `proxy_read_timeout 3600s` — Streamable HTTP/SSE; bật buffer là stream bị treo.
- `client_max_body_size 20m` — payload `create_page` lớn.

## 4. Kiểm tra

```bash
curl https://mcp.example.com/health
curl -s https://mcp.example.com/.well-known/oauth-authorization-server | jq .issuer   # phải là "https://mcp.example.com"
```

Thêm vào Claude: *Settings → Connectors → Add custom connector* → `https://mcp.example.com/mcp`.

## Ghi chú

- **Chạy 1 instance.** Session MCP nằm trong RAM của process; nhiều replica sau upstream thì phải sticky theo header `mcp-session-id`.
- Log: `docker compose logs -f webcake-mcp`. Dữ liệu Postgres/Redis nằm trong volume `webcake-mcp_pg-data` / `webcake-mcp_redis-data` (giữ qua mỗi lần deploy).
- Bỏ Playwright cho image nhẹ hơn: thêm `args: { ENABLE_PLAYWRIGHT: "0" }` vào `build:` và xoá 2 dòng `RENDER_SCREENSHOT_*`.
