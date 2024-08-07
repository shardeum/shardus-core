import { SQLDataTypes } from '../utils/schemaDefintions';

const networkReceipt = [
  'networkReceipt',
  {
    cycleNumber: {
      type: SQLDataTypes.STRING,
      allowNull: false,
      unique: 'compositeIndex',
    },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
];

export default networkReceipt;
