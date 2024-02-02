import { SQLDataTypes } from '../utils/schemaDefintions'

const receipt = [
  'receipt',
  {
    partitionId: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    cycleNumber: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
]

export default receipt
