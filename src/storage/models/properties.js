const Sequelize = require('sequelize')

module.exports = [
  'properties',
  {
    key: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    value: Sequelize.JSON
  }
]
