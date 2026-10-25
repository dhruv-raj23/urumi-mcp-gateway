# Urumi — Team MCP Gateway + WooCommerce on Kubernetes

Urumi is a Kubernetes-hosted MCP gateway aggregating WooCommerce, Time and
Notes MCP servers behind one client-facing Streamable HTTP endpoint. It
includes a dashboard, admin/member authentication, per-user API keys, audit
logging and a chat agent that calls tools through the gateway.

- Assignment: `docs/00-assignment.md`
- Architecture: `docs/02-architecture.md`
- Contracts: `docs/03-contracts.md`
- Threat model: `docs/04-threat-model.md`
- Design and trade-offs: `docs/05-design-and-tradeoffs.md`
- Production runbook: `docs/07-production.md`
- Requirement evidence: `docs/01-requirements-traceability.md`

## 1. Components and network boundaries

- **Dashboard:** browser UI.
- **Gateway:** sessions, API-key authentication, MCP aggregation and routing,
  audit logging, REST API and chat agent.
- **Woo MCP:** translates five MCP tools into WooCommerce REST API v3 calls.
- **Time and Notes MCP:** independent upstreams demonstrating aggregation,
  duplicate tool names and failure isolation.
- **WordPress/WooCommerce and MariaDB:** storefront, products and orders.
- **MongoDB:** gateway users, API-key hashes, server configuration and audit.
- **Traefik Ingress:** publishes the storefront and dashboard/gateway routes.

The local cluster uses namespace `urumi` and Helm release `urumi`.

- Dashboard and gateway: `http://app.localhost`
- Storefront: `http://store.localhost`
- External MCP endpoint: `http://app.localhost/mcp`

Databases and upstream MCP Services are ClusterIP-only and are not published
through public Ingress.

## 2. Prerequisites

Install Docker Desktop with its engine running, WSL 2 if developing from WSL,
Git, Node.js/npm, `make`, kubectl, Helm and k3d.

## 3. Local setup

Clone the repository:

```bash
git clone https://github.com/dhruv-raj23/urumi-mcp-gateway.git
cd urumi-mcp-gateway
```

Create the local k3d cluster:

```bash
make cluster-up
kubectl config current-context
kubectl get nodes
```

Supply the bootstrap password and LLM provider key through hidden prompts.
Do not put secret values in Git or print them in terminal output:

```bash
read -rsp "Bootstrap admin password: " BOOTSTRAP_ADMIN_PASSWORD
echo
export BOOTSTRAP_ADMIN_PASSWORD

read -rsp "LLM provider API key: " LLM_API_KEY
echo
export LLM_API_KEY
export BOOTSTRAP_ADMIN_EMAIL=admin@example.com

make secrets
unset BOOTSTRAP_ADMIN_PASSWORD LLM_API_KEY
```

The Secrets script preserves existing Secrets by default. Do not force-recreate
Secrets on an established cluster without planning the effects on credentials
and persisted data.

Build, import and deploy the local application images:

```bash
make build
make load
make deploy
```

The build and load targets use `urumi/<app>:dev` images. The local deploy
target overrides Helm image tags to `dev` so it deploys those images.

Check readiness and browser endpoints:

```bash
kubectl get pods -n urumi
kubectl get services,ingress,pvc -n urumi
helm status urumi -n urumi

curl -sS -o /dev/null -w 'dashboard HTTP %{http_code}\n' http://app.localhost/
curl -sS -o /dev/null -w 'store HTTP %{http_code}\n' http://store.localhost/
```

Both browser endpoints should return HTTP 200 when healthy. First startup can
take time while WordPress and WooCommerce initialization completes.

If `*.localhost` fails to resolve in your environment, check hostname
resolution. Depending on the host/client, add `127.0.0.1 app.localhost` and
`127.0.0.1 store.localhost` to the appropriate hosts file. Do not expose
internal services as a workaround.

### Developer checks

```bash
for app in gateway woo-mcp mcp-time mcp-notes dashboard; do
  npm --prefix "apps/$app" ci
done
make check
```

