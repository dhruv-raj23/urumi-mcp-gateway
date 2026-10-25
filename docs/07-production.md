# 07 — Production deployment, upgrades and rollback

## 1. Scope and prerequisites

Production configuration lives in `charts/urumi/values-prod.yaml`.
Local k3d configuration lives in `charts/urumi/values-local.yaml`.

Before a production deployment:

- Provision a Linux VPS with sufficient CPU, memory, disk and network capacity.
- Install k3s, kubectl and Helm using their official installation instructions.
- Configure DNS A records for `app.<domain>` and `store.<domain>` to point to
  the VPS public IP.
- Allow inbound TCP 80 and 443, and restrict SSH to trusted addresses.
- Confirm `kubectl get nodes` reports a healthy cluster and Traefik is running.
- Install cert-manager and configure the `letsencrypt-prod` ClusterIssuer.
- Replace `CHANGE_ME_DOMAIN` with a domain you control.
- Build and publish all custom application images under the repositories and
  tags declared in `values-prod.yaml` before deploying.
- Verify that the selected StorageClass exists and has enough capacity.

The current values use `local-path`, suitable as a simple single-node k3s
starting point, not a highly available storage solution. Plan and test backups
and restores for MongoDB, MariaDB and WordPress uploads before real use.

## 2. Container images

The chart does not automatically prepend `global.imageRegistry` to image
references. Production values therefore use fully qualified repositories.

The listed GHCR repositories and custom release tags are intended references;
do not assume images exist until they have actually been built and published.
The local Makefile's `build` target builds `urumi/<app>:dev` images locally;
it does not push production images to GHCR.

The current chart does not configure `imagePullSecrets`. For a fresh cluster,
the listed custom images must therefore be publicly pullable. Supporting
private images requires image-pull-secret configuration in the chart and
Kubernetes.

Use reviewed release tags and consider pinning image digests for stricter
reproducibility. Keep tokens and other credentials out of image URLs, Git,
Helm values and command history.

## 3. DNS, ingress and TLS

The chart creates these ingress routes:

- `app.<domain>` serves the dashboard.
- `app.<domain>/api` and `app.<domain>/mcp` route to the gateway.
- `store.<domain>` serves WordPress.

With TLS enabled, the chart requests certificates from the configured
cert-manager ClusterIssuer. Expected TLS Secret names are `urumi-app-tls`
and `urumi-store-tls`.

Configure and verify the `letsencrypt-prod` ClusterIssuer before rollout.
The DNS records must resolve to the VPS, and the required ACME challenge
ports must be reachable. Confirm certificates are issued and valid before
accepting application traffic.

Production sets `gateway.cookieSecure: true`. The local `*.localhost`
environment uses `false` and should not be deployed as the production config.

## 4. Secrets

Never commit real secrets or put them in values files. Follow
`scripts/create-secrets.sh` and
`docs/adr/ADR-0007-secrets-out-of-band.md` to create the required Kubernetes
Secrets in the `urumi` namespace.

Supply required values through a trusted operator environment or a suitable
secret-management system. Do not echo or paste secret values into logs,
support requests or documentation. Confirm required Secrets exist before
deployment.

## 5. First deployment on a VPS

After the cluster, DNS, TLS issuer, images and Secrets are ready:

```bash
kubectl create namespace urumi --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install urumi charts/urumi \
  -n urumi \
  -f charts/urumi/values-prod.yaml \
  --atomic \
  --wait \
  --timeout 20m
```

Review the rollout:

```bash
helm status urumi -n urumi
helm history urumi -n urumi
kubectl -n urumi get pods
kubectl -n urumi get services,ingress
kubectl -n urumi get networkpolicy
kubectl -n urumi get pvc
kubectl -n urumi get certificates
```

Test both HTTPS hostnames externally. Verify certificates, gateway chat,
audit persistence, WooCommerce reads and a test order before accepting traffic.
A successful Helm render does not prove images can be pulled, DNS works,
certificates will be issued or the application is healthy.

## 6. Local Helm upgrade and rollback demonstration (T09)

Perform this demonstration on the local k3d cluster using
`values-local.yaml`, not production values. The demonstration changes the
dashboard replica count from one to two, then rolls back to the original
deployed revision.

First, record the current deployed revision:

```bash
helm history urumi -n urumi
helm status urumi -n urumi
```

Set `BASE_REV` to the revision currently marked `deployed`. For example,
if the deployed revision is 36:

```bash
BASE_REV=36
```

Upgrade to two dashboard replicas:

