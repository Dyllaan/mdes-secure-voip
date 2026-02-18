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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncCurve = exports.Curve = void 0;
const Internal = __importStar(require("./internal"));
class Curve {
    constructor(curve) {
        this._curve = curve;
        this.async = new AsyncCurve(curve.async);
    }
    generateKeyPair() {
        const privKey = Internal.crypto.getRandomBytes(32);
        return this._curve.createKeyPair(privKey);
    }
    createKeyPair(privKey) {
        return this._curve.createKeyPair(privKey);
    }
    calculateAgreement(pubKey, privKey) {
        return this._curve.ECDHE(pubKey, privKey);
    }
    verifySignature(pubKey, msg, sig) {
        return this._curve.Ed25519Verify(pubKey, msg, sig);
    }
    calculateSignature(privKey, message) {
        return this._curve.Ed25519Sign(privKey, message);
    }
}
exports.Curve = Curve;
class AsyncCurve {
    constructor(curve) {
        this._curve = curve;
    }
    generateKeyPair() {
        const privKey = Internal.crypto.getRandomBytes(32);
        return this._curve.createKeyPair(privKey);
    }
    createKeyPair(privKey) {
        return this._curve.createKeyPair(privKey);
    }
    calculateAgreement(pubKey, privKey) {
        return this._curve.ECDHE(pubKey, privKey);
    }
    verifySignature(pubKey, msg, sig) {
        return this._curve.Ed25519Verify(pubKey, msg, sig);
    }
    calculateSignature(privKey, message) {
        return this._curve.Ed25519Sign(privKey, message);
    }
}
exports.AsyncCurve = AsyncCurve;
