const Sequelize = require('sequelize')

module.exports = [
  'accepted-tx',
  {
    txId: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    txTimestamp: { type: Sequelize.BIGINT, allowNull: false },
    txData: { type: Sequelize.TEXT, allowNull: false },
    txStatus: { type: Sequelize.STRING, allowNull: false },
    txReceipt: { type: Sequelize.STRING, allowNull: false }
  }
]

// these are the values in the documentation. converted them to naming standards
// Tx_id
// Tx_ts
// Tx_data
// Tx_status
// Tx_receipt
