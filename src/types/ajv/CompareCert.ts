import { addSchema } from '../../utils/serialization/SchemaHelpers'

const schemaCompareCert = {
  type: 'object',
  properties: {
    certs: {
      type: 'array',
      items: { type: 'object' },
      properties: {
        marker: { type: 'string' },
        score: { type: 'number' },
      },
      required: ['marker'],
    },
    record: {
      type: 'object',
      properties: {
        activated: { type: 'array', items: { type: 'string' } },
        activatedPublicKeys: { type: 'array', items: { type: 'string' } },
        active: { type: 'number' },
        apoptosized: { type: 'array', items: { type: 'string' } },
        counter: { type: 'number' },
        desired: { type: 'number' },
        duration: { type: 'number' },
        expired: { type: 'number' },
        joined: { type: 'array', items: { type: 'string' } },
        joinedArchivers: { type: 'array', items: true },
        joinedConsensors: { type: 'array', items: true },
        lost: { type: 'array', items: { type: 'string' } },
        previous: { type: 'string' },
        refreshedArchivers: { type: 'array', items: true },
        refreshedConsensors: { type: 'array', items: true },
        refuted: { type: 'array', items: { type: 'string' } },
        removed: { type: 'array', items: { type: 'string' } },
        start: { type: 'number' },
        syncing: { type: 'number' },
      },
      required: [
        'activated',
        'activatedPublicKeys',
        'active',
        'apoptosized',
        'counter',
        'desired',
        'duration',
        'expired',
        'joined',
        'joinedArchivers',
        'joinedConsensors',
        'lost',
        'previous',
        'refreshedArchivers',
        'refreshedConsensors',
        'refuted',
        'removed',
        'start',
        'syncing',
      ],
      additionalProperties: true,
    },
  },
  required: ['certs', 'record'],
}

export function initCompareCertReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('CompareCertReq', schemaCompareCert)
}
