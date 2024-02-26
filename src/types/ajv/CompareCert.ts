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
        networkId: { type: 'string' },
        counter: { type: 'number' },
        previous: { type: 'string' },
        start: { type: 'number' },
        duration: { type: 'number' },
        networkConfigHash: { type: 'string' },
        joined: { type: 'array', items: { type: 'string' } },
        returned: { type: 'array', items: { type: 'string' } },
        lost: { type: 'array', items: { type: 'string' } },
        refuted: { type: 'array', items: { type: 'string' } },
        appRemoved: { type: 'array', items: { type: 'string' } },
        apoptosized: { type: 'array', items: { type: 'string' } },
        nodeListHash: { type: 'string' },
        archiverListHash: { type: 'string' },
        standbyNodeListHash: { type: 'string' },
        mode: {type: 'string'}

      },
      required: [
        'networkId',
        'counter',
        'previous',
        'start',
        'duration',
        'networkConfigHash',
        'joined',
        'returned',
        'lost',
        'refuted',
        'appRemoved',
        'apoptosized',
        'nodeListHash',
        'archiverListHash',
        'standbyNodeListHash',
        'mode'
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
