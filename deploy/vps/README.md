# Deploy to a private-IP VPS behind nginx/OpenResty

**English** · [Tiếng Việt](README.vi.md)

```
Client ──https──▶ OpenResty (public IP, TLS) ──http──▶ VPS 10.0.0.5:8787 ──▶ webcake-mcp container
                                                                     ├─ redis    (cache)
                                                                     └─ postgres (OAuth store)
```

Files in this folder:

| File | Where it's used |
|------|-----------------|
| `docker-compose.yml` | Private VPS: MCP + Redis + Postgres (reuses `deploy/coolify/Dockerfile`) |
| `Makefile` | `make deploy` / `update` / `logs`… (manual deploy shortcuts) |
| `.env.example` | `.env` template (private IP, Postgres password, optional keys) |
| `nginx.conf` | Site config for the public OpenResty/nginx box |
| `../../.github/workflows/deploy-vps.yml` | Auto-deploy via a self-hosted runner on the VPS |

## 1. Prepare the private VPS

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh

# Only the proxy may reach port 8787
ufw allow from <openresty-ip> to any port 8787 proto tcp
```

## 2a. Automatic deploy (GitHub Actions + self-hosted runner) — recommended

**Install the runner on the VPS**: in the GitHub repo, go to *Settings → Actions → Runners → New self-hosted runner → Linux*
and run exactly the commands GitHub shows (download + `./config.sh`). When `config.sh` asks for **labels**, enter `webcake-vps`.
Then install it as a service so it starts again after a reboot:

```bash
sudo useradd -m -s /bin/bash gh-runner && sudo usermod -aG docker gh-runner
# (extract + ./config.sh as the gh-runner user, in /home/gh-runner/actions-runner)
cd /home/gh-runner/actions-runner
sudo ./svc.sh install gh-runner && sudo ./svc.sh start
```

The runner only makes **outbound** connections to GitHub, so the VPS needs no public IP and no open port.

**Set the variables** in *Settings → Secrets and variables → Actions*:

| Kind | Name | Value |
|------|------|-------|
| Variable | `BIND_IP` | The VPS private IP, e.g. `10.0.0.5` |
| Variable | `HOST_PORT` | (optional) defaults to `8787` |
| Variable | `WEBCAKE_ENV` | (optional) `prod` / `staging` |
| Secret | `PG_PASSWORD` | `openssl rand -hex 16`. **Set it once and never change it**: Postgres only applies the password when the volume is first initialized. |
| Secret | `PEXELS_API_KEY`, `MICROLINK_API_KEY` | (optional) |

The workflow uses the `production` environment. Create it under *Settings → Environments*; you can enable *Required reviewers* to approve each deploy by hand.

**Run it**: a push to `main` that touches `src/**`, `deploy/vps/**`, etc. deploys automatically. You can also use *Actions → Deploy VPS → Run workflow*.

> ⚠️ The repo is public, so the workflow deliberately has **no** `pull_request` trigger: a fork PR would run arbitrary code on the VPS.
> Don't add one. Also enable *Settings → Actions → General → Fork pull request workflows → Require approval for all outside collaborators*.

## 2b. Manual deploy (without Actions)

```bash
git clone https://github.com/<owner>/webcake-landing-mcp.git /opt/webcake-mcp
cd /opt/webcake-mcp/deploy/vps
make env && nano .env                  # creates .env with a random PG_PASSWORD; set BIND_IP
make deploy                            # build + start + health check
```

| Command | What it does |
|---------|--------------|
| `make deploy` | build + (re)start + health check + prune old images |
| `make update` | `git pull --ff-only`, then `make deploy` |
| `make logs` / `make ps` | follow server logs / container status |
| `make restart` / `make down` | restart the server / stop the stack (volumes kept) |
| `make health` | curl `http://BIND_IP:HOST_PORT/health` |

No `make` on the box? `apt install make`, or use `docker compose up -d --build` directly.

## 3. Configure OpenResty/nginx (the public box)

```bash
# Copy nginx.conf, then edit mcp.example.com + 10.0.0.5 + the cert paths
sudo cp nginx.conf /usr/local/openresty/nginx/conf/conf.d/webcake-mcp.conf   # or /etc/nginx/conf.d/
sudo openresty -t && sudo openresty -s reload                                 # nginx: nginx -t && nginx -s reload
```

No certificate yet? Run `certbot certonly --webroot -w /var/www/certbot -d mcp.example.com`. The port-80 block already serves `/.well-known/acme-challenge/`.

Three things in the config are **required** (don't remove them):

- `X-Forwarded-Host` + `X-Forwarded-Proto`: the server builds its public URL (OAuth issuer, callback) from these. Without them it advertises `http://10.0.0.5:8787` and the Claude connector can't log in.
- `proxy_buffering off` + `proxy_read_timeout 3600s`: needed for Streamable HTTP/SSE. With buffering on, streams hang.
- `client_max_body_size 20m`: `create_page` payloads can be large.

## 4. Verify

```bash
curl https://mcp.example.com/health
curl -s https://mcp.example.com/.well-known/oauth-authorization-server | jq .issuer   # must be "https://mcp.example.com"
```

To add it in Claude, go to *Settings → Connectors → Add custom connector* and enter `https://mcp.example.com/mcp`.

## Notes

- **Run a single instance.** MCP sessions live in process memory. Multiple replicas behind the upstream need stickiness on the `mcp-session-id` header.
- Logs: `docker compose logs -f webcake-mcp`. Postgres/Redis data lives in the `webcake-mcp_pg-data` / `webcake-mcp_redis-data` volumes, which persist across deploys.
- For a lighter image without Playwright, add `args: { ENABLE_PLAYWRIGHT: "0" }` under `build:` and remove the two `RENDER_SCREENSHOT_*` lines.
