const Sequelize = require('sequelize')

module.exports = [
  'nodes',
  {
    id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true },
    internalIp: Sequelize.STRING,
    externalIp: Sequelize.STRING,
    internalPort: Sequelize.SMALLINT,
    externalPort: Sequelize.SMALLINT,
    joinRequestTimestamp: Sequelize.BIGINT,
    address: Sequelize.STRING
  }
]
