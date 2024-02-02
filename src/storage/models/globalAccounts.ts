import { SQLDataTypes } from '../utils/schemaDefintions'

const globalAccounts = [
  'globalAccounts',
  {
    accountId: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    cycleNumber: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    data: { type: SQLDataTypes.JSON, allowNull: false },
    timestamp: { type: SQLDataTypes.BIGINT, allowNull: false },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
]

export default globalAccounts
