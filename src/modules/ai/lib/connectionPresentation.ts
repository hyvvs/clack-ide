import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";

export function describeConnectionAddress(value: string): { label: string; address: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported address");
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split(".").map(Number) : null;
    const loopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" || ipv4?.[0] === 127;
    const privateAddress = ipv4
      ? ipv4[0] === 10 || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168) || (ipv4[0] === 169 && ipv4[1] === 254)
      : host.includes(":") && (/^f[cd]/.test(host) || /^fe[89ab]/.test(host));
    return {
      label: loopback ? "Same-PC address" : privateAddress ? "Private-network address" : "Network address (location unverified)",
      address: url.origin,
    };
  } catch {
    return { label: "Destination unknown", address: "" };
  }
}

type ConnectionSettings = NonNullable<Parameters<typeof resolveModelTransportIdentity>[1]> & {
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
};

export function modelConnectionLabel(modelId: string, settings: ConnectionSettings): string {
  try {
    const identity = resolveModelTransportIdentity(modelId, settings);
    const address = identity.endpointBaseURL ?? {
      lmstudio: settings.lmstudioBaseURL,
      mlx: settings.mlxBaseURL,
      ollama: settings.ollamaBaseURL,
    }[identity.providerId as "lmstudio" | "mlx" | "ollama"];
    if (address) {
      const description = describeConnectionAddress(address);
      return `${description.label}${description.address ? `: ${description.address}` : ""}`;
    }
    if (["openai", "anthropic", "google", "xai", "cerebras", "groq", "deepseek", "mistral", "openrouter"].includes(identity.providerId)) return "Cloud connection";
    return "Destination unknown";
  } catch {
    return "Destination unknown";
  }
}
