// Star Comms shard launcher for the AMP template.
// Starts the shard and, depending on STARCOMMS_TLS_MODE, puts TLS in front of it:
//   off        - plain shard, Public URL as configured
//   quick      - Cloudflare quick tunnel (random https://*.trycloudflare.com, no account)
//   cloudflare - Cloudflare named tunnel (STARCOMMS_CF_TUNNEL_TOKEN, Public URL = tunnel hostname)
//   acme       - Let's Encrypt cert via DNS-01 (Cloudflare API token) + built-in TLS proxy
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHARD_SCRIPT = "starcomms-bun-shard-linux.mjs";
const CLOUDFLARED = resolve("..", "bin", "cloudflared");
const TLS_DIR = resolve("tls");
const RENEW_BEFORE_DAYS = 30;
const RENEW_CHECK_MS = 12 * 60 * 60 * 1000;

const env = process.env;
const mode = String(env.STARCOMMS_TLS_MODE || "off").trim().toLowerCase();
const shardPort = Number(env.STARCOMMS_SHARD_PORT || 8787);
const tlsPort = Number(env.STARCOMMS_TLS_PORT || 8443);
const children = new Set();
let stopping = false;

function log(level, msg) {
  console.log(`[${new Date().toISOString()}] ${level} [launcher] ${msg}`);
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 10_000).unref();
  Promise.all([...children].map((c) => new Promise((r) => c.once("exit", r)))).then(() => process.exit(code));
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

function run(name, cmd, args, childEnv, onLine) {
  const child = spawn(cmd, args, { env: childEnv, stdio: ["inherit", onLine ? "pipe" : "inherit", onLine ? "pipe" : "inherit"] });
  children.add(child);
  if (onLine) {
    for (const stream of [child.stdout, child.stderr]) {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          console.log(line);
          onLine(line);
        }
      });
    }
  }
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    log("ERROR", `${name} exited (${code ?? signal}), stopping`);
    shutdown(code || 1);
  });
  return child;
}

// Secrets meant for the launcher never reach the shard process.
function shardEnv(overrides) {
  const out = { ...env, ...overrides };
  for (const key of ["STARCOMMS_CF_TUNNEL_TOKEN", "STARCOMMS_CF_API_TOKEN", "TUNNEL_TOKEN"]) delete out[key];
  for (const [key, value] of Object.entries(out)) if (value === "") delete out[key];
  return out;
}

function startShard(overrides = {}) {
  log("INFO", `starting shard (tls mode: ${mode})`);
  return run("shard", process.execPath, ["run", SHARD_SCRIPT], shardEnv(overrides));
}

