import { CLACK_Z_INDEX } from "@/lib/layers";
import { cn } from "@/lib/utils";
import {
  readBgFastPath,
  usePreferencesStore,
} from "@/modules/settings/preferences";
import { BG_OPACITY_RENDER_FACTOR } from "@/modules/settings/store";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

const RESIZE_IDLE_MS = 280;
const FADE_IN_MS = 200;

export type BackgroundLayerPlacement = "viewport" | "contained";

type BackgroundStyleOptions = {
  placement: BackgroundLayerPlacement;
  url: string;
  blur: number;
  blurActive: boolean;
  renderedOpacity: number;
  suspendAnimated: boolean;
};

export function getConfiguredBackgroundStyle({
  placement,
  url,
  blur,
  blurActive,
  renderedOpacity,
  suspendAnimated,
}: BackgroundStyleOptions): CSSProperties {
  return {
    position: placement === "viewport" ? "fixed" : "absolute",
    inset: 0,
    zIndex: placement === "viewport" ? CLACK_Z_INDEX.backgroundEffects : 0,
    pointerEvents: "none",
    backgroundImage: suspendAnimated ? "none" : `url(${url})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    opacity: renderedOpacity,
    filter: blurActive ? `blur(${blur}px)` : undefined,
    transform: "translateZ(0)",
    transition: `opacity ${FADE_IN_MS}ms ease-out`,
  };
}

export function ConfiguredBackgroundLayer({
  placement,
  className,
}: {
  placement: BackgroundLayerPlacement;
  className?: string;
}) {
  const [fastPath] = useState(readBgFastPath);
  const storeActive = usePreferencesStore(
    (s) => s.backgroundKind === "image" && !!s.backgroundImageId,
  );
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const active = hydrated ? storeActive : fastPath.active;
  if (!active) return null;

  return (
    <ConfiguredBackgroundImage
      placement={placement}
      className={className}
      fastImageId={fastPath.imageId}
    />
  );
}

function ConfiguredBackgroundImage({
  placement,
  className,
  fastImageId,
}: {
  placement: BackgroundLayerPlacement;
  className?: string;
  fastImageId: string | null;
}) {
  const storeImageId = usePreferencesStore((s) => s.backgroundImageId);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const imageId = hydrated ? storeImageId : fastImageId;
  const opacity = usePreferencesStore((s) => s.backgroundOpacity);
  const blur = usePreferencesStore((s) => s.backgroundBlur);
  const [state, setState] = useState<{ url: string; animated: boolean } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const lastUrlRef = useRef<string | null>(null);
  const resizing = useWindowResizing(RESIZE_IDLE_MS);
  const docHidden = useDocumentHidden();

  useEffect(() => {
    if (!imageId) return;
    let alive = true;
    let rafId: number | null = null;
    setVisible(false);
    void (async () => {
      const { getBgImage } = await import("./bgImageStore");
      const blob = await getBgImage(imageId).catch(() => null);
      if (!alive || !blob) return;
      const url = URL.createObjectURL(blob);
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = url;
      const type = blob.type.toLowerCase();
      const animated =
        type === "image/gif" ||
        type === "image/apng" ||
        type === "image/webp";
      setState({ url, animated });
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (alive) setVisible(true);
      });
    })();
    return () => {
      alive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [imageId]);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
    };
  }, []);

  if (!state) return null;

  const suspendAnimated = state.animated && (resizing || docHidden);
  const blurActive = !state.animated && blur > 0 && !resizing;
  const renderedOpacity =
    visible && !suspendAnimated ? opacity * BG_OPACITY_RENDER_FACTOR : 0;

  return (
    <div
      aria-hidden
      className={cn(
        placement === "viewport"
          ? "clack-bg-surface"
          : "clack-contained-bg-surface",
        className,
      )}
      style={getConfiguredBackgroundStyle({
        placement,
        url: state.url,
        blur,
        blurActive,
        renderedOpacity,
        suspendAnimated,
      })}
    />
  );
}

function useWindowResizing(idleMs: number): boolean {
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    let timer: number | null = null;
    let active = false;
    const onResize = () => {
      if (!active) {
        active = true;
        setResizing(true);
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        active = false;
        setResizing(false);
        timer = null;
      }, idleMs);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [idleMs]);
  return resizing;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}
