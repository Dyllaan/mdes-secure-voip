#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_var() {
  key="$1"
  value="${2-}"
  escaped="$(json_escape "$value")"
  printf '  %s: "%s",\n' "$key" "$escaped"
}

{
  echo 'window.__APP_CONFIG__ = {'
  write_var 'VITE_AUTH_URL' "${VITE_AUTH_URL:-}"
  write_var 'VITE_SOCKET_URL' "${VITE_SOCKET_URL:-}"
  write_var 'VITE_HUB_SERVICE_URL' "${VITE_HUB_SERVICE_URL:-}"
  write_var 'VITE_MUSICMAN_URL' "${VITE_MUSICMAN_URL:-}"
  write_var 'VITE_GATEWAY_URL' "${VITE_GATEWAY_URL:-}"
  write_var 'VITE_PEER_HOST' "${VITE_PEER_HOST:-}"
  write_var 'VITE_PEER_PORT' "${VITE_PEER_PORT:-}"
  write_var 'VITE_PEER_PATH' "${VITE_PEER_PATH:-}"
  write_var 'VITE_PEER_SECURE' "${VITE_PEER_SECURE:-}"
  write_var 'VITE_TURN_HOST' "${VITE_TURN_HOST:-}"
  write_var 'VITE_TURN_PORT' "${VITE_TURN_PORT:-}"
  write_var 'VITE_TURN_SECURE' "${VITE_TURN_SECURE:-}"
  write_var 'VITE_GITHUB_URL' "${VITE_GITHUB_URL:-}"
  write_var 'VITE_MAX_MESSAGE_LENGTH' "${VITE_MAX_MESSAGE_LENGTH:-}"
  write_var 'VITE_MIN_HUB_NAME_LENGTH' "${VITE_MIN_HUB_NAME_LENGTH:-}"
  write_var 'VITE_MAX_HUB_NAME_LENGTH' "${VITE_MAX_HUB_NAME_LENGTH:-}"
  write_var 'VITE_MAX_CHANNEL_NAME_LENGTH' "${VITE_MAX_CHANNEL_NAME_LENGTH:-}"
  write_var 'VITE_MIN_CHANNEL_NAME_LENGTH' "${VITE_MIN_CHANNEL_NAME_LENGTH:-}"
  write_var 'VITE_MAX_ROOM_NAME_LENGTH' "${VITE_MAX_ROOM_NAME_LENGTH:-}"
  write_var 'VITE_MIN_ROOM_NAME_LENGTH' "${VITE_MIN_ROOM_NAME_LENGTH:-}"
  write_var 'VITE_MAX_USERNAME_LENGTH' "${VITE_MAX_USERNAME_LENGTH:-}"
  write_var 'VITE_MAX_PASSWORD_LENGTH' "${VITE_MAX_PASSWORD_LENGTH:-}"
  write_var 'VITE_MIN_USERNAME_LENGTH' "${VITE_MIN_USERNAME_LENGTH:-}"
  write_var 'VITE_MIN_PASSWORD_LENGTH' "${VITE_MIN_PASSWORD_LENGTH:-}"
  write_var 'VITE_MAX_ALIAS_LENGTH' "${VITE_MAX_ALIAS_LENGTH:-}"
  write_var 'VITE_MIN_ALIAS_LENGTH' "${VITE_MIN_ALIAS_LENGTH:-}"
  echo '};'
} > /usr/share/nginx/html/config/env.js