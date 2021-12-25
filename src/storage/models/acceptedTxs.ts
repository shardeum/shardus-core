import * as Sequelize from 'sequelize'

const acceptedTx = [
  'acceptedTxs',
  {
    txId: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    timestamp: { type: Sequelize.BIGINT, allowNull: false },
    data: { type: Sequelize.JSON, allowNull: false },
    keys: { type: Sequelize.JSON, allowNull: false },
  }
]

export default acceptedTx

// these are the values in the documentation. converted them to naming standards
// Tx_id
// Tx_ts
// Tx_data
// Tx_status
// Tx_receipt
