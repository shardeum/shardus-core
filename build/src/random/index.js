"use strict";
let crypto;
try {
    crypto = require('crypto');
}
catch (err) {
    console.log('Crypto support is disabled!');
}
const generateSeed = () => {
    const bytes = crypto.randomBytes(16);
    return bytes.toString('hex');
};
const parseSeed = (seed) => {
    if (typeof seed !== 'string' || seed.length !== 32) {
        return false;
    }
    const parsed = [];
    let processed = 0;
    for (let i = 0; i < 4; i++) {
        const start = 0 + (processed * 8);
        const end = start + 8;
        const hex = seed.slice(start, end);
        parsed[i] = parseInt(hex, 16);
        processed += 1;
    }
    return parsed;
};
// From StackOverflow: https://stackoverflow.com/a/47593316
const sfc32 = (a, b, c, d) => {
    return () => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        d = d + 1 | 0;
        t = t + d | 0;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
};
const generateContext = (seed) => {
    if (!seed) {
        seed = generateSeed();
    }
    const parsedSeed = parseSeed(seed);
    if (!parsedSeed)
        return false;
    const rand = sfc32(parsedSeed[0], parsedSeed[1], parsedSeed[2], parsedSeed[3]);
    const randomInt = (min, max) => {
        return Math.floor(rand() * (max - min + 1)) + min;
    };
    return { rand, randomInt };
};
exports = module.exports = generateContext;
exports.generateSeed = generateSeed;
//# sourceMappingURL=index.js.map