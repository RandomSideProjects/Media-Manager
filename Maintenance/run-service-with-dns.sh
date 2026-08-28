#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dns_file="${MEDIA_MANAGER_RESOLV_CONF:-${script_dir}/resolv.conf}"
node_bin="${MEDIA_MANAGER_NODE_BIN:-$(command -v node)}"
service_file="${script_dir}/service.mjs"

# Keep the service usable on hosts where unprivileged user namespaces are
# disabled. On the remote host this gives the process a private resolv.conf,
# bypassing a broken Tailscale DNS injection without changing global networking.
if [[ ! -r "$dns_file" ]] || ! /usr/bin/unshare --user --map-root-user --mount /bin/true >/dev/null 2>&1; then
  exec "$node_bin" "$service_file" "$@"
fi

exec /usr/bin/unshare --user --map-root-user --mount /bin/sh -c '
  set -eu
  mount --bind "$1" /etc/resolv.conf
  shift
  exec "$@"
' _ "$dns_file" "$node_bin" "$service_file" "$@"
