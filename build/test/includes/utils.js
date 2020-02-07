"use strict";
function isValidHex(str) {
    if (typeof str !== 'string') {
        return false;
    }
    try {
        parseInt(str, 16);
    }
    catch (e) {
        return false;
    }
    return true;
}
exports.isValidHex = isValidHex;
//# sourceMappingURL=utils.js.map