import { describe, expect, it } from "vitest";
import {
  boundedToolFingerprint,
  createOutputWatchdog,
  OutputWatchdogError,
  readWatchdogError,
  WATCHDOG_LIMITS as L,
} from "@/modules/ai/lib/outputWatchdog";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import { isRetryableProviderAttempt } from "@/modules/ai/lib/providerRetry";

const paragraph =
  "This is a complete natural language paragraph about an ordinary task and its outcome.";
describe("F2 bounded output watchdog", () => {
  it.each([
    " ",
    "\n",
    "\t",
  ])("stops a %j flood at the explicit whitespace boundary", (whitespace) => {
    const detector = createOutputWatchdog();
    expect(detector.observe(whitespace.repeat(L.whitespace - 1))).toBeNull();
    expect(detector.observe(whitespace)?.watchdog.reason).toBe(
      "excessive_whitespace",
    );
  });
  it("counts whitespace across fragmented chunks and keeps channels separate", () => {
    const detector = createOutputWatchdog();
    detector.observe(" ".repeat(5000));
    detector.observe("\n".repeat(5000), "reasoning");
    expect(detector.observe("valid text")).toBeNull();
    expect(
      detector.observe("\n".repeat(3200), "reasoning")?.watchdog.reason,
    ).toBe("excessive_whitespace");
  });
  it.each([
    "# Heading\n\nA short paragraph.\n\n---\n\nAnother section.\n",
    "    pass\n".repeat(3000),
    "const fixture = {value: 'same'};\n".repeat(2000),
    JSON.stringify(
      Array.from({ length: 1500 }, () => ({ key: "same", value: "same" })),
    ),
    "key,value\nsame,same\n".repeat(1500),
    "| key | value |\n| --- | --- |\n| same | same |\n".repeat(1000),
    "it('same', () => expect(value).toBe(true));\n".repeat(1000),
    "- similar list item\n".repeat(2000),
    "---\n".repeat(4000),
    Array.from(
      { length: 1000 },
      (_, i) => `Item ${i}: the same structure\n`,
    ).join(""),
  ])("allows the legitimate repetition corpus %#", (text) => {
    const detector = createOutputWatchdog();
    for (let offset = 0; offset < text.length; offset += 137)
      expect(detector.observe(text.slice(offset, offset + 137))).toBeNull();
  });
  it("stops exact repeated prose paragraphs", () => {
    expect(
      createOutputWatchdog().observe(`${paragraph}\n\n`.repeat(12))?.watchdog
        .reason,
    ).toBe("repeated_output");
  });
  it("stops repeated prose with commas without misclassifying it as CSV", () => {
    expect(
      createOutputWatchdog().observe(
        `${paragraph}, with ordinary prose.\n\n`.repeat(12),
      )?.watchdog.reason,
    ).toBe("repeated_output");
  });
  it("does not exempt a request that explicitly forbids repetition", () => {
    expect(
      createOutputWatchdog("Do not repeat this passage").observe(
        `${paragraph}\n\n`.repeat(12),
      )?.watchdog.reason,
    ).toBe("repeated_output");
  });
  it("stops repeated-token collapse across arbitrary chunk boundaries", () => {
    const detector = createOutputWatchdog();
    let stop = null;
    for (let i = 0; i < 600 && !stop; i++) stop = detector.observe("foo ");
    expect(stop?.watchdog.reason).toBe("repeated_output");
  });
  it("allows intentional repetition but keeps the whitespace flood ceiling", () => {
    const detector = createOutputWatchdog(
      "Please repeat this phrase many times.",
    );
    expect(detector.observe("foo ".repeat(4000))).toBeNull();
    expect(detector.observe(" ".repeat(L.whitespace))?.watchdog.reason).toBe(
      "excessive_whitespace",
    );
  });
  it("does not treat similar but changing paragraphs as collapse", () => {
    const text = Array.from(
      { length: 50 },
      (_, i) => `${paragraph} Unique ${String.fromCharCode(65 + i)}.\n\n`,
    ).join("");
    expect(createOutputWatchdog().observe(text)).toBeNull();
  });
  it("inspects large chunks with bounded retained suffix rather than quadratic whitespace regex", () => {
    expect(
      createOutputWatchdog().observe(`${" ".repeat(1_000_000)}useful`),
    ).toBeNull();
    expect(
      createOutputWatchdog().observe(" ".repeat(1_000_000))?.watchdog.reason,
    ).toBe("excessive_whitespace");
  });
  it("stops two negligible continuation segments without changing the first answer", () => {
    const detector = createOutputWatchdog();
    expect(detector.segment(paragraph, false)).toBeNull();
    expect(detector.segment("Tiny", true)).toBeNull();
    expect(detector.segment("Tiny", true)?.watchdog.reason).toBe(
      "continuation_loop",
    );
  });
  it("stops an equivalent suffix in two successive continuation/recovery cycles", () => {
    const detector = createOutputWatchdog();
    detector.segment(paragraph, false);
    expect(detector.segment(paragraph, true)).toBeNull();
    expect(detector.segment(paragraph, true)?.watchdog.reason).toBe(
      "continuation_loop",
    );
  });
  it("allows valid continuation progress, code and intentional suffixes", () => {
    const detector = createOutputWatchdog();
    for (const text of [
      paragraph,
      `${paragraph} More progress.`,
      `${paragraph} Done.`,
      "const fixture = true;".repeat(30),
    ])
      expect(detector.segment(text, true)).toBeNull();
    const intentional = createOutputWatchdog("Repeat this passage");
    for (let i = 0; i < 10; i++)
      expect(intentional.segment(paragraph, true)).toBeNull();
  });
  it("does not mistake a shared long suffix for negligible or identical progress", () => {
    const detector = createOutputWatchdog();
    for (let i = 0; i < 5; i++) {
      expect(
        detector.segment(
          `${i} Useful new content ${paragraph.repeat(8)}`,
          true,
        ),
      ).toBeNull();
      expect(
        detector.segment(`${i} Useful new content ${" ".repeat(600)}`, true),
      ).toBeNull();
    }
  });
  it("keeps a structured stop latched and never stores output in the reason", () => {
    const detector = createOutputWatchdog();
    const stop = detector.observe(" ".repeat(L.whitespace));
    expect(detector.observe("late chunk")).toBe(stop);
    expect(JSON.stringify(stop?.watchdog)).not.toContain("late chunk");
  });
  it("normalizes watchdogs distinctly and never makes them retryable", () => {
    const error = new OutputWatchdogError("repeated_output");
    expect(
      normalizeAiError(Object.assign(new Error("outer"), { cause: error })),
    ).toMatchObject({
      kind: "watchdog",
      errorCode: "repeated_output",
      retryable: false,
      disposition: "terminal",
    });
    expect(isRetryableProviderAttempt(error)).toBe(false);
    expect(readWatchdogError({ watchdog: { version: 99 } })).toBeNull();
  });
});

