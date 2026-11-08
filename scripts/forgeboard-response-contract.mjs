/** Narrowly recognize rejected evaluator inputs, including Express JSON-parser HTML errors. */
export function isRejectedInput(response) {
  if (![400, 422].includes(response?.status)) return false;
  const body = response?.json;
  if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length > 0)
    return true;
  return response.status === 400
    && typeof response.contentType === "string"
    && /text\/html/i.test(response.contentType)
    && typeof response.text === "string"
    && response.text.trim().length > 0
    && /SyntaxError|Unexpected token|JSON/i.test(response.text);
}

export function unwrapResponse(response, key) {
  return response?.json?.[key] ?? response?.json?.data?.[key] ?? response?.json?.data ?? response?.json;
}

export function responseList(response, key) {
  const value = unwrapResponse(response, key);
  return Array.isArray(value) ? value : value?.items ?? value?.[key] ?? value?.results ?? [];
}

/** A 2xx status alone is not CRUD evidence; require the expected entity fields. */
export function matchesResponseEntity(response, key, expected) {
  if (![200, 201].includes(response?.status)) return false;
  if (Object.hasOwn(expected, "id") && expected.id == null) return false;
  const entity = unwrapResponse(response, key);
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) return false;
  return Object.entries(expected).every(([field, value]) =>
    JSON.stringify(entity[field]) === JSON.stringify(value));
}
