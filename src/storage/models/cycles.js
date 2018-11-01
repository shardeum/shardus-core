const Sequelize = require('sequelize')

module.exports = [
  'cycles',
  {
    certificate: { type: Sequelize.JSON, allowNull: false },
    previous: { type: Sequelize.TEXT, allowNull: false },
    marker: { type: Sequelize.TEXT, allowNull: false },
    counter: { type: Sequelize.BIGINT, unique: true, primaryKey: true, allowNull: false },
    time: { type: Sequelize.BIGINT, allowNull: false },
    active: { type: Sequelize.BIGINT, allowNull: false },
    desired: { type: Sequelize.BIGINT, allowNull: false },
    joined: { type: Sequelize.JSON, allowNull: false },
    removed: { type: Sequelize.JSON, allowNull: false },
    returned: { type: Sequelize.JSON, allowNull: false },
    lost: { type: Sequelize.JSON, allowNull: false }
  }
]
