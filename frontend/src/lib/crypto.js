import CryptoJS from "crypto-js";

// Must match the backend (backend/lib/crypto.js). Configure both sides with the
// same value; the fallback keeps the demo working without any .env file.
const SECRET_KEY =
  import.meta.env.VITE_CRYPTO_SECRET_KEY || "your-very-strong-secret-key";

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
