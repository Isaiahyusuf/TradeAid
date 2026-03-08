import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

const allowedOrigins = new Set<string>();

for (const entry of String(process.env.CORS_ORIGINS || "").split(",")) {
  const value = entry.trim();
  if (value) allowedOrigins.add(value);
}

const frontendUrl = String(process.env.FRONTEND_URL || "").trim();
if (frontendUrl) {
  allowedOrigins.add(frontendUrl);
}

const railwayPublicDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
if (railwayPublicDomain) {
  allowedOrigins.add(`https://${railwayPublicDomain}`);
}

allowedOrigins.add("https://tradeaid.ink");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "25mb" }));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  const allowAny = allowedOrigins.has("*");
  const isAllowedOrigin = !!origin && (allowAny || allowedOrigins.has(origin));

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const basePort = parseInt(process.env.PORT || "5000", 10);
  const maxPortAttempts = Math.max(1, Number(process.env.PORT_RETRY_ATTEMPTS || 10));

  const listenWithRetry = async () => {
    const hostCandidates = [
      { host: "0.0.0.0", reusePort: true },
      { host: "127.0.0.1", reusePort: false },
    ] as const;

    const tryListen = async (host: string, port: number, reusePort: boolean) => {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          httpServer.off("error", onError);
          reject(error);
        };

        httpServer.once("error", onError);
        httpServer.listen({ port, host, reusePort }, () => {
          httpServer.off("error", onError);
          resolve();
        });
      });
    };

    for (let offset = 0; offset < maxPortAttempts; offset += 1) {
      const port = basePort + offset;

      for (const candidate of hostCandidates) {
        try {
          await tryListen(candidate.host, port, candidate.reusePort);
          if (offset > 0) {
            log(`Port ${basePort} unavailable; serving on ${candidate.host}:${port}`, "express");
          } else {
            log(`serving on ${candidate.host}:${port}`);
          }
          return;
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err?.code === "ENOTSUP" && candidate.host === "0.0.0.0") {
            log(`Primary bind failed on 0.0.0.0:${port}; retrying with 127.0.0.1`, "express");
            continue;
          }
          if (err?.code === "EADDRINUSE") {
            continue;
          }
          throw err;
        }
      }
    }

    throw new Error(
      `Unable to bind server after ${maxPortAttempts} attempts starting at port ${basePort}`,
    );
  };

  await listenWithRetry();
})();
