import { ensureBootstrapAdmin } from "./auth/bootstrap.js";
import { ensureDefaultWooServer } from "./db/defaultServers.js";
import { connectGatewayDatabase } from "./db/mongo.js";
import { createGatewayServer } from "./http/app.js";

function getPort(): number {
  const raw = process.env.PORT ?? "3000";
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }

  return port;
}

async function main(): Promise<void> {
  const port = getPort();
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required");
  }

  // The gateway does not listen until MongoDB and its indexes are ready.
  const database = await connectGatewayDatabase();

  try {
    // Creates the initial admin only when the users collection is empty.
    await ensureBootstrapAdmin(database.collections.users);
    await ensureDefaultWooServer(database.collections.servers);

    const server = createGatewayServer(database.collections, {
      sessionSecret,
      cookieSecure: process.env.COOKIE_SECURE === "true",
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);

      server.once("error", onError);
      server.listen(port, "0.0.0.0", () => {
        server.off("error", onError);
        resolve();
      });
    });

    console.log(`gateway listening on port ${port}`);

    let shuttingDown = false;

    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      console.log(`gateway received ${signal}; shutting down`);

      const forceExit = setTimeout(() => {
        console.error("gateway shutdown timed out");
        process.exit(1);
      }, 10_000);

      forceExit.unref();

      server.close((error) => {
        void database.client.close().then(() => {
          clearTimeout(forceExit);

          if (error) {
            console.error("gateway HTTP shutdown failed");
            process.exitCode = 1;
          }
        }).catch(() => {
          clearTimeout(forceExit);
          console.error("gateway database shutdown failed");
          process.exitCode = 1;
        });
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch {
    await database.client.close().catch(() => undefined);
    throw new Error("Gateway initialization failed");
  }
}

void main().catch(() => {
  // Do not print connection strings, driver errors, or environment values.
  console.error("gateway startup failed");
  process.exitCode = 1;
});
