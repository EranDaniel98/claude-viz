import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname } from "path";
import { randomBytes } from "crypto";
import { tailJsonl, TailHandle } from "./ingest.js";
import { SessionStateStore } from "./state.js";
import type { RawHookEvent } from "./types.js";

export interface ServerOptions {
  eventsFile: string;
  port?: number;                 // 0 = OS assigns
  webDir?: string;               // absolute path to built web/dist
}

export interface ServerHandle {
  url: string;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const token = randomBytes(16).toString("hex");
  const store = new SessionStateStore();
  let seq = 0;

  const clients = new Set<WebSocket>();
  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };

  let tail: TailHandle | undefined;
  try {
    tail = await tailJsonl(opts.eventsFile, (evt) => {
      seq++;
      const raw = evt as RawHookEvent;
      store.ingest(raw, seq, Date.now());
      broadcast({ type: "event", event: raw, seq });
    });
  } catch {
    // File may not exist yet; that's OK — hooks will create it.
  }

  const httpServer = createServer(async (req, res) => {
    if (!checkAuth(req, token)) return send(res, 403, "forbidden");
    if (!checkLocalOrigin(req)) return send(res, 403, "forbidden origin");

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/sessions") {
      const ids = store.allSessionIds();
      return sendJson(res, { sessions: ids });
    }
    if (url.pathname.startsWith("/api/session/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/session/".length));
      const snap = store.snapshot(id);
      return snap ? sendJson(res, snap) : send(res, 404, "unknown session");
    }

    // Static
    if (opts.webDir && existsSync(opts.webDir)) {
      let path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = resolve(join(opts.webDir, path));
      if (!file.startsWith(resolve(opts.webDir))) return send(res, 403, "bad path");
      if (existsSync(file)) {
        try {
          const body = await readFile(file);
          res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
          return res.end(body);
        } catch {
          return send(res, 500, "read error");
        }
      }
    }
    return send(res, 404, "not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if (!checkAuth(req, token) || !checkLocalOrigin(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      // initial backfill
      for (const id of store.allSessionIds()) {
        const snap = store.snapshot(id);
        if (snap) ws.send(JSON.stringify({ type: "snapshot", snapshot: snap }));
      }
      ws.on("close", () => clients.delete(ws));
    });
  });

  await new Promise<void>((r) => httpServer.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 0;
  const url = `http://127.0.0.1:${port}/?k=${token}`;

  return {
    url, token,
    async close() {
      await tail?.close();
      wss.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

function checkAuth(req: IncomingMessage, token: string): boolean {
  const u = new URL(req.url ?? "/", "http://localhost");
  return u.searchParams.get("k") === token;
}

function checkLocalOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  const hostOk = host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
  if (!hostOk) return false;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin)) return false;
  return true;
}

function send(res: ServerResponse, code: number, msg: string) {
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(msg);
}
function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
