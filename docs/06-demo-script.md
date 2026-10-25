# 06 — Demo script: acceptance walkthrough

Record the real running system using two distinct user accounts:
- **User A:** dashboard chat. Existing acceptance evidence used `admin@example.com`.
- **User B:** external MCP client. Existing acceptance evidence used `testuser3@example.com`.
The final video must show distinct identities and correct audit attribution; both accounts do not need to have the same role.

The administrator performs setup/control actions. Never display full API
keys, passwords, credential-bearing URLs or real customer data.

## 1. Pre-flight

- Confirm `app.localhost` and `store.localhost` load.
- Check the `urumi` namespace, workloads and upstream status.
- Ensure `woo`, `time` and `notes` are enabled and connected.
- Prepare User A's chat session and User B's external MCP configuration.
- Verify User B's key is valid; keep it masked in the recording.
- Use test products, orders and customer data.

Useful commands:

```bash
kubectl get pods -n urumi
kubectl get services,ingress,pvc,networkpolicy -n urumi
helm status urumi -n urumi
```

## 2. Architecture and Kubernetes

Show `docs/02-architecture.md`. Explain the dashboard, gateway, Woo MCP,
Time/Notes MCP servers, WordPress/WooCommerce, MariaDB and MongoDB.

Show namespace, workloads, Services, Ingress, PVCs and NetworkPolicies.
Show Secret names only; never print Secret YAML or values. Explain that the
dashboard and gateway are exposed through `app.localhost`, the storefront
through `store.localhost`, and internal MCP/database Services are ClusterIP
and not published by Ingress.

Explain probes, resource requests/limits and the intended NetworkPolicy paths.

## 3. Storefront order

1. Open `http://store.localhost`.
2. Add a test product to the cart.
3. Complete checkout using Cash on Delivery.
4. Open WordPress administration → WooCommerce → Orders.
5. Confirm the order was created.

Keep customer details out of the video.

## 4. User A — chat and audit identity

Sign in as User A, using the account selected for the chat demonstration.

Ask the chat agent:

`Create a product named "Urumi Demo Product A" priced at 19.99.`

Confirm the product exists on the storefront. Place an order manually for
that product, or use the prepared test order.

Then ask:

`What orders came in today?`

Show the tool-call summary and the returned order. Open the audit view and
confirm the chat activity is attributed to User A with `source=chat`.
If using a prepared order, ensure it falls within the requested date range.

## 5. User B — external MCP client

Connect a separate client to `http://app.localhost/mcp` using **User B's
own API key only**. Do not show the key value.

List the tools and show examples such as:
- `woo__list_orders`
- `woo__get_order`
- `time__get_current_time`
- `time__echo`
- `notes__echo`

Explain that names use `<serverSlug>__<toolName>` so the two `echo` tools
remain distinct.

Ask one prompt that uses two upstream servers, for example:

`Retrieve WooCommerce order <ID> and give me the current time in Asia/Kolkata.`

Show both results. In the audit log, confirm the MCP calls are attributed to
User B with `source=mcp`.

## 6. Revoke User B's key

From the dashboard, revoke User B's key. Retry a read-only MCP call using
that revoked key and show HTTP 401. Keep the key hidden throughout.

## 7. Disable and restore an upstream

In the Server Registry, disable Notes. Refresh tool discovery in the external
client and show that Notes tools disappear. In chat, request a Notes operation
and show that it is unavailable while another upstream still works.

Re-enable Notes and confirm its tools return.

## 8. Demonstrate upstream failure isolation

The prior acceptance test took `mcp-time` out of service and showed that Woo
and Notes remained available. For a controlled repeat, scale Time to zero:

```bash
kubectl scale deployment/mcp-time -n urumi --replicas=0
kubectl get pods -n urumi
```

Wait for the dashboard to report Time as unreachable and show that Woo and
Notes calls still work. Then restore Time immediately:

```bash
kubectl scale deployment/mcp-time -n urumi --replicas=1
kubectl rollout status deployment/mcp-time -n urumi --timeout=120s
```

Verify all three upstreams reconnect. Kubernetes can replace a deleted pod
quickly, so scaling to zero is easier to show as a sustained outage.

## 9. Explain security and MCP internals

Explain:
- API keys are user-scoped, hashed for storage and revocable.
- Upstream credentials are encrypted at rest and used server-side.
- Client bearer keys are not forwarded as upstream credentials.
- Tool names are prefixed to prevent collisions.
- Discovery/calls use timeouts, and independent upstreams can continue.
- NetworkPolicies restrict intended traffic paths.

Demonstrate role-based tool authorization: as a member, show that
`woo__create_product` and `woo__update_order_status` are absent from the tool
list and that a direct call is denied and audited. Then show that an admin
retains write access.

State the limitations honestly: comprehensive SSRF destination filtering,
configurable per-user permission policies and comprehensive per-user rate
limiting are not implemented. URL syntax validation is not a complete SSRF
defense.

## 10. Local-to-VPS and Helm rollback

Show `charts/urumi/values-local.yaml`, `charts/urumi/values-prod.yaml` and
`docs/07-production.md`. Explain the domain, TLS, secure-cookie, storage,
resource and image differences.

Show the existing local Helm rollback evidence:
- Revision 36: baseline, dashboard 1/1.
- Revision 37: dashboard scaled to two replicas.
- Revision 38: rollback restored dashboard to 1/1.

Useful read-only commands:

```bash
helm history urumi -n urumi
kubectl get deployment dashboard -n urumi
kubectl get networkpolicy -n urumi
```

This was a local k3d rehearsal, not a production VPS deployment. Do not
describe GHCR pullability, production DNS/TLS or a live VPS as verified.

## 11. Internal tool-call metrics

After deploying the observability image, open a local port-forward:

    kubectl port-forward -n urumi deployment/gateway 3000:3000

In another terminal, run:

    curl -fsS http://127.0.0.1:3000/metrics

Make a safe read-only tool call, fetch the metrics again, and verify the
corresponding server/outcome counter changes. Verify that a denied member
write call is counted as denied. Do not expose this endpoint through public
Ingress.

Live verification passed on k3d at Helm revision 41: /healthz and /metrics
returned HTTP 200; a successful time__get_current_time call incremented the
success counter, and a denied member WooCommerce write attempt incremented the
denied counter. Metrics are process-local, reset on restart and are not
aggregated across replicas. Prometheus scraping is not configured.

## 12. After recording

- Watch the entire video once.
- Ensure User A and User B are distinct member accounts.
- Verify correct audit identities and `chat`/`mcp` sources.
- Confirm no credentials or customer-identifying details are visible.
- Restore all test changes; ensure all pods are ready and all upstreams connect.
- Submit the video and GitHub repository through the assignment form:
  https://forms.gle/nftwgyNeenSDmiRb6
