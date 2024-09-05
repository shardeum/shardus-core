import { addSchema, addSchemaDependency } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

// AJV Schema for CycleRecord
let schemaCycleRecord: object | undefined = {
  type: 'object',
  properties: {
    networkId: { type: 'string' },
    counter: { type: 'number' },
    previous: { type: 'string' },
    start: { type: 'number' },
    duration: { type: 'number' },
    networkConfigHash: { type: 'string' },
    mode: {
      type: 'string',
      enum: ['forming', 'processing', 'safety', 'recovery', 'restart', 'restore', 'shutdown'],
    },
    safetyMode: { type: 'boolean' },
    safetyNum: { type: 'number' },
    networkStateHash: { type: 'string' },
    refreshedArchivers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          ip: { type: 'string' },
          port: { type: 'number' },
          curvePk: { type: 'string' },
        },
        required: ['publicKey', 'ip', 'port', 'curvePk'],
      },
    },
    refreshedConsensors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          externalIp: { type: 'string' },
          externalPort: { type: 'number' },
          internalIp: { type: 'string' },
          internalPort: { type: 'number' },
          address: { type: 'string' },
          joinRequestTimestamp: { type: 'number' },
          activeTimestamp: { type: 'number' },
          activeCycle: { type: 'number' },
          syncingTimestamp: { type: 'number' },
          readyTimestamp: { type: 'number' },
          refreshedCounter: { type: 'number' },
          curvePublicKey: { type: 'string' },
          status: {
            type: 'string',
            enum: ['initializing', 'standby', 'selected', 'syncing', 'ready', 'active'],
          },
        },
        required: [
          'publicKey',
          'externalIp',
          'externalPort',
          'internalIp',
          'internalPort',
          'address',
          'joinRequestTimestamp',
          'activeTimestamp',
          'activeCycle',
          'syncingTimestamp',
          'readyTimestamp',
        ],
      },
    },
    activated: { type: 'array', items: { type: 'string' } },
    activatedPublicKeys: { type: 'array', items: { type: 'string' } },
    active: { type: 'number' },
    apoptosized: { type: 'array', items: { type: 'string' } },
    appRemoved: { type: 'array', items: { type: 'string' } },
    archiverListHash: { type: 'string' },
    expired: { type: 'number' },
    finishedSyncing: { type: 'array', items: { type: 'string' } },
    joined: { type: 'array', items: { type: 'string' } },
    joinedArchivers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          ip: { type: 'string' },
          port: { type: 'number' },
          curvePk: { type: 'string' },
        },
        required: ['publicKey', 'ip', 'port', 'curvePk'],
      },
    },
    joinedConsensors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cycleJoined: { type: 'string' },
          counterRefreshed: { type: 'number' },
          id: { type: 'string' },
        },
      },
    },
    leavingArchivers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          ip: { type: 'string' },
          port: { type: 'number' },
          curvePk: { type: 'string' },
        },
        required: ['publicKey', 'ip', 'port', 'curvePk'],
      },
    },
    archiversAtShutdown: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          ip: { type: 'string' },
          port: { type: 'number' },
          curvePk: { type: 'string' },
        },
        required: ['publicKey', 'ip', 'port', 'curvePk'],
      },
    },
    lost: { type: 'array', items: { type: 'string' } },
    lostAfterSelection: { type: 'array', items: { type: 'string' } },
    lostArchivers: { type: 'array', items: { type: 'string' } },
    lostSyncing: { type: 'array', items: { type: 'string' } },
    marker: { type: 'string' },
    maxSyncTime: { type: 'number' },
    nodeListHash: { type: 'string' },
    refuted: { type: 'array', items: { type: 'string' } },
    refutedArchivers: { type: 'array', items: { type: 'string' } },
    removed: { type: 'array', items: { type: 'string' } },
    removedArchivers: { type: 'array', items: { type: 'string' } },
    returned: { type: 'array', items: { type: 'string' } },
    standby: { type: 'number' },
    standbyAdd: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          appJoinData: { type: 'object', additionalProperties: true },
          cycleMarker: { type: 'string' },
          nodeInfo: {
            type: 'object',
            properties: {
              publicKey: { type: 'string' },
              externalIp: { type: 'string' },
              externalPort: { type: 'number' },
              internalIp: { type: 'string' },
              internalPort: { type: 'number' },
              joinRequestTimestamp: { type: 'number' },
              readyTimestamp: { type: 'number' },
              address: { type: 'string' },
              activeTimestamp: { type: 'number' },
              syncingTimestamp: { type: 'number' },
              activeCycle: { type: 'number' },
              refreshedCounter: { type: 'number' },
            },
            required: [
              'publicKey',
              'externalIp',
              'externalPort',
              'internalIp',
              'internalPort',
              'activeTimestamp',
              'syncingTimestamp',
              'activeCycle',
              'joinRequestTimestamp',
              'address',
            ],
          },
          proofOfWork: { type: 'string' },
          selectionNum: { type: 'string' },
          sign: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              sig: { type: 'string' },
            },
            required: ['owner', 'sig'],
          },
          version: { type: 'string' },
        },
        required: [
          'appJoinData',
          'cycleMarker',
          'nodeInfo',
          'proofOfWork',
          'selectionNum',
          'sign',
          'version',
        ],
      },
    },
    standbyNodeListHash: { type: 'string' },
    standbyRefresh: { type: 'array', items: { type: 'string' } },
    standbyRemove: { type: 'array', items: { type: 'string' } },
    startedSyncing: { type: 'array', items: { type: 'string' } },
    syncing: { type: 'number' },
    target: { type: 'number' },
    desired: { type: 'number' },
    random: { type: 'number' },
    networkDataHash: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cycle: { type: 'number' },
          hash: { type: 'string' },
        },
      },
    },
    networkReceiptHash: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cycle: { type: 'number' },
          hash: { type: 'string' },
        },
      },
    },
    networkSummaryHash: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cycle: { type: 'number' },
          hash: { type: 'string' },
        },
      },
    },
    // Adding ServiceQueue.Record properties
    txadd: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hash: { type: 'string' },
          type: { type: 'string' },
          txData: { type: 'object' },
          cycle: { type: 'number' },
          priority: { type: 'number' },
          subQueueKey: { type: 'string' },
        },
        required: ['hash', 'type', 'txData', 'cycle'],
      },
    },
    txremove: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          txHash: { type: 'string' },
          cycle: { type: 'number' },
        },
        required: ['txHash', 'cycle'],
      },
    },
    txlisthash: { type: 'string' },
  },
  required: [
    'networkId',
    'counter',
    'previous',
    'start',
    'duration',
    'networkConfigHash',
    'mode',
    'refreshedArchivers',
    'refreshedConsensors',
    'activated',
    'activatedPublicKeys',
    'active',
    'apoptosized',
    'appRemoved',
    'archiverListHash',
    'expired',
    'joined',
    'joinedArchivers',
    'joinedConsensors',
    'leavingArchivers',
    'lost',
    'lostArchivers',
    'lostSyncing',
    'maxSyncTime',
    'nodeListHash',
    'refuted',
    'refutedArchivers',
    'removed',
    'removedArchivers',
    'returned',
    'standby',
    'standbyNodeListHash',
    'syncing',
    'target',
    'desired',
    'random',
    'txadd',
    'txremove',
    'txlisthash',
  ],
}

// AJV Schema for an Array of CycleRecords
export let schemaCycleRecordArray: object | undefined = {
  type: 'array',
  items: schemaCycleRecord
};

export function initCycleRecords(): void {
  addSchemaDependencies()
  addSchemas()
}

// Add Schema Dependencies
export function addSchemaDependencies(): void {}

// Add Schema
export function addSchemas(): void {
  addSchema(AJVSchemaEnum.CycleRecords, schemaCycleRecordArray)
}
