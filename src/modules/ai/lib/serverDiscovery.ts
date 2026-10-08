import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { normalizeEndpointUrl } from "@/modules/ai/lib/selfHostedProfiles";

export const DISCOVERY_LIMITS = {
  addresses: 8,
  addressBytes: 2048,
  inputBytes: 16384,
  deadlineMs: 15000,
  uiDeadlineMs: 17000,
};
const candidate = z
  .object({
    baseURL: z
      .string()
      .max(DISCOVERY_LIMITS.addressBytes)
      .transform(normalizeEndpointUrl),
    backendHint: z.enum(["ollama"]).nullable(),
    source: z.enum([
      "user-address/compatible-inventory",
      "user-address/ollama-inventory",
      "user-address/authentication-required",
    ]),
  })
  .strict()
  .refine(
    (value) =>
      (value.source === "user-address/ollama-inventory") ===
      (value.backendHint === "ollama"),
    "Contradictory discovery source",
  );
const result = z
  .object({
    candidates: z.array(candidate).max(DISCOVERY_LIMITS.addresses),
    issues: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(7),
            code: z.string().max(64),
          })
          .strict(),
      )
      .max(8),
    timedOut: z.boolean(),
  })
  .strict();
export type ServerCandidate = z.infer<typeof candidate>;
export type DiscoveryResult = z.infer<typeof result>;
type Invoker = <T>(
  command: string,
  args: Record<string, unknown>,
) => Promise<T>;

export function candidateIdentity(address: string): string {
  const url = new URL(normalizeEndpointUrl(address));
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.href;
}

export function discoveryAddresses(text: string): string[] {
  if (new TextEncoder().encode(text).length > DISCOVERY_LIMITS.inputBytes)
    throw new Error("Candidate addresses exceed 16 KiB.");
  const addresses = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!addresses.length || addresses.length > DISCOVERY_LIMITS.addresses)
    throw new Error("Enter one to eight candidate addresses.");
  if (
    addresses.some(
      (address) =>
        new TextEncoder().encode(address).length >
        DISCOVERY_LIMITS.addressBytes,
    )
  )
    throw new Error("Each candidate address must fit within 2 KiB.");
  return addresses;
}

export function createServerDiscoveryClient(call: Invoker = invoke) {
  return {
    async discover(
      addresses: string[],
      allowPrivateNetwork: boolean,
      signal: AbortSignal,
    ): Promise<DiscoveryResult> {
      signal.throwIfAborted();
      // Copy only the explicit address list and run-local opt-in. No profile/header/key input.
      const options = {
        addresses: discoveryAddresses(addresses.join("\n")),
        allowPrivateNetwork,
      };
      let requestId: string | undefined;
      const cancel = () => {
        if (requestId)
          void call("ai_http_cancel", { requestId }).catch(() => {});
      };
      let abort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        abort = () => {
          cancel();
          reject(new DOMException("Discovery cancelled", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
      });
      const work = async () => {
        requestId = await call<string>("ai_http_open", {});
        if (signal.aborted) {
          cancel();
          signal.throwIfAborted();
        }
        const value = result.parse(
          await call("self_hosted_discover", { requestId, options }),
        );
        signal.throwIfAborted();
        const seen = new Set<string>();
        value.candidates = value.candidates.filter((item) => {
          const identity = candidateIdentity(item.baseURL);
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
        return value;
      };
      try {
        return await Promise.race([work(), aborted]);
      } finally {
        signal.removeEventListener("abort", abort);
        cancel();
      }
    },
  };
}
