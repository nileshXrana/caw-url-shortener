"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLongUrl = normalizeLongUrl;
exports.isValidRedirectUrl = isValidRedirectUrl;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
function normalizeLongUrl(input) {
    const trimmed = input.trim();
    if (CONTROL_CHARS.test(trimmed))
        return "";
    return trimmed;
}
function isValidRedirectUrl(url) {
    if (!url)
        return false;
    if (url.length > 2048)
        return false;
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return false;
    }
    if (!["http:", "https:"].includes(parsed.protocol))
        return false;
    if (!parsed.hostname)
        return false;
    if (parsed.username || parsed.password)
        return false;
    if (url.startsWith("//"))
        return false;
    if (url.includes("\\\\"))
        return false;
    return true;
}
//# sourceMappingURL=url.js.map