The current lint targets are TODO stubs; they do not represent a configured
ESLint run.

## 4. Dashboard and users

Open `http://app.localhost` and sign in with the bootstrap admin email and
the password supplied to the Secrets script.

The admin can manage upstream servers, invite users and inspect audit records.
Create two distinct member users for the acceptance demonstration:

- **User A:** uses the dashboard chat agent.
- **User B:** connects through an external MCP client.

Each member should create their own API key. The full key is shown only once.
Store it securely in the intended client configuration. Never put it in Git,
screenshots or a recording. Revoking a key should make the next request using
it unauthorized.

Members are scoped to their own keys and audit entries. Admins have broader
administrative and audit visibility. Tool access uses a fixed role-based
allowlist: members can see and invoke approved read-only tools, while admins
can use all otherwise available tools. Unknown tools are denied to members
by default, and denied calls are recorded in the audit log.

## 5. Place a WooCommerce order

1. Open `http://store.localhost`.
2. Add a test product to the cart.
3. Complete checkout using Cash on Delivery and test data.
4. Open WordPress administration and go to WooCommerce → Orders.
5. Confirm the new order appears.

Use only test data. Avoid recording customer-identifying information.

## 6. Use the dashboard chat agent

Sign in as User A and try prompts such as:

- `Create a product named "Urumi Demo Product A" priced at 19.99.`
- `What orders came in today?`
- `What time is it in Asia/Kolkata, and list today's orders.`

Confirm that the tool-call summary appears in chat. Check the audit log to
verify calls are attributed to User A with `source=chat`.

The chat agent gets its tools from the same aggregator as external MCP clients
and routes calls through the user-aware gateway path. The LLM provider key is
configured server-side through Kubernetes Secret-backed configuration.

## 7. Connect an external MCP client

Configure a supported Streamable HTTP MCP client to use:

`http://app.localhost/mcp`

Use **User B's API key only** as the bearer token:

`Authorization: Bearer <USER_B_API_KEY>`

Never paste the real key into this README or a public issue. Use the client's
supported HTTP MCP configuration and secret-storage mechanism.

After connecting, list tools and confirm prefixed names such as
`woo__list_orders`, `woo__get_order`, `time__get_current_time`,
`time__echo` and `notes__echo`. Duplicate tool names are disambiguated using
the server slug.

Try a prompt that retrieves a WooCommerce order and calls another upstream:

`Retrieve order <ID> and give me the current time in Asia/Kolkata.`

Verify external calls are attributed to User B with `source=mcp`.

## 8. Verify revocation and upstream failure handling

For the acceptance demonstration:

1. Revoke User B's API key from the dashboard.
2. Retry an MCP request using that key; expect HTTP 401.
3. Disable Notes in the Server Registry; verify Notes tools disappear from
   the external client's tool list and the chat tool set.
4. Re-enable Notes and confirm its tools return.
5. Make an upstream unavailable, observe its unreachable status, and verify
   other upstreams still work. Restore the upstream afterward.

The local acceptance test disabled `mcp-time` and verified that Woo and Notes
continued working. See `docs/06-demo-script.md` for the full sequence.

## 9. VPS / production-like deployment (k3s)

The same Helm chart is used in both environments:

- Local: `charts/urumi/values-local.yaml`
- Production-like VPS: `charts/urumi/values-prod.yaml`

**A real VPS deployment has not been verified.** Production instructions below
are a deployment plan, not a claim that remote image pulls, DNS, TLS or live
application health have been tested.

Before production deployment:

1. Provision a Linux VPS and install k3s, kubectl and Helm.
2. Configure DNS for `app.<your-domain>` and `store.<your-domain>`.
3. Ensure Traefik is running and configure cert-manager and the
   `letsencrypt-prod` ClusterIssuer.
4. Replace `CHANGE_ME_DOMAIN` in `values-prod.yaml`.
5. Build and publish every custom image referenced by that file, and verify
   that the target cluster can pull the listed repositories and tags.
