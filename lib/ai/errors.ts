/** Error messages safe to show the user: built from status codes, never from provider text or the key. */

export class ProviderError extends Error {
  name = "ProviderError";
}

export function providerStatusMessage(provider: string, status: number | undefined): string {
  switch (status) {
    case 400:
      return `${provider} rejected the request (400). The model may not support structured output.`;
    case 401:
      return `${provider} rejected the API key (401). Check that it was copied correctly.`;
    case 403:
      return `This ${provider} key is not allowed to use that model (403).`;
    case 404:
      return `${provider} could not find that model for this key (404).`;
    case 429:
      return `${provider} rate limit or credit limit reached (429).`;
    default:
      return status && status >= 500
        ? `${provider} is having problems (${status}). Try again shortly.`
        : `${provider} returned an error${status ? ` (${status})` : ""}.`;
  }
}
