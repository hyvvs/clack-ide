from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from urllib.request import Request
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from tools import fetch_rescue_training_videos as furg_fetch
from tools.fetch_rescue_flood_samples import extract_selected
from tracker.rescue import range_archive
from tracker.rescue.floodnet_samples import select_floodnet_pairs
from tracker.rescue.range_archive import RangeArchive


class Response(io.BytesIO):
    def __init__(self, data: bytes, status: int, content_range: str) -> None:
        super().__init__(data)
        self.status = status
        self.headers = {"Content-Range": content_range}


def remote_fixture(monkeypatch: pytest.MonkeyPatch, payload: bytes) -> RangeArchive:
    def request(req: Request, timeout: int) -> Response:
        assert timeout == 30
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", req.get_header("Range") or "")
        assert match
        start, end = map(int, match.groups())
        return Response(payload[start : end + 1], 206, f"bytes {start}-{end}/{len(payload)}")

    monkeypatch.setattr(range_archive, "urlopen", request)
    return RangeArchive("https://example.com/archive.zip", len(payload))


def test_range_reader_supports_zip_without_downloading_whole_archive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    memory = io.BytesIO()
    with ZipFile(memory, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("selected.txt", b"selected")
        archive.writestr("unused.bin", bytes(range(256)) * 400)
    payload = memory.getvalue()
    with remote_fixture(monkeypatch, payload) as remote, ZipFile(remote) as archive:
        assert archive.read("selected.txt") == b"selected"
        assert remote.downloaded_bytes < len(payload)


def test_range_reader_bounds_seeks_and_budget_before_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote = remote_fixture(monkeypatch, b"0123456789")
    assert remote.seek(-3, io.SEEK_END) == 7
    assert remote.read(50) == b"789"
    assert remote.read() == b""
    assert remote.seek(-2, io.SEEK_CUR) == 8
    remote.budget_bytes = 4
    with pytest.raises(ValueError, match="budget"):
        remote.read(2)
    with pytest.raises(ValueError, match="before"):
        remote.seek(-1)
    with pytest.raises(ValueError, match="mode"):
        remote.seek(0, 42)
    remote.close()
    with pytest.raises(ValueError, match="closed"):
        remote.read(1)


@pytest.mark.parametrize(
    "status,content_range,data",
    [
        (200, "bytes 0-2/10", b"012"),
        (206, "bytes 1-3/10", b"123"),
        (206, "bytes 0-2/11", b"012"),
        (206, "bytes 0-2/10", b"01"),
        (206, "bytes 0-2/10", b"0123"),
    ],
)
def test_untrustworthy_http_ranges_are_rejected(
    monkeypatch: pytest.MonkeyPatch, status: int, content_range: str, data: bytes
) -> None:
    monkeypatch.setattr(
        range_archive, "urlopen", lambda *a, **kw: Response(data, status, content_range)
    )
    with RangeArchive("https://example.com/archive.zip", 10) as remote, pytest.raises(ValueError):
        remote.read(3)


def test_flood_selection_uses_only_paired_training_items() -> None:
    names = []
    for group in ("Flooded", "Non-Flooded"):
        for index in range(6):
            base = f"floodnet/Train/Labeled/{group}"
            names += [f"{base}/image/{index}.jpg", f"{base}/mask/{index}_lab.png"]
    names += ["floodnet/Test/image/999.jpg", "floodnet/Train/Labeled/Flooded/image/../bad.jpg"]
    pairs = select_floodnet_pairs(names, 2)
    assert len(pairs) == 4
    assert {Path(image).stem for _, image, _ in pairs} == {"0", "3"}
    assert all("/Train/Labeled/" in image for _, image, _ in pairs)
    with pytest.raises(ValueError, match="duplicate"):
        select_floodnet_pairs([*names, names[0]], 2)
    with pytest.raises(ValueError, match="not enough"):
        select_floodnet_pairs(names, 7)
    with pytest.raises(ValueError, match="between"):
        select_floodnet_pairs(names, 0)


def test_existing_extracted_assets_are_verified_and_never_overwritten(tmp_path: Path) -> None:
    memory = io.BytesIO()
    with ZipFile(memory, "w") as archive:
        archive.writestr("asset.jpg", b"example data")
    target = tmp_path / "asset.jpg"
    with ZipFile(memory) as archive:
        first = extract_selected(archive, "asset.jpg", target)
        assert extract_selected(archive, "asset.jpg", target) == first
        target.write_bytes(b"other data")
        with pytest.raises(ValueError, match="not overwritten"):
            extract_selected(archive, "asset.jpg", target)
        assert target.read_bytes() == b"other data"


def test_furg_fetch_pins_content_and_reuses_only_exact_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"fixture"
    git_hash = hashlib.sha1(b"blob 7\0" + payload).hexdigest()
    monkeypatch.setitem(furg_fetch.ASSETS, "fixture", (7, git_hash))
    monkeypatch.setattr(furg_fetch, "urlopen", lambda *a, **kw: io.BytesIO(payload))
    first = furg_fetch.fetch_asset(tmp_path, "fixture")
    assert first["sha256"] == hashlib.sha256(payload).hexdigest()
    assert furg_fetch.fetch_asset(tmp_path, "fixture") == first
    (tmp_path / "fixture").write_bytes(b"changed")
    with pytest.raises(ValueError, match="pinned"):
        furg_fetch.fetch_asset(tmp_path, "fixture")
    assert (tmp_path / "fixture").read_bytes() == b"changed"


def test_wrong_furg_download_stays_partial_not_a_verified_asset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(furg_fetch.ASSETS, "fixture", (3, "0" * 40))
    monkeypatch.setattr(furg_fetch, "urlopen", lambda *a, **kw: io.BytesIO(b"bad"))
    with pytest.raises(ValueError, match="pinned"):
        furg_fetch.fetch_asset(tmp_path, "fixture")
    assert not (tmp_path / "fixture").exists()
    assert (tmp_path / "fixture.part").read_bytes() == b"bad"
