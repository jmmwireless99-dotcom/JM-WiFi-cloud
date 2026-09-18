#!/usr/bin/env bash
# Push ccr-v7-8wan-pcc.rsc to a RouterOS v7 box over SSH, then /import.
#
#   MT_HOST=x.x.x.x MT_USER=admin MT_PASS='secret' ./apply-via-ssh.sh
#   MT_HOST=x.x.x.x MT_USER=admin MT_PASS='secret' ./apply-via-ssh.sh --bootstrap
#
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
RSC="${RSC:-$DIR/ccr-v7-8wan-pcc.rsc}"
BOOT="$DIR/open-mgmt-access.rsc"
HOST="${MT_HOST:?set MT_HOST}"
USER="${MT_USER:-admin}"
PASS="${MT_PASS:?set MT_PASS}"
PORT="${MT_SSH_PORT:-22}"
FILE_REMOTE="${MT_REMOTE_FILE:-ccr-v7-8wan-pcc.rsc}"

if ! command -v sshpass >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq sshpass
fi

SSH=(sshpass -p "$PASS" ssh -p "$PORT"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
  -o HostKeyAlgorithms=+ssh-rsa
  -o PubkeyAcceptedAlgorithms=+ssh-rsa
)
SCP=(sshpass -p "$PASS" scp -P "$PORT" -O
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1
  -o HostKeyAlgorithms=+ssh-rsa
)

run() { "${SSH[@]}" "${USER}@${HOST}" "$1"; }

echo "==> SSH ${USER}@${HOST}:${PORT}"
run "/system identity print"

if [[ "${1:-}" == "--bootstrap" ]]; then
  echo "==> bootstrap mgmt SSH/API"
  "${SCP[@]}" "$BOOT" "${USER}@${HOST}:open-mgmt-access.rsc"
  run "/import file-name=open-mgmt-access.rsc verbose=yes"
fi

echo "==> upload $RSC -> $FILE_REMOTE"
"${SCP[@]}" "$RSC" "${USER}@${HOST}:${FILE_REMOTE}"
echo "==> /import $FILE_REMOTE"
run "/import file-name=$FILE_REMOTE verbose=yes"
echo "==> identity / WAN / dhcp"
run "/system identity print"
run "/interface ethernet print where comment~\"WAN\""
run "/ip dhcp-client print"
run "/routing table print"
echo "==> done"
