from __future__ import annotations

from tracker.rescue.annotations import LabelFrame

STATE_COLORS = {
    "Tracked": "#7ec8ff",
    "Predicted": "#90b9ed",
    "Copied": "#b4a7ff",
    "Corrected": "#ffd27b",
    "Needs attention": "#ff8d91",
    "Reviewed": "#70dfba",
    "Manual": "#d4dee9",
    "Keyframe": "#d4dee9",
    "Draft": "#b4a7ff",
}


def box_state(frame: LabelFrame, index: int) -> str:
    link = frame.box_links.get(index)
    if link and link.needs_attention:
        return "Needs attention"
    if frame.reviewed:
        return "Reviewed"
    if not link:
        return "Manual"
    if link.edited or (link.generated is not None and link.generated != frame.objects[index]):
        return "Corrected"
    if link.generated is None:
        return "Keyframe"
    return link.origin.capitalize() if link.origin else "Draft"


def box_identity(frame: LabelFrame, index: int) -> str:
    obj, link = frame.objects[index], frame.box_links.get(index)
    if obj.object_id:
        return f"ID:{obj.object_id}"
    return f"T-{link.track_key[:8]}" if link else "untracked"


def box_caption(frame: LabelFrame, index: int) -> str:
    return (
        f"{frame.objects[index].label} | {box_identity(frame, index)} | {box_state(frame, index)}"
    )


def attention_count(frame: LabelFrame) -> int:
    return sum(bool(link.needs_attention) for link in frame.box_links.values())
