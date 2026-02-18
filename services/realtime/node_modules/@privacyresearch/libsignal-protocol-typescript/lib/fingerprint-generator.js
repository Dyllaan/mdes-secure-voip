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
exports.FingerprintGenerator = void 0;
const utils = __importStar(require("./helpers"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const msrcrypto = require('../lib/msrcrypto');
class FingerprintGenerator {
    constructor(_iterations) {
        this._iterations = _iterations;
    }
    createFor(localIdentifier, localIdentityKey, remoteIdentifier, remoteIdentityKey) {
        return __awaiter(this, void 0, void 0, function* () {
            const localStr = yield getDisplayStringFor(localIdentifier, localIdentityKey, this._iterations);
            const remoteStr = yield getDisplayStringFor(remoteIdentifier, remoteIdentityKey, this._iterations);
            return [localStr, remoteStr].sort().join('');
        });
    }
}
exports.FingerprintGenerator = FingerprintGenerator;
FingerprintGenerator.VERSION = 0;
function getDisplayStringFor(identifier, key, iterations) {
    return __awaiter(this, void 0, void 0, function* () {
        const bytes = concatArrayBuffers([
            shortToArrayBuffer(FingerprintGenerator.VERSION),
            key,
            utils.binaryStringToArrayBuffer(identifier),
        ]);
        const hash = yield iterateHash(bytes, key, iterations);
        const output = new Uint8Array(hash);
        return (getEncodedChunk(output, 0) +
            getEncodedChunk(output, 5) +
            getEncodedChunk(output, 10) +
            getEncodedChunk(output, 15) +
            getEncodedChunk(output, 20) +
            getEncodedChunk(output, 25));
    });
}
function iterateHash(data, key, count) {
    return __awaiter(this, void 0, void 0, function* () {
        const data1 = concatArrayBuffers([data, key]);
        const result = yield msrcrypto.subtle.digest({ name: 'SHA-512' }, data1);
        if (--count === 0) {
            return result;
        }
        else {
            return iterateHash(result, key, count);
        }
    });
}
function getEncodedChunk(hash, offset) {
    const chunk = (hash[offset] * Math.pow(2, 32) +
        hash[offset + 1] * Math.pow(2, 24) +
        hash[offset + 2] * Math.pow(2, 16) +
        hash[offset + 3] * Math.pow(2, 8) +
        hash[offset + 4]) %
        100000;
    let s = chunk.toString();
    while (s.length < 5) {
        s = '0' + s;
    }
    return s;
}
function shortToArrayBuffer(number) {
    return new Uint16Array([number]).buffer;
}
function concatArrayBuffers(bufs) {
    const lengths = bufs.map((b) => b.byteLength);
    const totalLength = lengths.reduce((p, c) => p + c, 0);
    const result = new Uint8Array(totalLength);
    lengths.reduce((p, c, i) => {
        result.set(new Uint8Array(bufs[i]), p);
        return p + c;
    }, 0);
    return result.buffer;
}
