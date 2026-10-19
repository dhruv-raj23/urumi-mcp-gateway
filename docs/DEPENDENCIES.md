# DEPENDENCIES (one line of justification per non-trivial dependency)
Format: `- app | package | why`
- all node apps | typescript, tsx, vitest, @types/node | build/dev/test toolchain
- woo-mcp | @modelcontextprotocol/sdk | Official SDK for MCP server implementation and Streamable HTTP transport
- woo-mcp | zod | Runtime validation for MCP tool input schemas
- gateway | mongodb | Official Node.js driver for MongoDB connections, typed collection operations, and indexes without an ODM.
- gateway | zod | Runtime validation of REST request bodies, including rejection of unknown fields.
- gateway | bcryptjs | Bcrypt password hashing and verification without native build dependencies.
