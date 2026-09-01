import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("./", import.meta.url));
const publicFiles = new Set([
  "",
  "404.html",
  "credits.html",
  "icon.svg",
  "index.css",
  "index.html",
  "index.js",
  "register-sw.js",
  "search.js",
  "sw.js",
]);

const accessKey = process.env.ACCESS_KEY?.trim() || "";
const socketCounts = new Map();

logging.set_level(logging.NONE);

Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_direct_ip: false,
  allow_private_ips: false,
  allow_loopback_ips: false,
  hostname_blacklist: [/^localhost$/i, /\.localhost$/i, /\.local$/i],
  port_whitelist: [80, 443],
  stream_limit_per_host: 20,
  stream_limit_total: 100,
});

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }

  return "";
}

function access(req) {
  if (!accessKey) {
    return { allowed: true, supplied: false };
  }

  const url = new URL(req.url || "/", "http://nebula.local");

  if (url.pathname === "/health") {
    return { allowed: true, supplied: false };
  }

  const supplied =
    url.searchParams.get("key") ||
    cookieValue(req, "nebula_access");

  return {
    allowed: supplied === accessKey,
    supplied: url.searchParams.get("key") === accessKey,
  };
}

function reject(res) {
  res.writeHead(401, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });

  res.end(
    "<!doctype html><meta name=viewport content='width=device-width'><title>Private</title><style>body{margin:0;background:#07080a;color:#eee;font:14px system-ui;display:grid;place-items:center;height:100vh}main{max-width:420px;padding:28px;border:1px solid #292a30;border-radius:12px;background:#101115}h1{font-size:20px}p{color:#92949b;line-height:1.6}code{color:#ff5264}</style><main><h1>Nebula is private</h1><p>Open this address once with <code>?key=YOUR_ACCESS_KEY</code>. Your browser will remember access on this device.</p></main>",
  );
}

function clientIp(req) {
  return String(
    req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "unknown",
  )
    .split(",")[0]
    .trim();
}

const fastify = Fastify({
  logger: false,
  bodyLimit: 64 * 1024,

  serverFactory: (handler) => {
    const server = createServer()
      .on("request", (req, res) => {
        const auth = access(req);

        if (!auth.allowed) {
          return reject(res);
        }

        if (auth.supplied) {
          const secure =
            req.socket.encrypted ||
            req.headers["x-forwarded-proto"] === "https";

          const url = new URL(
            req.url || "/",
            "http://nebula.local",
          );

          url.searchParams.delete("key");

          res.writeHead(302, {
            Location: `${url.pathname}${url.search}`,
            "Cache-Control": "no-store",
            "Set-Cookie": `nebula_access=${encodeURIComponent(accessKey)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`,
          });

          return res.end();
        }

        res.setHeader(
          "Cross-Origin-Opener-Policy",
          "same-origin",
        );

        res.setHeader(
          "Cross-Origin-Embedder-Policy",
          "require-corp",
        );

        res.setHeader(
          "X-Content-Type-Options",
          "nosniff",
        );

        res.setHeader(
          "Referrer-Policy",
          "no-referrer",
        );

        handler(req, res);
      })
      .on("upgrade", (req, socket, head) => {
        if (
          !access(req).allowed ||
          !req.url?.endsWith("/wisp/")
        ) {
          return socket.destroy();
        }

        const ip = clientIp(req);
        const count = socketCounts.get(ip) || 0;

        if (count >= 6) {
          return socket.destroy();
        }

        socketCounts.set(ip, count + 1);

        socket.once("close", () => {
          const remaining =
            (socketCounts.get(ip) || 1) - 1;

          if (remaining > 0) {
            socketCounts.set(ip, remaining);
          } else {
            socketCounts.delete(ip);
          }
        });

        wisp.routeRequest(req, socket, head);
      });

    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    return server;
  },
});

const immutable = (res) =>
  res.setHeader(
    "Cache-Control",
    "public, max-age=31536000, immutable",
  );

fastify.register(fastifyStatic, {
  root: publicPath,
  decorateReply: true,

  allowedPath: (pathName) =>
    publicFiles.has(pathName.replace(/^\/+/, "")),

  setHeaders: (res, path) =>
    res.setHeader(
      "Cache-Control",
      path.endsWith("sw.js")
        ? "no-cache"
        : "public, max-age=300",
    ),
});

fastify.register(fastifyStatic, {
  root: scramjetPath,
  prefix: "/scram/",
  decorateReply: false,
  setHeaders: immutable,
});

fastify.register(fastifyStatic, {
  root: libcurlPath,
  prefix: "/libcurl/",
  decorateReply: false,
  setHeaders: immutable,
});

fastify.register(fastifyStatic, {
  root: baremuxPath,
  prefix: "/baremux/",
  decorateReply: false,
  setHeaders: immutable,
});

fastify.get("/health", async () => ({
  status: "ok",
}));

fastify.setNotFoundHandler((_request, reply) =>
  reply
    .code(404)
    .type("text/html")
    .sendFile("404.html"),
);

fastify.server.on("listening", () => {
  const address = fastify.server.address();

  console.log(
    `Nebula running on http://localhost:${address.port}`,
  );

  console.log(
    `Network: http://${hostname()}:${address.port}`,
  );
});

function shutdown() {
  fastify.close().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const port = Number.parseInt(
  process.env.PORT || "8080",
  10,
);

const host = process.env.HOST || "0.0.0.0";

fastify.listen({
  port: Number.isFinite(port) ? port : 8080,
  host,
});
