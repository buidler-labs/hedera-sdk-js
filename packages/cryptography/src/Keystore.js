import nacl from "tweetnacl";
import BadKeyError from "./BadKeyError.js";
import * as hex from "./hex.js";
import * as utf8 from "./utf8.js";
import * as hmac from "./hmac.js";
import * as pbkdf2 from "./pbkdf2.js";
import { isAccessible } from "./util.js";

const AES_128_CTR = "aes-128-ctr";
const HMAC_SHA256 = "hmac-sha256";

/**
 * @typedef {Object} KeystoreKdfParams
 * @property {number} KeystoreKdfParams.dkLen
 * @property {string} KeystoreKdfParams.salt
 * @property {number} KeystoreKdfParams.c
 * @property {string} KeystoreKdfParams.prf
 */

/**
 * @typedef {Object} KeystoreCipherParams
 * @property {string} KeystoreCipherParams.iv
 */

/**
 * @typedef {Object} KeystoreCrypto
 * @property {string} KeystoreCrypto.ciphertext
 * @property {KeystoreCipherParams} KeystoreCrypto.cipherparams
 * @property {string} KeystoreCrypto.cipher
 * @property {string} KeystoreCrypto.kdf
 * @property {KeystoreKdfParams} KeystoreCrypto.kdfparams
 * @property {string} KeystoreCrypto.mac
 */

/**
 * @typedef {Object} Keystore
 * @property {number} Keystore.version
 * @property {KeystoreCrypto} Keystore.crypto
 */

/**
 * @param {Uint8Array} privateKey
 * @param {string} passphrase
 * @returns {Promise<Uint8Array>}
 */
export async function createKeystore(privateKey, passphrase) {
    // all values taken from https://github.com/ethereumjs/ethereumjs-wallet/blob/de3a92e752673ada1d78f95cf80bc56ae1f59775/src/index.ts#L25
    const dkLen = 32;
    const c = 262144;
    const saltLen = 32;
    const salt = nacl.randomBytes(saltLen);

    const key = await pbkdf2.deriveKey(
        hmac.HashAlgorithm.Sha256,
        passphrase,
        salt,
        c,
        dkLen
    );

    const iv = nacl.randomBytes(16);

    if (isAccessible("Buffer")) {
        // AES-128-CTR with the first half of the derived key and a random IV
        const cipher = (await import("crypto")).createCipheriv(
            AES_128_CTR,
            key.slice(0, 16),
            iv
        );

        const cipherText = Buffer.concat([
            cipher.update(privateKey),
            cipher["final"](),
        ]);

        const mac = await hmac.hash(
            hmac.HashAlgorithm.Sha384,
            key.slice(16),
            cipherText
        );

        /**
         * @type {Keystore}
         */
        const keystore = {
            version: 1,
            crypto: {
                ciphertext: hex.encode(cipherText),
                cipherparams: { iv: hex.encode(iv) },
                cipher: AES_128_CTR,
                kdf: "pbkdf2",
                kdfparams: {
                    dkLen,
                    salt: hex.encode(salt),
                    c,
                    prf: HMAC_SHA256,
                },
                mac: hex.encode(mac),
            },
        };

        return utf8.encode(JSON.stringify(keystore));
    } else {
        throw new Error("Cannot create keystore on web");
    }
}

/**
 * @param {Uint8Array} keystoreBytes
 * @param {string} passphrase
 * @returns {Promise<{privateKey: Uint8Array, publicKey: Uint8Array}>}
 */
export async function loadKeystore(keystoreBytes, passphrase) {
    /**
     * @type {Keystore}
     */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const keystore = JSON.parse(Buffer.from(keystoreBytes).toString());

    if (keystore.version !== 1) {
        throw new Error(`unsupported keystore version: ${keystore.version}`);
    }

    const {
        ciphertext,
        cipherparams: { iv },
        cipher,
        kdf,
        kdfparams: { dkLen, salt, c, prf },
        mac,
    } = keystore.crypto;

    if (kdf !== "pbkdf2") {
        throw new Error(`unsupported key derivation function:" + ${kdf}`);
    }

    if (prf !== HMAC_SHA256) {
        throw new Error(`unsupported key derivation hash function: ${prf}`);
    }

    const saltBytes = hex.decode(salt);
    const ivBytes = hex.decode(iv);
    const cipherBytes = hex.decode(ciphertext);

    const key = await pbkdf2.deriveKey(
        hmac.HashAlgorithm.Sha256,
        passphrase,
        saltBytes,
        c,
        dkLen
    );

    const macHex = hex.decode(mac);
    const verifyHmac = await hmac.hash(
        hmac.HashAlgorithm.Sha384,
        key.slice(16),
        cipherBytes
    );

    // compare that these two Uint8Arrays are equivalent
    if (!macHex.every((b, i) => b === verifyHmac[i])) {
        throw new BadKeyError("HMAC mismatch; passphrase is incorrect");
    }

    if (isAccessible("Buffer")) {
        const decipher = (await import("crypto")).createDecipheriv(
            cipher,
            key.slice(0, 16),
            ivBytes
        );
        const privateKeyBytes = Buffer.concat([
            decipher.update(cipherBytes),
            decipher["final"](),
        ]);

        // `Buffer instanceof Uint8Array` doesn't work in Jest because the prototype chain is different
        const {
            secretKey: privateKey,
            publicKey,
        } = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(privateKeyBytes));

        return { privateKey, publicKey };
    } else {
        throw new Error("Cannot load keystore on web");
    }
}