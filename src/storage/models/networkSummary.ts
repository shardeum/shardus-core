import { SQLDataTypes } from '../utils/schemaDefintions'

const networkSummary = [
  'networkSummary',
  {
    cycleNumber: {
      type: SQLDataTypes.STRING,
      allowNull: false,
      unique: 'compositeIndex',
    },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
]

export default networkSummary
