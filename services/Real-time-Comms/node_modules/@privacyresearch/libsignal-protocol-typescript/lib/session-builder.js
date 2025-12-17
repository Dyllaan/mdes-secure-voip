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
exports.SessionBuilder = void 0;
const types_1 = require("./types");
const session_types_1 = require("./session-types");
const Internal = __importStar(require("./internal"));
const base64 = __importStar(require("base64-js"));
const session_record_1 = require("./session-record");
const session_lock_1 = require("./session-lock");
const helpers_1 = require("./helpers");
class SessionBuilder {
    constructor(storage, remoteAddress) {
        this.processPreKeyJob = (device) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const trusted = yield this.storage.isTrustedIdentity(this.remoteAddress.name, device.identityKey, types_1.Direction.SENDING);
            if (!trusted) {
                throw new Error('Identity key changed');
            }
            // This will throw if invalid
            yield Internal.crypto.Ed25519Verify(device.identityKey, device.signedPreKey.publicKey, device.signedPreKey.signature);
            const ephemeralKey = yield Internal.crypto.createKeyPair();
            const deviceOneTimePreKey = (_a = device.preKey) === null || _a === void 0 ? void 0 : _a.publicKey;
            const session = yield this.startSessionAsInitiator(ephemeralKey, device.identityKey, device.signedPreKey.publicKey, deviceOneTimePreKey, device.registrationId);
            session.pendingPreKey = {
                signedKeyId: device.signedPreKey.keyId,
                baseKey: ephemeralKey.pubKey,
            };
            if (device.preKey) {
                session.pendingPreKey.preKeyId = device.preKey.keyId;
            }
            const address = this.remoteAddress.toString();
            const serialized = yield this.storage.loadSession(address);
            let record;
            if (serialized !== undefined) {
                record = session_record_1.SessionRecord.deserialize(serialized);
            }
            else {
                record = new session_record_1.SessionRecord();
            }
            record.archiveCurrentState();
            record.updateSessionState(session);
            yield Promise.all([
                this.storage.storeSession(address, record.serialize()),
                this.storage.saveIdentity(this.remoteAddress.toString(), session.indexInfo.remoteIdentityKey),
            ]);
            return session;
        });
        // Arguments map to the X3DH spec: https://signal.org/docs/specifications/x3dh/#keys
        // We are Alice the initiator.
        this.startSessionAsInitiator = (EKa, IKb, SPKb, OPKb, registrationId) => __awaiter(this, void 0, void 0, function* () {
            const IKa = yield this.storage.getIdentityKeyPair();
            if (!IKa) {
                throw new Error(`No identity key. Cannot initiate session.`);
            }
            let sharedSecret;
            if (OPKb === undefined) {
                sharedSecret = new Uint8Array(32 * 4);
            }
            else {
                sharedSecret = new Uint8Array(32 * 5);
            }
            // As specified in X3DH spec secion 22, the first 32 bytes are
            // 0xFF for curve25519 (https://signal.org/docs/specifications/x3dh/#cryptographic-notation)
            for (let i = 0; i < 32; i++) {
                sharedSecret[i] = 0xff;
            }
            if (!SPKb) {
                throw new Error(`theirSignedPubKey is undefined. Cannot proceed with ECDHE`);
            }
            // X3DH Section 3.3. https://signal.org/docs/specifications/x3dh/
            // We'll handle the possible one-time prekey below
            const ecRes = yield Promise.all([
                Internal.crypto.ECDHE(SPKb, IKa.privKey),
                Internal.crypto.ECDHE(IKb, EKa.privKey),
                Internal.crypto.ECDHE(SPKb, EKa.privKey),
            ]);
            sharedSecret.set(new Uint8Array(ecRes[0]), 32);
            sharedSecret.set(new Uint8Array(ecRes[1]), 32 * 2);
            sharedSecret.set(new Uint8Array(ecRes[2]), 32 * 3);
            if (OPKb !== undefined) {
                const ecRes4 = yield Internal.crypto.ECDHE(OPKb, EKa.privKey);
                sharedSecret.set(new Uint8Array(ecRes4), 32 * 4);
            }
            const masterKey = yield Internal.HKDF((0, helpers_1.uint8ArrayToArrayBuffer)(sharedSecret), new ArrayBuffer(32), 'WhisperText');
            const session = {
                registrationId: registrationId,
                currentRatchet: {
                    rootKey: masterKey[0],
                    lastRemoteEphemeralKey: SPKb,
                    previousCounter: 0,
                },
                indexInfo: {
                    remoteIdentityKey: IKb,
                    closed: -1,
                },
                oldRatchetList: [],
                chains: {},
            };
            // We're initiating so we go ahead and set our first sending ephemeral key now,
            // otherwise we figure it out when we first maybeStepRatchet with the remote's ephemeral key
            session.indexInfo.baseKey = EKa.pubKey;
            session.indexInfo.baseKeyType = session_types_1.BaseKeyType.OURS;
            const ourSendingEphemeralKey = yield Internal.crypto.createKeyPair();
            session.currentRatchet.ephemeralKeyPair = ourSendingEphemeralKey;
            yield this.calculateSendingRatchet(session, SPKb);
            return session;
        });
        // Arguments map to the X3DH spec: https://signal.org/docs/specifications/x3dh/#keys
        // We are Bob now.
        this.startSessionWthPreKeyMessage = (OPKb, SPKb, message) => __awaiter(this, void 0, void 0, function* () {
            const IKb = yield this.storage.getIdentityKeyPair();
            const IKa = message.identityKey;
            const EKa = message.baseKey;
            if (!IKb) {
                throw new Error(`No identity key. Cannot initiate session.`);
            }
            let sharedSecret;
            if (!OPKb) {
                sharedSecret = new Uint8Array(32 * 4);
            }
            else {
                sharedSecret = new Uint8Array(32 * 5);
            }
            // As specified in X3DH spec secion 22, the first 32 bytes are
            // 0xFF for curve25519 (https://signal.org/docs/specifications/x3dh/#cryptographic-notation)
            for (let i = 0; i < 32; i++) {
                sharedSecret[i] = 0xff;
            }
            // X3DH Section 3.3. https://signal.org/docs/specifications/x3dh/
            // We'll handle the possible one-time prekey below
            const ecRes = yield Promise.all([
                Internal.crypto.ECDHE(IKa, SPKb.privKey),
                Internal.crypto.ECDHE(EKa, IKb.privKey),
                Internal.crypto.ECDHE(EKa, SPKb.privKey),
            ]);
            sharedSecret.set(new Uint8Array(ecRes[0]), 32);
            sharedSecret.set(new Uint8Array(ecRes[1]), 32 * 2);
            sharedSecret.set(new Uint8Array(ecRes[2]), 32 * 3);
            if (OPKb) {
                const ecRes4 = yield Internal.crypto.ECDHE(EKa, OPKb.privKey);
                sharedSecret.set(new Uint8Array(ecRes4), 32 * 4);
            }
            const masterKey = yield Internal.HKDF((0, helpers_1.uint8ArrayToArrayBuffer)(sharedSecret), new ArrayBuffer(32), 'WhisperText');
            const session = {
                registrationId: message.registrationId,
                currentRatchet: {
                    rootKey: masterKey[0],
                    lastRemoteEphemeralKey: EKa,
                    previousCounter: 0,
                },
                indexInfo: {
                    remoteIdentityKey: IKa,
                    closed: -1,
                },
                oldRatchetList: [],
                chains: {},
            };
            // If we're initiating we go ahead and set our first sending ephemeral key now,
            // otherwise we figure it out when we first maybeStepRatchet with the remote's ephemeral key
            session.indexInfo.baseKey = EKa;
            session.indexInfo.baseKeyType = session_types_1.BaseKeyType.THEIRS;
            session.currentRatchet.ephemeralKeyPair = SPKb;
            return session;
        });
        this.remoteAddress = remoteAddress;
        this.storage = storage;
    }
    calculateSendingRatchet(session, remoteKey) {
        return __awaiter(this, void 0, void 0, function* () {
            const ratchet = session.currentRatchet;
            if (!ratchet.ephemeralKeyPair) {
                throw new Error(`Invalid ratchet - ephemeral key pair is missing`);
            }
            const ephPrivKey = ratchet.ephemeralKeyPair.privKey;
            const rootKey = ratchet.rootKey;
            const ephPubKey = base64.fromByteArray(new Uint8Array(ratchet.ephemeralKeyPair.pubKey));
            if (!(ephPrivKey && ephPubKey && rootKey)) {
                throw new Error(`Missing key, cannot calculate sending ratchet`);
            }
            const sharedSecret = yield Internal.crypto.ECDHE(remoteKey, ephPrivKey);
            const masterKey = yield Internal.HKDF(sharedSecret, rootKey, 'WhisperRatchet');
            session.chains[ephPubKey] = {
                messageKeys: {},
                chainKey: { counter: -1, key: masterKey[1] },
                chainType: session_types_1.ChainType.SENDING,
            };
            ratchet.rootKey = masterKey[0];
        });
    }
    processPreKey(device) {
        return __awaiter(this, void 0, void 0, function* () {
            // return this.processPreKeyJob(device)
            const runJob = () => __awaiter(this, void 0, void 0, function* () {
                const sess = yield this.processPreKeyJob(device);
                return sess;
            });
            return session_lock_1.SessionLock.queueJobForNumber(this.remoteAddress.toString(), runJob);
        });
    }
    processV3(record, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const trusted = this.storage.isTrustedIdentity(this.remoteAddress.name, (0, helpers_1.uint8ArrayToArrayBuffer)(message.identityKey), types_1.Direction.RECEIVING);
            if (!trusted) {
                throw new Error(`Unknown identity key: ${(0, helpers_1.uint8ArrayToArrayBuffer)(message.identityKey)}`);
            }
            const [preKeyPair, signedPreKeyPair] = yield Promise.all([
                this.storage.loadPreKey(message.preKeyId),
                this.storage.loadSignedPreKey(message.signedPreKeyId),
            ]);
            if (record.getSessionByBaseKey(message.baseKey)) {
                return;
            }
            const session = record.getOpenSession();
            if (signedPreKeyPair === undefined) {
                // Session may or may not be the right one, but if its not, we
                // can't do anything about it ...fall through and let
                // decryptWhisperMessage handle that case
                if (session !== undefined && session.currentRatchet !== undefined) {
                    return;
                }
                else {
                    throw new Error('Missing Signed PreKey for PreKeyWhisperMessage');
                }
            }
            if (session !== undefined) {
                record.archiveCurrentState();
            }
            if (message.preKeyId && !preKeyPair) {
                // console.log('Invalid prekey id', message.preKeyId)
            }
            const new_session = yield this.startSessionWthPreKeyMessage(preKeyPair, signedPreKeyPair, message);
            record.updateSessionState(new_session);
            yield this.storage.saveIdentity(this.remoteAddress.toString(), (0, helpers_1.uint8ArrayToArrayBuffer)(message.identityKey));
            return message.preKeyId;
        });
    }
}
exports.SessionBuilder = SessionBuilder;
