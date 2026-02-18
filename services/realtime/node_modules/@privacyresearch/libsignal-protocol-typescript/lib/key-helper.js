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
exports.KeyHelper = void 0;
const Internal = __importStar(require("./internal"));
class KeyHelper {
    static generateIdentityKeyPair() {
        return Internal.crypto.createKeyPair();
    }
    static generateRegistrationId() {
        const registrationId = new Uint16Array(Internal.crypto.getRandomBytes(2))[0];
        return registrationId & 0x3fff;
    }
    static generateSignedPreKey(identityKeyPair, signedKeyId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(identityKeyPair.privKey instanceof ArrayBuffer) ||
                identityKeyPair.privKey.byteLength !== 32 ||
                !(identityKeyPair.pubKey instanceof ArrayBuffer) ||
                identityKeyPair.pubKey.byteLength !== 33) {
                throw new TypeError('Invalid argument for identityKeyPair');
            }
            if (!isNonNegativeInteger(signedKeyId)) {
                throw new TypeError('Invalid argument for signedKeyId: ' + signedKeyId);
            }
            const keyPair = yield Internal.crypto.createKeyPair();
            const sig = yield Internal.crypto.Ed25519Sign(identityKeyPair.privKey, keyPair.pubKey);
            return {
                keyId: signedKeyId,
                keyPair: keyPair,
                signature: sig,
            };
        });
    }
    static generatePreKey(keyId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!isNonNegativeInteger(keyId)) {
                throw new TypeError('Invalid argument for keyId: ' + keyId);
            }
            const keyPair = yield Internal.crypto.createKeyPair();
            return { keyId: keyId, keyPair: keyPair };
        });
    }
}
exports.KeyHelper = KeyHelper;
function isNonNegativeInteger(n) {
    return typeof n === 'number' && n % 1 === 0 && n >= 0;
}