// Tunnels carry only TCP; UDP voice must still reach this host directly.
async function detectPublicIp() {
  try {
    const res = await fetch("https://1.1.1.1/cdn-cgi/trace", { signal: AbortSignal.timeout(10_000) });
    return /^ip=(.+)$/m.exec(await res.text())?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

async function udpHostOverride() {
  if (env.STARCOMMS_SHARD_UDP_PUBLIC_HOST) return {};
  const ip = await detectPublicIp();
  if (ip) log("INFO", `UDP voice host auto-detected: ${ip}`);
  else log("WARN", "could not detect public IP; set UDP Public Host or UDP voice will not connect");
  return ip ? { STARCOMMS_SHARD_UDP_PUBLIC_HOST: ip } : {};
}

function requireCloudflared() {
  if (!existsSync(CLOUDFLARED)) throw new Error(`cloudflared not found at ${CLOUDFLARED}; run Update after choosing a tunnel mode`);
}

async function startQuickTunnel() {
  requireCloudflared();
  const udp = await udpHostOverride();
  let started = false;
  const timer = setTimeout(() => {
    if (!started) {
      log("ERROR", "quick tunnel did not report a URL within 60s");
      shutdown(1);
    }
  }, 60_000);
  run("cloudflared", CLOUDFLARED, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${shardPort}`], { ...env }, (line) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0];
    if (!url || started) return;
    started = true;
    clearTimeout(timer);
    log("INFO", `quick tunnel ready: ${url}`);
    startShard({ STARCOMMS_SHARD_PUBLIC_URL: url, ...udp });
  });
}

async function startNamedTunnel() {
  requireCloudflared();
  if (!env.STARCOMMS_CF_TUNNEL_TOKEN) throw new Error("Cloudflare Tunnel Token is required for the cloudflare TLS mode");
  if (!/^https:\/\//.test(env.STARCOMMS_SHARD_PUBLIC_URL || "")) {
    throw new Error("Public URL must be the tunnel's https:// hostname for the cloudflare TLS mode");
  }
  const udp = await udpHostOverride();
  run("cloudflared", CLOUDFLARED, ["tunnel", "--no-autoupdate", "--protocol", "http2", "run"], { ...env, TUNNEL_TOKEN: env.STARCOMMS_CF_TUNNEL_TOKEN });
  startShard(udp);
}

// --- Let's Encrypt (DNS-01 through the Cloudflare API) ---

async function cfApi(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.STARCOMMS_CF_API_TOKEN}`, "Content-Type": "application/json" }
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare API ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

async function cfZoneId(domain) {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const zones = await cfApi(`/zones?name=${labels.slice(i).join(".")}`);
    if (zones.length) return zones[0].id;
  }
  throw new Error(`no Cloudflare zone found for ${domain} (check the API token's Zone:Read + DNS:Edit access)`);
}

async function issueCertificate(domain) {
  const { default: acme } = await import("acme-client");
  mkdirSync(TLS_DIR, { recursive: true });
  const accountKeyPath = resolve(TLS_DIR, "account.key");
  if (!existsSync(accountKeyPath)) writeFileSync(accountKeyPath, await acme.crypto.createPrivateKey(), { mode: 0o600 });
  const client = new acme.Client({
    directoryUrl: env.STARCOMMS_ACME_STAGING === "true" ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey: readFileSync(accountKeyPath)
  });
  const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [domain] });
  const zoneId = await cfZoneId(domain);
  const records = new Map();
  log("INFO", `requesting Let's Encrypt certificate for ${domain}`);
  const cert = await client.auto({
    csr,
    email: env.STARCOMMS_TLS_EMAIL || undefined,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    skipChallengeVerification: true,
    challengeCreateFn: async (authz, _challenge, keyAuthorization) => {
      const record = await cfApi(`/zones/${zoneId}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ type: "TXT", name: `_acme-challenge.${authz.identifier.value}`, content: keyAuthorization, ttl: 60 })
      });
      records.set(keyAuthorization, record.id);
      await new Promise((r) => setTimeout(r, 20_000));
    },
    challengeRemoveFn: async (_authz, _challenge, keyAuthorization) => {
      const id = records.get(keyAuthorization);
      if (id) await cfApi(`/zones/${zoneId}/dns_records/${id}`, { method: "DELETE" }).catch(() => {});
    }
  });
  writeFileSync(resolve(TLS_DIR, "privkey.pem"), key, { mode: 0o600 });
  writeFileSync(resolve(TLS_DIR, "fullchain.pem"), cert);
  log("INFO", "certificate issued");
}

async function certNeedsRenewal(domain) {
  const certPath = resolve(TLS_DIR, "fullchain.pem");
  if (!existsSync(certPath) || !existsSync(resolve(TLS_DIR, "privkey.pem"))) return true;
  const { default: acme } = await import("acme-client");
  const info = acme.crypto.readCertificateInfo(readFileSync(certPath));
  if (!info.domains.altNames.includes(domain)) return true;
  return info.notAfter.getTime() - Date.now() < RENEW_BEFORE_DAYS * 86_400_000;
}

function readTls() {
  return { cert: readFileSync(resolve(TLS_DIR, "fullchain.pem"), "utf8"), key: readFileSync(resolve(TLS_DIR, "privkey.pem"), "utf8") };
}

// TLS front end: HTTPS + WSS on tlsPort, proxied to the shard on localhost.
function serveTls() {
  const upstream = `127.0.0.1:${shardPort}`;
  const hopByHop = ["connection", "upgrade", "keep-alive", "transfer-encoding", "host"];
  const options = {
    port: tlsPort,
    hostname: env.STARCOMMS_TLS_BIND || "0.0.0.0",
    tls: readTls(),
    async fetch(req, server) {
      const url = new URL(req.url);
      const clientIp = server.requestIP(req)?.address || "";
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const headers = {};
        for (const [k, v] of req.headers) if (!hopByHop.includes(k) && !k.startsWith("sec-websocket")) headers[k] = v;
        headers["x-forwarded-for"] = clientIp;
        headers["x-forwarded-proto"] = "https";
        const protocols = req.headers.get("sec-websocket-protocol");
        if (server.upgrade(req, { data: { path: url.pathname + url.search, headers, protocols } })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      const headers = new Headers(req.headers);
      for (const k of hopByHop) headers.delete(k);
      headers.set("x-forwarded-for", clientIp);
      headers.set("x-forwarded-proto", "https");
      try {
        return await fetch(`http://${upstream}${url.pathname}${url.search}`, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
          redirect: "manual"
        });
      } catch {
        return new Response("shard unavailable", { status: 502 });
      }
    },
    websocket: {
      open(ws) {
        const { path, headers, protocols } = ws.data;
        const up = new WebSocket(`ws://${upstream}${path}`, { headers, protocols: protocols ? protocols.split(",").map((p) => p.trim()) : undefined });
        up.binaryType = "arraybuffer";
        ws.data.up = up;
        ws.data.queue = [];
        up.onopen = () => {
          for (const msg of ws.data.queue) up.send(msg);
          ws.data.queue = null;
        };
        up.onmessage = (ev) => ws.send(ev.data);
        up.onclose = (ev) => ws.close(ev.code === 1005 ? 1000 : ev.code, ev.reason);
        up.onerror = () => ws.close(1011, "upstream error");
      },
      message(ws, msg) {
        if (ws.data.queue) ws.data.queue.push(msg);
        else if (ws.data.up?.readyState === WebSocket.OPEN) ws.data.up.send(msg);
      },
      close(ws) {
        ws.data.up?.close();
      }
    }
  };
  let server = Bun.serve(options);
  log("INFO", `TLS proxy listening on ${options.hostname}:${tlsPort} -> ${upstream}`);
  return {
    reload() {
      server.stop();
      server = Bun.serve({ ...options, tls: readTls() });
      log("INFO", "TLS proxy reloaded with renewed certificate");
    }
  };
}

