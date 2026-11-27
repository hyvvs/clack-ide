import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PROVIDER_RESPONSE_BYTES } from "./answerContinuation";
import type { ProviderKeys } from "./keyring";
import { transcribeAudio } from "./stt";

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: ({ fetch }: { fetch: typeof globalThis.fetch }) => ({
    transcription: (model: string) => ({ fetch, model }),
  }),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    experimental_transcribe: async ({
      model,
    }: {
      model: { fetch: typeof globalThis.fetch };
    }) => {
      const response = await model.fetch(
        "https://api.openai.com/v1/audio/transcriptions",
      );
      return { text: await response.text() };
    },
  };
});

function oversizedResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROVIDER_RESPONSE_BYTES + 1));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech-to-text response bounds", () => {
  it("bounds OpenAI SDK transcription responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oversizedResponse()),
    );
    await expect(
      transcribeAudio(new Blob(["audio"]), "openai", {
        openai: "fixture-key",
      } as ProviderKeys),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("bounds Groq REST transcription responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oversizedResponse()),
    );
    await expect(
      transcribeAudio(new Blob(["audio"]), "groq", {
        groq: "fixture-key",
      } as ProviderKeys),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("bounds loopback Whisper.cpp transcription responses", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        async decodeAudioData() {
          return {
            length: 1,
            sampleRate: 8000,
            getChannelData: () => new Float32Array([0]),
          } as unknown as AudioBuffer;
        }
        close() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => oversizedResponse()),
    );
    await expect(
      transcribeAudio(new Blob(["audio"]), "whispercpp", {} as ProviderKeys, {
        whispercppBaseURL: "http://127.0.0.1:8080",
      }),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it.each([307, 308])("never forwards recorded audio through an HTTP %i redirect", async (status) => {
    vi.stubGlobal(
      "AudioContext",
      class {
        async decodeAudioData() {
          return {
            length: 1,
            sampleRate: 8000,
            getChannelData: () => new Float32Array([0]),
          } as unknown as AudioBuffer;
        }
        close() {}
      },
    );
    let redirectedRequests = 0;
    const destination = createServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("unexpected redirect");
    });
    const start = (server: ReturnType<typeof createServer>) =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string")
            reject(new Error("Could not bind offline STT fixture"));
          else resolve(address.port);
        });
      });
    const close = (server: ReturnType<typeof createServer>) =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const destinationPort = await start(destination);
    const source = createServer((_request, response) => {
      response.writeHead(status, {
        location: `http://127.0.0.1:${destinationPort}/capture`,
      });
      response.end();
    });
    try {
      const sourcePort = await start(source);
      await expect(
        transcribeAudio(new Blob(["recorded audio"]), "whispercpp", {} as ProviderKeys, {
          whispercppBaseURL: `http://127.0.0.1:${sourcePort}`,
        }),
      ).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      if (source.listening) await close(source);
      await close(destination);
    }
  });
});
