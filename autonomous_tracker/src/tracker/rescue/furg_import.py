from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from tracker.rescue.annotations import AnnotationDocument, LabelFrame
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import VideoIdentity


@dataclass(frozen=True)
class FurgImport:
    document: AnnotationDocument
    warnings: list[str]


def import_furg_annotations(encoded: bytes, source: VideoIdentity) -> FurgImport:
    if len(encoded) > 8 * 1024 * 1024:
        raise ValueError("annotation XML exceeds 8 MB")
    text = encoded.decode("utf-8-sig")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("XML declarations for DTDs/entities are not supported")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid FURG XML: {exc}") from exc
    if root.tag != "opencv_storage" or root.findtext("shapeType") != "r":
        raise ValueError("expected FURG OpenCV rectangle annotations")
    original_name = (root.findtext("fileName") or "").strip().replace("\\", "/").rsplit("/", 1)[-1]
    if original_name.casefold() != Path(source.path).name.casefold():
        raise ValueError("XML names a different source video")
    if (int(root.findtext("frameWidth") or "0"), int(root.findtext("frameHeight") or "0")) != (
        source.width,
        source.height,
    ):
        raise ValueError("XML image dimensions differ from decoded video")
    nodes = root.find("frames")
    if nodes is None or len(nodes) == 0:
        raise ValueError("XML has no explicitly annotated frames")
    frames: list[LabelFrame] = []
    for node in nodes:
        if node.tag != "_":
            raise ValueError("unexpected XML frame node")
        index = int(node.findtext("frameNumber") or "-1")
        annotations = node.find("annotations")
        if annotations is None:
            raise ValueError(f"frame {index} has no annotation record")
        objects = []
        for rectangle in annotations:
            if rectangle.tag != "_" or len(rectangle):
                raise ValueError(f"unsupported rectangle format in frame {index}")
            parts = (rectangle.text or "").split()
            if len(parts) != 4:
                raise ValueError(f"frame {index} rectangle needs x y width height")
            x, y, width, height = map(int, parts)
            objects.append(TruthObject(label="fire", bbox_xyxy=(x, y, x + width, y + height)))
        frames.append(LabelFrame(frame_index=index, objects=objects, reviewed=False))
    warnings = []
    if [frame.frame_index for frame in frames] == list(range(source.frame_count + 1)):
        frames.pop()
        warnings.append(
            f"Excluded terminal XML record {source.frame_count}: decoded frame indices end "
            f"at {source.frame_count - 1}. Retained original XML; no frame numbers were shifted."
        )
    document = AnnotationDocument(source=source, classes=["fire"], frames=frames)
    return FurgImport(document, warnings)
