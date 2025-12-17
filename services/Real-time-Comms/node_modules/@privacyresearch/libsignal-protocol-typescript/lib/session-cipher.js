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
exports.SessionCipher = void 0;
const types_1 = require("./types");
const session_types_1 = require("./session-types");
const signal_protocol_address_1 = require("./signal-protocol-address");
const libsignal_protocol_protobuf_ts_1 = require("@privacyresearch/libsignal-protocol-protobuf-ts");
const base64 = __importStar(require("base64-js"));
const util = __importStar(require("./helpers"));
const Internal = __importStar(require("./internal"));
const session_record_1 = require("./session-record");
const session_lock_1 = require("./session-lock");
const session_builder_1 = require("./session-builder");
const helpers_1 = require("./helpers");
class SessionCipher {
    constructor(storage, remoteAddress) {
        this.encryptJob = (buffer) => __awaiter(this, void 0, void 0, function* () {
            if (!(buffer instanceof ArrayBuffer)) {
                throw new Error('Expected buffer to be an ArrayBuffer');
            }
            const address = this.remoteAddress.toString();
            const msg = libsignal_protocol_protobuf_ts_1.WhisperMessage.fromJSON({});
            const [ourIdentityKey, myRegistrationId, record] = yield this.loadKeysAndRecord(address);
            if (!record) {
                throw new Error('No record for ' + address);
            }
            if (!ourIdentityKey) {
                throw new Error(`cannot encrypt without identity key`);
            }
            // if (!myRegistrationId) {
            //     throw new Error(`cannot encrypt without registration id`)
            // }
            const { session, chain } = yield this.prepareChain(address, record, msg);
            const keys = yield Internal.HKDF(chain.messageKeys[chain.chainKey.counter], new ArrayBuffer(32), 'WhisperMessageKeys');
            delete chain.messageKeys[chain.chainKey.counter];
            msg.counter = chain.chainKey.counter;
            msg.previousCounter = session.currentRatchet.previousCounter;
            const ciphertext = yield Internal.crypto.encrypt(keys[0], buffer, keys[2].slice(0, 16));
            msg.ciphertext = new Uint8Array(ciphertext);
            const encodedMsg = libsignal_protocol_protobuf_ts_1.WhisperMessage.encode(msg).finish();
            const macInput = new Uint8Array(encodedMsg.byteLength + 33 * 2 + 1);
            macInput.set(new Uint8Array(ourIdentityKey.pubKey));
            macInput.set(new Uint8Array(session.indexInfo.remoteIdentityKey), 33);
            macInput[33 * 2] = (3 << 4) | 3;
            macInput.set(new Uint8Array(encodedMsg), 33 * 2 + 1);
            const mac = yield Internal.crypto.sign(keys[1], macInput.buffer);
            const encodedMsgWithMAC = new Uint8Array(encodedMsg.byteLength + 9);
            encodedMsgWithMAC[0] = (3 << 4) | 3;
            encodedMsgWithMAC.set(new Uint8Array(encodedMsg), 1);
            encodedMsgWithMAC.set(new Uint8Array(mac, 0, 8), encodedMsg.byteLength + 1);
            const trusted = yield this.storage.isTrustedIdentity(this.remoteAddress.getName(), session.indexInfo.remoteIdentityKey, types_1.Direction.SENDING);
            if (!trusted) {
                throw new Error('Identity key changed');
            }
            this.storage.saveIdentity(this.remoteAddress.toString(), session.indexInfo.remoteIdentityKey);
            record.updateSessionState(session);
            yield this.storage.storeSession(address, record.serialize());
            if (session.pendingPreKey !== undefined) {
                const preKeyMsg = libsignal_protocol_protobuf_ts_1.PreKeyWhisperMessage.fromJSON({});
                preKeyMsg.identityKey = new Uint8Array(ourIdentityKey.pubKey);
                // TODO: for some test vectors there is no registration id. Why?
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                preKeyMsg.registrationId = myRegistrationId;
                preKeyMsg.baseKey = new Uint8Array(session.pendingPreKey.baseKey);
                if (session.pendingPreKey.preKeyId) {
                    preKeyMsg.preKeyId = session.pendingPreKey.preKeyId;
                }
                preKeyMsg.signedPreKeyId = session.pendingPreKey.signedKeyId;
                preKeyMsg.message = encodedMsgWithMAC;
                const encodedPreKeyMsg = libsignal_protocol_protobuf_ts_1.PreKeyWhisperMessage.encode(preKeyMsg).finish();
                const result = String.fromCharCode((3 << 4) | 3) + util.uint8ArrayToString(encodedPreKeyMsg);
                return {
                    type: 3,
                    body: result,
                    registrationId: session.registrationId,
                };
            }
            else {
                return {
                    type: 1,
                    body: util.uint8ArrayToString(encodedMsgWithMAC),
                    registrationId: session.registrationId,
                };
            }
        });
        this.loadKeysAndRecord = (address) => {
            return Promise.all([
                this.storage.getIdentityKeyPair(),
                this.storage.getLocalRegistrationId(),
                this.getRecord(address),
            ]);
        };
        this.prepareChain = (address, record, msg) => __awaiter(this, void 0, void 0, function* () {
            const session = record.getOpenSession();
            if (!session) {
                throw new Error('No session to encrypt message for ' + address);
            }
            if (!session.currentRatchet.ephemeralKeyPair) {
                throw new Error(`ratchet missing ephemeralKeyPair`);
            }
            msg.ephemeralKey = new Uint8Array(session.currentRatchet.ephemeralKeyPair.pubKey);
            const searchKey = base64.fromByteArray(msg.ephemeralKey);
            const chain = session.chains[searchKey];
            if ((chain === null || chain === void 0 ? void 0 : chain.chainType) === session_types_1.ChainType.RECEIVING) {
                throw new Error('Tried to encrypt on a receiving chain');
            }
            yield this.fillMessageKeys(chain, chain.chainKey.counter + 1);
            return { session, chain };
        });
        this.fillMessageKeys = (chain, counter) => __awaiter(this, void 0, void 0, function* () {
            if (chain.chainKey.counter >= counter) {
                return Promise.resolve(); // Already calculated
            }
            if (counter - chain.chainKey.counter > 2000) {
                throw new Error('Over 2000 messages into the future!');
            }
            if (chain.chainKey.key === undefined) {
                throw new Error('Got invalid request to extend chain after it was already closed');
            }
            const ckey = chain.chainKey.key;
            if (!ckey) {
                throw new Error(`chain key is missing`);
            }
            // Compute KDF_CK as described in X3DH specification
            const byteArray = new Uint8Array(1);
            byteArray[0] = 1;
            const mac = yield Internal.crypto.sign(ckey, byteArray.buffer);
            byteArray[0] = 2;
            const key = yield Internal.crypto.sign(ckey, byteArray.buffer);
            chain.messageKeys[chain.chainKey.counter + 1] = mac;
            chain.chainKey.key = key;
            chain.chainKey.counter += 1;
            yield this.fillMessageKeys(chain, counter);
        });
        this.storage = storage;
        this.remoteAddress =
            typeof remoteAddress === 'string' ? signal_protocol_address_1.SignalProtocolAddress.fromString(remoteAddress) : remoteAddress;
    }
    getRecord(encodedNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            const serialized = yield this.storage.loadSession(encodedNumber);
            if (serialized === undefined) {
                return undefined;
            }
            return session_record_1.SessionRecord.deserialize(serialized);
        });
    }
    encrypt(buffer) {
        return session_lock_1.SessionLock.queueJobForNumber(this.remoteAddress.toString(), () => this.encryptJob(buffer));
    }
    calculateRatchet(session, remoteKey, sending) {
        return __awaiter(this, void 0, void 0, function* () {
            const ratchet = session.currentRatchet;
            if (!ratchet.ephemeralKeyPair) {
                throw new Error(`currentRatchet has no ephemeral key. Cannot calculateRatchet.`);
            }
            const sharedSecret = yield Internal.crypto.ECDHE(remoteKey, ratchet.ephemeralKeyPair.privKey);
            const masterKey = yield Internal.HKDF(sharedSecret, ratchet.rootKey, 'WhisperRatchet');
            let ephemeralPublicKey;
            if (sending) {
                ephemeralPublicKey = ratchet.ephemeralKeyPair.pubKey;
            }
            else {
                ephemeralPublicKey = remoteKey;
            }
            session.chains[base64.fromByteArray(new Uint8Array(ephemeralPublicKey))] = {
                messageKeys: {},
                chainKey: { counter: -1, key: masterKey[1] },
                chainType: sending ? session_types_1.ChainType.SENDING : session_types_1.ChainType.RECEIVING,
            };
            ratchet.rootKey = masterKey[0];
        });
    }
    decryptPreKeyWhisperMessage(buff, encoding) {
        return __awaiter(this, void 0, void 0, function* () {
            encoding = encoding || 'binary';
            if (encoding !== 'binary') {
                throw new Error(`unsupported encoding: ${encoding}`);
            }
            const buffer = typeof buff === 'string' ? util.binaryStringToArrayBuffer(buff) : buff;
            const view = new Uint8Array(buffer);
            const version = view[0];
            const messageData = view.slice(1);
            if ((version & 0xf) > 3 || version >> 4 < 3) {
                // min version > 3 or max version < 3
                throw new Error('Incompatible version number on PreKeyWhisperMessage');
            }
            const address = this.remoteAddress.toString();
            const job = () => __awaiter(this, void 0, void 0, function* () {
                let record = yield this.getRecord(address);
                const preKeyProto = libsignal_protocol_protobuf_ts_1.PreKeyWhisperMessage.decode(messageData);
                if (!record) {
                    if (preKeyProto.registrationId === undefined) {
                        throw new Error('No registrationId');
                    }
                    record = new session_record_1.SessionRecord(); // (preKeyProto.registrationId)???
                }
                const builder = new session_builder_1.SessionBuilder(this.storage, this.remoteAddress);
                // isTrustedIdentity is called within processV3, no need to call it here
                const preKeyId = yield builder.processV3(record, preKeyProto);
                const session = record.getSessionByBaseKey((0, helpers_1.uint8ArrayToArrayBuffer)(preKeyProto.baseKey));
                if (!session) {
                    throw new Error(`unable to find session for base key ${base64.fromByteArray(preKeyProto.baseKey)}, ${preKeyProto.baseKey.byteLength}`);
                }
                const plaintext = yield this.doDecryptWhisperMessage(preKeyProto.message, session);
                record.updateSessionState(session);
                yield this.storage.storeSession(address, record.serialize());
                if (preKeyId !== undefined && preKeyId !== null) {
                    yield this.storage.removePreKey(preKeyId);
                }
                return plaintext;
            });
            return session_lock_1.SessionLock.queueJobForNumber(address, job);
        });
    }
    decryptWithSessionList(buffer, sessionList, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errors) {
        return __awaiter(this, void 0, void 0, function* () {
            // Iterate recursively through the list, attempting to decrypt
            // using each one at a time. Stop and return the result if we get
            // a valid result
            if (sessionList.length === 0) {
                return Promise.reject(errors[0]);
            }
            const session = sessionList.pop();
            if (!session) {
                return Promise.reject(errors[0]);
            }
            try {
                const plaintext = yield this.doDecryptWhisperMessage(buffer, session);
                return { plaintext: plaintext, session: session };
            }
            catch (e) {
                if (e.name === 'MessageCounterError') {
                    return Promise.reject(e);
                }
                errors.push(e);
                return this.decryptWithSessionList(buffer, sessionList, errors);
            }
        });
    }
    decryptWhisperMessage(buff, encoding) {
        encoding = encoding || 'binary';
        if (encoding !== 'binary') {
            throw new Error(`unsupported encoding: ${encoding}`);
        }
        const buffer = typeof buff === 'string' ? util.binaryStringToArrayBuffer(buff) : buff;
        const address = this.remoteAddress.toString();
        const job = () => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const record = yield this.getRecord(address);
            if (!record) {
                throw new Error('No record for device ' + address);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errors = [];
            const result = yield this.decryptWithSessionList(buffer, record.getSessions(), errors);
            if (result.session.indexInfo.baseKey !== ((_a = record.getOpenSession()) === null || _a === void 0 ? void 0 : _a.indexInfo.baseKey)) {
                record.archiveCurrentState();
                record.promoteState(result.session);
            }
            const trusted = yield this.storage.isTrustedIdentity(this.remoteAddress.getName(), result.session.indexInfo.remoteIdentityKey, types_1.Direction.RECEIVING);
            if (!trusted) {
                throw new Error('Identity key changed');
            }
            yield this.storage.saveIdentity(address, result.session.indexInfo.remoteIdentityKey);
            record.updateSessionState(result.session);
            yield this.storage.storeSession(address, record.serialize());
            return result.plaintext;
        });
        return session_lock_1.SessionLock.queueJobForNumber(address, job);
    }
    doDecryptWhisperMessage(messageBytes, session) {
        return __awaiter(this, void 0, void 0, function* () {
            const version = new Uint8Array(messageBytes)[0];
            if ((version & 0xf) > 3 || version >> 4 < 3) {
                // min version > 3 or max version < 3
                throw new Error('Incompatible version number on WhisperMessage ' + version);
            }
            const messageProto = messageBytes.slice(1, messageBytes.byteLength - 8);
            const mac = messageBytes.slice(messageBytes.byteLength - 8, messageBytes.byteLength);
            const message = libsignal_protocol_protobuf_ts_1.WhisperMessage.decode(new Uint8Array(messageProto));
            const remoteEphemeralKey = (0, helpers_1.uint8ArrayToArrayBuffer)(message.ephemeralKey);
            if (session === undefined) {
                return Promise.reject(new Error('No session found to decrypt message from ' + this.remoteAddress.toString()));
            }
            if (session.indexInfo.closed != -1) {
                //  console.log('decrypting message for closed session')
            }
            yield this.maybeStepRatchet(session, remoteEphemeralKey, message.previousCounter);
            const chain = session.chains[base64.fromByteArray(message.ephemeralKey)];
            if (!chain) {
                console.warn(`no chain found for key`, { key: base64.fromByteArray(message.ephemeralKey), session });
            }
            if ((chain === null || chain === void 0 ? void 0 : chain.chainType) === session_types_1.ChainType.SENDING) {
                throw new Error('Tried to decrypt on a sending chain');
            }
            yield this.fillMessageKeys(chain, message.counter);
            const messageKey = chain.messageKeys[message.counter];
            if (messageKey === undefined) {
                const e = new Error('Message key not found. The counter was repeated or the key was not filled.');
                e.name = 'MessageCounterError';
                throw e;
            }
            delete chain.messageKeys[message.counter];
            const keys = yield Internal.HKDF(messageKey, new ArrayBuffer(32), 'WhisperMessageKeys');
            const ourIdentityKey = yield this.storage.getIdentityKeyPair();
            if (!ourIdentityKey) {
                throw new Error(`Our identity key is missing. Cannot decrypt.`);
            }
            const macInput = new Uint8Array(messageProto.byteLength + 33 * 2 + 1);
            macInput.set(new Uint8Array(session.indexInfo.remoteIdentityKey));
            macInput.set(new Uint8Array(ourIdentityKey.pubKey), 33);
            macInput[33 * 2] = (3 << 4) | 3;
            macInput.set(new Uint8Array(messageProto), 33 * 2 + 1);
            yield Internal.verifyMAC(macInput.buffer, keys[1], mac, 8);
            const plaintext = yield Internal.crypto.decrypt(keys[0], (0, helpers_1.uint8ArrayToArrayBuffer)(message.ciphertext), keys[2].slice(0, 16));
            delete session.pendingPreKey;
            return plaintext;
        });
    }
    maybeStepRatchet(session, remoteKey, previousCounter) {
        return __awaiter(this, void 0, void 0, function* () {
            const remoteKeyString = base64.fromByteArray(new Uint8Array(remoteKey));
            if (session.chains[remoteKeyString] !== undefined) {
                return Promise.resolve();
            }
            const ratchet = session.currentRatchet;
            if (!ratchet.ephemeralKeyPair) {
                throw new Error(`attempting to step reatchet without ephemeral key`);
            }
            const previousRatchet = session.chains[base64.fromByteArray(new Uint8Array(ratchet.lastRemoteEphemeralKey))];
            if (previousRatchet !== undefined) {
                yield this.fillMessageKeys(previousRatchet, previousCounter).then(function () {
                    delete previousRatchet.chainKey.key;
                    session.oldRatchetList[session.oldRatchetList.length] = {
                        added: Date.now(),
                        ephemeralKey: ratchet.lastRemoteEphemeralKey,
                    };
                });
            }
            yield this.calculateRatchet(session, remoteKey, false);
            const previousRatchetKey = base64.fromByteArray(new Uint8Array(ratchet.ephemeralKeyPair.pubKey));
            if (session.chains[previousRatchetKey] !== undefined) {
                ratchet.previousCounter = session.chains[previousRatchetKey].chainKey.counter;
                delete session.chains[previousRatchetKey];
            }
            const keyPair = yield Internal.crypto.createKeyPair();
            ratchet.ephemeralKeyPair = keyPair;
            yield this.calculateRatchet(session, remoteKey, true);
            ratchet.lastRemoteEphemeralKey = remoteKey;
        });
    }
    /////////////////////////////////////////
    // session management and storage access
    getRemoteRegistrationId() {
        return session_lock_1.SessionLock.queueJobForNumber(this.remoteAddress.toString(), () => __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getRecord(this.remoteAddress.toString());
            if (record === undefined) {
                return undefined;
            }
            const openSession = record.getOpenSession();
            if (openSession === undefined) {
                return undefined;
            }
            return openSession.registrationId;
        }));
    }
    hasOpenSession() {
        const job = () => __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getRecord(this.remoteAddress.toString());
            if (record === undefined) {
                return false;
            }
            return record.haveOpenSession();
        });
        return session_lock_1.SessionLock.queueJobForNumber(this.remoteAddress.toString(), job);
    }
    closeOpenSessionForDevice() {
        const address = this.remoteAddress.toString();
        const job = () => __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getRecord(this.remoteAddress.toString());
            if (record === undefined || record.getOpenSession() === undefined) {
                return;
            }
            record.archiveCurrentState();
            return this.storage.storeSession(address, record.serialize());
        });
        return session_lock_1.SessionLock.queueJobForNumber(address, job);
    }
    deleteAllSessionsForDevice() {
        // Used in session reset scenarios, where we really need to delete
        const address = this.remoteAddress.toString();
        const job = () => __awaiter(this, void 0, void 0, function* () {
            const record = yield this.getRecord(this.remoteAddress.toString());
            if (record === undefined) {
                return;
            }
            record.deleteAllSessions();
            return this.storage.storeSession(address, record.serialize());
        });
        return session_lock_1.SessionLock.queueJobForNumber(address, job);
    }
}
exports.SessionCipher = SessionCipher;
/*

  S

  libsignal.SessionCipher = function(storage, remoteAddress) {
      var cipher = new SessionCipher(storage, remoteAddress);

      // returns a Promise that resolves to a ciphertext object
      this.encrypt = cipher.encrypt.bind(cipher);

      // returns a Promise that inits a session if necessary and resolves
      // to a decrypted plaintext array buffer
      this.decryptPreKeyWhisperMessage = cipher.decryptPreKeyWhisperMessage.bind(cipher);

      // returns a Promise that resolves to decrypted plaintext array buffer
      this.decryptWhisperMessage = cipher.decryptWhisperMessage.bind(cipher);

      this.getRemoteRegistrationId = cipher.getRemoteRegistrationId.bind(cipher);
      this.hasOpenSession = cipher.hasOpenSession.bind(cipher);
      this.closeOpenSessionForDevice = cipher.closeOpenSessionForDevice.bind(cipher);
      this.deleteAllSessionsForDevice = cipher.deleteAllSessionsForDevice.bind(cipher);
  };
  */
