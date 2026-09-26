import CryptoJS from "crypto-js";

// Must match the backend (backend/lib/crypto.js) and is inlined into the bundle
// at build time, so it is a shared transport key rather than a server secret.
// The public development fallback only exists for `npm run dev`; a production
// build without VITE_CRYPTO_SECRET_KEY is rejected in vite.config.js.
const SECRET_KEY =
  import.meta.env.VITE_CRYPTO_SECRET_KEY ||
  (import.meta.env.DEV ? "your-very-strong-secret-key" : "");

export function encrypt(text) {
  if (!text) return "";

  const ciphertext = CryptoJS.AES.encrypt(text, SECRET_KEY).toString();

  return ciphertext;
}

export function decrypt(ciphertext) {
  if (!ciphertext) return "";

  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);

    const originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText;
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
}
