#!/bin/sh
# Fetch the pinned shard script (once per version) into /data, then run it.
set -eu

SCRIPT=starcomms-bun-shard-linux.mjs
STAMP=.shard-version
URL="https://star-comms.org/downloads/shards/${SCRIPT}?v=${STARCOMMS_SHARD_VERSION}"

for v in STARCOMMS_SHARD_TOKEN STARCOMMS_SHARD_PUBLIC_URL; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then
    echo "ERROR: $v is not set (shard would block on an interactive prompt)." >&2
    exit 1
  fi
done

if [ ! -f "$SCRIPT" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$STARCOMMS_SHARD_VERSION" ]; then
  echo "Downloading Star Comms shard v${STARCOMMS_SHARD_VERSION}..."
  bun -e "
    const r = await fetch(process.argv[1]);
    if (!r.ok) { console.error('download failed: HTTP ' + r.status); process.exit(1); }
    await Bun.write(process.argv[2] + '.tmp', r);
  " "$URL" "$SCRIPT"
  mv "$SCRIPT.tmp" "$SCRIPT"
  echo "$STARCOMMS_SHARD_VERSION" > "$STAMP"
fi

exec bun run "$SCRIPT" "$@"
