"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCode = createCode;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function createCode(length) {
    if (!Number.isInteger(length) || length <= 0)
        throw new Error("invalid code length");
    const bytes = node_crypto_1.default.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}
//# sourceMappingURL=code.js.map