// Deterministic loopback provider for actual Tauri acceptance, never a production path.
import http from "node:http";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const root = path.resolve(".native-u1.local/workspace");
const profile = path.join(process.env.APPDATA, "app.clack.u1-acceptance");
if (process.argv.includes("--seed")) {
  const previous = JSON.parse(await readFile(path.join(profile, "terax-ai-sessions.json"), "utf8"));
  const hasContent = Object.entries(previous).some(([key, value]) => key.startsWith("messages:") && value.length);
  if (hasContent || previous.sessions?.some((session) => session.title !== "New chat" || session.run)) throw Error("Refusing to replace existing acceptance conversations");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "sample.txt"), "U1 local evidence. Required bounds are explicit.\n");
  const workspaceRoot = root.replaceAll("\\", "/");
  const workspaceId = `local:${workspaceRoot.toLowerCase()}`;
  const now = Date.now();
  const sessions = ["coder", "reviewer"].map((agent) => ({ id: `u1-${agent}`, title: `U1 ${agent}`, createdAt: now, updatedAt: now, profileVersion: 1,
    profile: { agentId: `builtin:${agent}`, modelId: "compat-u1", workspaceId, workspaceRoot } }));
  const messages = Object.fromEntries(sessions.map((s) => [`messages:${s.id}`, [{ id: `source-${s.id}`, role: "user", parts: [{ type: "text", text: "U1 acceptance: preserve source evidence and private conversation ownership." }] }]]));
  await writeFile(path.join(profile, "terax-ai-sessions.json"), JSON.stringify({ sessions, activeId: "u1-coder", ...messages }));
  await writeFile(path.join(profile, "terax-settings.json"), JSON.stringify({ theme: "dark", customEndpoints: [{ id: "u1", name: "U1 loopback", baseURL: "http://127.0.0.1:1438/v1", modelId: "u1-fixture", contextLimit: 131072 }], savedProviderModelsVersion: 1, savedProviderModels: [], lastUsedAiSelection: { agentId: "builtin:coder", modelId: "compat-u1" } }));
  await writeFile(path.join(profile, "terax-spaces.json"), JSON.stringify({ activeId: "default", spaces: [{ id: "default", name: "U1 acceptance", root: workspaceRoot, explorerPath: workspaceRoot, env: { kind: "local" }, createdAt: now, updatedAt: now }], "state:default": { activeTabIndex: 0, tabs: [{ kind: "terminal", tree: { active: true, cwd: workspaceRoot, kind: "leaf" } }] } }));
  console.log("Seeded isolated U1 acceptance profile; normal Clack data untouched.");
}
let requests = 0;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 2 ** 20) { res.writeHead(413).end(); return; } }
  if (req.method === "GET") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ object: "list", data: [{ id: "u1-fixture", object: "model" }] })); return; }
  const request = JSON.parse(body);
  console.log(`U1 loopback request ${++requests}: ${request.model}; ${request.messages.length} messages`);
  const lastUserIndex = request.messages.findLastIndex((message) => message.role === "user");
  const prompt = JSON.stringify(request.messages[lastUserIndex]?.content ?? "");
  const hasResult = request.messages.slice(lastUserIndex + 1).some((message) => message.role === "tool");
  const tool = !hasResult && /approval/i.test(prompt) ? { name: "write_file", arguments: { path: "report.txt", content: "U1 bounded output\n" } }
    : !hasResult && /read the sample/i.test(prompt) ? { name: "read_file", arguments: { path: "sample.txt" } } : null;
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: `u1-${requests}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  send({ role: "assistant" });
  if (tool) { send({ tool_calls: [{ index: 0, id: `u1-call-${requests}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }); send({}, "tool_calls"); res.end("data: [DONE]\n\n"); return; }
  const text = hasResult ? "The tool result is recorded in this conversation." : "U1 native acceptance is running. Source evidence is preserved. This response belongs only to the selected conversation. Minimize and restore do not restart this request. The local provider completes without external data transfer.";
  const words = text.split(" ");
  let index = 0;
  const timer = setInterval(() => {
    if (index < words.length) send({ content: `${words[index++]} ` });
    else { clearInterval(timer); send({}, "stop"); res.end("data: [DONE]\n\n"); }
  }, hasResult ? 80 : 1000);
  res.on("close", () => clearInterval(timer));
});
server.listen(1438, "127.0.0.1", () => console.log("U1 acceptance provider on 127.0.0.1:1438 (no real model, no external service)."));
process.on("SIGINT", () => { server.close(); process.exit(0); });
