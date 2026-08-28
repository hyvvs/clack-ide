import { createPortal } from "react-dom";
import { ConfiguredBackgroundLayer } from "./ConfiguredBackgroundLayer";

export function SurfaceLayer() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <ConfiguredBackgroundLayer placement="viewport" />,
    document.body,
  );
}
