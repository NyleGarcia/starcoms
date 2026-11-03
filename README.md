# Star Comms Shard — CubeCoders AMP template

Generic-module template for a self-hosted [Star Comms](https://star-comms.org/self-hosted-setup.html) shard, run with Bun. Linux only. Follows the CubeCoders AMPTemplates format (based on the upstream Bun App Runner template).

Prereqs: active Premium Shard, Star Comms bot in your Discord, `scsh_...` token from `/star-shard-request`, TCP+UDP 8787 open. Public URL can be plain `http://your-host:8787` (simplest) or `https://your-domain` behind a TLS reverse proxy.

> The shard script is proprietary ([license](https://star-comms.org/license.html)) and is not included here. The template downloads it from star-comms.org during Update.

## Install

1. ADS → Settings → Instance Deployment → Configuration Repositories: add `NyleGarcia/starcoms:main`.
2. Click Fetch latest (or restart ADS) so it picks up the template.
3. Create instance → "Star Comms Shard". Set Shard Token + Public URL under Configuration → Star Comms, then **Update**, then **Start**.

Update stages install Bun (x64/x64-baseline/aarch64, version pin optional) and download the shard script for the configured Shard Version. Auto-update in the shard is forced off so AMP controls versions.

## TLS (optional)

AMP has no built-in TLS for an instance's own ports; its HTTPS only covers the panel. If your panel already runs behind nginx with a Let's Encrypt cert (the `ampinstmgr setupnginx` setup), reuse that cert on a second port. Run this once on the AMP host, setting `DOMAIN` to your panel domain:

```bash
DOMAIN=amp.example.com; TLS_PORT=8443; SHARD_PORT=8787
sudo tee /etc/nginx/conf.d/starcomms-tls.conf >/dev/null <<NGINX
server {
    listen ${TLS_PORT} ssl;
    http2 on;
    server_name ${DOMAIN};
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:${SHARD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow ${TLS_PORT}/tcp; sudo ufw allow ${TLS_PORT}/udp
```

Then in AMP:
- **Public URL** = `https://amp.example.com:8443`
- **UDP Voice Port** = `8443` (the shard takes the UDP port from the Public URL; nginx holds only TCP 8443, so there's no clash)
- **Shard Port** stays `8787`, used only internally by nginx. You can close TCP 8787 in the firewall.

Restart the instance and check that `curl https://amp.example.com:8443/health` returns `ok:true`. certbot's existing renewal keeps the cert fresh; nginx picks up the new cert on reload.
