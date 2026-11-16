export type SubscriptionInputError =
  | 'INVALID_NAME'
  | 'INVALID_URL'
  | 'HTTPS_REQUIRED'
  | 'URL_CREDENTIALS_NOT_ALLOWED'
  | 'URL_FRAGMENT_NOT_ALLOWED';

export type SubscriptionValidation =
  | { ok: true; value: { name: string; sourceUrl: string } }
  | { ok: false; error: SubscriptionInputError };

/** Input validation only: does not download, persist or assert YAML/core compatibility. */
export function validateSubscriptionInput(input: {
  name: string;
  sourceUrl: string;
}): SubscriptionValidation {
  const name = input.name.trim();
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/u.test(name)) {
    return { ok: false, error: 'INVALID_NAME' };
  }

  const rawUrl = input.sourceUrl.trim();
  if (!rawUrl || rawUrl.length > 8192 || /[\s\\]/u.test(rawUrl)) {
    return { ok: false, error: 'INVALID_URL' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'HTTPS_REQUIRED' };
  }
  if (!/^https:\/\//iu.test(rawUrl) || !url.hostname) {
    return { ok: false, error: 'INVALID_URL' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URL_CREDENTIALS_NOT_ALLOWED' };
  }
  if (rawUrl.includes('#')) {
    return { ok: false, error: 'URL_FRAGMENT_NOT_ALLOWED' };
  }

  // Preserve query tokens and signed URL encoding; do not log this value.
  return { ok: true, value: { name, sourceUrl: rawUrl } };
}
