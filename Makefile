.PHONY: help cluster-up cluster-down secrets build load deploy undeploy check test typecheck lint chart-check secret-scan scaffold-verify
APPS := gateway woo-mcp mcp-time mcp-notes dashboard
NS := urumi

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

cluster-up: ## create local k3d cluster
	./scripts/cluster-up.sh
cluster-down: ## delete local cluster
	./scripts/cluster-down.sh
secrets: ## create K8s secrets (needs LLM_API_KEY, BOOTSTRAP_ADMIN_PASSWORD in env)
	./scripts/create-secrets.sh
build: ## build all docker images as urumi/<app>:dev
	@for a in $(APPS); do docker build -t urumi/$$a:dev apps/$$a || exit 1; done
load: ## import images into k3d
	@for a in $(APPS); do k3d image import urumi/$$a:dev -c urumi || exit 1; done
deploy: ## helm upgrade --install (local values)
	helm upgrade --install urumi charts/urumi -n $(NS) --create-namespace -f charts/urumi/values-local.yaml --set-string gateway.image.tag=dev --set-string wooMcp.image.tag=dev --set-string mcpTime.image.tag=dev --set-string mcpNotes.image.tag=dev --set-string dashboard.image.tag=dev
undeploy: ## helm uninstall
	helm uninstall urumi -n $(NS)
typecheck: ## tsc --noEmit in every app (run npm install first)
	@for a in $(APPS); do (cd apps/$$a && npm run -s typecheck) || exit 1; done
lint: ## lint every app
	@for a in $(APPS); do (cd apps/$$a && npm run -s lint) || exit 1; done
test: ## run tests in every app
	@for a in $(APPS); do (cd apps/$$a && npm test --silent) || exit 1; done
chart-check: ## helm lint/template + policy check
	./scripts/check-chart.sh
secret-scan: ## scan for hardcoded secrets
	./scripts/check-secrets.sh
scaffold-verify: ## ensure guardrail docs/files exist
	./scripts/scaffold-verify.sh
check: scaffold-verify secret-scan chart-check lint typecheck test ## everything agents must pass before finishing
