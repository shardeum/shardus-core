import { Sequelize } from 'sequelize'

const accountStates = [
  'accountStates',
  {
    accountId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
    txId: { type: Sequelize.STRING, allowNull: false },
    txTimestamp: { type: Sequelize.BIGINT, allowNull: false, unique: 'compositeIndex' },
    stateBefore: { type: Sequelize.STRING, allowNull: false },
    stateAfter: { type: Sequelize.STRING, allowNull: false }
  }
]

export default accountStates

// these are the values in the documentation. converted them to naming standards
// Acc_id
// Tx_id
// Tx_ts
// State_before
// State_after
