#!/usr/bin/env bash

set -Eeuo pipefail

user_home="${HOME:?HOME must be set}"
repository_url="${MEDIA_MANAGER_REPOSITORY_URL:-https://github.com/RandomSideProjects/Media-Manager.git}"
repository_branch="${MEDIA_MANAGER_REPOSITORY_BRANCH:-main}"
install_dir="${MEDIA_MANAGER_INSTALL_DIR:-${user_home}/media-manager-maintenance}"
service_name="${MEDIA_MANAGER_SERVICE_NAME:-media-manager-maintenance}"
config_root="${XDG_CONFIG_HOME:-${user_home}/.config}"
config_dir="${config_root}/media-manager"
environment_file="${config_dir}/maintenance.env"
unit_dir="${config_root}/systemd/user"
unit_file="${unit_dir}/${service_name}.service"
maintenance_host="${MAINTENANCE_HOST:-0.0.0.0}"
maintenance_port="${MAINTENANCE_PORT:-6968}"

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

require_command git
require_command node
require_command systemctl

node_bin="$(command -v node)"
node_major="$("$node_bin" -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" -lt 18 ]]; then
  fail "Node.js 18 or newer is required (found $node_major)"
fi

if [[ "$install_dir" == *' '* || "$unit_file" == *' '* ]]; then
  fail "install paths containing spaces are not supported by this systemd installer"
fi

if [[ -e "$install_dir" && ! -d "$install_dir/.git" ]]; then
  fail "$install_dir exists but is not a Git checkout"
fi

if [[ -d "$install_dir/.git" ]]; then
  if ! git -C "$install_dir" diff --quiet || ! git -C "$install_dir" diff --cached --quiet; then
    fail "$install_dir has uncommitted changes; commit or remove them before reinstalling"
  fi
  git -C "$install_dir" fetch --depth 1 origin "$repository_branch"
  git -C "$install_dir" pull --ff-only origin "$repository_branch"
else
  mkdir -p "$(dirname "$install_dir")"
  git clone --depth 1 --branch "$repository_branch" "$repository_url" "$install_dir"
fi

[[ -f "$install_dir/Maintenance/service.mjs" ]] || fail "the checkout has no Maintenance/service.mjs"
[[ -d "$install_dir/Sources/Files/Anime" ]] || fail "the checkout has no Sources/Files/Anime directory"

if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "ffmpeg is not installed; torrent jobs that need video conversion will fail"
fi
td_bin="${TD_BIN:-${user_home}/.deno/bin/td}"
if [[ ! -x "$td_bin" ]]; then
  warn "td was not found at $td_bin; install/authenticate td before starting a maintenance run"
fi
compatibility_script="$install_dir/Maintenance/apply-toodrive-compatibility.sh"
if [[ -x "$td_bin" && -f "$compatibility_script" ]]; then
  chmod +x "$compatibility_script"
  if ! "$compatibility_script"; then
    warn "could not apply the td compatibility patch; video jobs may need manual td repair"
  fi
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
    printf '# MEDIA_MANAGER_WEBHOOK_URL=https://discord.com/api/webhooks/...\n'
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
  printf 'ExecStartPre=/usr/bin/env bash %s\n' "$install_dir/Maintenance/apply-toodrive-compatibility.sh"
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