6. Review the StorageClass, PVC sizes, requests/limits, cookie security and
   NetworkPolicies.
7. Create the required Kubernetes Secrets using a trusted operator process.
   Never put real credentials into values files.

The production values reference GHCR repositories which must be verified
before deployment. `make build` creates local `urumi/<app>:dev` images; it
does not publish images to GHCR. The chart currently has no `imagePullSecrets`
configuration, so custom images must be publicly pullable unless the chart
and cluster are updated for private image pulls.

After verifying prerequisites, use an operator machine:

```bash
kubectl create namespace urumi --dry-run=client -o yaml | kubectl apply -f -

helm lint charts/urumi -f charts/urumi/values-prod.yaml

helm template urumi charts/urumi -n urumi \
  -f charts/urumi/values-prod.yaml \
  > /tmp/urumi-production-render.yaml

helm upgrade --install urumi charts/urumi -n urumi \
  -f charts/urumi/values-prod.yaml \
  --atomic --wait --timeout 20m

helm status urumi -n urumi
helm history urumi -n urumi
kubectl -n urumi get pods,services,ingress,pvc,networkpolicy
kubectl -n urumi get certificates
```

Do not run the production deployment until the domain, issuer, Secrets,
storage and image availability have been checked. See `docs/07-production.md`
for the production and rollback runbook.

The current `local-path` storage configuration is a simple single-node/small
VPS starting point, not highly available storage. Test backup and restore for
MongoDB, MariaDB and WordPress content before using real customer data.

## 10. Design, security and limitations

- The gateway separates client authentication from upstream credentials.
  API keys are hashed for storage; stored upstream credentials are encrypted
  and used server-side.
- Tools use `<serverSlug>__<toolName>` naming, and calls route to the owning
  upstream with bounded timeouts.
- NetworkPolicies restrict service paths. Woo MCP is not exposed by a public
  Ingress.
- Comprehensive SSRF destination filtering is **not implemented**. The URL
  validator checks HTTP(S) and rejects embedded user-info, but does not
  comprehensively block loopback, private, cluster-internal, link-local or
  metadata destinations.
- Role-based tool authorization uses a fixed allowlist in
  `apps/gateway/src/mcp/toolPermissions.ts`. Member tool lists and dashboard
  server metadata are filtered, and restricted direct calls are rejected
  before connecting to an upstream. Comprehensive per-user rate limiting
  is not implemented.
- Browser sessions use stateless signed cookies with an eight-hour expiry.
  A copied cookie may remain valid until expiry after logout if the account
  remains active; disabling the account blocks subsequent requests.
- Audit records retain identity, tool, server, duration and outcome, plus an
  argument hash rather than full tool arguments. Chat history stays in browser
  memory and is sent with requests; the gateway does not persist transcripts.

See `docs/04-threat-model.md` and `docs/05-design-and-tradeoffs.md`.

## 11. Stand-out items attempted

- Additional NetworkPolicy rules and workload hardening:
  `docs/tasks/T08-hardening.md`.
- Local Helm upgrade/rollback rehearsal: `docs/07-production.md`.
- Idempotent default WooCommerce registration with encrypted credential
  storage and repeat-startup handling:
  `apps/gateway/src/db/defaultServers.ts` and
  `apps/gateway/tests/defaultServers.test.ts`. Fresh registration was tested
  against a temporary MongoDB collection.

Role-based tool authorization is implemented and covered by gateway tests.
Comprehensive SSRF destination filtering and comprehensive per-user rate
limiting remain incomplete. A real VPS deployment has not been completed.

## 12. Submission checklist

- [ ] Rehearse and record the two-user demo.
- [ ] Check the video for visible credentials and customer information.
- [ ] Complete the remaining evidence rows in
      `docs/01-requirements-traceability.md`.
- [ ] Submit the video and GitHub repository using:
      https://forms.gle/nftwgyNeenSDmiRb6
