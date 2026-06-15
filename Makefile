FLY_APP ?= korovan
FLY_REGION ?= iad

.PHONY: fly-setup fly-deploy fly-logs fly-status fly-ssh fly-secrets

## First-time Fly.io setup (run once per environment).
## Prerequisites: flyctl installed (brew install flyctl), fly auth login
fly-setup:
	fly launch --name $(FLY_APP) --region $(FLY_REGION) --no-deploy --copy-config
	fly volumes create korovan_data --region $(FLY_REGION) --size 1 --app $(FLY_APP)
	@echo ""
	@echo "==> Now set secrets (substituting real values):"
	@echo "    fly secrets set DATABASE_PATH=/data/korovan.db AI_API_KEY=<key> SESSION_SECRET=<secret>"
	@echo ""
	@echo "==> Then deploy:"
	@echo "    make fly-deploy"

## Deploy to Fly.io (rolling strategy — zero-downtime for single-machine demo).
fly-deploy:
	fly deploy --app $(FLY_APP) --strategy rolling

## Tail live logs.
fly-logs:
	fly logs --app $(FLY_APP)

## Show machine status.
fly-status:
	fly status --app $(FLY_APP)

## SSH into running machine.
fly-ssh:
	fly ssh console --app $(FLY_APP)

## Print current secrets (keys only, not values).
fly-secrets:
	fly secrets list --app $(FLY_APP)