const observation = {
  toolName: "read_file",
  input: { path: "a" },
  output: { content: "same" },
  failed: false,
};
describe("F2 existing tool observation loop protection", () => {
  it("stops eight identical successful calls with unchanged normalized state", () => {
    const detector = createOutputWatchdog();
    for (let i = 0; i < L.toolSuccesses - 1; i++)
      expect(detector.tool(observation, { version: 1 })).toBeNull();
    expect(detector.tool(observation, { version: 1 })?.watchdog.reason).toBe(
      "repeated_tool_call",
    );
  });
  it("extends the existing three-identical-failure detector", () => {
    const detector = createOutputWatchdog();
    for (let i = 0; i < 2; i++)
      expect(detector.tool({ ...observation, failed: true })).toBeNull();
    expect(
      detector.tool({ ...observation, failed: true })?.watchdog.reason,
    ).toBe("repeated_tool_call");
  });
  it.each([
    "input",
    "output",
    "version",
    "name",
  ])("allows repeated operations when %s changes", (part) => {
    const detector = createOutputWatchdog();
    for (let i = 0; i < 30; i++)
      expect(
        detector.tool(
          {
            ...observation,
            ...(part === "input" ? { input: { path: `a${i}` } } : {}),
            ...(part === "output" ? { output: { content: `${i}` } } : {}),
            ...(part === "name" ? { toolName: `tool${i}` } : {}),
          },
          { version: part === "version" ? i : 1 },
        ),
      ).toBeNull();
  });
  it("normalizes object key order, not array order", () => {
    expect(boundedToolFingerprint({ a: 1, b: 2 })).toBe(
      boundedToolFingerprint({ b: 2, a: 1 }),
    );
    expect(boundedToolFingerprint([1, 2])).not.toBe(
      boundedToolFingerprint([2, 1]),
    );
  });
  it("does not create false matches from incomplete or oversized results", () => {
    const detector = createOutputWatchdog();
    for (let i = 0; i < 20; i++)
      expect(
        detector.tool({ ...observation, output: "x".repeat(L.toolBytes) + i }),
      ).toBeNull();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(boundedToolFingerprint(circular)).toBeNull();
    expect(boundedToolFingerprint(NaN)).toBeNull();
    expect(boundedToolFingerprint(undefined)).toBeNull();
  });
  it("honors explicit repeated successful operation requests without disabling failure safety", () => {
    const detector = createOutputWatchdog("Repeat the read operation");
    for (let i = 0; i < 20; i++) expect(detector.tool(observation)).toBeNull();
    detector.tool({ ...observation, failed: true });
    detector.tool({ ...observation, failed: true });
    expect(
      detector.tool({ ...observation, failed: true })?.watchdog.reason,
    ).toBe("repeated_tool_call");
  });
});
