const CryptoJS = require("crypto-js");

// Transport encryption for request/response payloads. The key is shared with
// the browser bundle, so it must come from the environment in production: the
// dev fallback below is public knowledge and would let anyone forge payloads.
const DEV_FALLBACK_KEY = "your-very-strong-secret-key";
let SECRET_KEY = process.env.CRYPTO_SECRET_KEY || "";

if (!SECRET_KEY) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CRYPTO_SECRET_KEY is required in production. Set it in .env (see .env.example) " +
        "and give the frontend the same value as VITE_CRYPTO_SECRET_KEY.",
    );
  }
  console.warn(
    "[crypto] CRYPTO_SECRET_KEY is not set - using the public development key. " +
      "Never run production without it.",
  );
  SECRET_KEY = DEV_FALLBACK_KEY;
}

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
