/** Acceptance-only built-in names extracted from the factories imported by
 * production buildTools. No UI/store imports, no browser or model execution.
 * Unknown/dynamic factories fail closed instead of guessing permitted names.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export async function productionBuiltinToolNames(repository) {
  const root = path.join(repository, "src/modules/ai/tools");
  const source = await readFile(path.join(root, "tools.ts"), "utf8");
  const index = ts.createSourceFile("tools.ts", source, ts.ScriptTarget.Latest, true);
  const modules = [];
  for (const node of index.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const spec = node.moduleSpecifier.text;
    const name = spec.startsWith("./") ? spec.slice(2) :
      spec.startsWith("@/modules/ai/tools/") ? spec.slice("@/modules/ai/tools/".length) : null;
    if (name && /^[a-z]+$/.test(name) && name !== "context") modules.push(name);
  }
  if (modules.length < 10) throw new Error("Production native tool registry imports unavailable");
  const names = new Set();
  for (const name of modules) {
    const content = await readFile(path.join(root, name + ".ts"), "utf8");
    const parsed = ts.createSourceFile(name + ".ts", content, ts.ScriptTarget.Latest, true);
    let found = 0;
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "tool" &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
        const toolName = node.name.text;
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(toolName)) throw new Error("Invalid native tool registry name");
        names.add(toolName);
        found++;
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (!found) throw new Error("Production native tool factory missing static definitions: " + name);
  }
  for (const required of ["read_file", "list_directory", "bash_run", "todo_write"])
    if (!names.has(required)) throw new Error("Required production native tool missing: " + required);
  return [...names].sort();
}
