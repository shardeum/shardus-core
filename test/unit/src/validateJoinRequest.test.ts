import { version as packageVersion } from '../../../package.json'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import {
  ALREADY_KNOWN_IP_ERROR,
  ALREADY_KNOWN_PK_ERROR,
  ALREADY_SEEN_ERROR,
  BAD_SIGNATURE_ERROR,
  BAD_STRUCTURE_ERROR,
  BAD_VERSION_ERROR,
  BOGON_NOT_ACCEPTED_ERROR,
  EARLY_TIMESTAMP_ERROR,
  IPV6_ERROR,
  LATE_TIMESTAMP_ERROR,
  RESERVED_IP_REJECTED_ERROR,
  validateJoinRequest,
  validateJoinRequestHost,
  validateVersion,
  verifyJoinRequestSigner,
  verifyJoinRequestTypes,
  verifyNotIPv6,
} from '../../../src/p2p/Join/validate'
import { JoinRequestResponse } from '../../../src/p2p/Join/types'
import { getAllowBogon, getSeen } from '../../../src/p2p/Join/state'
import { getByIpPortMap, getByPubKeyMap } from '../../../src/p2p/NodeList'

// mock some required functions from the Context module
jest.mock('../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  config: {
    p2p: {
      checkVersion: true,
      useJoinProtocolV2: true,
    },
  },
}))

// set up mocking for NodeList maps
jest.mock('../../../src/p2p/NodeList', () => {
  const actual = jest.requireActual('../../../src/p2p/NodeList')
  return {
    ...actual,
    getByPubKeyMap: jest.fn().mockReturnValue(new Map()),
    getByIpPortMap: jest.fn().mockReturnValue(new Map()),
  }
})

// mock some CycleChain fields
jest.mock('../../../src/p2p/CycleChain', () => ({
  newest: {
    duration: 60,
    start: 1723322908, // validJoinRequest.nodeInfo.joinRequestTimestamp - 10
  },
}))

// mock logging functions
jest.mock('../../../src/p2p/Join/logging', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}))

// mock state functions to allow modification at test-time
jest.mock('../../../src/p2p/Join/state', () => ({
  getAllowBogon: jest.fn().mockReturnValue(true),
  getSeen: jest.fn().mockReturnValue(new Set()),
}))

/** A test case for modifying and testing a JoinRequest. */
interface ValidateJoinRequestTest {
  /** `it` description of the test. */
  it: string

  /** How the `validJoinRequest` should be mutated for this test. Overrides
   * fields in the `validJoinRequest` when tests are run. */
  mutation?: object

  /** The expected error response from the validation function. If `null` or
   * `undefined`, the test is expected to be successful instead of failing with
   * an error. */
  expectedError?: JoinRequestResponse

  /** Optional function to run before the test, for e.g. mocking adjustments. */
  before?: () => void
}

/**
 * Runs a collection of tests using the provided function, which will receive
 * a mutated JoinRequest (depending on ValidateJoinRequestTest.mutation) and
 * return a `JoinRequestResponse` (if unsuccessful) or `null` (if validation
 * passes).
 */
const runTestsWith = (
  fn: (jr: JoinRequest) => null | JoinRequestResponse,
  tests: ValidateJoinRequestTest[]
): void => {
  for (const test of tests) {
    // create an `it` call
    it(test.it, () => {
      // run before hook if provided
      if (test.before) test.before()

      // warn if the test is expecting an error, but `success` is expected to be
      // `true`
      if (test.expectedError?.success) {
        console.warn('this test is expecting an error, but `success` is expected to be `true`')
      }

      // create the mutated JoinRequest, asserting that it is a valid
      // JoinRequest (even though it's very likely not, haha, joke's on you,
      // TypeScript)
      const joinRequest = {
        ...validJoinRequest,
        ...(test.mutation || {}),
      } as JoinRequest

      // run the validation function and get the result
      const result = fn(joinRequest)

      // seen set needs to be cleared after every test
      getSeen().clear()

      // check if the result is what was expected
      if (!test.expectedError) {
        expect(result).toBeNull()
      } else {
        expect(result).toStrictEqual(test.expectedError)
      }
    })
  }
}

