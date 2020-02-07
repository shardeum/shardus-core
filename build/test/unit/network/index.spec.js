"use strict";
const test = require('tap').test;
const Network = require('../../../src/network');
const Logger = require('../../../src/logger');
const path = require('path');
// const DEFAULT_ADDRESS = '127.0.0.1'
// const DEFAULT_PORT = 5000
let config = require(path.join(__dirname, '../../../config/server.json'));
let logger = new Logger(path.resolve('./'), config.log);
test('Network Module', t => {
    // {
    //   const func = Network.bind(Network, null, DEFAULT_ADDRESS)
    //   const expectedError = new Error('Fatal: network module requires localPort')
    //   t.throws(func, expectedError, 'throws when not given port')
    // }
    // {
    //   const func = Network.bind(Network, DEFAULT_PORT, null)
    //   const expectedError = new Error('Fatal: network module requires localAddress')
    //   t.throws(func, expectedError, 'throws when not given address')
    // }
    // {
    //   const network = Network(DEFAULT_PORT, DEFAULT_ADDRESS)
    //   t.ok(network, 'a network object is returned from the constructor')
    // }
    {
        const network = new Network(config.network, logger);
        t.equal(typeof network, 'object', 'the network should be a type of function');
        t.equal(network instanceof Network, true, 'the object should be an instance of Network Class');
    }
    t.end();
});
//# sourceMappingURL=index.spec.js.map