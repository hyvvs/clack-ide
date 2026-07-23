Clack native Arch/CachyOS package
=================================

This package installs a native Arch build of Clack and a small compiled launcher.
Launch Clack normally from the desktop application menu or with:

  clack

Installed layout
----------------

  /usr/bin/clack
  /usr/lib/clack/clack-bin
  /usr/share/applications/clack.desktop
  /usr/share/icons/hicolor/32x32/apps/clack.png
  /usr/share/icons/hicolor/128x128/apps/clack.png
  /usr/share/icons/hicolor/256x256/apps/clack.png
  /usr/share/doc/clack/ARCH_PACKAGE_README.txt

NVIDIA Wayland launcher
-----------------------

/usr/bin/clack is a compiled Rust launcher. It sets
__NV_DISABLE_EXPLICIT_SYNC=1 only when all of these conditions are true:

  - Clack is running on Linux.
  - __NV_DISABLE_EXPLICIT_SYNC is not already set.
  - CLACK_DISABLE_NVIDIA_WAYLAND_WORKAROUND is not 1.
  - XDG_SESSION_TYPE is wayland, case-insensitively, or WAYLAND_DISPLAY is
    non-empty.
  - The proprietary NVIDIA driver is detected through
    /proc/driver/nvidia/version, /sys/module/nvidia/version, or
    /sys/module/nvidia.

The variable is applied only to the launched Clack process and its descendants.
It does not change the login environment, shell configuration, or system
environment. Any value already supplied by the user is preserved.

To disable automatic application for one launch:

  CLACK_DISABLE_NVIDIA_WAYLAND_WORKAROUND=1 clack

To provide an explicit value:

  __NV_DISABLE_EXPLICIT_SYNC=0 clack

Standard Linux bundles
----------------------

Standard Tauri AppImage, deb, and rpm bundles do not automatically use this
native Arch launcher. The conditional workaround is guaranteed only in this
native Arch package unless equivalent package-specific launchers are added.
AppImage remains experimental on the affected proprietary NVIDIA and Wayland
setup and should not be described as compatible without manual testing.

Setting __NV_DISABLE_EXPLICIT_SYNC during `tauri build` does not make the
variable active when a generated artifact is launched later.

WEBKIT_DISABLE_COMPOSITING_MODE=1 is a last-resort diagnostic because it was
severely laggy in the tested setup. WEBKIT_DISABLE_DMABUF_RENDERER=1 avoided
some failures but was still laggy. Disabling Clack's visual effects is not part
of this workaround.

Build notes
-----------

The package uses Arch system GTK3, WebKitGTK 4.1, graphics, icon, and desktop
libraries. It does not bundle GTK, WebKitGTK, NVIDIA, Mesa, GBM, EGL, ALSA, or
similar platform libraries.
