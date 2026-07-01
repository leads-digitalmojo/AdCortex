import dotenv from "dotenv";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { initScheduler } from "./scheduler";
import { setupAuth, protectApiRoutes } from "./auth";
import { runMigrations } from "./db";
import path from "path";
import fs from "fs";

const isProduction = process.env.NODE_ENV === "production";

const app = express();
const httpServer = createServer(app);

httpServer.on("upgrade", (req, socket, head) => {
  // placeholder for WebSocket if needed
});

// Use import.meta.dirname in ESM, or fallback for built script
const __root = import.meta.dirname || process.cwd();
dotenv.config({ path: path.resolve(__root, "../.env") });

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ─── CORS ───────────────────────────────────────────────────────────
// Only apply CORS headers when CORS_ORIGIN is explicitly configured.
// On Render (same-origin deployment) this is not needed, but it's
// required for any future CDN / subdomain / mobile setup.
const allowedOrigin = process.env.CORS_ORIGIN?.trim();
if (allowedOrigin) {
  app.use((req, res, next) => {
    if (req.headers.origin === allowedOrigin) {
      res.header("Access-Control-Allow-Origin", allowedOrigin);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

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
        // Truncate to 200 chars to avoid flooding logs with large analysis payloads
        const preview = JSON.stringify(capturedJsonResponse).slice(0, 200);
        logLine += ` :: ${preview}${preview.length >= 200 ? "…" : ""}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await runMigrations();
  await setupAuth(app);
  app.use(protectApiRoutes);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const buildPath = path.resolve(import.meta.dirname, isProduction ? "public" : "../dist/public");
  const hasBuild = fs.existsSync(buildPath);

  if (isProduction || !!process.env.RENDER) {
    serveStatic(app);
  } else {
    if (hasBuild) {
      log("Build directory exists, but prioritizing Vite HMR for development");
    }
    log("Starting Vite development server...");
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
      initScheduler();
    },
  );
})();
