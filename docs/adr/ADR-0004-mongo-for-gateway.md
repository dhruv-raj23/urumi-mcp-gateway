# ADR-0004: MongoDB for gateway state
Status: Accepted (2026-10-15)

## Context
Owner's strongest stack is Node/Express/Mongo; data is small and document-shaped.

## Decision
MongoDB StatefulSet with PVC in the chart; collections per `docs/03-contracts.md` §9.

## Consequences
Fast to build and explain. Backups out of scope; noted in design doc.
