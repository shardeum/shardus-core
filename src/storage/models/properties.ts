import { SQLDataTypes } from '../utils/schemaDefintions'

const properties = [
  'properties',
  {
    key: { type: SQLDataTypes.STRING, allowNull: false, primaryKey: true },
    value: SQLDataTypes.JSON,
  },
]

export default properties