```bash
helm upgrade urumi charts/urumi \
  -n urumi \
  -f charts/urumi/values-local.yaml \
  --set dashboard.replicas=2 \
  --atomic \
  --wait \
  --timeout 10m
```

Verify the visible change and record the upgrade revision:

```bash
kubectl -n urumi get deployment dashboard
kubectl -n urumi get pods
helm history urumi -n urumi
```

Roll back to the original revision stored in `BASE_REV`:

```bash
helm rollback urumi "$BASE_REV" -n urumi \
  --wait \
  --timeout 10m
```

Verify that the dashboard has returned to one replica and the release
history contains the rollback:

```bash
helm history urumi -n urumi
helm status urumi -n urumi
kubectl -n urumi get deployment dashboard
kubectl -n urumi get pods
kubectl -n urumi get networkpolicy
```

Record the actual revision numbers and results as acceptance evidence.
Do not claim the demonstration passed until the upgrade and rollback have
both run and their resulting states have been verified.

## 7. Routine upgrades and emergency rollback

Validate the production chart before deployment:

```bash
helm lint charts/urumi -f charts/urumi/values-prod.yaml

helm template urumi charts/urumi \
  -n urumi \
  -f charts/urumi/values-prod.yaml \
  > /tmp/urumi-production-render.yaml
```

After publishing and verifying the intended images, a production upgrade
uses the reviewed production values:

```bash
helm upgrade urumi charts/urumi \
  -n urumi \
  -f charts/urumi/values-prod.yaml \
  --atomic \
  --wait \
  --timeout 20m
```

Inspect `helm history urumi -n urumi` and select the known-good revision
before rolling back:

```bash
helm rollback urumi <known-good-revision> -n urumi \
  --wait \
  --timeout 20m
```

Rollback creates a new Helm history revision; it does not erase prior history.
After upgrades or rollbacks, verify workload health, ingress, certificates,
NetworkPolicies and application workflows.

## 8. Local versus production configuration

| Setting | Local k3d | Production VPS |
|---|---|---|
| Domain | `localhost` | Real domain; replace placeholder |
| Ingress | Traefik | Traefik |
| TLS | Disabled | Enabled with cert-manager |
| Secure cookie | `false` | `true` |
| Custom images | Locally loaded image tags | Fully qualified GHCR references |
| Persistent storage | k3d default/local-path | Explicit StorageClass; backups and failure modes reviewed |
| NetworkPolicies | Enabled in local values | Enabled in production values |
| Secrets | Kubernetes Secrets for local testing | Kubernetes Secrets or managed secret solution |

This is a single-node/small-VPS starting point, not a high-availability
design. Before using it with real customers, validate backups and restores,
monitoring, capacity, image provenance, secret rotation and incident recovery.

## 9. T09 local upgrade/rollback evidence

Executed on the local k3d cluster on October 23, 2026.

- Baseline Helm revision: 36; dashboard was 1/1 ready.
- Upgrade created revision 37 (`Upgrade complete`).
- Upgrade changed dashboard replicas from 1 to 2; deployment showed 2/2
  ready and both dashboard pods were Running.
- Rollback created revision 38 (`Rollback to 36`).
- After rollback, dashboard returned to 1/1 ready.
- All eight application pods were Running after rollback.
- All 14 NetworkPolicies remained installed.
- Production values were rendered and passed `helm lint`; this did not
  constitute a production VPS deployment.

## 10. Outbound destination security status

The gateway validates registered upstream destinations and checks resolved
addresses when opening outbound connections. External upstreams must use
HTTPS on the default port; first-party in-cluster MCP services are permitted
only through their expected service identities and paths. Automatic redirect
following is disabled for upstream requests.

The chart also restricts outbound TCP 443 using IPv4 address exclusions.
This is defense-in-depth only: it is not a hostname-specific egress allowlist,
and it does not by itself prove that all IPv4 or IPv6 destinations are safe.
Review the effective policy and its enforcement in the target cluster and
network plugin before production use.

The `feat/ssrf-hardening` changes passed branch-level tests and chart
validation and were deployed to the local k3d cluster as Helm revision 43.
Local runtime checks exercised SSRF destination rejection and the
authorized WooCommerce connection. A non-gateway connection probe returned
`ECONNREFUSED`, but this does not conclusively prove CNI NetworkPolicy
enforcement. These checks are not a production deployment or proof of complete
egress enforcement; CNI-aware policy verification remains outstanding. Before production deployment, rerun the repository checks,
review the rendered production NetworkPolicies, and repeat allowed/blocked
destination tests in the target environment. Keep upstream credentials
least-privileged and register only reviewed endpoints.
