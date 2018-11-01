const Sequelize = require('sequelize')

module.exports = [
  'nodes',
  {
    id: { type: Sequelize.TEXT, allowNull: false, primaryKey: true},
    ip: Sequelize.STRING,
    internalPort: Sequelize.SMALLINT,
    externalPort: Sequelize.SMALLINT,
    joinRequestTimestamp: Sequelize.BIGINT,
    address: Sequelize.STRING
  }
]
