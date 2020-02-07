"use strict";
const Sequelize = require('sequelize');
// dont forget to add the certificate field as JSON
module.exports = [
    'cycles',
    {
        counter: { type: Sequelize.BIGINT, unique: true, primaryKey: true, allowNull: false },
        certificate: { type: Sequelize.JSON, allowNull: false },
        previous: { type: Sequelize.TEXT, allowNull: false },
        marker: { type: Sequelize.TEXT, allowNull: false },
        start: { type: Sequelize.BIGINT, allowNull: false },
        duration: { type: Sequelize.BIGINT, allowNull: false },
        active: { type: Sequelize.BIGINT, allowNull: false },
        desired: { type: Sequelize.BIGINT, allowNull: false },
        expired: { type: Sequelize.BIGINT, allowNull: false },
        joined: { type: Sequelize.JSON, allowNull: false },
        joinedArchivers: { type: Sequelize.JSON, allowNull: false },
        joinedConsensors: { type: Sequelize.JSON, allowNull: false },
        activated: { type: Sequelize.JSON, allowNull: false },
        activatedPublicKeys: { type: Sequelize.JSON, allowNull: false },
        removed: { type: Sequelize.JSON, allowNull: false },
        returned: { type: Sequelize.JSON, allowNull: false },
        lost: { type: Sequelize.JSON, allowNull: false },
        refuted: { type: Sequelize.JSON, allowNull: false },
        apoptosized: { type: Sequelize.JSON, allowNull: false }
    }
];
//# sourceMappingURL=cycles.js.map