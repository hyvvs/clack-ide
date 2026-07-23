import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { transcribeAudio, type SttOptions } from "../lib/stt";
import type { SttProvider } from "../config";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function providerNeedsKey(provider: SttProvider): boolean {
  return provider !== "whispercpp";
}

function getApiKeyForStt(
  apiKeys: import("../lib/keyring").ProviderKeys,
  provider: SttProvider,
): string | null {
  if (provider === "openai") return apiKeys.openai;
  if (provider === "groq") return apiKeys.groq;
  return null;
}

type State = "idle" | "recording" | "transcribing";

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);
  const [state, setState] = useState<State>("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(false);
  const onResultRef = useRef(onResult);

  const needsKey = providerNeedsKey(sttProvider);
  const providerKey = needsKey ? getApiKeyForStt(apiKeys, sttProvider) : null;
  const hasKey = needsKey ? !!providerKey : true;

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const sttOptions: SttOptions = useMemo(
    () => ({ groqSttModel, whispercppBaseURL }),
    [groqSttModel, whispercppBaseURL],
  );

  const teardownStream = useCallback(() => {
    const stream = streamRef.current;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  }, []);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || !hasKey || activeRef.current) return;
    activeRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        activeRef.current = false;
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = () => {
        if (recRef.current === rec) recRef.current = null;
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
        if (rec.state !== "inactive") rec.stop();
        chunksRef.current = [];
        activeRef.current = false;
        teardownStream();
        if (mountedRef.current) {
          toast.error("Recording failed");
          setState("idle");
        }
      };
      rec.onstop = async () => {
        if (recRef.current === rec) recRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        teardownStream();
        if (!mountedRef.current) {
          activeRef.current = false;
          return;
        }
        if (blob.size === 0) {
          activeRef.current = false;
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const text = await transcribeAudio(blob, sttProvider, apiKeys, sttOptions);
          if (mountedRef.current && text.trim()) {
            onResultRef.current(text.trim());
          }
        } catch (e) {
          if (mountedRef.current) {
            console.error("stt.transcribe", e);
            toast.error(
              e instanceof Error ? e.message : "Transcription failed",
            );
          }
        } finally {
          activeRef.current = false;
          if (mountedRef.current) setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      activeRef.current = false;
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
        if (rec.state !== "inactive") rec.stop();
      }
      if (mountedRef.current) {
        console.error("stt.getUserMedia", e);
        toast.error("Microphone access failed");
        setState("idle");
      }
      teardownStream();
    }
  }, [apiKeys, sttProvider, sttOptions, supported, hasKey, teardownStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        rec.onerror = null;
        if (rec.state !== "inactive") rec.stop();
      }
      chunksRef.current = [];
      teardownStream();
    };
  }, [teardownStream]);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported,
    hasKey,
    sttProvider,
  };
}
