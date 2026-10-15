export function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    isDev ? 'connect-src http://localhost:* ws://localhost:*' : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}
