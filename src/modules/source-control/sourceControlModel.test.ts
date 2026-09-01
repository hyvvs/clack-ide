import { describe, expect, it } from "vitest";
import {
  savedProviderModelSelectionId,
  type SavedProviderModel,
} from "@/modules/ai/lib/savedProviderModels";
import { resolveSourceControlModel } from "./sourceControlModel";

const savedOpenRouterModel: SavedProviderModel = {
  id: "openrouter-reviewer",
  providerId: "openrouter",
  transportModelId: "anthropic/claude-sonnet-4",
  displayName: "Reviewer",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("resolveSourceControlModel", () => {
  it("resolves a saved provider model without treating it as a static model", () => {
    expect(
      resolveSourceControlModel(
        savedProviderModelSelectionId(savedOpenRouterModel.id),
        [],
        [savedOpenRouterModel],
      ),
    ).toMatchObject({
      provider: "openrouter",
      label: "Reviewer",
    });
  });

  it("does not throw while a saved selection is unavailable", () => {
    expect(
      resolveSourceControlModel("saved-provider:missing", [], []),
    ).toBeNull();
  });
});
