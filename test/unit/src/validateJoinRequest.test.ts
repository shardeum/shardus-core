import * as Join from '../../../src/p2p/Join';
import { config, crypto, setConfig, setCryptoContext, setLoggerContext } from '../../../src/p2p/Context';
import * as utils from '../../../src/utils';
import * as NodeList from '../../../src/p2p/NodeList';
import { isBogonIP, isInvalidIP, isIPv6 } from '../../../src/utils/functions/checkIP';
import * as CycleChain from "../../../src/p2p/CycleChain";
import { logFlags } from "../../../src/logger"

logFlags.p2pNonFatal = false;

jest.mock('../../../src/utils/functions/checkIP', () => ({
  isBogonIP: jest.fn(),
  isInvalidIP: jest.fn(),
  isIPv6: jest.fn(),
}));

jest.mock('../../../src/p2p/NodeList', () => ({
  byPubKey: new Map(),
  byIpPort: new Map(),
  ipPort: jest.fn(),
}));

// Setting up mocks directly on imported objects
beforeEach(() => {
  Join.reset();
  // Resetting mocks before each test case
  jest.clearAllMocks();

  setConfig({
    p2p: {
      checkVersion: true,
      maxJoinedPerCycle: 5,
      firstCycleJoin: 0,
      dynamicBogonFiltering: false,
      forceBogonFilteringOn: false,
      rejectBogonOutboundJoin: true,
    }
  } as any);
  setCryptoContext({
    verify: jest.fn().mockReturnValue(true),
    hash: jest.fn().mockReturnValue('hashed_value')
  });
  console.log(config);
  // Mocking the config.p2p object
  (config.p2p as any) = {
    checkVersion: true,
    maxJoinedPerCycle: 5,
    firstCycleJoin: 0,
    dynamicBogonFiltering: false,
    forceBogonFilteringOn: false,
    rejectBogonOutboundJoin: true,
  };

  // Mocking other config items that might exist in the project context
  (config as any).version = '1.0.0';

  // Mocking CycleChain and logFlags globally as they're not exported from Context
  (CycleChain as any).newest = {
    start: Date.now(),
    duration: 60000,
    counter: 1,
  };

  (global as any).logFlags = {
    p2pNonFatal: true,
  };

  // Mocking IP check functions
  (isBogonIP as jest.Mock).mockReturnValue(false);
  (isInvalidIP as jest.Mock).mockReturnValue(false);
  (isIPv6 as jest.Mock).mockReturnValue(false);

  // Mocking NodeList related methods
  NodeList.byPubKey.clear();
  NodeList.byIpPort.clear();
  (NodeList.ipPort as jest.Mock).mockReturnValue('1.2.3.4:8080');

});

const validJoinRequest: any = {
  appJoinData: { adminCert: null, mustUseAdminCert: false, stakeCert: null, version: '1.12.1' },
  cycleMarker: '45da5452eb8e45d73eee05a973375ef824f43d8a3f67186e24222e3bdd5e7940',
  nodeInfo: {
    activeTimestamp: 0,
    address: '3d173e0ce5ee2c81fd53f810d34093ae33bfeb76b352a05237d3575fc7c23f2d',
    externalIp: '127.0.0.1',
    externalPort: 9003,
    internalIp: '127.0.0.1',
    internalPort: 10003,
    joinRequestTimestamp: Date.now(),
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
  version: '123',
};

describe('validateJoinRequest', () => {
  it('should pass with valid join request', () => {
    const result = Join.validateJoinRequest(validJoinRequest);
    expect(result).toBe(undefined);
  });

  it('should fail with older join request version', () => {
    const oldVersion = validJoinRequest.version;
    validJoinRequest.version = '0.9.0';
    const result = Join.validateJoinRequest(validJoinRequest);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Old shardus core version');
    validJoinRequest.version = oldVersion;
  });

  it('should fail with incorrect join request types', () => {
    const joinRequest = { cycleMarker: 1234 };
    const result = Join.validateJoinRequest(joinRequest as any);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Bad join request object structure');
  });

  it('should fail with invalid signer', () => {
    const joinRequest = { sign: { owner: 'owner_key' }, nodeInfo: { publicKey: 'different_key' } };
    const result = Join.validateJoinRequest({
      ...validJoinRequest,
      ...joinRequest
    });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Bad signature, sign owner and node attempted joining mismatched');
  });

  // it('should fail with IPv6', () => {
  //   isIPv6.mockReturnValue(true);
  //   const joinRequest = { nodeInfo: { externalIp: '::1' } };
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Bad ip version, IPv6 are not accepted');
  // });

  // it('should fail with invalid host', () => {
  //   isInvalidIP.mockReturnValue(true);
  //   const joinRequest = { nodeInfo: { externalIp: '192.168.1.1' } };
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Bad ip, reserved ip not accepted');
  // });

  // it('should fail if already seen', () => {
  //   const joinRequest = { nodeInfo: { publicKey: 'public_key' } };
  //   // Assuming `seen` set is available in your test scope
  //   seen.add('public_key');
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Node has already been seen this cycle');
  // });

  // it('should fail if joining node is known by public key', () => {
  //   NodeList.byPubKey.set('public_key', {});
  //   const joinRequest = { nodeInfo: { publicKey: 'public_key' } };
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Cannot add join request for this node, already a known node');
  // });

  // it('should fail if joining node is known by IP address', () => {
  //   NodeList.byIpPort.set('1.2.3.4:8080', {});
  //   const joinRequest = { nodeInfo: { internalIp: '1.2.3.4', internalPort: 8080 } };
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Cannot add join request for this node, already a known node');
  // });

  // it('should fail with timestamp too early', () => {
  //   const joinRequest = { nodeInfo: { joinRequestTimestamp: Date.now() - 120000 } }; // Earlier than allowed
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Cannot add join request, timestamp is earlier than allowed cycle range');
  // });

  // it('should fail with timestamp too late', () => {
  //   const joinRequest = { nodeInfo: { joinRequestTimestamp: Date.now() + 120000 } }; // Later than allowed
  //   const result = validateJoinRequest(joinRequest);
  //   expect(result.success).toBe(false);
  //   expect(result.reason).toContain('Cannot add join request, timestamp exceeds allowed cycle range');
  // });

  // describe('verifyJoinRequestTypes', () => {
  //   it('should pass when correct types are passed', () => {
  //     const joinRequest = { cycleMarker: 'marker', nodeInfo: {}, sign: {}, version: '1.0.0' };
  //     utils.validateTypes.mockReturnValue(null);
  //     const result = verifyJoinRequestTypes(joinRequest);
  //     expect(result).toBe(null);
  //   });

  //   it('should fail if cycleMarker is a number', () => {
  //     const joinRequest = { cycleMarker: 1234 };
  //     utils.validateTypes.mockReturnValue('Error: Invalid type');
  //     const result = verifyJoinRequestTypes(joinRequest);
  //     expect(result.success).toBe(false);
  //     expect(result.reason).toContain('Bad join request object structure');
  //   });
  // });
});
