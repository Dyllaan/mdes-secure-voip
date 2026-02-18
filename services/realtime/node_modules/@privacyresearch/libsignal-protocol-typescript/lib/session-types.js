"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncryptionResultMessageType = exports.BaseKeyType = exports.ChainType = void 0;
var ChainType;
(function (ChainType) {
    ChainType[ChainType["SENDING"] = 1] = "SENDING";
    ChainType[ChainType["RECEIVING"] = 2] = "RECEIVING";
})(ChainType = exports.ChainType || (exports.ChainType = {}));
var BaseKeyType;
(function (BaseKeyType) {
    BaseKeyType[BaseKeyType["OURS"] = 1] = "OURS";
    BaseKeyType[BaseKeyType["THEIRS"] = 2] = "THEIRS";
})(BaseKeyType = exports.BaseKeyType || (exports.BaseKeyType = {}));
var EncryptionResultMessageType;
(function (EncryptionResultMessageType) {
    EncryptionResultMessageType[EncryptionResultMessageType["WhisperMessage"] = 1] = "WhisperMessage";
    EncryptionResultMessageType[EncryptionResultMessageType["PreKeyWhisperMessage"] = 3] = "PreKeyWhisperMessage";
})(EncryptionResultMessageType = exports.EncryptionResultMessageType || (exports.EncryptionResultMessageType = {}));
