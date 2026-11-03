# Star Comms self-hosted shard (Bun runtime).
# The shard script is proprietary (https://star-comms.org/license.html), so it is
# NOT baked into the image: entrypoint.sh downloads it into /data on first start.
FROM oven/bun:1-slim

ENV STARCOMMS_SHARD_VERSION=1.0.116 \
    STARCOMMS_CENTRAL_URL=https://api.star-comms.org \
    STARCOMMS_SHARD_PORT=8787 \
    STARCOMMS_SHARD_UDP_VOICE_ENABLED=true \
    STARCOMMS_SHARD_ARCHIVE_DRIVER=sqlite \
    STARCOMMS_SHARD_AUTO_UPDATE=false \
    STARCOMMS_LOG_LEVEL=info

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

RUN mkdir -p /data && chown bun:bun /data
WORKDIR /data
VOLUME ["/data"]
USER bun

EXPOSE 8787/tcp 8787/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.STARCOMMS_SHARD_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
