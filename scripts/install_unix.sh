#!/usr/bin/env bash
# Installs the epubtrans CLI (a single binary) from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/namnhfreelancer/epubtrans/main/scripts/install_unix.sh | bash
#   ... | bash -s -- --system              install to /usr/local/bin (uses sudo when needed)
#   ... | bash -s -- --dir "$HOME/bin"     install to a directory of your choice
#   ... | bash -s -- --version v3.0.0      install a specific release
#
# The download is verified against the SHA256SUMS file published with the release.

set -euo pipefail

REPO="namnhfreelancer/epubtrans"
INSTALL_DIR="${EPUBTRANS_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${EPUBTRANS_VERSION:-latest}"

die() {
  echo "error: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --system)
      INSTALL_DIR="/usr/local/bin"
      ;;
    --dir)
      [ $# -ge 2 ] || die "--dir needs a directory"
      INSTALL_DIR="$2"
      shift
      ;;
    --version)
      [ $# -ge 2 ] || die "--version needs a release tag such as v3.0.0"
      VERSION="$2"
      shift
      ;;
    -h | --help)
      cat << 'USAGE'
Usage: install_unix.sh [--system] [--dir DIR] [--version TAG]

  --system       install to /usr/local/bin (uses sudo when needed)
  --dir DIR      install to DIR (default: $HOME/.local/bin)
  --version TAG  install a specific release, e.g. v3.0.0 (default: latest)

Environment: EPUBTRANS_INSTALL_DIR, EPUBTRANS_VERSION, EPUBTRANS_RELEASE_BASE_URL (mirror or local test server).
USAGE
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) die "unsupported OS: $(uname -s). Windows users: use scripts/install_windows.ps1" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) die "unsupported CPU architecture: $(uname -m)" ;;
  esac
  echo "${os}-${arch}"
}

download() {
  local url="$1" dest="$2"
  if command -v curl > /dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$dest" "$url" || die "download failed: $url"
  elif command -v wget > /dev/null 2>&1; then
    wget -q -O "$dest" "$url" || die "download failed: $url"
  else
    die "curl or wget is required"
  fi
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    die "sha256sum or shasum is required to verify the download"
  fi
}

TARGET="$(detect_target)"
ASSET="epubtrans-${TARGET}"
if [ -n "${EPUBTRANS_RELEASE_BASE_URL:-}" ]; then
  BASE_URL="${EPUBTRANS_RELEASE_BASE_URL%/}"
elif [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading ${ASSET} (${VERSION}) ..."
download "${BASE_URL}/${ASSET}" "${TMP_DIR}/${ASSET}"
download "${BASE_URL}/SHA256SUMS" "${TMP_DIR}/SHA256SUMS"

EXPECTED="$(awk -v name="$ASSET" '$2 == name || $2 == "*" name { print $1 }' "${TMP_DIR}/SHA256SUMS")"
[ -n "$EXPECTED" ] || die "SHA256SUMS has no entry for ${ASSET}"
ACTUAL="$(sha256_of "${TMP_DIR}/${ASSET}")"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for ${ASSET} (expected ${EXPECTED}, got ${ACTUAL}); not installing"
echo "Checksum verified."

chmod +x "${TMP_DIR}/${ASSET}"
SUDO=""
if ! mkdir -p "$INSTALL_DIR" 2> /dev/null || [ ! -w "$INSTALL_DIR" ]; then
  command -v sudo > /dev/null 2>&1 || die "cannot write to ${INSTALL_DIR} and sudo is not available"
  SUDO="sudo"
  echo "Installing to ${INSTALL_DIR} with sudo ..."
  $SUDO mkdir -p "$INSTALL_DIR"
fi
$SUDO install -m 0755 "${TMP_DIR}/${ASSET}" "${INSTALL_DIR}/epubtrans"

echo "Installed epubtrans $("${INSTALL_DIR}/epubtrans" --version) to ${INSTALL_DIR}/epubtrans"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "Note: ${INSTALL_DIR} is not on your PATH. Add it, e.g. export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