/** A valid JoinRequest, sourced organically from a local network. */
const validJoinRequest: JoinRequest = Object.freeze({
  appJoinData: { adminCert: null, mustUseAdminCert: false, stakeCert: null, version: '1.12.1' },
  cycleMarker: '45da5452eb8e45d73eee05a973375ef824f43d8a3f67186e24222e3bdd5e7940',
  nodeInfo: {
    activeTimestamp: 0,
    address: '3d173e0ce5ee2c81fd53f810d34093ae33bfeb76b352a05237d3575fc7c23f2d',
    externalIp: '127.0.0.1',
    externalPort: 9003,
    internalIp: '127.0.0.1',
    internalPort: 10003,
    joinRequestTimestamp: 1723322918,
    publicKey: '3d173e0ce5ee2c81fd53f810d34093ae33bfeb76b352a05237d3575fc7c23f2d',
    readyTimestamp: 0,
    refreshedCounter: 2,
    syncingTimestamp: 0,
  },
  proofOfWork:
    '{"compute":{"hash":"28efe69b94cf3786477fdbba8da46bfbf399d02a649da97f6b82b0da8d4d6490","nonce":"f7e6cbce19eef02662e7fc40a8dc8e76f437ba0bd0e9a2dc9f5edfa12e55d754"}}',
  selectionNum: 'a331b77d1413e3a71181b7a62451c49151fd4c516c2b9e5a778f11d3709feec9',
  sign: {
    owner: '3d173e0ce5ee2c81fd53f810d34093ae33bfeb76b352a05237d3575fc7c23f2d',
    sig: '5e5e8b826526aa3f9b49731e9dc0b2497f1e4c3f1a0dde18920c70e31dc4a12d62f1f0145e39ee9ae2f5351beda0d48a26da816dbbfb6232eb8d5f403443360909b6b3625fafa0f078857197320b63d24d81960f48ec2058a6c8f7be272a8430',
  },
  version: packageVersion,
})

describe('validateJoinRequest', () => {
  const tests: ValidateJoinRequestTest[] = [
    {
      it: 'should pass with valid join request',
    },
    {
      it: 'should fail with older join request version',
      mutation: {
        version: '0.0.0',
      },
      expectedError: BAD_VERSION_ERROR,
    },
    {
      it: 'should fail with incorrect join request types',
      mutation: {
        cycleMarker: 1,
      },
      expectedError: BAD_STRUCTURE_ERROR,
    },
    {
      it: 'should fail with invalid signer',
      mutation: {
        sign: {
          ...validJoinRequest.sign,
          owner: 'invalid owner',
        },
      },
      expectedError: BAD_SIGNATURE_ERROR,
    },
    {
      it: 'should fail with IPv6',
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          externalIp: 'abcd:ef01:2345:6789:abcd:ef01:2345:6789',
          internalIp: '::',
        },
      },
      expectedError: IPV6_ERROR,
    },
    {
      it: 'should fail with invalid host',
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          externalIp: 'not an address',
          internalIp: 'also not an address, but not checked',
        },
      },
      expectedError: RESERVED_IP_REJECTED_ERROR,
    },
    {
      it: 'should fail if already seen',
      before: () => {
        ;(getSeen as jest.Mock).mockReturnValueOnce(new Set(['already seen']))
      },
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          publicKey: 'already seen',
        },
        sign: {
          ...validJoinRequest.sign,
          owner: 'already seen',
        },
      },
      expectedError: ALREADY_SEEN_ERROR,
    },
    {
      it: 'should fail if joining node is known by public key',
      before: () => {
        ;(getByPubKeyMap as jest.Mock).mockReturnValueOnce(new Map([['known node', {}]]))
      },
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          publicKey: 'known node',
        },
        sign: {
          ...validJoinRequest.sign,
          owner: 'known node',
        },
      },
      expectedError: ALREADY_KNOWN_PK_ERROR,
    },
    {
      it: 'should fail if joining node is known by IP address',
      before: () => {
        ;(getByIpPortMap as jest.Mock).mockReturnValueOnce(new Map([['12.34.56.78:90', {}]]))
      },
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          internalIp: '12.34.56.78',
          internalPort: 90,
        },
      },
      expectedError: ALREADY_KNOWN_IP_ERROR,
    },
    {
      it: 'should fail with timestamp too early',
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          joinRequestTimestamp: 0,
        },
      },
      expectedError: EARLY_TIMESTAMP_ERROR,
    },
    {
      it: 'should fail with timestamp too late',
      mutation: {
        nodeInfo: {
          ...validJoinRequest.nodeInfo,
          joinRequestTimestamp: 999999999999999,
        },
      },
      expectedError: LATE_TIMESTAMP_ERROR,
    },
  ]

  runTestsWith(validateJoinRequest, tests)
})

