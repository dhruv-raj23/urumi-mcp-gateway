// STUB (scaffold). Only /healthz exists so Helm probes can be tested early.
// Replace per the task card; contracts: docs/03-contracts.md. Do not invent routes/env vars.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3002);

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(501, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_implemented", message: "mcp-time is a scaffold stub" } }));
}).listen(port, () => console.log("mcp-time listening on " + port));
