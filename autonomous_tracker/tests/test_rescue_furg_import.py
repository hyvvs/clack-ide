from __future__ import annotations

import pytest

from tracker.rescue.furg_import import import_furg_annotations
from tracker.rescue.media import VideoIdentity


def source() -> VideoIdentity:
    return VideoIdentity(
        path="video.mp4", sha256="a" * 64, width=100, height=100, frame_count=3, nominal_fps=29.97
    )


def xml(frames: str, filename: str = "video.mp4") -> bytes:
    return (
        f"<opencv_storage><fileName>{filename}</fileName><shapeType>r</shapeType>"
        "<frameWidth>100</frameWidth><frameHeight>100</frameHeight>"
        f"<frames>{frames}</frames></opencv_storage>"
    ).encode()


def frame(index: int, box: str | None = "10 20 30 40") -> str:
    annotation = "" if box is None else f"<_>{box}</_>"
    return f"<_><frameNumber>{index}</frameNumber><annotations>{annotation}</annotations></_>"


def test_publisher_boxes_become_drafts_without_invented_ids_or_splits() -> None:
    imported = import_furg_annotations(xml(frame(0) + frame(2, None)), source())
    document = imported.document
    assert document.classes == ["fire"]
    assert document.split == "unassigned" and document.incident_id == ""
    assert document.frames[0].objects[0].bbox_xyxy == (10, 20, 40, 60)
    assert document.frames[0].objects[0].object_id is None
    assert [f.frame_index for f in document.frames] == [0, 2]
    assert not document.to_truth().frames
    assert not document.frames[1].objects
    assert imported.warnings == []


def test_legacy_terminal_record_is_documented_and_never_shifts_frames() -> None:
    imported = import_furg_annotations(xml("".join(frame(i) for i in range(4))), source())
    assert [f.frame_index for f in imported.document.frames] == [0, 1, 2]
    assert len(imported.warnings) == 1
    assert "terminal XML record 3" in imported.warnings[0]


def test_xml_original_windows_path_can_match_local_filename() -> None:
    imported = import_furg_annotations(xml(frame(0), "E:\\old\\VIDEO.mp4"), source())
    assert imported.document.frames


@pytest.mark.parametrize(
    "payload",
    [
        xml(frame(0), "different.mp4"),
        xml(frame(0)).replace(b"<frameWidth>100", b"<frameWidth>99"),
        xml(frame(3)),
        xml(frame(0) + frame(0)),
        xml(frame(-1)),
        xml(frame(0, "90 20 30 40")),
        xml(frame(0, "10 20 0 40")),
        xml(frame(0, "10 20 30")),
        xml("<_><frameNumber>0</frameNumber></_>"),
        xml(frame(0)).replace(b"<shapeType>r", b"<shapeType>c"),
        b"<!DOCTYPE x [<!ENTITY example 'x'>]><opencv_storage/>",
        b"invalid XML",
    ],
)
def test_bad_labels_are_not_silently_repaired(payload: bytes) -> None:
    with pytest.raises(ValueError):
        import_furg_annotations(payload, source())
