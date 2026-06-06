#!/bin/bash

# ═══════════════════════════════════════════════════════════
#  Webcake Landing MCP - Cai dat tu dong (macOS / Linux)
#  Ho tro: Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex
#
#  Dung sau khi clone:
#    ./install.sh
#  Tu xa:
#    curl -fsSL https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.sh | bash
#  Go cai dat:
#    ./install.sh --uninstall
# ═══════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

print_banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}Webcake Landing MCP - Cai dat${NC}                  ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  Sinh & sua landing page Webcake tu yeu cau      ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  12 tools | element schema | validate + persist  ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

NAME="webcake-landing"
REPO_URL="https://github.com/vuluu2k/webcake-landing-mcp.git"
DEFAULT_INSTALL_DIR="$HOME/.webcake-landing-mcp"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# ── Node.js ──
install_node() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &> /dev/null; then
      info "Cai Node.js qua Homebrew..."; brew install node@20
      brew link --overwrite node@20 2>/dev/null || brew link --force node@20 2>/dev/null || true
    else
      info "Cai Homebrew truoc..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      [ -f "/opt/homebrew/bin/brew" ] && eval "$(/opt/homebrew/bin/brew shellenv)"
      [ -f "/usr/local/bin/brew" ] && eval "$(/usr/local/bin/brew shellenv)"
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || brew link --force node@20 2>/dev/null || true
    fi
  elif command -v apt-get &> /dev/null; then
    info "Cai Node.js 20 qua NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -; sudo apt-get install -y nodejs
  elif command -v yum &> /dev/null; then
    info "Cai Node.js 20 qua NodeSource..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -; sudo yum install -y nodejs
  else
    error "Khong the tu cai Node.js tren OS nay. Cai thu cong: https://nodejs.org/"; exit 1
  fi
  command -v node &> /dev/null || { error "Cai Node.js that bai. https://nodejs.org/"; exit 1; }
  success "Node.js $(node -v) da cai"
}

