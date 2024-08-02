// JoinRequest.ts
import { addSchema } from '../../utils/serialization/SchemaHelpers';

const schemaP2PNode = {
    type: 'object',
    properties: {
        publicKey: { type: 'string' },
        externalIp: { type: 'string' },
        externalPort: { type: 'integer', minimum: 1, maximum: 65535 },
        internalIp: { type: 'string' },
        internalPort: { type: 'integer', minimum: 1, maximum: 65535 },
        address: { type: 'string' },
        joinRequestTimestamp: { type: 'integer' },
        activeTimestamp: { type: 'integer' },
        syncingTimestamp: { type: 'integer' },
        readyTimestamp: { type: 'integer' },
        refreshedCounter: { type: 'integer', minimum: 0 }
    },
    required: ['publicKey', 'externalIp', 'externalPort', 'internalIp', 'internalPort', 'address', 'joinRequestTimestamp', 'activeTimestamp', 'syncingTimestamp', 'readyTimestamp']
};

const schemaSignature = {
    type: 'object',
    properties: {
        owner: { type: 'string' },
        sig: { type: 'string' }
    },
    required: ['owner', 'sig']
};

const schemaJoinRequest = {
    type: 'object',
    properties: {
        nodeInfo: schemaP2PNode,
        selectionNum: { type: 'string' },
        cycleMarker: { type: 'string' },
        proofOfWork: { type: 'string' },
        version: { type: 'string' },
        sign: schemaSignature,
        appJoinData: { type: 'object', additionalProperties: true } // Optional and allows any properties
    },
    required: ['nodeInfo', 'cycleMarker', 'proofOfWork', 'version', 'sign']
};

export function initJoinReq(): void {
    addSchemaDependencies()
    addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
    // No dependencies
  }

// Function to register the schema
function addSchemas(): void {
    addSchema('JoinReq', schemaJoinRequest);
  }
  