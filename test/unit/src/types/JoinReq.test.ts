import { initJoinReq } from '../../../../src/types/ajv/JoinReq'
import { verifyPayload } from '../../../../src/types/ajv/Helpers';


describe('JoinRequest Tests', () => {
  beforeAll(() => {
    // Initialize schema once before all tests
    initJoinReq();
  });

  describe('JoinRequest Validation', () => {
    let validJoinRequest;

    beforeEach(() => {
      // Prepare a valid join request according to the schema
      validJoinRequest = {
        nodeInfo: {
          publicKey: '12345abcdef',
          externalIp: '192.168.1.0',
          externalPort: 8000,
          internalIp: '10.0.0.1',
          internalPort: 8001,
          address: '1A2b3C4d5E6f',
          joinRequestTimestamp: Date.now(),
          activeTimestamp: Date.now() - 10000,
          syncingTimestamp: Date.now() - 5000,
          readyTimestamp: Date.now() - 3000,
          refreshedCounter: 0
        },
        selectionNum: '67890',
        cycleMarker: 'abcdef123456',
        proofOfWork: 'def456abcdef',
        version: '1.0',
        sign: {
          owner: 'owner12345',
          sig: 'sig67890'
        },
        appJoinData: {
          extraData: 'Some data here'
        }
      };
    });

    test('should pass validation for a valid join request', () => {
      const errors = verifyPayload('JoinReq', validJoinRequest);
      expect(errors).toBeNull(); // No errors for a valid schema
    });

    test('should fail validation if required fields are missing', () => {
      // Modify validJoinRequest to invalidate it
      const invalidJoinRequest = { ...validJoinRequest, nodeInfo: { ...validJoinRequest.nodeInfo, publicKey: undefined } };

      const errors = verifyPayload('JoinReq', invalidJoinRequest);
      expect(errors).not.toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    });

    test('should fail validation if fields do not meet criteria', () => {
      // Set externalPort outside the specified range
      const invalidPortJoinRequest = {
        ...validJoinRequest,
        nodeInfo: { ...validJoinRequest.nodeInfo, externalPort: 70000 } // Invalid port number
      };

      const errors = verifyPayload('JoinReq', invalidPortJoinRequest);
      expect(errors).not.toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    });

    test('should fail validation for an invalid external IP format', () => {
        validJoinRequest.nodeInfo.externalIp = '999.999.999.999';  // Invalid IP format
        const errors = verifyPayload('JoinReq', validJoinRequest);
        expect(errors).not.toBeNull();
        expect(errors.length).toBeGreaterThan(0);
      });
  });
});
