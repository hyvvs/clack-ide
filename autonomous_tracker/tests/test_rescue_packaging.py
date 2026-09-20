from pathlib import Path

from tools.desktop.build_installer import packaged_path


def test_packaging_shortens_only_long_license_paths_without_collisions() -> None:
    original = Path("torch-2.13.0.dist-info/licenses") / ("nested/" * 22) / "LICENSE"
    relocated = packaged_path(original)
    assert relocated.parts[0] == "third-party-licenses"
    assert len(relocated.as_posix()) < 80
    assert packaged_path(original.with_name("COPYING")) != relocated
    for unchanged in (Path("torch/__init__.py"), Path("torch-2.13.0.dist-info/licenses/LICENSE")):
        assert packaged_path(unchanged) == Path("runtime/Lib/site-packages") / unchanged
