"use strict";
const test = require('tap').test;
const path = require('path');
const fs = require('fs');
const { isIP } = require('net');
// const { spawn } = require('child_process')
const P2P = require('../../../src/p2p');
const Logger = require('../../../src/logger');
const Storage = require('../../../src/storage');
const Crypto = require('../../../src/crypto/index');
const Network = require('../../../src/network/index');
// const { readLogFile } = require('../../includes/utils-log')
const { clearTestDb, createTestDb } = require('../../includes/utils-storage');
// const { sleep } = require('../../../src/utils')
// const { isValidHex } = require('../../includes/utils')
let p2p;
let confStorage = module.require('../../../config/storage.json');
let config = require(path.join(__dirname, '../../../config/server.json'));
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000;
config.ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null };
// let configFilePath = path.join(__dirname, '../../../config/logs.json')
let loggerConfig = {
    dir: '/logs',
    confFile: '/config/logs.json',
    files: {
        main: 'main.log',
        fatal: 'fatal.log',
        net: 'net.log'
    }
};
let logger = new Logger(path.resolve('./'), loggerConfig);
createTestDb(confStorage);
let storage = new Storage(logger, '.', { confFile: './config/storage.json' });
let crypto;
let network;
test('Testing p2p constructor', async (t) => {
    await storage.init();
    crypto = new Crypto(logger, storage);
    await crypto.init();
    network = new Network(config.network, logger);
    const { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay } = config;
    const ipInfo = config.ip;
    const p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay };
    p2p = new P2P(p2pConf, logger, storage, crypto, network);
    t.equal(p2p instanceof P2P, true, 'p2p should be instatiated correctly');
    t.end();
});
test('Testing _verifyExternalInfo', async (t) => {
    try {
        p2p._verifyExternalInfo();
        t.fail('this call without args should not be allowed');
    }
    catch (e) {
        t.pass('should throw an error with no args passed');
    }
    try {
        p2p._verifyExternalInfo({ externalIp: '127.0.0.1' });
        t.fail('this call without port should not be allowed');
    }
    catch (e) {
        t.pass('should throw an error with no property port passed');
    }
    {
        const res = p2p._verifyExternalInfo({ externalIp: '127.0.0.1', externalPort: 9001 });
        t.equal(res, true, 'should return true for a valid ip and port passed as parameter');
    }
    t.end();
});
test('Testing _discoverIp method', async (t) => {
    try {
        await p2p._discoverIp('http://google.com');
        t.fail('should not get an IP from google');
    }
    catch (e) {
        t.pass('should throw an error for an invalid ip server');
    }
    {
        const res = await p2p._discoverIp(config.ipServer);
        t.notEqual(isIP(res), 0, 'should return a valid ip from ipServer');
    }
    if (confStorage) {
        confStorage.options.storage = 'db/db.sqlite';
        fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2));
        clearTestDb();
    }
    t.end();
});
//# sourceMappingURL=p2p.spec.js.map