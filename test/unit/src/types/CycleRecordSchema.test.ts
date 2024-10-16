import Ajv from 'ajv';
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers';
import validCycleRecord from '../../../../test/data/validCycleRecord.json'
import { schemaCycleRecordArray } from '../../../../src/types/ajv/CycleRecordSchema'

describe('CycleRecord Schema Tests', () => {
  let ajv

  beforeAll(() => {
    ajv = new Ajv()
    initAjvSchemas()
  });

  describe('AJV Schema Validation Tests', () => {
    test('Validate valid CycleRecord JSON', () => {
      const validate = ajv.compile(schemaCycleRecordArray)
      const isValid = validate(validCycleRecord.cycleInfo)
      if (!isValid) {
        console.error(validate.errors)
      }
      expect(isValid).toBe(true)
    });

    test('Fail on invalid CycleRecord JSON', () => {
      const invalidCycleRecord = { ...validCycleRecord }
      delete invalidCycleRecord.cycleInfo[0].networkId

      const validate = ajv.compile(schemaCycleRecordArray)
      const isValid = validate(invalidCycleRecord.cycleInfo)

      expect(isValid).toBe(false)
      expect(validate.errors).toBeDefined()
    });
  });
});
