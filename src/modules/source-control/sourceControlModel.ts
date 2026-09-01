import type { CustomEndpoint, ModelInfo } from "@/modules/ai/config";
import {
  resolveModelSelectionInfo,
  type SavedProviderModel,
} from "@/modules/ai/lib/savedProviderModels";

export function resolveSourceControlModel(
  selectionId: string,
  customEndpoints: readonly CustomEndpoint[],
  savedProviderModels: readonly SavedProviderModel[],
): ModelInfo | null {
  try {
    return resolveModelSelectionInfo(
      selectionId,
      customEndpoints,
      savedProviderModels,
    );
  } catch {
    return null;
  }
}
