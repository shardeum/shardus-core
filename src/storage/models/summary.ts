import { SQLDataTypes } from '../utils/schemaDefintions'

const summary = [
  'summary',
  {
    partitionId: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    cycleNumber: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
]

export default summary
