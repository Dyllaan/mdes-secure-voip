"use strict";
/* eslint-disable @typescript-eslint/no-non-null-assertion */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionTypeArrayBufferToString = exports.sessionTypeStringToArrayBuffer = exports.indexInfoArrayBufferToString = exports.indexInfoStringToArrayBuffer = exports.ratchetArrayBufferToString = exports.ratchetStringToArrayBuffer = exports.oldRatchetInfoArrayBufferToString = exports.oldRatchetInfoStringToArrayBuffer = exports.chainArrayBufferToString = exports.chainStringToArrayBuffer = exports.pendingPreKeyArrayBufferToString = exports.pendingPreKeyStringToArrayBuffer = exports.keyPairArrayBufferToString = exports.keyPairStirngToArrayBuffer = exports.SessionRecord = void 0;
const base64_js_1 = __importDefault(require("base64-js"));
const util = __importStar(require("./helpers"));
const session_types_1 = require("./session-types");
const ARCHIVED_STATES_MAX_LENGTH = 40;
const OLD_RATCHETS_MAX_LENGTH = 10;
const SESSION_RECORD_VERSION = 'v1';
class SessionRecord {
    constructor(registrationId) {
        this.sessions = {};
        this.version = SESSION_RECORD_VERSION;
        this.registrationId = registrationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static migrate(data) {
        let run = data.version === undefined;
        for (let i = 0; i < SessionRecord.migrations.length; ++i) {
            if (run) {
                SessionRecord.migrations[i].migrate(data);
            }
            else if (SessionRecord.migrations[i].version === data.version) {
                run = true;
            }
        }
        if (!run) {
            throw new Error('Error migrating SessionRecord');
        }
    }
    static deserialize(serialized) {
        const data = JSON.parse(serialized);
        if (data.version !== SESSION_RECORD_VERSION) {
            SessionRecord.migrate(data);
        }
        const record = new SessionRecord();
        record.sessions = {};
        for (const k of Object.keys(data.sessions)) {
            record.sessions[k] = sessionTypeStringToArrayBuffer(data.sessions[k]);
        }
        if (record.sessions === undefined ||
            record.sessions === null ||
            typeof record.sessions !== 'object' ||
            Array.isArray(record.sessions)) {
            throw new Error('Error deserializing SessionRecord');
        }
        return record;
    }
    serialize() {
        const sessions = {};
        for (const k of Object.keys(this.sessions)) {
            sessions[k] = sessionTypeArrayBufferToString(this.sessions[k]);
        }
        const json = {
            sessions,
            version: this.version,
        };
        return JSON.stringify(json);
    }
    haveOpenSession() {
        const openSession = this.getOpenSession();
        return !!openSession && typeof openSession.registrationId === 'number';
    }
    getSessionByBaseKey(baseKey) {
        const idx = util.arrayBufferToString(baseKey);
        if (!idx) {
            return undefined;
        }
        const session = this.sessions[idx];
        if (session && session.indexInfo.baseKeyType === session_types_1.BaseKeyType.OURS) {
            return undefined;
        }
        return session;
    }
    getSessionByRemoteEphemeralKey(remoteEphemeralKey) {
        this.detectDuplicateOpenSessions();
        const sessions = this.sessions;
        const searchKey = util.arrayBufferToString(remoteEphemeralKey);
        if (searchKey) {
            let openSession;
            for (const key in sessions) {
                if (sessions[key].indexInfo.closed == -1) {
                    openSession = sessions[key];
                }
                if (sessions[key].chains[searchKey] !== undefined) {
                    return sessions[key];
                }
            }
            if (openSession !== undefined) {
                return openSession;
            }
        }
        return undefined;
    }
    getOpenSession() {
        const sessions = this.sessions;
        if (sessions === undefined) {
            return undefined;
        }
        this.detectDuplicateOpenSessions();
        for (const key in sessions) {
            if (sessions[key].indexInfo.closed == -1) {
                return sessions[key];
            }
        }
        return undefined;
    }
    detectDuplicateOpenSessions() {
        let openSession = null;
        const sessions = this.sessions;
        for (const key in sessions) {
            if (sessions[key].indexInfo.closed == -1) {
                if (openSession !== null) {
                    throw new Error('Datastore inconsistensy: multiple open sessions');
                }
                openSession = sessions[key];
            }
        }
    }
    updateSessionState(session) {
        const sessions = this.sessions;
        this.removeOldChains(session);
        const idx = session.indexInfo.baseKey && util.arrayBufferToString(session.indexInfo.baseKey);
        if (!idx) {
            throw new Error(`invalid index for session`);
        }
        sessions[idx] = session;
        this.removeOldSessions();
    }
    getSessions() {
        // return an array of sessions ordered by time closed,
        // followed by the open session
        let list = [];
        let openSession = null;
        for (const k in this.sessions) {
            if (this.sessions[k].indexInfo.closed === -1) {
                openSession = this.sessions[k];
            }
            else {
                list.push(this.sessions[k]);
            }
        }
        list = list.sort(function (s1, s2) {
            return s1.indexInfo.closed - s2.indexInfo.closed;
        });
        if (openSession) {
            list.push(openSession);
        }
        return list;
    }
    archiveCurrentState() {
        const open_session = this.getOpenSession();
        if (open_session !== undefined) {
            open_session.indexInfo.closed = Date.now();
            this.updateSessionState(open_session);
        }
    }
    promoteState(session) {
        session.indexInfo.closed = -1;
    }
    removeOldChains(session) {
        // Sending ratchets are always removed when we step because we never need them again
        // Receiving ratchets are added to the oldRatchetList, which we parse
        // here and remove all but the last ten.
        while (session.oldRatchetList.length > OLD_RATCHETS_MAX_LENGTH) {
            let index = 0;
            let oldest = session.oldRatchetList[0];
            for (let i = 0; i < session.oldRatchetList.length; i++) {
                if (session.oldRatchetList[i].added < oldest.added) {
                    oldest = session.oldRatchetList[i];
                    index = i;
                }
            }
            const idx = util.arrayBufferToString(oldest.ephemeralKey);
            if (!idx) {
                throw new Error(`invalid index for chain`);
            }
            delete session[idx];
            session.oldRatchetList.splice(index, 1);
        }
    }
    removeOldSessions() {
        // Retain only the last 20 sessions
        const { sessions } = this;
        let oldestBaseKey = null;
        let oldestSession = null;
        while (Object.keys(sessions).length > ARCHIVED_STATES_MAX_LENGTH) {
            for (const key in sessions) {
                const session = sessions[key];
                if (session.indexInfo.closed > -1 && // session is closed
                    (!oldestSession || session.indexInfo.closed < oldestSession.indexInfo.closed)) {
                    oldestBaseKey = key;
                    oldestSession = session;
                }
            }
            if (oldestBaseKey) {
                delete sessions[oldestBaseKey];
            }
        }
    }
    deleteAllSessions() {
        // Used primarily in session reset scenarios, where we really delete sessions
        this.sessions = {};
    }
}
exports.SessionRecord = SessionRecord;
SessionRecord.migrations = [
    {
        version: 'v1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        migrate: function migrateV1(data) {
            const sessions = data.sessions;
            let key;
            if (data.registrationId) {
                for (key in sessions) {
                    if (!sessions[key].registrationId) {
                        sessions[key].registrationId = data.registrationId;
                    }
                }
            }
            else {
                for (key in sessions) {
                    if (sessions[key].indexInfo.closed === -1) {
                        //    console.log(
                        //       'V1 session storage migration error: registrationId',
                        //      data.registrationId,
                        //     'for open session version',
                        //     data.version
                        // )
                    }
                }
            }
        },
    },
];
// Serialization helpers
function toAB(s) {
    return util.uint8ArrayToArrayBuffer(base64_js_1.default.toByteArray(s));
}
function abToS(b) {
    return base64_js_1.default.fromByteArray(new Uint8Array(b));
}
function keyPairStirngToArrayBuffer(kp) {
    return {
        pubKey: toAB(kp.pubKey),
        privKey: toAB(kp.privKey),
    };
}
exports.keyPairStirngToArrayBuffer = keyPairStirngToArrayBuffer;
function keyPairArrayBufferToString(kp) {
    return {
        pubKey: abToS(kp.pubKey),
        privKey: abToS(kp.privKey),
    };
}
exports.keyPairArrayBufferToString = keyPairArrayBufferToString;
function pendingPreKeyStringToArrayBuffer(ppk) {
    const { preKeyId, signedKeyId } = ppk;
    return {
        baseKey: toAB(ppk.baseKey),
        preKeyId,
        signedKeyId,
    };
}
exports.pendingPreKeyStringToArrayBuffer = pendingPreKeyStringToArrayBuffer;
function pendingPreKeyArrayBufferToString(ppk) {
    const { preKeyId, signedKeyId } = ppk;
    return {
        baseKey: abToS(ppk.baseKey),
        preKeyId,
        signedKeyId,
    };
}
exports.pendingPreKeyArrayBufferToString = pendingPreKeyArrayBufferToString;
function chainStringToArrayBuffer(c) {
    const { chainType, chainKey, messageKeys } = c;
    const { key, counter } = chainKey;
    const newMessageKeys = {};
    for (const k of Object.keys(messageKeys)) {
        newMessageKeys[k] = toAB(messageKeys[k]);
    }
    return {
        chainType,
        chainKey: {
            key: key ? util.uint8ArrayToArrayBuffer(base64_js_1.default.toByteArray(key)) : undefined,
            counter,
        },
        messageKeys: newMessageKeys,
    };
}
exports.chainStringToArrayBuffer = chainStringToArrayBuffer;
function chainArrayBufferToString(c) {
    const { chainType, chainKey, messageKeys } = c;
    const { key, counter } = chainKey;
    const newMessageKeys = {};
    for (const k of Object.keys(messageKeys)) {
        newMessageKeys[k] = abToS(messageKeys[k]);
    }
    return {
        chainType,
        chainKey: {
            key: key ? abToS(key) : undefined,
            counter,
        },
        messageKeys: newMessageKeys,
    };
}
exports.chainArrayBufferToString = chainArrayBufferToString;
function oldRatchetInfoStringToArrayBuffer(ori) {
    return {
        ephemeralKey: toAB(ori.ephemeralKey),
        added: ori.added,
    };
}
exports.oldRatchetInfoStringToArrayBuffer = oldRatchetInfoStringToArrayBuffer;
function oldRatchetInfoArrayBufferToString(ori) {
    return {
        ephemeralKey: abToS(ori.ephemeralKey),
        added: ori.added,
    };
}
exports.oldRatchetInfoArrayBufferToString = oldRatchetInfoArrayBufferToString;
function ratchetStringToArrayBuffer(r) {
    return {
        rootKey: toAB(r.rootKey),
        ephemeralKeyPair: r.ephemeralKeyPair && keyPairStirngToArrayBuffer(r.ephemeralKeyPair),
        lastRemoteEphemeralKey: toAB(r.lastRemoteEphemeralKey),
        previousCounter: r.previousCounter,
        added: r.added,
    };
}
exports.ratchetStringToArrayBuffer = ratchetStringToArrayBuffer;
function ratchetArrayBufferToString(r) {
    return {
        rootKey: abToS(r.rootKey),
        ephemeralKeyPair: r.ephemeralKeyPair && keyPairArrayBufferToString(r.ephemeralKeyPair),
        lastRemoteEphemeralKey: abToS(r.lastRemoteEphemeralKey),
        previousCounter: r.previousCounter,
        added: r.added,
    };
}
exports.ratchetArrayBufferToString = ratchetArrayBufferToString;
function indexInfoStringToArrayBuffer(ii) {
    const { closed, remoteIdentityKey, baseKey, baseKeyType } = ii;
    return {
        closed,
        remoteIdentityKey: toAB(remoteIdentityKey),
        baseKey: baseKey ? toAB(baseKey) : undefined,
        baseKeyType,
    };
}
exports.indexInfoStringToArrayBuffer = indexInfoStringToArrayBuffer;
function indexInfoArrayBufferToString(ii) {
    const { closed, remoteIdentityKey, baseKey, baseKeyType } = ii;
    return {
        closed,
        remoteIdentityKey: abToS(remoteIdentityKey),
        baseKey: baseKey ? abToS(baseKey) : undefined,
        baseKeyType,
    };
}
exports.indexInfoArrayBufferToString = indexInfoArrayBufferToString;
function sessionTypeStringToArrayBuffer(sess) {
    const { indexInfo, registrationId, currentRatchet, pendingPreKey, oldRatchetList, chains } = sess;
    const newChains = {};
    for (const k of Object.keys(chains)) {
        newChains[k] = chainStringToArrayBuffer(chains[k]);
    }
    return {
        indexInfo: indexInfoStringToArrayBuffer(indexInfo),
        registrationId,
        currentRatchet: ratchetStringToArrayBuffer(currentRatchet),
        pendingPreKey: pendingPreKey ? pendingPreKeyStringToArrayBuffer(pendingPreKey) : undefined,
        oldRatchetList: oldRatchetList.map(oldRatchetInfoStringToArrayBuffer),
        chains: newChains,
    };
}
exports.sessionTypeStringToArrayBuffer = sessionTypeStringToArrayBuffer;
function sessionTypeArrayBufferToString(sess) {
    const { indexInfo, registrationId, currentRatchet, pendingPreKey, oldRatchetList, chains } = sess;
    const newChains = {};
    for (const k of Object.keys(chains)) {
        newChains[k] = chainArrayBufferToString(chains[k]);
    }
    return {
        indexInfo: indexInfoArrayBufferToString(indexInfo),
        registrationId,
        currentRatchet: ratchetArrayBufferToString(currentRatchet),
        pendingPreKey: pendingPreKey ? pendingPreKeyArrayBufferToString(pendingPreKey) : undefined,
        oldRatchetList: oldRatchetList.map(oldRatchetInfoArrayBufferToString),
        chains: newChains,
    };
}
exports.sessionTypeArrayBufferToString = sessionTypeArrayBufferToString;
/*

var Internal = Internal || {};

Internal.BaseKeyType = {
  OURS: 1,
  THEIRS: 2
};
Internal.ChainType = {
  SENDING: 1,
  RECEIVING: 2
};



    var migrations = [
      {
        version: 'v1',
        migrate: function migrateV1(data) {
          var sessions = data.sessions;
          var key;
          if (data.registrationId) {
              for (key in sessions) {
                  if (!sessions[key].registrationId) {
                      sessions[key].registrationId = data.registrationId;
                  }
              }
          } else {
              for (key in sessions) {
                  if (sessions[key].indexInfo.closed === -1) {
                     // console.log('V1 session storage migration error: registrationId',
                      //    data.registrationId, 'for open session version',
                      //    data.version);
                  }
              }
          }
        }
      }
    ];

    function migrate(data) {
      var run = (data.version === undefined);
      for (var i=0; i < migrations.length; ++i) {
        if (run) {
          migrations[i].migrate(data);
        } else if (migrations[i].version === data.version) {
          run = true;
        }
      }
      if (!run) {
        throw new Error("Error migrating SessionRecord");
      }
    }

 ,

        ,
}();*/
