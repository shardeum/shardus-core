import { SQLDataTypes } from '../utils/schemaDefintions';

const accountsCopy = [
  'accountsCopy',
  {
    accountId: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    cycleNumber: { type: SQLDataTypes.STRING, allowNull: false, unique: 'compositeIndex' },
    data: { type: SQLDataTypes.JSON, allowNull: false },
    timestamp: { type: SQLDataTypes.BIGINT, allowNull: false },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
    isGlobal: { type: SQLDataTypes.BOOLEAN, allowNull: false },
  },
];

export default accountsCopy;
