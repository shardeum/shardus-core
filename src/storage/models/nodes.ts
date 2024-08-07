import { SQLDataTypes } from '../utils/schemaDefintions';

const nodes = [
  'nodes',
  {
    id: { type: SQLDataTypes.TEXT, allowNull: false, primaryKey: true },
    publicKey: { type: SQLDataTypes.TEXT, allowNull: false },
    curvePublicKey: { type: SQLDataTypes.TEXT, allowNull: false },
    cycleJoined: { type: SQLDataTypes.TEXT, allowNull: false },
    internalIp: { type: SQLDataTypes.STRING, allowNull: false },
    externalIp: { type: SQLDataTypes.STRING, allowNull: false },
    internalPort: { type: SQLDataTypes.SMALLINT, allowNull: false },
    externalPort: { type: SQLDataTypes.SMALLINT, allowNull: false },
    joinRequestTimestamp: { type: SQLDataTypes.BIGINT, allowNull: false },
    activeTimestamp: { type: SQLDataTypes.BIGINT, allowNull: false },
    address: { type: SQLDataTypes.STRING, allowNull: false },
    status: { type: SQLDataTypes.STRING, allowNull: false },
  },
];

export default nodes;
