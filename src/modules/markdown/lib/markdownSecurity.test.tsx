import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) =>
    `http://asset.localhost/${encodeURIComponent(value)}`,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { MessageResponse } from "@/components/ai-elements/message";
import { Streamdown } from "streamdown";
import {
  createMarkdownRehypePlugins,
  createMarkdownUrlTransform,
} from "../MarkdownPreviewPane";

const hostileMarkdown = [
  "Visible safe text.",
  "<script>window.__clackXss = true</script>",
  '<img src="x" onerror="alert(1)">',
  '<svg onload="alert(1)"><script>alert(1)</script></svg>',
  "[unsafe link](javascript:alert(1))",
].join("\n\n");

function expectNoExecutableMarkup(html: string) {
  expect(html).toMatch(/Visible safe text/);
  expect(html).not.toMatch(/<script\b/i);
  expect(html).not.toMatch(/<img\b[^>]*\bonerror\s*=/i);
  expect(html).not.toMatch(/<svg\b[^>]*\bonload\s*=/i);
  expect(html).not.toMatch(/href=["']javascript:/i);
}

describe("untrusted Markdown rendering", () => {
  it("keeps chat responses inert when provider content contains HTML and unsafe links", () => {
    const html = renderToStaticMarkup(
      <MessageResponse>{hostileMarkdown}</MessageResponse>,
    );
    expectNoExecutableMarkup(html);
  });

  it("keeps workspace Markdown inert through its raw/sanitize/harden plugin chain", () => {
    const html = renderToStaticMarkup(
      <Streamdown
        rehypePlugins={createMarkdownRehypePlugins("docs/guide.md", null)}
        urlTransform={createMarkdownUrlTransform("docs/guide.md", null)}
      >
        {hostileMarkdown}
      </Streamdown>,
    );
    expectNoExecutableMarkup(html);
  });

  it("preserves supported GFM tables, strikethrough, code blocks and external links in both surfaces", () => {
    const markdown = [
      "| Name | Value |",
      "| --- | --- |",
      "| answer | 42 |",
      "",
      "~~obsolete~~",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "[Reference](https://example.com/docs)",
    ].join("\n");
    const chat = renderToStaticMarkup(<MessageResponse>{markdown}</MessageResponse>);
    const preview = renderToStaticMarkup(
      <Streamdown
        rehypePlugins={createMarkdownRehypePlugins("docs/guide.md", null)}
        urlTransform={createMarkdownUrlTransform("docs/guide.md", null)}
      >
        {markdown}
      </Streamdown>,
    );

    for (const html of [chat, preview]) {
      expect(html).toContain("<table");
      expect(html).toContain("<del>");
      expect(html).toContain("const answer = 42;");
      expect(html).toContain("Reference");
      expect(html).toContain('data-streamdown="link"');
    }
  });

  it("keeps incomplete streaming Markdown readable while a response is still arriving", () => {
    const html = renderToStaticMarkup(
      <Streamdown mode="streaming" isAnimating>
        {"**partial streamed answer\n\n```ts\nconst pending = true;"}
      </Streamdown>,
    );
    expect(html).toContain("partial streamed answer");
    expect(html).toContain("const pending = true;");
    expect(html).not.toMatch(/<script\b/i);
  });

  it("confines workspace images to the workspace while preserving valid local images", () => {
    const html = renderToStaticMarkup(
      <Streamdown
        rehypePlugins={createMarkdownRehypePlugins(
          "C:/workspace/docs/guide.md",
          "C:/workspace",
        )}
        urlTransform={createMarkdownUrlTransform(
          "C:/workspace/docs/guide.md",
          "C:/workspace",
        )}
      >
        {"![local](./images/local.png)\n\n![outside](../../secret.png)"}
      </Streamdown>,
    );
    expect(html).toContain(
      "http://asset.localhost/C%3A%2Fworkspace%2Fdocs%2Fimages%2Flocal.png",
    );
    expect(html).toContain("Image blocked: image path is outside the workspace");
  });
  it.each([
    "asset://localhost/C%3A%2Fprivate%2Fsecrets.png",
    "https://asset.localhost/C%3A%2Fprivate%2Fsecrets.png",
    "http://asset.localhost/C%3A%2Fprivate%2Fsecrets.png",
  ])("rejects user-authored asset image URLs outside the workspace: %s", (forgedAsset) => {
    const html = renderToStaticMarkup(
      <Streamdown
        rehypePlugins={createMarkdownRehypePlugins("C:/workspace/docs/readme.md", "C:/workspace")}
        urlTransform={createMarkdownUrlTransform("C:/workspace/docs/readme.md", "C:/workspace")}
      >
        {`![forged asset](${forgedAsset})`}
      </Streamdown>,
    );
    expect(html).toContain("Image blocked: untrusted local asset URL");
    expect(html).not.toContain(forgedAsset);
  });

  it("does not activate Mermaid diagrams or math notation without opt-in plugins", () => {
    const markdown = [
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "Inline math remains text: $x^2$.",
    ].join("\n");
    const chat = renderToStaticMarkup(
      <MessageResponse>{markdown}</MessageResponse>,
    );
    const preview = renderToStaticMarkup(
      <Streamdown
        rehypePlugins={createMarkdownRehypePlugins("docs/guide.md", null)}
        urlTransform={createMarkdownUrlTransform("docs/guide.md", null)}
      >
        {markdown}
      </Streamdown>,
    );

    for (const html of [chat, preview]) {
      expect(html).toContain("graph TD");
      expect(html).toContain("$x^2$");
      expect(html).not.toContain("katex");
      expect(html).not.toMatch(/<svg\b[^>]*class=["'][^"']*mermaid/i);
    }
  });
});
