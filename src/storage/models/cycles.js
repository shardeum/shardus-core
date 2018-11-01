const Sequelize = require('sequelize')

module.exports = [
  'cycles',
  {
    counter: Sequelize.BIGINT,
    marker: Sequelize.TEXT,
    active: Sequelize.BIGINT,
    desired: Sequelize.BIGINT,
    joined: Sequelize.JSON,
    removed: Sequelize.JSON,
    returned: Sequelize.JSON,
    lost: Sequelize.JSON
  }
]
