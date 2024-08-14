import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaCompareCert = {
  type: 'object',
  properties: {
    certs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          marker: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['marker'],
      },
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
      },
      required: ['networkId', 'counter', 'previous', 'start', 'duration', 'networkConfigHash'],
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
  addSchema(AJVSchemaEnum.CompareCertReq, schemaCompareCert)
}
