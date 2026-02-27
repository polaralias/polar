import crypto from "node:crypto";
import { RuntimeExecutionError } from "../../polar-domain/src/index.mjs";

const DEFAULT_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "vault:v1:";

/**
 * @param {{ masterKey?: string | Buffer }} config
 */
export function createCryptoVault(config = {}) {
    let activeMasterKey = config.masterKey;

    // Attempt to resolve from environment if not provided explicitly
    if (!activeMasterKey && typeof process !== "undefined" && process.env?.POLAR_VAULT_KEY) {
        activeMasterKey = process.env.POLAR_VAULT_KEY;
    }

    // Generate an ephemeral key if running in dev/memory modes and no key is explicitly bound
    let isEphemeral = false;
    if (!activeMasterKey) {
        isEphemeral = true;
        activeMasterKey = crypto.randomBytes(KEY_LENGTH);
    }

    const normalizedKey = typeof activeMasterKey === "string"
        ? crypto.createHash("sha256").update(activeMasterKey).digest() // Normalize string to 32 bytes
        : activeMasterKey;

    if (!Buffer.isBuffer(normalizedKey) || normalizedKey.length !== KEY_LENGTH) {
        throw new RuntimeExecutionError(
            Buffer.isBuffer(config.masterKey)
                ? `Vault masterKey Buffer must be exactly ${KEY_LENGTH} bytes (received ${normalizedKey.length} bytes). String keys are auto-hashed via SHA-256.`
                : "Vault masterKey must resolve to a valid 32-byte buffer"
        );
    }

    return Object.freeze({
        /**
         * @param {string} plaintext
         * @returns {string}
         */
        encrypt(plaintext) {
            if (typeof plaintext !== "string") {
                throw new RuntimeExecutionError("Vault encrypt requires a string plaintext");
            }

            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(DEFAULT_ALGORITHM, normalizedKey, iv);

            const encrypted = Buffer.concat([
                cipher.update(plaintext, "utf8"),
                cipher.final()
            ]);
            const authTag = cipher.getAuthTag();

            // Format: vault:v1:base64(iv):base64(authTag):base64(encrypted)
            return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
        },

        /**
         * @param {string} ciphertext
         * @returns {string}
         */
        decrypt(ciphertext) {
            if (typeof ciphertext !== "string") {
                throw new RuntimeExecutionError("Vault decrypt requires a string ciphertext");
            }

            if (!ciphertext.startsWith(PREFIX)) {
                // Return as-is if not a vault-encrypted string (transparent handling)
                return ciphertext;
            }

            const parts = ciphertext.substring(PREFIX.length).split(":");
            if (parts.length !== 3) {
                throw new RuntimeExecutionError("Malformed vault ciphertext payload");
            }

            const iv = Buffer.from(parts[0], "base64");
            const authTag = Buffer.from(parts[1], "base64");
            const encrypted = Buffer.from(parts[2], "base64");

            if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
                throw new RuntimeExecutionError("Invalid vault ciphertext parameters");
            }

            const decipher = crypto.createDecipheriv(DEFAULT_ALGORITHM, normalizedKey, iv);
            decipher.setAuthTag(authTag);

            try {
                const decrypted = Buffer.concat([
                    decipher.update(encrypted),
                    decipher.final()
                ]);
                return decrypted.toString("utf8");
            } catch (err) {
                throw new RuntimeExecutionError("Vault decryption failed (bad key or corrupted payload)", { cause: err });
            }
        },

        /**
         * Deep encrypts all strings that end with 'Secret' or 'Key' or 'Token' or strictly equal 'apiKey' or 'secretRef' in a nested object.
         * @param {unknown} value
         * @returns {unknown}
         */
        encryptSecretsInObject(value) {
            if (value === null || typeof value !== "object") {
                return value;
            }

            if (Array.isArray(value)) {
                return value.map(item => this.encryptSecretsInObject(item));
            }

            const result = {};
            for (const [k, v] of Object.entries(value)) {
                // BUG-025 fix: case-insensitive field name matching for secret detection
                const lk = k.toLowerCase();
                const isSecretField = lk.endsWith("secret") || lk.endsWith("key") || lk.endsWith("token") || lk === "apikey" || lk === "secretref" || lk === "password";

                if (isSecretField && typeof v === "string" && !v.startsWith(PREFIX)) {
                    result[k] = this.encrypt(v);
                } else if (typeof v === "object") {
                    result[k] = this.encryptSecretsInObject(v);
                } else {
                    result[k] = v;
                }
            }
            return result;
        },

        /**
         * Deep decrypts all vault strings in a nested object.
         * @param {unknown} value
         * @returns {unknown}
         */
        decryptSecretsInObject(value) {
            if (value === null || typeof value !== "object") {
                if (typeof value === "string" && value.startsWith(PREFIX)) {
                    return this.decrypt(value);
                }
                return value;
            }

            if (Array.isArray(value)) {
                return value.map(item => this.decryptSecretsInObject(item));
            }

            const result = {};
            for (const [k, v] of Object.entries(value)) {
                if (typeof v === "string" && v.startsWith(PREFIX)) {
                    result[k] = this.decrypt(v);
                } else if (typeof v === "object") {
                    result[k] = this.decryptSecretsInObject(v);
                } else {
                    result[k] = v;
                }
            }
            return result;
        },

        getStatus() {
            return Object.freeze({
                isEphemeral,
                algorithm: DEFAULT_ALGORITHM
            });
        }
    });
}
