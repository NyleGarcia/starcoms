# Star Comms shard — Docker + CubeCoders AMP

Self-hosted [Star Comms](https://star-comms.org/self-hosted-setup.html) shard, run with Bun.

Prereqs: active Premium Shard, Star Comms bot in your Discord, `scsh_...` token from `/star-shard-request`, a public URL (HTTPS reverse proxy → port 8787, must serve `/ws` and `/health`), and TCP+UDP 8787 open.

> License: the shard script is proprietary ([license](https://star-comms.org/license.html)). Nothing here bundles it — both setups download it from star-comms.org at install/start. Don't push a built image or submit the AMP template publicly without written permission from Star-Comms LLC.

## Docker

```bash
cd docker && cp .env.example .env   # fill in token + public URL
docker compose up -d --build
docker compose logs -f
```

Data (archive sqlite, local config, logs) persists in the `shard-data` volume at `/data`. Upgrade: bump `STARCOMMS_SHARD_VERSION` in `.env`, then `docker compose up -d`. Healthcheck hits `/health`.

## AMP (Generic module)

Template files in the repo root (`starcomms*.kvp/json`) follow the CubeCoders AMPTemplates format (based on the upstream Bun App Runner template). Linux only.

1. AMP pulls config repos without auth, so a **private** repo can't be added there. Instead copy the 5 `starcomms*` files into the ADS instance's deployment templates folder (e.g. `~/.ampdata/instances/ADS01/Plugins/ADSModule/GenericTemplates/` — check your AMP version's path).
2. ADS → Settings → Instance Deployment → Fetch latest (or restart ADS) so it picks up the template.
3. Create instance → "Star Comms Shard". Set Shard Token + Public URL under Configuration → Star Comms, then **Update**, then **Start**.

Update stages install Bun (x64/x64-baseline/aarch64, version pin optional) and download the shard script for the configured Shard Version. Auto-update in the shard is forced off so AMP controls versions.
