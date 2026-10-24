import type { UIMessage } from "ai";

// A narrow signal, not a parser: the output is never converted to an SDK call.
// Match only unmistakable standalone invocations of a currently exposed tool.
export function imitatedNativeTool(text: string, exposed: ReadonlySet<string>): string | null {
  if (!exposed.size || text.length > 16_384) return null;
  const start = text.trim().replace(/^<tool_call>\s*/i, "");
  if (/^\{\s*["'](?:name|tool_calls|function)["']\s*:/.test(start) &&
    /["'](?:arguments|parameters)["']\s*:/.test(start)) {
    const name = /["']name["']\s*:\s*["']([\w-]+)["']/.exec(start)?.[1];
    if (name && exposed.has(name)) return name;
  }
  for (const line of text.split(/\r?\n/)) {
    const candidate = line.trim();
    const xml = /^<(?:function\s*=\s*|function_call\s+name\s*=\s*["']?)([\w-]+)(?:["']?\s*)>/i.exec(candidate);
    if (xml && exposed.has(xml[1])) return xml[1];
    const call = /^([a-zA-Z_][\w-]*)\s*\(\s*\{/.exec(candidate);
    if (call && exposed.has(call[1])) return call[1];
  }
  return null;
}

// This guard intentionally does not apply to ordinary questions, reviews,
// discussion of tool syntax, or a completed coding task's final answer.
export function actionableCoderRequest(messages: readonly UIMessage[]): boolean {
  const last = [...messages].reverse().find(m => m.role === "user");
  const request = last?.parts.filter(p => p.type === "text").map(p => p.text).join("\n").trim() ?? "";
  return /^(?:please\s+|can you\s+|could you\s+)?(?:build|implement|create|write|fix|debug|refactor|modify|edit|add|update|run|test|install|repair|develop|set up)\b/i.test(request) &&
    !/^(?:please\s+)?(?:explain|describe|discuss|review|summarize|compare|brainstorm)\b/i.test(request);
}
