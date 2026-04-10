const CryptoJS = require("crypto-js");

// IMPORTANT: Keep this secret safe (use env in production)
const SECRET_KEY = process.env.CRYPTO_SECRET_KEY || "your-very-strong-secret-key";

function encrypt(text) {
  if (!text) return "";
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
}

function decrypt(ciphertext) {
  if (!ciphertext) return "";

  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
}

module.exports = { encrypt, decrypt };
