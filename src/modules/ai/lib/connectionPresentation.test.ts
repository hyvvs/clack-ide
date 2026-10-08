import { describe, expect, it } from "vitest";
import { describeConnectionAddress, modelConnectionLabel } from "@/modules/ai/lib/connectionPresentation";

describe("connection destination presentation, not authorization", () => {
  it.each([
    ["http://localhost:11434/v1", "Same-PC address"],
    ["http://127.0.0.1:1234", "Same-PC address"],
    ["http://[::1]:8080", "Same-PC address"],
    ["http://test.localhost", "Same-PC address"],
    ["http://10.1.2.3", "Private-network address"],
    ["http://172.16.0.1", "Private-network address"],
    ["http://172.31.255.254", "Private-network address"],
    ["http://192.168.1.50", "Private-network address"],
    ["http://169.254.1.2", "Private-network address"],
    ["http://[fd00::1]", "Private-network address"],
    ["http://[fe80::1]", "Private-network address"],
    ["https://example.com", "Network address (location unverified)"],
    ["http://gaming-pc.local", "Network address (location unverified)"],
    ["http://172.32.0.1", "Network address (location unverified)"],
    ["file:///private", "Destination unknown"],
    ["not an address", "Destination unknown"],
  ])("%s is %s", (url, label) => expect(describeConnectionAddress(url).label).toBe(label));

  it("does not display credentials, query tokens, fragments or private paths", () => {
    expect(describeConnectionAddress("https://user:SECRET@example.com/private?key=SECRET#SECRET").address).toBe("https://example.com");
  });
  it("uses the actual configured address, not the local provider name", () => {
    expect(modelConnectionLabel("ollama-local", { ollamaModelId: "model", ollamaBaseURL: "http://192.168.1.50:11434" })).toContain("Private-network address");
  });
  it("reports known provider routing and fails closed for missing configuration", () => {
    expect(modelConnectionLabel("gpt-5.4-mini", {})).toBe("Cloud connection");
    expect(modelConnectionLabel("compat-missing", {})).toBe("Destination unknown");
    expect(modelConnectionLabel("ollama-local", {})).toBe("Destination unknown");
  });
  it("uses custom endpoint identity without displaying URL secrets", () => {
    expect(modelConnectionLabel("compat-test", { customEndpoints: [{id:"test",name:"Local-looking name",modelId:"model",contextLimit:8192,baseURL:"https://user:SECRET@example.com/v1?key=SECRET"}] })).toBe("Network address (location unverified): https://example.com");
  });
});
