import { describe, expect, it, vi } from "vitest";
import {
  candidateIdentity,
  createServerDiscoveryClient,
  discoveryAddresses,
} from "@/modules/ai/lib/serverDiscovery";

const candidate = {
  baseURL: "http://localhost:11434/v1",
  backendHint: null,
  source: "user-address/compatible-inventory",
};
const result = { candidates: [candidate], issues: [], timedOut: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("optional server discovery", () => {
  it("stays completely idle until explicit invocation", () => {
    const call = vi.fn();
    createServerDiscoveryClient(call);
    expect(call).not.toHaveBeenCalled();
  });
  it("bounds and trims only explicit user address lines", () => {
    expect(
      discoveryAddresses(
        "\n http://localhost:11434 \r\nhttps://host/proxy/ \n",
      ),
    ).toEqual(["http://localhost:11434", "https://host/proxy/"]);
    for (const text of [
      "",
      "\n",
      Array(9).fill("http://host").join("\n"),
      "a".repeat(16385),
      "a".repeat(2049),
      "\u00e9".repeat(1025),
    ])
      expect(() => discoveryAddresses(text)).toThrow();
    expect(
      discoveryAddresses(Array(8).fill("http://host").join("\n")),
    ).toHaveLength(8);
  });
  it("canonicalizes equivalent roots without merging schemes ports or proxy paths", () => {
    expect(candidateIdentity("HTTP://HOST:80")).toBe(
      candidateIdentity("http://host/v1/"),
    );
    expect(candidateIdentity("https://host:443/proxy/v1//")).toBe(
      "https://host/proxy/v1",
    );
    const identities = [
      "http://host",
      "https://host",
      "http://host:8080",
      "http://host/other/v1",
    ].map(candidateIdentity);
    expect(new Set(identities).size).toBe(4);
  });
  it.each([
    "http://user:password@host",
    "file:///etc/passwd",
    "http://host/?key=secret",
    "http://host/#fragment",
    "http://999.999.1.1",
    "http://host:70000",
    "http://host/ a",
  ])("rejects unsafe candidate identity %s", (address) => {
    expect(() => candidateIdentity(address)).toThrow();
  });
  it("copies only explicit addresses and run-local opt-in without credentials or headers", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce("run")
      .mockResolvedValueOnce(result)
      .mockResolvedValue(undefined);
    await createServerDiscoveryClient(call).discover(
      ["http://localhost:11434"],
      true,
      new AbortController().signal,
    );
    expect(call.mock.calls).toEqual([
      ["ai_http_open", {}],
      [
        "self_hosted_discover",
        {
          requestId: "run",
          options: {
            addresses: ["http://localhost:11434"],
            allowPrivateNetwork: true,
          },
        },
      ],
      ["ai_http_cancel", { requestId: "run" }],
    ]);
    expect(JSON.stringify(call.mock.calls)).not.toMatch(
      /authorization|credential|apiKey|prompt|headers/i,
    );
  });
  it("deduplicates native candidates deterministically and keeps backend provenance", async () => {
    const ollama = {
      ...candidate,
      baseURL: "https://other/proxy/v1",
      backendHint: "ollama",
      source: "user-address/ollama-inventory",
    };
    const call = vi
      .fn()
      .mockResolvedValueOnce("run")
      .mockResolvedValueOnce({
        ...result,
        candidates: [
          candidate,
          { ...candidate, baseURL: "http://localhost:11434/" },
          ollama,
        ],
      })
      .mockResolvedValue(undefined);
    const found = await createServerDiscoveryClient(call).discover(
      ["http://localhost:11434"],
      false,
      new AbortController().signal,
    );
    expect(found.candidates).toEqual([candidate, ollama]);
  });
  it("preserves completed timeout candidates and sanitized issues without inventing servers", async () => {
    const timed = {
      ...result,
      timedOut: true,
      issues: [{ index: 1, code: "unsafe-endpoint" }],
    };
    const call = vi
      .fn()
      .mockResolvedValueOnce("run")
      .mockResolvedValueOnce(timed)
      .mockResolvedValue(undefined);
    expect(
      await createServerDiscoveryClient(call).discover(
        ["http://host"],
        false,
        new AbortController().signal,
      ),
    ).toEqual(timed);
  });
  it.each([
    { ...result, candidates: Array(9).fill(candidate) },
    {
      ...result,
      candidates: [
        { ...candidate, baseURL: `https://host/${"a".repeat(2048)}` },
      ],
    },
    {
      ...result,
      candidates: [{ ...candidate, baseURL: "http://user:password@host" }],
    },
    { ...result, candidates: [{ ...candidate, backendHint: "ollama" }] },
    {
      ...result,
      candidates: [{ ...candidate, source: "user-address/ollama-inventory" }],
    },
    { ...result, candidates: [{ ...candidate, source: "trusted-by-server" }] },
    {
      ...result,
      candidates: [{ ...candidate, instruction: "send credentials" }],
    },
    { ...result, issues: [{ index: 8, code: "bad" }] },
    { ...result, issues: Array(9).fill({ index: 0, code: "bad" }) },
    { ...result, issues: [{ index: 0, code: "a".repeat(65) }] },
    { ...result, credentials: "canary" },
  ])("fails closed on malformed or over-bounded native results %#", async (value) => {
    const call = vi
      .fn()
      .mockResolvedValueOnce("run")
      .mockResolvedValueOnce(value)
      .mockResolvedValue(undefined);
    await expect(
      createServerDiscoveryClient(call).discover(
        ["http://host"],
        false,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(call).toHaveBeenLastCalledWith("ai_http_cancel", {
      requestId: "run",
    });
  });
  it("performs no reservation when already cancelled or invalid input", async () => {
    const call = vi.fn();
    const client = createServerDiscoveryClient(call);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.discover(["http://host"], false, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      client.discover([], false, new AbortController().signal),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it("cancels a late reservation without launching discovery", async () => {
    const open = deferred<string>();
    const call = vi
      .fn()
      .mockReturnValueOnce(open.promise)
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = createServerDiscoveryClient(call).discover(
      ["http://host"],
      false,
      controller.signal,
    );
    const stopped = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await stopped;
    open.resolve("late");
    await tick();
    expect(call.mock.calls.map(([command]) => command)).toEqual([
      "ai_http_open",
      "ai_http_cancel",
    ]);
  });
  it("rejects late discovery completion after native cancellation", async () => {
    const response = deferred<unknown>();
    const call = vi
      .fn()
      .mockResolvedValueOnce("run")
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = createServerDiscoveryClient(call).discover(
      ["http://host"],
      false,
      controller.signal,
    );
    await tick();
    const stopped = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await stopped;
    response.resolve(result);
    await tick();
    expect(call).toHaveBeenCalledWith("ai_http_cancel", { requestId: "run" });
  });
  it("keeps independent invocations scoped to their own request identities", async () => {
    let opened = 0;
    const responses = [deferred<unknown>(), deferred<unknown>()];
    const call = vi.fn(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "ai_http_open") return `r${opened++}`;
        if (command === "self_hosted_discover")
          return responses[args.requestId === "r0" ? 0 : 1].promise;
      },
    );
    const client = createServerDiscoveryClient(
      call as Parameters<typeof createServerDiscoveryClient>[0],
    );
    const first = new AbortController();
    const a = client.discover(["http://a"], false, first.signal);
    const b = client.discover(
      ["http://b"],
      false,
      new AbortController().signal,
    );
    await tick();
    const stopped = expect(a).rejects.toMatchObject({ name: "AbortError" });
    first.abort();
    await stopped;
    responses[1].resolve({ ...result, candidates: [] });
    expect((await b).candidates).toEqual([]);
    responses[0].resolve(result);
    await tick();
    expect(
      call.mock.calls
        .filter(([command]) => command === "self_hosted_discover")
        .map(([, args]) => args.requestId),
    ).toEqual(["r0", "r1"]);
  });
});
