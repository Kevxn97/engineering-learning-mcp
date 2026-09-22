#!/usr/bin/env bash
set -euo pipefail
version=8.30.1
case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported scanner architecture' >&2; exit 1;; esac
case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) echo 'Use the Linux container for this platform' >&2; exit 1;; esac
out=${1:-.local/bin}
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
name="gitleaks_${version}_${os}_${arch}.tar.gz"
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${name}" -o "$tmp/$name"
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_checksums.txt" -o "$tmp/checksums"
(
  cd "$tmp"
  if command -v sha256sum >/dev/null 2>&1; then
    grep " ${name}$" checksums | sha256sum -c -
  elif command -v shasum >/dev/null 2>&1; then
    grep " ${name}$" checksums | shasum -a 256 -c -
  else
    echo 'No SHA-256 verifier available; refusing to install an unverified scanner' >&2
    exit 1
  fi
)
tar -xzf "$tmp/$name" -C "$out" gitleaks
"$out/gitleaks" version
