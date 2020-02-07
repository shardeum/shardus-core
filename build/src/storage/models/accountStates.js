"use strict";
const Sequelize = require('sequelize');
module.exports = [
    'accountStates',
    {
        accountId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
        txId: { type: Sequelize.STRING, allowNull: false },
        txTimestamp: { type: Sequelize.BIGINT, allowNull: false, unique: 'compositeIndex' },
        stateBefore: { type: Sequelize.STRING, allowNull: false },
        stateAfter: { type: Sequelize.STRING, allowNull: false }
    }
];
// these are the values in the documentation. converted them to naming standards
// Acc_id
// Tx_id
// Tx_ts
// State_before
// State_after
//# sourceMappingURL=accountStates.js.map