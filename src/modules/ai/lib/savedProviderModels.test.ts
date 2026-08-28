import { describe, expect, it } from "vitest";
import {
  createSavedProviderModel,
  findSavedProviderModel,
  getSavedProviderModelInfo,
  isSavedProviderModelSelectionId,
  migrateSavedProviderModels,
  normalizeSavedProviderModels,
  savedProviderModelIdFromSelection,
  savedProviderModelSelectionId,
} from "./savedProviderModels";

describe("saved provider models", () => {
  it("creates a normalized model without credentials", () => {
    const model = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: " anthropic/claude-sonnet-4 ",
        displayName: " Sonnet ",
      },
      "model-a",
      42,
    );
    expect(model).toEqual({
      id: "model-a",
      providerId: "openrouter",
      transportModelId: "anthropic/claude-sonnet-4",
      displayName: "Sonnet",
      enabled: true,
      createdAt: 42,
      updatedAt: 42,
    });
    expect(JSON.stringify(model)).not.toMatch(/api.?key|credential|secret/i);
  });

  it("rejects empty model IDs", () => {
    expect(() =>
      createSavedProviderModel({
        providerId: "openrouter",
        transportModelId: "  ",
      }),
    ).toThrow("Provider model ID is empty");
  });

  it("normalizes malformed records and removes duplicates", () => {
    const value = [
      {
        id: " a ",
        providerId: "openrouter",
        transportModelId: " model/a ",
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "b",
        providerId: "openrouter",
        transportModelId: "model/a",
      },
      { id: "c", providerId: "nope", transportModelId: "model/c" },
      null,
    ];
    expect(normalizeSavedProviderModels(value)).toEqual([
      {
        id: "a",
        providerId: "openrouter",
        transportModelId: "model/a",
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
  });

  it("migrates the legacy OpenRouter model", () => {
    const migrated = migrateSavedProviderModels({
      stored: [],
      storedVersion: undefined,
      legacyOpenrouterModelId: "anthropic/claude-sonnet-4",
      now: 10,
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.models).toHaveLength(1);
    expect(migrated.models[0]).toMatchObject({
      providerId: "openrouter",
      transportModelId: "anthropic/claude-sonnet-4",
      createdAt: 10,
    });
  });

  it("keeps legacy migration stable across repeated startup", () => {
    const first = migrateSavedProviderModels({
      stored: [],
      storedVersion: undefined,
      legacyOpenrouterModelId: "openai/gpt-5",
      now: 10,
    });
    const second = migrateSavedProviderModels({
      stored: first.models,
      storedVersion: first.version,
      legacyOpenrouterModelId: "openai/gpt-5",
      now: 20,
    });
    expect(second.changed).toBe(false);
    expect(second.models).toEqual(first.models);
  });

  it("does not duplicate an already-saved legacy model", () => {
    const existing = createSavedProviderModel(
      { providerId: "openrouter", transportModelId: "openai/gpt-5" },
      "existing",
      1,
    );
    const migrated = migrateSavedProviderModels({
      stored: [existing],
      storedVersion: 1,
      legacyOpenrouterModelId: "openai/gpt-5",
      now: 2,
    });
    expect(migrated.changed).toBe(false);
    expect(migrated.models).toEqual([existing]);
  });

  it("supports several models under one provider", () => {
    const models = [
      createSavedProviderModel(
        { providerId: "openrouter", transportModelId: "anthropic/one" },
        "one",
      ),
      createSavedProviderModel(
        { providerId: "openrouter", transportModelId: "openai/two" },
        "two",
      ),
    ];
    expect(models.map((model) => model.providerId)).toEqual([
      "openrouter",
      "openrouter",
    ]);
  });

  it("round-trips a saved selection identity", () => {
    const selection = savedProviderModelSelectionId("model-a");
    expect(isSavedProviderModelSelectionId(selection)).toBe(true);
    expect(savedProviderModelIdFromSelection(selection)).toBe("model-a");
    expect(savedProviderModelIdFromSelection("gpt-5.4-mini")).toBe("");
  });

  it("resolves selection metadata without provider secrets", () => {
    const model = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "anthropic/model",
        displayName: "Review model",
      },
      "review",
    );
    const selection = savedProviderModelSelectionId(model.id);
    expect(findSavedProviderModel(selection, [model])).toEqual(model);
    expect(getSavedProviderModelInfo(selection, [model])).toMatchObject({
      id: selection,
      provider: "openrouter",
      label: "Review model",
      hint: "OpenRouter",
    });
  });

  it("fails clearly for a missing saved model", () => {
    expect(() =>
      getSavedProviderModelInfo(savedProviderModelSelectionId("missing"), []),
    ).toThrow("Saved provider model not found");
  });
});
