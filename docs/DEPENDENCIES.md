# DEPENDENCIES (one line of justification per non-trivial dependency)
Format: `- app | package | why`
- all node apps | typescript, tsx, vitest, @types/node | build/dev/test toolchain
- woo-mcp | @modelcontextprotocol/sdk | Official SDK for MCP server implementation and Streamable HTTP transport
- woo-mcp | zod | Runtime validation for MCP tool input schemas
- gateway | mongodb | Official Node.js driver for MongoDB connections, typed collection operations, and indexes without an ODM.
- gateway | zod | Runtime validation of REST request bodies, including rejection of unknown fields.
- gateway | bcryptjs | Bcrypt password hashing and verification without native build dependencies.
- gateway | @modelcontextprotocol/sdk | Official MCP client/server primitives and Streamable HTTP transport for stateless upstream aggregation.
- dashboard | vitest | Runs automated dashboard regression tests using the existing Vite configuration.
- dashboard | jsdom | Provides a simulated browser DOM for React component tests without a real browser.
- dashboard | @testing-library/react | Tests dashboard rendering and interactions through accessible UI behavior.
- dashboard | @testing-library/jest-dom | Adds DOM-specific assertions for dashboard component tests.
- dashboard | @testing-library/user-event | Simulates realistic user interactions such as filling forms and clicking controls.
- dashboard | eslint | Detects JavaScript and TypeScript correctness and maintainability problems.
- dashboard | @eslint/js | Provides ESLint's recommended JavaScript rules.
- dashboard | typescript-eslint | Provides TypeScript parsing and recommended lint rules.
- dashboard | eslint-plugin-react-hooks | Checks React Hooks usage and dependency correctness.
- dashboard | globals | Supplies browser global definitions to ESLint.
