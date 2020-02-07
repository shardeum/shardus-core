"use strict";
const Sequelize = require('sequelize');
module.exports = [
    'acceptedTxs',
    {
        id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
        timestamp: { type: Sequelize.BIGINT, allowNull: false },
        data: { type: Sequelize.JSON, allowNull: false },
        status: { type: Sequelize.STRING, allowNull: false },
        receipt: { type: Sequelize.JSON, allowNull: false }
    }
];
// these are the values in the documentation. converted them to naming standards
// Tx_id
// Tx_ts
// Tx_data
// Tx_status
// Tx_receipt
//# sourceMappingURL=acceptedTxs.js.map