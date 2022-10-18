import * as Sequelize from 'sequelize'

const receipt = [
  'receipt',
  {
    partitionId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
    cycleNumber: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
    hash: { type: Sequelize.STRING, allowNull: false },
  },
]

export default receipt