async function startAcme() {
  const domain = String(env.STARCOMMS_TLS_DOMAIN || "").trim().toLowerCase();
  if (!domain) throw new Error("TLS Domain is required for the acme TLS mode");
  if (!env.STARCOMMS_CF_API_TOKEN) throw new Error("Cloudflare API Token is required for the acme TLS mode (DNS-01)");
  if (await certNeedsRenewal(domain)) await issueCertificate(domain);
  else log("INFO", "existing certificate still valid");
  const proxy = serveTls();
  setInterval(async () => {
    try {
      if (await certNeedsRenewal(domain)) {
        await issueCertificate(domain);
        proxy.reload();
      }
    } catch (err) {
      log("WARN", `certificate renewal failed, will retry: ${err.message}`);
    }
  }, RENEW_CHECK_MS);
  const publicUrl = env.STARCOMMS_SHARD_PUBLIC_URL || (tlsPort === 443 ? `https://${domain}` : `https://${domain}:${tlsPort}`);
  startShard({ STARCOMMS_SHARD_PUBLIC_URL: publicUrl });
}

try {
  if (mode === "off") startShard();
  else if (mode === "quick") await startQuickTunnel();
  else if (mode === "cloudflare") await startNamedTunnel();
  else if (mode === "acme") await startAcme();
  else throw new Error(`unknown TLS mode "${mode}" (use off, quick, cloudflare or acme)`);
} catch (err) {
  log("ERROR", err.message);
  shutdown(1);
}
