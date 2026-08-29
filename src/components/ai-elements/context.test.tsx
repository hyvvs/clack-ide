import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Context, ContextTrigger } from "./context";

describe("ContextTrigger", () => {
  it("keeps custom multi-part content inside one slottable button", () => {
    expect(() =>
      renderToStaticMarkup(
        <Context usedTokens={1_000} maxTokens={100_000}>
          <ContextTrigger title="Model: Example">
            <span>Example</span>
            <span>1%</span>
          </ContextTrigger>
        </Context>,
      ),
    ).not.toThrow();

    const html = renderToStaticMarkup(
      <Context usedTokens={1_000} maxTokens={100_000}>
        <ContextTrigger title="Model: Example">
          <span>Example</span>
          <span>1%</span>
        </ContextTrigger>
      </Context>,
    );
    expect(html).toContain("<button");
    expect(html).toContain('title="Model: Example"');
    expect(html).toContain("Example");
    expect(html).toContain("1%");
  });
});
