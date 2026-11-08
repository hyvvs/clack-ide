import { describe, expect, it } from "vitest";
import {
  isRejectedInput,
  matchesResponseEntity,
  responseList,
} from "./forgeboard-response-contract.mjs";

describe("ForgeBoard invalid-input response contract", () => {
  it("accepts structured 400/422 validation errors", () => {
    expect(isRejectedInput({ status: 400, json: { error: "Invalid project" } })).toBe(true);
    expect(isRejectedInput({ status: 422, json: { message: "Invalid task" } })).toBe(true);
  });

  it("accepts Express HTML JSON-parser rejection for malformed JSON", () => {
    expect(isRejectedInput({
      status: 400,
      contentType: "text/html; charset=utf-8",
      text: "<pre>SyntaxError: Expected property name or '}' in JSON</pre>",
    })).toBe(true);
  });

  it.each([
    { status: 200, json: { error: "wrong behavior" } },
    { status: 400, json: [] },
    { status: 400, json: {} },
    { status: 400, contentType: "text/plain", text: "Invalid input" },
    { status: 400, contentType: "text/html", text: "<h1>Unrelated proxy failure</h1>" },
    { status: 500, json: { error: "Internal error" } },
  ])("does not accept unrelated or successful response %j", response => {
    expect(isRejectedInput(response)).toBe(false);
  });

  it("requires CRUD entity semantics instead of trusting HTTP 200", () => {
    expect(matchesResponseEntity({ status: 200, json: { project: { id: "p1", name: "Expected" } } },
      "project", { id: "p1", name: "Expected" })).toBe(true);
    expect(matchesResponseEntity({ status: 200, json: { project: { id: "p1", name: "Unchanged" } } },
      "project", { id: "p1", name: "Expected" })).toBe(false);
    expect(matchesResponseEntity({ status: 200, json: { task: { id: "t1", status: "Todo", priority: "High" } } },
      "task", { id: "t1", status: "In Progress", priority: "Urgent" })).toBe(false);
    expect(matchesResponseEntity({ status: 200, json: { ok: true } },
      "task", { id: "t1", title: "Expected" })).toBe(false);
    expect(matchesResponseEntity({ status: 500, json: { project: { id: "p1", name: "Expected" } } },
      "project", { id: "p1", name: "Expected" })).toBe(false);
  });

  it("reads collection envelopes without treating unrelated 200 bodies as resource lists", () => {
    expect(responseList({ status: 200, json: { data: { projects: [{ id: "p1" }] } } }, "projects"))
      .toEqual([{ id: "p1" }]);
    expect(responseList({ status: 200, json: { message: "healthy" } }, "projects")).toEqual([]);
  });
});
