"use strict";
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
exports.AsyncCurve = exports.Curve = void 0;
const curve25519_typescript_1 = require("@privacyresearch/curve25519-typescript");
const helpers_1 = require("../helpers");
class Curve {
    constructor(curve25519) {
        this._curve25519 = curve25519;
        this.async = new AsyncCurve();
    }
    set curve(c) {
        this._curve25519 = c;
    }
    createKeyPair(privKey) {
        validatePrivKey(privKey);
        const raw_keys = this._curve25519.keyPair(privKey);
        return processKeys(raw_keys);
    }
    ECDHE(pubKey, privKey) {
        pubKey = validatePubKeyFormat(pubKey);
        validatePrivKey(privKey);
        if (pubKey === undefined || pubKey.byteLength != 32) {
            throw new Error('Invalid public key');
        }
        return this._curve25519.sharedSecret(pubKey, privKey);
    }
    Ed25519Sign(privKey, message) {
        validatePrivKey(privKey);
        if (message === undefined) {
            throw new Error('Invalid message');
        }
        return this._curve25519.sign(privKey, message);
    }
    Ed25519Verify(pubKey, msg, sig) {
        pubKey = validatePubKeyFormat(pubKey);
        if (pubKey === undefined || pubKey.byteLength != 32) {
            throw new Error('Invalid public key');
        }
        if (msg === undefined) {
            throw new Error('Invalid message');
        }
        if (sig === undefined || sig.byteLength != 64) {
            throw new Error('Invalid signature');
        }
        return this._curve25519.verify(pubKey, msg, sig);
    }
}
exports.Curve = Curve;
class AsyncCurve {
    constructor() {
        this._curve25519 = new curve25519_typescript_1.AsyncCurve25519Wrapper();
    }
    set curve(c) {
        this._curve25519 = c;
    }
    createKeyPair(privKey) {
        return __awaiter(this, void 0, void 0, function* () {
            validatePrivKey(privKey);
            const raw_keys = yield this._curve25519.keyPair(privKey);
            return processKeys(raw_keys);
        });
    }
    ECDHE(pubKey, privKey) {
        pubKey = validatePubKeyFormat(pubKey);
        validatePrivKey(privKey);
        if (pubKey === undefined || pubKey.byteLength != 32) {
            throw new Error('Invalid public key');
        }
        return this._curve25519.sharedSecret(pubKey, privKey);
    }
    Ed25519Sign(privKey, message) {
        validatePrivKey(privKey);
        if (message === undefined) {
            throw new Error('Invalid message');
        }
        return this._curve25519.sign(privKey, message);
    }
    Ed25519Verify(pubKey, msg, sig) {
        return __awaiter(this, void 0, void 0, function* () {
            pubKey = validatePubKeyFormat(pubKey);
            if (pubKey === undefined || pubKey.byteLength != 32) {
                throw new Error('Invalid public key');
            }
            if (msg === undefined) {
                throw new Error('Invalid message');
            }
            if (sig === undefined || sig.byteLength != 64) {
                throw new Error('Invalid signature');
            }
            const verifyResult = yield this._curve25519.verify(pubKey, msg, sig);
            if (verifyResult) {
                throw new Error('Invalid signature');
            }
            return verifyResult;
        });
    }
}
exports.AsyncCurve = AsyncCurve;
function validatePrivKey(privKey) {
    if (privKey === undefined || !(privKey instanceof ArrayBuffer) || privKey.byteLength != 32) {
        throw new Error('Invalid private key');
    }
}
function validatePubKeyFormat(pubKey) {
    if (pubKey === undefined ||
        ((pubKey.byteLength != 33 || new Uint8Array(pubKey)[0] != 5) && pubKey.byteLength != 32)) {
        console.warn(`Invalid public key`, { pubKey });
        throw new Error(`Invalid public key: ${pubKey} ${pubKey === null || pubKey === void 0 ? void 0 : pubKey.byteLength}`);
    }
    if (pubKey.byteLength == 33) {
        return pubKey.slice(1);
    }
    else {
        console.error('WARNING: Expected pubkey of length 33, please report the ST and client that generated the pubkey');
        return pubKey;
    }
}
function processKeys(raw_keys) {
    // prepend version byte
    const origPub = new Uint8Array(raw_keys.pubKey);
    const pub = new Uint8Array(33);
    pub.set(origPub, 1);
    pub[0] = 5;
    return { pubKey: (0, helpers_1.uint8ArrayToArrayBuffer)(pub), privKey: raw_keys.privKey };
}
