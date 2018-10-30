const test = require('tap').test
const generateNetworkModule = require('../../../src/network')

const DEFAULT_ADDRESS = '127.0.0.1'
const DEFAULT_PORT    = 5000

test('Network Module', t => {
  {
    const func = generateNetworkModule.bind(generateNetworkModule, null, DEFAULT_ADDRESS)
    const expectedError = new Error('Fatal: network module requires localPort')
    t.throws(func, expectedError, 'throws when not given port')
  }

  {
    const func = generateNetworkModule.bind(generateNetworkModule, DEFAULT_PORT, null)
    const expectedError = new Error('Fatal: network module requires localAddress')
    t.throws(func, expectedError, 'throws when not given address')
  }

  {
    const network = generateNetworkModule(DEFAULT_PORT, DEFAULT_ADDRESS)
    t.ok(network, 'a network object is returned from the constructor')
  }

  {
    const network = generateNetworkModule(DEFAULT_PORT, DEFAULT_ADDRESS)
    t.equal(typeof network, 'object', 'the network should be a type of function')
  }

  t.end()
})
