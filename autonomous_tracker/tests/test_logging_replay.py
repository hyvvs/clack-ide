from pathlib import Path

import numpy as np

from tracker.telemetry.logger import JSONLLogger
from tracker.telemetry.replay import read_events, replay_session
from tracker.types import Vector3


def test_structured_logging_and_deterministic_replay(tmp_path: Path) -> None:
    path = tmp_path / "session.jsonl"
    logger = JSONLLogger(path, "test-session")
    logger.log("detection", {"position": Vector3(1.0, 2.0, 3.0), "cov": np.eye(3)}, 10)
    logger.log("state_transition", {"state": "TRACKING"}, 20)
    JSONLLogger(path, "second-writer").log("summary", {"healthy": True}, 30)
    events = list(read_events(path))
    assert [event.sequence for event in events] == [0, 1, 2]
    assert events[0].payload["position"]["x"] == 1.0
    reproduced = replay_session(path, lambda event: (event.event_type, event.payload))
    assert reproduced[1] == ("state_transition", {"state": "TRACKING"})
