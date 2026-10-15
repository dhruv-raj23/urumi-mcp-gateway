#!/usr/bin/env bash
# Create the local k3d cluster. Host :80 -> Traefik ingress so http://store.localhost and http://app.localhost work.
set -euo pipefail
CLUSTER=urumi
if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER} "; then
  echo "cluster ${CLUSTER} already exists"; exit 0
fi
k3d cluster create "${CLUSTER}" --servers 1 --agents 0 -p "80:80@loadbalancer"
kubectl wait --for=condition=Ready node --all --timeout=120s
kubectl create namespace urumi --dry-run=client -o yaml | kubectl apply -f -
echo "cluster ready. context: k3d-${CLUSTER}"
