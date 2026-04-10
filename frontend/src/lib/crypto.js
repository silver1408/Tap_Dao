import CryptoJS from "crypto-js";

// IMPORTANT: Keep this secret safe (use env in production)
const SECRET_KEY = "your-very-strong-secret-key";

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
