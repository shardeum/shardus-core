import * as Sequelize from 'sequelize'

const networkSummary = [
  'networkSummary',
  {
    cycleNumber: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: 'compositeIndex',
    },
    hash: { type: Sequelize.STRING, allowNull: false },
  },
]

export default networkSummary
