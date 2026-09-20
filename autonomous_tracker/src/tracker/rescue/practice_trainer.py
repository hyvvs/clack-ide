"""YOLO training without validation loaders, scores, or final evaluation."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from ultralytics.models.yolo.detect import DetectionTrainer
from ultralytics.utils.torch_utils import strip_optimizer


class EmptyValidationLoader:
    dataset: tuple[()] = ()

    def __len__(self) -> int:
        return 0

    def __iter__(self) -> Iterator[Any]:
        return iter(())

    def reset(self) -> None:
        pass


class PracticeTrainer(DetectionTrainer):
    loss: Any
    metrics: Any
    validator: Any

    def get_dataloader(
        self, dataset_path: str, batch_size: int = 16, rank: int = 0, mode: str = "train"
    ) -> Any:
        if mode == "val":
            return EmptyValidationLoader()
        return super().get_dataloader(dataset_path, batch_size, rank, mode)

    def validate(self) -> tuple[dict[str, float], float]:
        # Ultralytics calls validate on the final epoch even when val=False.
        loss = float(self.loss.detach().sum().cpu())
        return {}, -loss

    def save_metrics(self, metrics: dict[str, Any]) -> None:
        training = {
            key: value for key, value in metrics.items() if key.startswith(("train/", "lr/"))
        }
        super().save_metrics(training)  # type: ignore[no-untyped-call]

    def final_eval(self) -> None:
        if self.last.exists():
            strip_optimizer(self.last)
        self.metrics = {}
        self.validator.metrics = None
