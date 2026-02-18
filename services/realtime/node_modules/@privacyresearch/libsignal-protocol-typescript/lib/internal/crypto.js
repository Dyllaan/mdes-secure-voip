"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMAC = exports.verifyMAC = exports.HKDF = exports.setCurve = exports.setWebCrypto = exports.crypto = exports.Crypto = void 0;
const Internal = __importStar(require("."));
const util = __importStar(require("../helpers"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webcrypto = (globalThis === null || globalThis === void 0 ? void 0 : globalThis.crypto) || require('../../lib/msrcrypto'); // globalThis?.crypto || window?.crypto || require('../../lib/msrcrypto')
class Crypto {
    constructor(crypto) {
        this._curve = new Internal.AsyncCurve();
        this._webcrypto = crypto || webcrypto;
    }
    set webcrypto(wc) {
        this._webcrypto = wc;
    }
    set curve(c) {
        this._curve.curve = c;
    }
    getRandomBytes(n) {
        const array = new Uint8Array(n);
        this._webcrypto.getRandomValues(array);
        return util.uint8ArrayToArrayBuffer(array);
    }
    encrypt(key, data, iv) {
        return __awaiter(this, void 0, void 0, function* () {
            const impkey = yield this._webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
            return this._webcrypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, impkey, data);
        });
    }
    decrypt(key, data, iv) {
        return __awaiter(this, void 0, void 0, function* () {
            const impkey = yield this._webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
            return this._webcrypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, impkey, data);
        });
    }
    sign(key, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const impkey = yield this._webcrypto.subtle.importKey('raw', key, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);
            try {
                return this._webcrypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, impkey, data);
            }
            catch (e) {
                // console.log({ e, data, impkey })
                throw e;
            }
        });
    }
    hash(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._webcrypto.subtle.digest({ name: 'SHA-512' }, data);
        });
    }
    HKDF(input, salt, info) {
        return __awaiter(this, void 0, void 0, function* () {
            // Specific implementation of RFC 5869 that only returns the first 3 32-byte chunks
            if (typeof info === 'string') {
                throw new Error(`HKDF info was a string`);
            }
            const PRK = yield Internal.crypto.sign(salt, input);
            const infoBuffer = new ArrayBuffer(info.byteLength + 1 + 32);
            const infoArray = new Uint8Array(infoBuffer);
            infoArray.set(new Uint8Array(info), 32);
            infoArray[infoArray.length - 1] = 1;
            const T1 = yield Internal.crypto.sign(PRK, infoBuffer.slice(32));
            infoArray.set(new Uint8Array(T1));
            infoArray[infoArray.length - 1] = 2;
            const T2 = yield Internal.crypto.sign(PRK, infoBuffer);
            infoArray.set(new Uint8Array(T2));
            infoArray[infoArray.length - 1] = 3;
            const T3 = yield Internal.crypto.sign(PRK, infoBuffer);
            return [T1, T2, T3];
        });
    }
    // Curve25519 crypto
    createKeyPair(privKey) {
        if (!privKey) {
            privKey = this.getRandomBytes(32);
        }
        return this._curve.createKeyPair(privKey);
    }
    ECDHE(pubKey, privKey) {
        return this._curve.ECDHE(pubKey, privKey);
    }
    Ed25519Sign(privKey, message) {
        return this._curve.Ed25519Sign(privKey, message);
    }
    Ed25519Verify(pubKey, msg, sig) {
        return this._curve.Ed25519Verify(pubKey, msg, sig);
    }
}
exports.Crypto = Crypto;
exports.crypto = new Crypto();
function setWebCrypto(webcrypto) {
    exports.crypto.webcrypto = webcrypto;
}
exports.setWebCrypto = setWebCrypto;
function setCurve(curve) {
    exports.crypto.curve = curve;
}
exports.setCurve = setCurve;
// HKDF for TextSecure has a bit of additional handling - salts always end up being 32 bytes
function HKDF(input, salt, info) {
    if (salt.byteLength != 32) {
        throw new Error('Got salt of incorrect length');
    }
    const abInfo = util.binaryStringToArrayBuffer(info);
    if (!abInfo) {
        throw new Error(`Invalid HKDF info`);
    }
    return exports.crypto.HKDF(input, salt, abInfo);
}
exports.HKDF = HKDF;
function verifyMAC(data, key, mac, length) {
    return __awaiter(this, void 0, void 0, function* () {
        const calculated_mac = yield exports.crypto.sign(key, data);
        if (mac.byteLength != length || calculated_mac.byteLength < length) {
            throw new Error('Bad MAC length');
        }
        const a = new Uint8Array(calculated_mac);
        const b = new Uint8Array(mac);
        let result = 0;
        for (let i = 0; i < mac.byteLength; ++i) {
            result = result | (a[i] ^ b[i]);
        }
        if (result !== 0) {
            throw new Error('Bad MAC');
        }
    });
}
exports.verifyMAC = verifyMAC;
function calculateMAC(key, data) {
    return exports.crypto.sign(key, data);
}
exports.calculateMAC = calculateMAC;
