#!/usr/bin/env bash

set -Eeuo pipefail

bundle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
user_home="${HOME:?HOME must be set}"
install_dir="${MEDIA_MANAGER_INSTALL_DIR:-${user_home}/media-manager-maintenance}"
service_name="${MEDIA_MANAGER_SERVICE_NAME:-media-manager-maintenance}"
config_root="${XDG_CONFIG_HOME:-${user_home}/.config}"
config_dir="${config_root}/media-manager"
environment_file="${config_dir}/maintenance.env"
unit_dir="${config_root}/systemd/user"
unit_file="${unit_dir}/${service_name}.service"
maintenance_host="${MAINTENANCE_HOST:-0.0.0.0}"
maintenance_port="${MAINTENANCE_PORT:-6968}"
td_bin="${TD_BIN:-${user_home}/.deno/bin/td}"

fail() {
  printf 'Install failed: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required. Install it with your Linux distribution's package manager."
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "this installer is for Linux only"
fi

require_command node
require_command systemctl
require_command cp
require_command mkdir

node_bin="$(command -v node)"
node_major="$("$node_bin" -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 18 ]]; then
  fail "Node.js 18 or newer is required (found $node_major)"
fi

if [[ "$install_dir" == *' '* || "$unit_file" == *' '* ]]; then
  fail "install paths containing spaces are not supported by this systemd installer"
fi

[[ "$install_dir" != "$bundle_root" ]] || fail "MEDIA_MANAGER_INSTALL_DIR cannot be the extracted bundle directory"
[[ -f "$bundle_root/Maintenance/service.mjs" ]] || fail "the bundle has no Maintenance/service.mjs"
[[ -d "$bundle_root/Sources/Files/Anime" ]] || fail "the bundle has no Sources/Files/Anime directory"

mkdir -p "$install_dir"
cp -a "$bundle_root/Maintenance" "$install_dir/"
cp -a "$bundle_root/Sources" "$install_dir/"
if [[ -d "$bundle_root/Assets" ]]; then
  cp -a "$bundle_root/Assets" "$install_dir/"
fi
if [[ -f "$bundle_root/README.md" ]]; then
  cp -f "$bundle_root/README.md" "$install_dir/README.md"
fi
chmod +x "$install_dir/Maintenance/service.mjs" "$install_dir/Maintenance/install-linux.sh" 2>/dev/null || true

if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "ffmpeg is not installed; video conversion jobs will fail"
fi
if [[ ! -x "$td_bin" ]]; then
  warn "td was not found at $td_bin; install and authenticate td before starting a run"
fi

mkdir -p "$config_dir" "$unit_dir"
if [[ ! -f "$environment_file" ]]; then
  {
    printf '# Media Manager Maintenance API configuration\n'
    printf 'MEDIA_MANAGER_ROOT=%s\n' "$install_dir"
    printf 'CREATOR_TORRENT_HOST=%s\n' "$maintenance_host"
    printf 'CREATOR_TORRENT_PORT=%s\n' "$maintenance_port"
    printf 'TD_BIN=%s\n' "$td_bin"
    printf 'MEDIA_MANAGER_GITHUB_REPOSITORY=RandomSideProjects/Media-Manager\n'
    printf 'MEDIA_MANAGER_GITHUB_BRANCH=main\n'
    printf '# MEDIA_MANAGER_GITHUB_TOKEN=put-your-token-here\n'
  } >"$environment_file"
  chmod 600 "$environment_file"
else
  warn "$environment_file already exists; preserving it"
fi

{
  printf '[Unit]\n'
  printf 'Description=Media Manager Maintenance API\n'
  printf 'After=network-online.target\n'
  printf 'Wants=network-online.target\n\n'
  printf '[Service]\n'
  printf 'Type=simple\n'
  printf 'WorkingDirectory=%s\n' "$install_dir"
  printf 'EnvironmentFile=-%s\n' "$environment_file"
  printf 'ExecStart=%s %s\n' "$node_bin" "$install_dir/Maintenance/service.mjs"
  printf 'Restart=on-failure\n'
  printf 'RestartSec=5\n'
  printf 'KillSignal=SIGINT\n\n'
  printf '[Install]\n'
  printf 'WantedBy=default.target\n'
} >"$unit_file"

if systemctl --user daemon-reload && systemctl --user enable --now "$service_name.service"; then
  :
else
  warn "the unit was installed at $unit_file but the user systemd manager could not be started"
  warn "run: systemctl --user daemon-reload && systemctl --user enable --now $service_name.service"
fi

printf '\nMedia Manager Maintenance API installed.\n'
printf 'Checkout: %s\n' "$install_dir"
printf 'Listen address: %s:%s\n' "$maintenance_host" "$maintenance_port"
printf 'Config: %s\n' "$environment_file"
printf 'Health check: curl http://127.0.0.1:%s/api/health\n' "$maintenance_port"
printf 'Logs: journalctl --user -u %s.service -f\n' "$service_name"
printf '\nNext steps:\n'
printf '1. Edit %s and set MEDIA_MANAGER_GITHUB_TOKEN.\n' "$environment_file"
printf '2. Run td login --auth-backend=file as this user.\n'
printf '3. Restart: systemctl --user restart %s.service\n' "$service_name"
printf '4. Allow TCP %s only through your LAN/VPN firewall; the default bind is 0.0.0.0.\n' "$maintenance_port"