check_node() {
  local need=false
  if ! command -v node &> /dev/null; then warn "Node.js chua duoc cai."; need=true
  else
    local major; major=$(node -v | sed 's/v//' | cut -d. -f1)
    [ "$major" -lt 18 ] && { warn "Can Node.js >= 18. Hien tai: $(node -v)"; need=true; }
  fi
  if [ "$need" = true ]; then
    read -rp "  Cai Node.js 20 LTS tu dong? (Y/n): " a < /dev/tty; a="${a:-Y}"
    [[ "$a" =~ ^[Yy]$ ]] && install_node || { error "Can Node.js >= 18. Cai xong chay lai."; exit 1; }
  fi
  NODE_BIN="$(command -v node)"; case "$NODE_BIN" in /*) ;; *) NODE_BIN="/usr/local/bin/node" ;; esac
  success "Node.js $(node -v) tai ${BOLD}$NODE_BIN${NC}"
}

check_npm() { command -v npm &> /dev/null || { error "Chua cai npm."; exit 1; }; success "npm $(npm -v)"; }

# ── Cai MCP server (local hoac clone) ──
install_mcp() {
  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q "webcake-landing-mcp" "$SCRIPT_DIR/package.json" 2>/dev/null; then
    INSTALL_DIR="$SCRIPT_DIR"; info "Chay tu repo da clone: $INSTALL_DIR"
  else
    info "Cai MCP server o dau?"; echo -e "  Mac dinh: ${BOLD}$DEFAULT_INSTALL_DIR${NC}"
    read -rp "  Duong dan (Enter de dung mac dinh): " INSTALL_DIR < /dev/tty
    INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"; INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Cap nhat code..."; ( cd "$INSTALL_DIR" && git pull origin main 2>/dev/null || git pull 2>/dev/null || warn "Git pull that bai" )
    elif [ ! -d "$INSTALL_DIR" ]; then
      info "Dang clone repository..."; git clone "$REPO_URL" "$INSTALL_DIR"
    fi
  fi
  info "Cai dependencies..."; ( cd "$INSTALL_DIR" && npm install )
  info "Build TypeScript..."; ( cd "$INSTALL_DIR" && npm run build )
  MCP_INDEX="$INSTALL_DIR/dist/index.js"
  success "MCP server san sang: $MCP_INDEX"
}

# ── Thu thap cau hinh (tat ca tuy chon) ──
collect_env() {
  echo ""; echo -e "${BOLD}── Cau hinh (Enter de bo qua — nhom tool tham chieu chay khong can creds) ──${NC}"; echo ""
  # defaults: tu .env (neu co) hoac bien moi truong
  [ -f "$INSTALL_DIR/.env" ] && { set -a; . "$INSTALL_DIR/.env"; set +a; }
  local d_api="${WEBCAKE_API_BASE:-http://localhost:5800}"
  read -rp "  WEBCAKE_API_BASE [$d_api]: " API_BASE < /dev/tty; API_BASE="${API_BASE:-$d_api}"
  echo -e "  ${YELLOW}WEBCAKE_JWT${NC} (token tai khoan — Enter de bo qua):"
  read -rp "  WEBCAKE_JWT: " JWT < /dev/tty; JWT="${JWT:-${WEBCAKE_JWT:-}}"
  read -rp "  WEBCAKE_ORG_ID (Enter de bo qua): " ORG_ID < /dev/tty; ORG_ID="${ORG_ID:-${WEBCAKE_ORG_ID:-}}"
  APP_BASE="${WEBCAKE_APP_BASE:-}"   # hiem dung — lay tu env neu co
  echo ""; success "Cau hinh:"
  echo "  API base : $API_BASE"
  if [ -n "$JWT" ]; then echo "  JWT      : ${JWT:0:8}…(${#JWT} ky tu)"; else echo -e "  JWT      : ${YELLOW}(chua set)${NC}"; fi
  [ -n "$ORG_ID" ] && echo "  Org id   : $ORG_ID"
}

# env -> -e args (chi key co gia tri)
cli_env_args() {
  local s=""
  [ -n "$API_BASE" ] && s="$s -e WEBCAKE_API_BASE=\"$API_BASE\""
  [ -n "$JWT" ]      && s="$s -e WEBCAKE_JWT=\"$JWT\""
  [ -n "$ORG_ID" ]   && s="$s -e WEBCAKE_ORG_ID=\"$ORG_ID\""
  [ -n "$APP_BASE" ] && s="$s -e WEBCAKE_APP_BASE=\"$APP_BASE\""
  echo "$s"
}
toml_env() {
  local parts="" pair k v
  for pair in "WEBCAKE_API_BASE=$API_BASE" "WEBCAKE_JWT=$JWT" "WEBCAKE_ORG_ID=$ORG_ID" "WEBCAKE_APP_BASE=$APP_BASE"; do
    k="${pair%%=*}"; v="${pair#*=}"; [ -n "$v" ] || continue
    [ -n "$parts" ] && parts="$parts, "; parts="$parts\"$k\" = \"$v\""
  done
  echo "$parts"
}

# Doc/tao file JSON, set mcpServers[NAME] (gia tri truyen qua env de tranh loi quoting)
merge_json() {
  local file="$1"; mkdir -p "$(dirname "$file")"
  MCP_NAME="$NAME" MCP_NODE="$NODE_BIN" MCP_INDEX="$MCP_INDEX" MCP_CFG="$file" \
  E_API="$API_BASE" E_JWT="$JWT" E_ORG="$ORG_ID" E_APP="$APP_BASE" \
  node -e '
    const fs=require("fs"), f=process.env.MCP_CFG;
    let c={}; try{ if(fs.existsSync(f)&&fs.readFileSync(f,"utf8").trim()) c=JSON.parse(fs.readFileSync(f,"utf8")); }
    catch(e){ console.error("  ! parse fail "+f+": "+e.message); process.exit(0); }
    const env={};
    for(const [k,e] of [["WEBCAKE_API_BASE","E_API"],["WEBCAKE_JWT","E_JWT"],["WEBCAKE_ORG_ID","E_ORG"],["WEBCAKE_APP_BASE","E_APP"]])
      if(process.env[e]) env[k]=process.env[e];
    if(typeof c.mcpServers!=="object"||!c.mcpServers) c.mcpServers={};
    c.mcpServers[process.env.MCP_NAME]={command:process.env.MCP_NODE,args:[process.env.MCP_INDEX],...(Object.keys(env).length?{env}:{})};
    fs.writeFileSync(f, JSON.stringify(c,null,2)+"\n");
  '
}

configure_claude_code() {
  info "Cau hinh Claude Code..."
  if command -v claude &> /dev/null; then
    eval "claude mcp remove $NAME 2>/dev/null || true"
    eval "claude mcp add $NAME$(cli_env_args) -- \"$NODE_BIN\" \"$MCP_INDEX\""
    success "Claude Code da cau hinh (qua CLI) — kiem tra: claude mcp list"
  else
    merge_json "$HOME/.claude.json"; success "Claude Code da cau hinh ($HOME/.claude.json)"
  fi
}
configure_claude_desktop() {
  info "Cau hinh Claude Desktop..."
  local dir="$HOME/Library/Application Support/Claude"; [ -d "$dir" ] || dir="$HOME/.config/Claude"
  merge_json "$dir/claude_desktop_config.json"; success "Claude Desktop da cau hinh"; warn "Khoi dong lai Claude Desktop"
}
configure_cursor()   { info "Cau hinh Cursor...";   merge_json "$HOME/.cursor/mcp.json"; success "Cursor da cau hinh"; }
configure_windsurf() { info "Cau hinh Windsurf..."; merge_json "$HOME/.codeium/windsurf/mcp_config.json"; success "Windsurf da cau hinh"; }
configure_augment()  {
  info "Cau hinh Augment / VS Code..."
  local dir="$HOME/.vscode"
  [ -d "$HOME/Library/Application Support/Code/User" ] && dir="$HOME/Library/Application Support/Code/User"
  [ -d "$HOME/.config/Code/User" ] && dir="$HOME/.config/Code/User"
  merge_json "$dir/mcp.json"; success "Augment/VS Code da cau hinh ($dir/mcp.json)"
}
configure_codex() {
  info "Cau hinh Codex (OpenAI)..."
  local dir="$HOME/.codex" cfg="$HOME/.codex/config.toml"; mkdir -p "$dir"
  local envt; envt="$(toml_env)"; local envline=""; [ -n "$envt" ] && envline="env = { $envt }"
  local block; block="
[mcp_servers.$NAME]
command = \"$NODE_BIN\"
args = [\"$MCP_INDEX\"]
$envline"
  if [ -f "$cfg" ] && grep -q "\[mcp_servers\.$NAME\]" "$cfg"; then
    MCP_CFG="$cfg" MCP_NAME="$NAME" node -e '
      const fs=require("fs"),f=process.env.MCP_CFG,n=process.env.MCP_NAME;
      let c=fs.readFileSync(f,"utf8");
      c=c.replace(new RegExp("\\n?\\[mcp_servers\\."+n+"\\][\\s\\S]*?(?=\\n\\[|$)"),"");
      fs.writeFileSync(f,c.trimEnd()+"\n");' 2>/dev/null
    info "Thay the block $NAME cu..."
  fi
  [ -f "$cfg" ] || echo "# Webcake Landing MCP" > "$cfg"
  printf '%s\n' "$block" >> "$cfg"
  success "Codex da cau hinh ($cfg) — khoi dong lai Codex"
}

select_ides() {
  echo ""; echo -e "${BOLD}── Chon IDE/Tool de cau hinh ──${NC}"; echo ""
  echo "  1) Claude Desktop"; echo "  2) Claude Code (CLI)"; echo "  3) Cursor"
  echo "  4) Windsurf"; echo "  5) Augment (VS Code)"; echo "  6) Codex (OpenAI)"
  echo "  7) Tat ca"; echo "  0) Bo qua"; echo ""
  read -rp "  Chon (phan cach bang dau phay, vd 1,2): " choice < /dev/tty
  local IFS=','; read -ra picks <<< "$choice"
  for c in "${picks[@]}"; do
    c="$(echo "$c" | tr -d ' ')"
    case "$c" in
      1) configure_claude_desktop ;; 2) configure_claude_code ;; 3) configure_cursor ;;
      4) configure_windsurf ;; 5) configure_augment ;; 6) configure_codex ;;
      7) configure_claude_desktop; configure_claude_code; configure_cursor; configure_windsurf; configure_augment; configure_codex ;;
      0) info "Bo qua cau hinh IDE." ;; *) warn "Lua chon khong hop le: $c" ;;
    esac
  done
}

verify() {
  echo ""; info "Kiem tra cai dat..."
  [ -f "$MCP_INDEX" ] && node --check "$MCP_INDEX" 2>/dev/null && success "MCP server syntax OK" || warn "Khong kiem tra duoc $MCP_INDEX"
}

print_summary() {
  echo ""; echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Cai dat thanh cong!${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"; echo ""
  echo -e "  Node.js    : ${BOLD}$NODE_BIN${NC}"
  echo -e "  MCP Server : ${BOLD}$MCP_INDEX${NC}"
  echo -e "  API base   : ${API_BASE:-（chua set）}"; echo ""
  echo -e "  ${BOLD}Buoc tiep theo:${NC} khoi dong lai IDE, roi yeu cau AI: \"Tao landing page Webcake\"."
  echo -e "  ${BOLD}Kiem tra (Claude Code):${NC} claude mcp list"; echo ""
}

uninstall() {
  print_banner; echo -e "${BOLD}── Go cai dat Webcake Landing MCP ──${NC}"; echo ""
  command -v claude &> /dev/null && { claude mcp remove "$NAME" 2>/dev/null && success "Da xoa khoi Claude Code" || true; }
  for cf in \
    "$HOME/.claude.json" \
    "$HOME/Library/Application Support/Claude/claude_desktop_config.json" \
    "$HOME/.config/Claude/claude_desktop_config.json" \
    "$HOME/.cursor/mcp.json" \
    "$HOME/.codeium/windsurf/mcp_config.json" \
    "$HOME/Library/Application Support/Code/User/mcp.json" \
    "$HOME/.config/Code/User/mcp.json"; do
    [ -f "$cf" ] && MCP_CFG="$cf" MCP_NAME="$NAME" node -e '
      const fs=require("fs"),f=process.env.MCP_CFG;
      try{ const c=JSON.parse(fs.readFileSync(f,"utf8")); if(c.mcpServers){ delete c.mcpServers[process.env.MCP_NAME]; fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n"); } }catch(e){}' 2>/dev/null \
      && success "Da don $cf" || true
  done
  local codex="$HOME/.codex/config.toml"
  [ -f "$codex" ] && MCP_CFG="$codex" MCP_NAME="$NAME" node -e '
    const fs=require("fs"),f=process.env.MCP_CFG,n=process.env.MCP_NAME;
    let c=fs.readFileSync(f,"utf8"); c=c.replace(new RegExp("\\n?\\[mcp_servers\\."+n+"\\][\\s\\S]*?(?=\\n\\[|$)"),"");
    fs.writeFileSync(f,c.trimEnd()+"\n");' 2>/dev/null && success "Da don Codex config.toml" || true
  echo ""; success "Go cai dat xong. Khoi dong lai IDE."
}

main() {
  print_banner
  case "${1:-}" in --uninstall|uninstall) uninstall; exit 0 ;; esac
  check_node; check_npm
  install_mcp; collect_env; select_ides; verify; print_summary
}
main "$@"
