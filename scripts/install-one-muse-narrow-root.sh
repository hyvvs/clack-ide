#!/usr/bin/bash
# ONE-TIME administrator bootstrap, never a sudoers-granted command.
# All runtime sudo permissions point to ONE root-owned immutable launcher.
# Takes exactly one hylab-owned task staging path, never a command or source.
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C
trap 'status=$?; printf "BOOTSTRAP_REMOTE_FAILURE=installation_step_%d\n" "$status" >&2; exit 72' ERR
if (( $# != 1 )) || [[ $(/usr/bin/id -u) != 0 ]]; then exit 72; fi
stage=$1
if [[ ! $stage =~ ^/home/hylab/\.cache/clack-muse-narrow-install\.[A-Za-z0-9]{8}$ ]]; then
  exit 72
fi
if [[ ! -d $stage || -L $stage ||
      $(/usr/bin/stat -c '%u:%a' -- "$stage") != "$(/usr/bin/id -u hylab):700" ]]; then
  exit 72
fi
for parent in / /usr /usr/local /etc /etc/sudoers.d; do
  if [[ ! -d $parent || -L $parent || $(/usr/bin/stat -c '%u:%g' -- "$parent") != '0:0' ||
        $(/usr/bin/stat -c '%a' -- "$parent") =~ [2367][0-7]$ ]]; then
    exit 72
  fi
done
root=/usr/local/libexec
assets=$root/clack-one-muse-assets
wrapper=$root/clack-one-muse-root
rule=/etc/sudoers.d/90-clack-one-muse-root
# An interrupted earlier bootstrap may leave a subset of these exact root
# files. Reuse ONLY byte-identical root-owned files with exact safe modes.
# Never overwrite a changed file, symlink, directory entry or sudo rule.
verify_root_file() {
  local file=$1 digest=$2 mode=$3
  [[ -f $file && ! -L $file &&
     $(/usr/bin/stat -c '%u:%g:%a:%h' -- "$file") == "0:0:${mode}:1" ]] || exit 72
  printf '%s  %s\n' "$digest" "$file" | /usr/bin/sha256sum -c --status
}
names=(one-muse-narrow-root.py one-muse-narrow-sudoers
  local-muse-one-root.sh local-muse-one-ebpf.py
  local-muse-tcp-session.py local-muse-tcp.bt)
if [[ $(/usr/bin/find "$stage" -mindepth 1 -maxdepth 1 -printf x | /usr/bin/wc -c) -ne 6 ]]; then
  exit 72
fi
for filename in "${names[@]}"; do
  if [[ ! -f $stage/$filename || -L $stage/$filename ||
        $(/usr/bin/stat -c '%u:%a' -- "$stage/$filename") != "$(/usr/bin/id -u hylab):600" ]]; then
    exit 72
  fi
done
hashes=(
  '551de3b1b2895b06f5bafd19b569fb41ab2170990bbb74a39d41014532ab223b'
  '5c009fffbfe7c2ebb5cf720a0cd31e44f46559477af0f1b5c0b6f7646e096268'
  '69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137'
  'eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df'
  'd22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf'
  'e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0'
)
for i in "${!names[@]}"; do
  printf '%s  %s\n' "${hashes[$i]}" "$stage/${names[$i]}" |
    /usr/bin/sha256sum -c --status
done
if ! /usr/bin/visudo -c -f "$stage/one-muse-narrow-sudoers" >/dev/null; then
  printf 'BOOTSTRAP_REMOTE_FAILURE=sudoers_validation\n' >&2
  exit 73
fi
if [[ ! -e $root && ! -L $root ]]; then
  /usr/bin/install -d -o root -g root -m 0755 "$root"
fi
if [[ ! -d $root || -L $root ||
      $(/usr/bin/stat -c '%u:%g' -- "$root") != '0:0' ||
      $(/usr/bin/stat -c '%a' -- "$root") != 755 ]]; then
  exit 72
fi
if [[ -e $assets || -L $assets ]]; then
  if [[ ! -d $assets || -L $assets ||
        $(/usr/bin/stat -c '%u:%g:%a' -- "$assets") != '0:0:700' ]]; then
    exit 72
  fi
else
  /usr/bin/install -d -o root -g root -m 0700 "$assets"
fi
for i in 2 3 4 5; do
  filename=${names[$i]}
  if [[ ! -e $assets/$filename && ! -L $assets/$filename ]]; then
    /usr/bin/install -o root -g root -m 0600 "$stage/$filename" "$assets/$filename"
  fi
  verify_root_file "$assets/$filename" "${hashes[$i]}" 600
done
if [[ $(/usr/bin/find "$assets" -mindepth 1 -maxdepth 1 -printf x | /usr/bin/wc -c) -ne 4 ]]; then
  exit 72
fi
if [[ ! -e $wrapper && ! -L $wrapper ]]; then
  /usr/bin/install -o root -g root -m 0755 "$stage/one-muse-narrow-root.py" "$wrapper"
fi
verify_root_file "$wrapper" "${hashes[0]}" 755
"$wrapper" --self-check | /usr/bin/grep -Fxq 'CLACK_NARROW_SUDO_SELF_CHECK=PASS'
# Copy the untrusted staged policy to a root-only candidate first, then
# verify its EXACT bytes before granting any sudo permission. This closes
# the source-stage replacement race between initial hash and final install.
candidate=$root/clack-one-muse-policy-candidate
if [[ ! -e $candidate && ! -L $candidate ]]; then
  /usr/bin/install -o root -g root -m 0440 "$stage/one-muse-narrow-sudoers" "$candidate"
fi
verify_root_file "$candidate" "${hashes[1]}" 440
if ! /usr/bin/visudo -c -f "$candidate" >/dev/null; then
  printf 'BOOTSTRAP_REMOTE_FAILURE=sudoers_validation\n' >&2
  exit 73
fi
# Last privilege-granting write uses ONLY the root-owned verified candidate.
if [[ ! -e $rule && ! -L $rule ]]; then
  /usr/bin/install -o root -g root -m 0440 "$candidate" "$rule"
fi
verify_root_file "$rule" "${hashes[1]}" 440
/usr/bin/visudo -c -f "$rule" >/dev/null || {
  /usr/bin/rm -f -- "$rule"
  printf 'BOOTSTRAP_REMOTE_FAILURE=sudoers_validation\n' >&2
  exit 73
}
/usr/bin/rm -f -- "$candidate"
/usr/bin/test "$(/usr/bin/stat -c '%u:%g:%a' -- "$rule")" = '0:0:440'
printf 'CLACK_NARROW_ROOT_BOOTSTRAP=PASS\n'
