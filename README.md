# Star Comms Shard — CubeCoders AMP template

Generic-module template for a self-hosted [Star Comms](https://star-comms.org/self-hosted-setup.html) shard, run with Bun. Linux only. Follows the CubeCoders AMPTemplates format (based on the upstream Bun App Runner template).

Prereqs: active Premium Shard, Star Comms bot in your Discord, `scsh_...` token from `/star-shard-request`, TCP+UDP 8787 open. Public URL can be plain `http://your-host:8787` (simplest) or `https://your-domain` behind a TLS reverse proxy.

> The shard script is proprietary ([license](https://star-comms.org/license.html)) and is not included here. The template downloads it from star-comms.org during Update.

## Install

1. ADS → Settings → Instance Deployment → Configuration Repositories: add `NyleGarcia/starcoms:main`.
2. Click Fetch latest (or restart ADS) so it picks up the template.
3. Create instance → "Star Comms Shard". Set Shard Token + Public URL under Configuration → Star Comms, then **Update**, then **Start**.

The launcher preloads a small shim that gives the shard's `Bun.serve()` an `idleTimeout` of 60s (Bun's 10s default otherwise drops the Owner API `/api/v1/stream` SSE between its 25s pings). Override with env `STARCOMMS_SHARD_IDLE_TIMEOUT` (0–255, 0 = off).

Update stages install Bun (x64/x64-baseline/aarch64, version pin optional) and download the shard script for the configured Shard Version. Auto-update in the shard is forced off so AMP controls versions.

## TLS (optional, no host setup)

Choose **TLS Mode** under Configuration → Star Comms → TLS, click **Update**, then **Start**. Nothing on the host changes: no nginx, no certbot. The template's launcher (`starcomms-launcher.mjs`, downloaded during Update) handles it.

| Mode | You provide | Public URL | Notes |
|---|---|---|---|
| Off | nothing | `http://your-host:8787` | Plain HTTP. Simplest |
| Cloudflare Quick Tunnel | nothing | auto (`https://*.trycloudflare.com`) | Free, no account. The URL changes every start (the shard re-registers itself). Cloudflare says it's for testing, with no uptime guarantee |
| Cloudflare Tunnel | Tunnel token | `https://your-tunnel-hostname` | Zero Trust → Networks → Tunnels → create (cloudflared), copy the token, add a public hostname → `http://localhost:8787`. Fixed URL; needs no TCP port forward |
| Let's Encrypt | TLS Domain + DNS Provider + DNS API token | auto (`https://domain:<TLS Port>`) | Real cert issued and renewed automatically via the DNS-01 check. Providers: **Cloudflare** (token with Zone:Read + DNS:Edit) or **DigitalOcean** (personal access token with domain read/create/delete). Served on the TLS Port (default 8443). Choosing it accepts the Let's Encrypt terms |

UDP voice never goes through TLS or a tunnel: forward the **UDP Voice Port** to the host in every mode. In tunnel modes the launcher detects the public IP for UDP automatically (override it with UDP Public Host). The UDP Voice Port does not need to match the TLS Port: clients are told the UDP port directly (verified with Let's Encrypt on TCP 8443 + UDP 8787).

Let's Encrypt through a DNS provider API is the only automatic option because the other checks need port 80/443, which the AMP panel's nginx usually holds and which AMP instances can't bind anyway.
