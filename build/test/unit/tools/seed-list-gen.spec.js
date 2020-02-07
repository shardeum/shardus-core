"use strict";
const { test, beforeEach, afterEach } = require('tap');
const fs = require('fs');
const path = require('path');
const crypto = require('shardus-crypto-utils');
crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc');
// const { sleep } = require('../../../src/utils')
const config = require('../../../tools/seed-list-gen/config.json');
let inFile, outFile, keypair;
try {
    inFile = Object.assign({}, module.require(path.join(__dirname, `../../../tools/seed-list-gen/${config.inFile.replace('./', '')}`)));
    outFile = Object.assign({}, module.require(path.join(__dirname, `../../../tools/seed-list-gen/${config.outFile.replace('./', '')}`)));
    keypair = Object.assign({}, module.require(path.join(__dirname, `../../../tools/seed-list-gen/${config.keypair.replace('./', '')}`)));
}
catch (e) {
    inFile = null;
    outFile = null;
    keypair = null;
}
function clearFile(path) {
    if (fs.existsSync(path))
        fs.unlinkSync(path);
}
function clearFiles() {
    clearFile(path.join(__dirname, `../../../tools/seed-list-gen/${config.keypair.replace('./', '')}`));
    clearFile(path.join(__dirname, `../../../tools/seed-list-gen/${config.inFile.replace('./', '')}`));
    clearFile(path.join(__dirname, `../../../tools/seed-list-gen/${config.outFile.replace('./', '')}`));
}
function writeFiles() {
    if (keypair) {
        fs.writeFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.keypair.replace('./', '')}`), JSON.stringify(keypair, null, 2));
    }
    if (inFile) {
        fs.writeFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.inFile.replace('./', '')}`), JSON.stringify(inFile, null, 2));
    }
    if (outFile) {
        fs.writeFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.outFile.replace('./', '')}`), JSON.stringify(outFile, null, 2));
    }
}
beforeEach((done) => {
    clearFiles();
    done();
});
afterEach((done) => {
    writeFiles();
    done();
});
test('Testing seed list generator without the seed node list', (t) => {
    try {
        // disable standard lint for line below becaues it expected
        const seedListGen = module.require('../../../tools/seed-list-gen'); // eslint-disable-line
        t.fail('without the seed list should throw an error');
    }
    catch (e) {
        t.pass('should throw an error without a seedList');
    }
    finally {
        t.end();
    }
});
test('Testing the seed list generator if gonna create the signed outFile correctly', (t) => {
    // Testing keypair generation
    const seedNodes = [{ ip: '127.0.0.1', port: 8080 }, { ip: '127.0.0.1', port: 8081 }];
    fs.writeFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.inFile.replace('./', '')}`), JSON.stringify({ seedNodes }, null, 2));
    // disable standard lint for line below becaues it expected
    const seedListGen = module.require('../../../tools/seed-list-gen'); // eslint-disable-line
    const signedList = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.outFile.replace('./', '')}`)));
    const keysLib = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.keypair.replace('./', '')}`)));
    const expectedSignedList = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../tools/seed-list-gen/${config.inFile.replace('./', '')}`)));
    crypto.signObj(expectedSignedList, keysLib.secretKey, keysLib.publicKey);
    clearFiles();
    t.deepEqual(expectedSignedList, signedList, 'should have the seed nodes list signed correctly');
    t.end();
});
//# sourceMappingURL=seed-list-gen.spec.js.map