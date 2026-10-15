const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeUtf8Base64(text: string): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeUtf8Base64(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return decoder.decode(bytes)
}