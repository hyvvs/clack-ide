#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root=$(mktemp -d /tmp/clack-confinement-native.XXXXXXXX)
case "$root" in
  /tmp/clack-confinement-native.*) ;;
  *) exit 2 ;;
esac
cleanup() {
  rm -f -- "$root/probe"
  rmdir -- "$root"
}
trap cleanup EXIT
cc -std=c11 -Wall -Wextra -Werror "$source_dir/confinement_linux_probe.c" -o "$root/probe"
"$root/probe"
