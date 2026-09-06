#!/bin/zsh
set -euo pipefail

KEY_PATH="${1:-$HOME/.ssh/id_ed25519_edu_workspace}"
HOST_ALIAS="github-edu-workspace"
SSH_CONFIG="$HOME/.ssh/config"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "SSH private key not found: $KEY_PATH"
  echo "Copy the private key to this path using a secure method, then run this command again."
  exit 1
fi
if [[ ! -f "$KEY_PATH.pub" ]]; then
  echo "SSH public key not found: $KEY_PATH.pub"
  echo "The private key is present, but its matching public key is missing."
  exit 1
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$SSH_CONFIG"
chmod 600 "$SSH_CONFIG"

if ! grep -q "^Host $HOST_ALIAS$" "$SSH_CONFIG"; then
  cat >> "$SSH_CONFIG" <<EOF

Host $HOST_ALIAS
  HostName github.com
  User git
  IdentityFile $KEY_PATH
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes
EOF
fi

chmod 600 "$KEY_PATH"
chmod 644 "$KEY_PATH.pub"
ssh-add --apple-use-keychain "$KEY_PATH" >/dev/null

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -n "$remote_url" && "$remote_url" == git@github.com:* ]]; then
    repo_path="${remote_url#git@github.com:}"
    git remote set-url origin "git@$HOST_ALIAS:$repo_path"
    git remote set-url --push origin "git@$HOST_ALIAS:$repo_path"
  fi
fi

ssh -T "git@$HOST_ALIAS" 2>&1 || true
echo "SSH setup complete for $HOST_ALIAS."
