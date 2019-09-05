const Sequelize = require('sequelize')

module.exports = [
  'nodes',
  {
    id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
    publicKey: { type: Sequelize.TEXT, allowNull: false },
    curvePublicKey: { type: Sequelize.TEXT, allowNull: false },
    cycleJoined: { type: Sequelize.TEXT, allowNull: false },
    internalIp: { type: Sequelize.STRING, allowNull: false },
    externalIp: { type: Sequelize.STRING, allowNull: false },
    internalPort: { type: Sequelize.SMALLINT, allowNull: false },
    externalPort: { type: Sequelize.SMALLINT, allowNull: false },
    joinRequestTimestamp: { type: Sequelize.BIGINT, allowNull: false },
    activeTimestamp: { type: Sequelize.BIGINT, allowNull: false },
    address: { type: Sequelize.STRING, allowNull: false },
    status: { type: Sequelize.STRING, allowNull: false }
  }
]