describe('verifyJoinRequestTypes', () => {
  const tests: ValidateJoinRequestTest[] = [
    {
      it: 'should pass when correct types are passed',
      mutation: {},
    },
    {
      it: 'should fail if cycleMarker is a number',
      mutation: { cycleMarker: 1 },
      expectedError: BAD_STRUCTURE_ERROR,
    },
    {
      it: 'should fail if nodeInfo is a string',
      mutation: { nodeInfo: '192.68.123.123' },
      expectedError: BAD_STRUCTURE_ERROR,
    },
    {
      it: 'should fail if sign if a string',
      mutation: { sign: 'i am a hash but i should be an object' },
      expectedError: BAD_STRUCTURE_ERROR,
    },
    {
      it: 'should fail if version is a number',
      mutation: { version: 1 },
      expectedError: BAD_STRUCTURE_ERROR,
    },
  ]

  runTestsWith(verifyJoinRequestTypes, tests)
})

describe('validateVersion', () => {
  it('should pass with equal join request version', () => {
    const result = validateVersion(packageVersion)
    expect(result).toBeNull()
  })
  it('should pass with newer join request version', () => {
    const result = validateVersion('99999.99999.99999')
    expect(result).toBeNull()
  })
  it('should fail with older join request version', () => {
    const result = validateVersion('0.0.0')
    expect(result).toStrictEqual(BAD_VERSION_ERROR)
  })
})

describe('verifyJoinRequestSigner', () => {
  const tests = [
    {
      it: 'should pass with correct signer',
      mutation: {},
      shouldSucceed: true,
    },
    {
      it: 'should fail with wrong signature owner',
      mutation: {
        sign: {
          owner: 'wrong owner',
        },
      },
      expectedError: BAD_SIGNATURE_ERROR,
    },
    {
      it: 'should fail with wrong node public key',
      mutation: {
        nodeInfo: {
          publicKey: 'wrong key',
        },
      },
      expectedError: BAD_SIGNATURE_ERROR,
    },
  ]
  runTestsWith(verifyJoinRequestSigner, tests)
})

describe('verifyNotIPv6', () => {
  it('should pass without IPv6', () => {
    expect(verifyNotIPv6('192.168.1.1')).toBeNull()
  })
  it('should fail with IPv6', () => {
    expect(verifyNotIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toStrictEqual(IPV6_ERROR)
  })
})

describe('validateJoinRequestHost', () => {
  it('should pass with valid IP', () => {
    expect(validateJoinRequestHost('123.234.123.234')).toBeNull()
  })

  // test reserved IPs
  const reservedAddresses = [
    '0.1.2.3',
    '192.0.0.100',
    '192.0.2.4',
    '198.18.4.5',
    '198.51.100.5',
    '203.0.113.60',
    '224.239.0.2',
    '239.0.123.123',
    '240.1.2.3',
    '254.4.5.6',
    '255.255.255.255',
  ]
  for (const address of reservedAddresses) {
    it(`should fail with reserved IP ${address}, bogon disallowed`, () => {
      ;(getAllowBogon as jest.Mock).mockReturnValue(false)
      expect(validateJoinRequestHost(address)).toStrictEqual(BOGON_NOT_ACCEPTED_ERROR)
    })
  }
  for (const address of reservedAddresses) {
    it(`should fail with reserved IP ${address}, bogon allowed`, () => {
      ;(getAllowBogon as jest.Mock).mockReturnValue(true)
      expect(validateJoinRequestHost(address)).toStrictEqual(RESERVED_IP_REJECTED_ERROR)
    })
  }

  // bogon tests
  const privateAddresses = [
    '10.1.2.3',
    '100.64.0.0',
    '100.127.0.0',
    '127.0.1.2',
    '169.254.100.100',
    '172.16.1.2',
    '172.31.3.4',
    '192.168.0.1',
  ]

  // test with bogon allowed
  for (const address of privateAddresses) {
    it(`should pass with private IP ${address}, bogon allowed`, () => {
      ;(getAllowBogon as jest.Mock).mockReturnValue(true)
      expect(validateJoinRequestHost(address)).toBeNull()
    })
  }

  // test with bogon disallowed
  for (const address of privateAddresses) {
    it(`should fail with private IP ${address}, bogon disallowed`, () => {
      ;(getAllowBogon as jest.Mock).mockReturnValue(false)
      expect(validateJoinRequestHost(address)).toStrictEqual(BOGON_NOT_ACCEPTED_ERROR)
    })
  }
})

// describe('verifyUnseen', () => {
//   it('should pass if node is unseen', () => {})
//   it('should fail if node is already seen', () => {})
// })
//
// describe('verifyNodeUnknown', () => {
//   it('should pass if joining node is unknown', () => {})
//   it('should fail if joining node is known', () => {})
// })
//
// describe('validateJoinRequestTimestamp', () => {
//   it('should pass with correct timestamp', () => {})
//   it('should fail with invalid timestamp', () => {})
// })
