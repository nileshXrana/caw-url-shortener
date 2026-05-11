const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function normalizeLongUrl(input: string): string {
  const trimmed = input.trim();
  if (CONTROL_CHARS.test(trimmed)) return "";
  return trimmed;
}

export function isValidRedirectUrl(url: string): boolean {
  if (!url) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Must be http or https
  if (!["http:", "https:"].includes(parsed.protocol)) return false;

  // Must be an absolute URL with a real host.
  if (!parsed.hostname) return false;

  // Block userinfo tricks like https://good.com@evil.example.com
  if (parsed.username || parsed.password) return false;

  // Disallow scheme-relative URLs like //evil.example.com (URL() treats them as invalid without a base)
  // but also block obvious weird encodings/backslashes which often indicate bypass attempts.
  if (url.startsWith("//")) return false;
  if (url.includes("\\\\")) return false;

  return true;
}
