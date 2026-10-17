# ADR-0008: Store database and currency defaults

Status: Accepted (2026-10-16)

## Context

The locked contracts require WordPress database configuration and a WooCommerce
currency to be provided, but did not specify their default values.

## Decision

- WordPress database name: `wordpress`.
- WordPress application database user: `wordpress`.
- WooCommerce store currency: `INR`.
- Store these non-secret settings in `charts/urumi/values.yaml`:
  `mariadb.databaseName`, `mariadb.user`, and `wordpress.currency`.
- Keep database passwords in Kubernetes Secret `urumi-mariadb`; do not put
  passwords in Helm values or templates.

## Consequences

Local and production deployments share the same defaults unless explicitly
overridden by their values files. The MariaDB StatefulSet and WordPress
workload must use the same database name and application username.

## WordPress HTTP port mapping

- WordPress Apache runs as UID/GID `33:33`, with all Linux capabilities dropped, and listens on unprivileged port `8080`.
- The WordPress container port is named `http` and uses port `8080`.
- The Kubernetes `wordpress` Service retains contract port `80` and uses `targetPort: http`; the public Ingress targets the Service port `80`.
- HTTP probes run against the container port named `http`, not the Service. Use `/wp-login.php` for HTTP readiness/liveness checks, or a TCP check where appropriate. Do not rely on `/` for readiness before initialization, because WordPress may redirect during installation.
- Future NetworkPolicy rules must match the WordPress Pod's container port `8080`, not the Service port `80`.
