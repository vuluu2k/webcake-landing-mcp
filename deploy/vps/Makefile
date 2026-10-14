# Shortcuts for the plain-VPS stack. Run from deploy/vps (or `make -C deploy/vps <target>`).
#   make deploy   build + (re)start + health check
#   make update   git pull, then deploy

-include .env
BIND_IP   ?= 127.0.0.1
HOST_PORT ?= 8787
DC := docker compose

.PHONY: deploy update check health logs ps restart down env

deploy: check
	$(DC) up -d --build --remove-orphans
	@$(MAKE) --no-print-directory health
	docker image prune -f

update:
	git pull --ff-only
	@$(MAKE) --no-print-directory deploy

health:
	@for _ in $$(seq 1 30); do \
	  curl -fsS http://$(BIND_IP):$(HOST_PORT)/health && echo && exit 0; sleep 2; \
	done; $(DC) logs --tail 100 webcake-mcp; exit 1

logs:
	$(DC) logs -f --tail 200 webcake-mcp

ps:
	$(DC) ps

restart:
	$(DC) restart webcake-mcp

down:
	$(DC) down

check:
	@test -f .env || { echo "No .env — run 'make env' first."; exit 1; }

# First run: create .env with a random Postgres password, then edit BIND_IP.
env:
	@test ! -f .env || { echo ".env already exists."; exit 1; }
	@sed "s/^PG_PASSWORD=.*/PG_PASSWORD=$$(openssl rand -hex 16)/" .env.example > .env
	@echo "Created .env — set BIND_IP, then run 'make deploy'."
