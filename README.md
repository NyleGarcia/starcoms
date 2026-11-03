# Star Comms Shard — CubeCoders AMP template

Generic-module template for a self-hosted [Star Comms](https://star-comms.org/self-hosted-setup.html) shard, run with Bun. Linux only. Follows the CubeCoders AMPTemplates format (based on the upstream Bun App Runner template).

Prereqs: active Premium Shard, Star Comms bot in your Discord, `scsh_...` token from `/star-shard-request`, a public URL (HTTPS reverse proxy → port 8787, must serve `/ws` and `/health`), TCP+UDP 8787 open.

> The shard script is proprietary ([license](https://star-comms.org/license.html)) and is not included here. The template downloads it from star-comms.org during Update.

## Install

1. ADS → Settings → Instance Deployment → Configuration Repositories: add `NyleGarcia/starcoms:main`.
2. Click Fetch latest (or restart ADS) so it picks up the template.
3. Create instance → "Star Comms Shard". Set Shard Token + Public URL under Configuration → Star Comms, then **Update**, then **Start**.

Update stages install Bun (x64/x64-baseline/aarch64, version pin optional) and download the shard script for the configured Shard Version. Auto-update in the shard is forced off so AMP controls versions.
