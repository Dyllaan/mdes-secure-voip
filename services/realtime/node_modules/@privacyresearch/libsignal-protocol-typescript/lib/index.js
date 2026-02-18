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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
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
exports.setCurve = exports.setWebCrypto = void 0;
const curve25519_typescript_1 = require("@privacyresearch/curve25519-typescript");
const curve_1 = require("./curve");
__exportStar(require("./types"), exports);
__exportStar(require("./signal-protocol-address"), exports);
__exportStar(require("./key-helper"), exports);
__exportStar(require("./fingerprint-generator"), exports);
__exportStar(require("./session-builder"), exports);
__exportStar(require("./session-cipher"), exports);
__exportStar(require("./session-types"), exports);
__exportStar(require("./curve"), exports);
const Internal = __importStar(require("./internal"));
var internal_1 = require("./internal");
Object.defineProperty(exports, "setWebCrypto", { enumerable: true, get: function () { return internal_1.setWebCrypto; } });
Object.defineProperty(exports, "setCurve", { enumerable: true, get: function () { return internal_1.setCurve; } });
// returns a promise of something with the shape of the old libsignal
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
exports.default = () => __awaiter(void 0, void 0, void 0, function* () {
    const cw = yield curve25519_typescript_1.Curve25519Wrapper.create();
    return {
        Curve: new curve_1.Curve(new Internal.Curve(cw)),
    };
});
