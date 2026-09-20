from __future__ import annotations

import re
from pathlib import PurePosixPath


def select_floodnet_pairs(names: list[str], per_group: int = 6) -> list[tuple[str, str, str]]:
    if not 1 <= per_group <= 20:
        raise ValueError("select between 1 and 20 samples per group")
    if len(names) != len(set(names)):
        raise ValueError("archive has duplicate entry names")
    available = set(names)
    pairs: list[tuple[str, str, str]] = []
    for group in ("Flooded", "Non-Flooded"):
        base = f"floodnet/Train/Labeled/{group}"
        images = sorted(
            name for name in names if re.fullmatch(re.escape(base) + r"/image/[0-9]+\.jpg", name)
        )
        valid = [(name, f"{base}/mask/{PurePosixPath(name).stem}_lab.png") for name in images]
        valid = [(image, mask) for image, mask in valid if mask in available]
        if len(valid) < per_group:
            raise ValueError(f"not enough image/mask pairs in {group}")
        indices = [index * len(valid) // per_group for index in range(per_group)]
        pairs.extend((group, *valid[index]) for index in indices)
    return pairs
