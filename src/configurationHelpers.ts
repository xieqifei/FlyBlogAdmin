const PASSWORD_ITERATIONS = 600_000;

function randomBytes(length: number) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateSecretKey() {
  return base64Url(randomBytes(32));
}

export async function generatePasswordHash(password: string) {
  const salt = base64Url(randomBytes(16));
  const material = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS }, material, 256);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${base64(new Uint8Array(derived))}`;
}
