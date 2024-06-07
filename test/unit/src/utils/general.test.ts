import { Utils } from '@shardus/types'
import { compareObjectShape, generateArraySchema, generateObjectSchema } from '../../../../src/utils'

test('compareObjectShape() > two identical object should return true', () => {
  const idol = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: false,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  expect(isValid).toBe(true)
  expect(error).toBe(undefined)
})

test('compareObjectShape() > should be fatal for array diversity in idol object', () => {
  expect.assertions(1)
  const idol = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      diverseArr: [1, false, 'str'],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      diverseArr: ['str', 'str', 'str'],
      id: 1,
      debug: false,
    },
  }

  try {
    compareObjectShape(idol, admirer)
  } catch (e) {
    expect(e.message).toBe('Type varies array detected inside idol object')
  }
})

test('compareObjectShape() > should detect missing property', () => {
  const idol = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      Arr: ['doe', 'doe', 'str'],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: true,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: false,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  const expectedError = {
    defectiveProp: { Arr: undefined },
    defectiveChain: ['nestedObj', 'Arr'],
  }

  expect(isValid).toBe(false)
  expect(Utils.safeStringify(expectedError) === Utils.safeStringify(error)).toBe(true)
})

test('compareObjectShape() > should detect extra props', () => {
  const idol = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    timestamp: new Date(),
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      extraProp: { id: 1, name: 'doe' },
      id: 1,
      debug: false,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  const expectedError = {
    defectiveProp: { extraProp: { id: 'number', name: 'string' } },
    defectiveChain: ['nestedObj', 'extraProp'],
  }
  expect(isValid).toBe(false)
  expect(Utils.safeStringify(expectedError) === Utils.safeStringify(error)).toBe(true)
})

test('compareObjectShape() > should return error object on property type mismatch', () => {
  const idol = {
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      timestamp: new Date(),
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      numArr: [1, 3, 4],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      timestamp: { reason: 'defector' },
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      extraProp: { id: 1, name: 'doe' },
      id: 1,
      debug: false,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  const expectedError = {
    defectiveProp: { timestamp: { reason: 'string' } },
    defectiveChain: ['nestedObj', 'timestamp'],
  }

  expect(isValid).toBe(false)
  expect(Utils.safeStringify(expectedError) === Utils.safeStringify(error)).toBe(true)
})

test('compareObjectShape() > should return error object on array type mismatch', () => {
  const idol = {
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      numArr: [1, 3, 4],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    fn: (str) => str,
    debug: false,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 'any'],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      extraProp: { id: 1, name: 'doe' },
      id: 1,
      debug: false,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  const expectedError = {
    defectiveProp: { numArr: 'any[]' },
    defectiveChain: ['nestedObj', 'numArr'],
  }

  expect(isValid).toBe(false)
  expect(Utils.safeStringify(expectedError) === Utils.safeStringify(error)).toBe(true)
})

test('compareObjectShape() > should not fail when property possess falsy value', () => {
  const idol = {
    timestamp: new Date(),
    fn: (str) => str,
    falsy: 0,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: false,
    },
  }
  const admirer = {
    timestamp: new Date(),
    fn: (str) => str,
    falsy: 20,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      id: 1,
      debug: true,
    },
  }

  const { isValid, error } = compareObjectShape(idol, admirer)

  expect(isValid).toBe(true)
  expect(error).toBe(undefined)
})

test('generateArraySchema() > should generate proper array schema', () => {
  const num = [1, 3, 2]
  const str = ['john', 'doe']
  const fn = [(str) => str]
  const instanceObj = [new Date(), new Date()]
  const literalObj = [{}, {}]
  const any = [1, false, 'doe']
  const dimensional = [
    [1, 2, 3],
    [1, 1],
  ]

  expect(generateArraySchema(num)).toBe('number[]')
  expect(generateArraySchema(str)).toBe('string[]')
  expect(generateArraySchema(fn)).toBe('function[]')
  expect(generateArraySchema(instanceObj)).toBe('object[]')
  expect(generateArraySchema(literalObj)).toBe('{}[]')
  expect(generateArraySchema(any, { diversity: true })).toBe('any[]')

  try {
    generateArraySchema(any)
  } catch (e) {
    expect(e.message).toBe(
      'Array schema generation does not allowed type diversities in an array unless specified'
    )
  }
  expect(generateArraySchema(dimensional)).toBe('array[]')
})

test('generateObjectSchema() > should generate proper object schema', () => {
  const obj = {
    timestamp: new Date(),
    fn: (str) => str,
    falsy: -0,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      diverseArr: [1, false, 'str'],
      id: 1,
      debug: true,
    },
  }

  const expectedSchema = {
    timestamp: 'object',
    fn: 'function',
    falsy: 'number',
    id: 'number',
    dummyObj: { id: 'number', name: 'string', NRC: 'string' },
    nestedObj: {
      numArr: 'number[]',
      strArr: 'string[]',
      multiDiArr: 'array[]',
      nestedArr: '{}[]',
      diverseArr: 'any[]',
      id: 'number',
      debug: 'boolean',
    },
  }

  const generatedSchema = generateObjectSchema(obj, { arrTypeDiversity: true })

  const isEqual = Utils.safeStringify(generatedSchema) === Utils.safeStringify(expectedSchema)

  expect(isEqual).toBe(true)
})
