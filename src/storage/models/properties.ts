const Sequelize = require('sequelize')

export default [
  'properties',
  {
    key: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    value: Sequelize.JSON
  }
]
