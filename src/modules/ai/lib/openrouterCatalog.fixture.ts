// Public API record shape captured during this fix; irrelevant descriptive fields retained.
export const lagunaCatalogRecord = {
  id: "poolside/laguna-s-2.1:free",
  canonical_slug: "poolside/laguna-s-2.1-20260720",
  hugging_face_id: "poolside/Laguna-S-2.1",
  name: "Poolside: Laguna S 2.1 (free)",
  created: 1784652683,
  description: "Laguna S 2.1 is the latest coding agent model from Poolside.",
  context_length: 262144,
  architecture: {
    modality: "text->text",
    input_modalities: ["text"],
    output_modalities: ["text"],
    tokenizer: "Other",
    instruct_type: null,
  },
  pricing: { prompt: "0", completion: "0" },
  top_provider: {
    context_length: 262144,
    max_completion_tokens: 32768,
    is_moderated: false,
  },
  per_request_limits: null,
  supported_parameters: [
    "include_reasoning",
    "max_tokens",
    "reasoning",
    "temperature",
    "tool_choice",
    "tools",
  ],
  default_parameters: {},
  supported_voices: null,
  knowledge_cutoff: null,
  expiration_date: "2026-10-31",
  links: { details: "/api/v1/models/poolside/laguna-s-2.1-20260720/endpoints" },
  reasoning: { mandatory: false, default_enabled: true },
};

export const minimaxBaseCatalogRecord = {
  id: "minimax/minimax-m3",
  canonical_slug: "minimax/minimax-m3-20260531",
  hugging_face_id: "MiniMaxAI/Minimax-M3",
  name: "MiniMax: MiniMax M3",
  created: 1780245374,
  description: "MiniMax-M3 is a multimodal foundation model from MiniMax.",
  context_length: 1048576,
  architecture: {
    modality: "text+image+video->text",
    input_modalities: ["text", "image", "video"],
    output_modalities: ["text"],
    tokenizer: "Other",
    instruct_type: null,
  },
  pricing: {
    prompt: "0.0000003",
    completion: "0.0000012",
    input_cache_read: "0.00000006",
  },
  top_provider: {
    context_length: 524288,
    max_completion_tokens: 512000,
    is_moderated: false,
  },
  per_request_limits: null,
  supported_parameters: [
    "frequency_penalty",
    "include_reasoning",
    "logit_bias",
    "logprobs",
    "max_tokens",
    "min_p",
    "presence_penalty",
    "reasoning",
    "repetition_penalty",
    "response_format",
    "seed",
    "stop",
    "structured_outputs",
    "temperature",
    "tool_choice",
    "tools",
    "top_k",
    "top_logprobs",
    "top_p",
  ],
  default_parameters: {
    temperature: 1,
    top_p: 0.95,
    top_k: null,
    frequency_penalty: null,
    presence_penalty: null,
    repetition_penalty: null,
  },
  supported_voices: null,
  knowledge_cutoff: null,
  expiration_date: null,
  links: { details: "/api/v1/models/minimax/minimax-m3-20260531/endpoints" },
  reasoning: { mandatory: false },
};

// Reproduction fixture, not a captured positive API result for this variant.
// It models the user's exact-variant evidence with the actual API record shape.
export const minimaxFreeCatalogRecord = {
  ...minimaxBaseCatalogRecord,
  id: "minimax/minimax-m3:free",
  name: "MiniMax: MiniMax M3 (free)",
  pricing: { prompt: "0", completion: "0" },
  top_provider: {
    context_length: 1048576,
    max_completion_tokens: 32768,
    is_moderated: false,
  },
  reasoning: {
    mandatory: false,
    default_enabled: true,
    supported_efforts: ["high", "low"],
    default_effort: "high",
  },
};

export const openrouterCatalogFixture = {
  data: [
    lagunaCatalogRecord,
    minimaxBaseCatalogRecord,
    minimaxFreeCatalogRecord,
  ],
};
