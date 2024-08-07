import { SQLDataTypes } from '../utils/schemaDefintions';

const network = [
  'network',
  {
    cycleNumber: {
      type: SQLDataTypes.STRING,
      allowNull: false,
      unique: 'compositeIndex',
    },
    hash: { type: SQLDataTypes.STRING, allowNull: false },
  },
];

export default network;
