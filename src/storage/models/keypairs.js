const Sequelize = require('sequelize')

module.exports = [
  'keypairs',
  {
    publicKey: Sequelize.STRING,
    secretKey: Sequelize.STRING
  }
]
