import * as Sequelize from 'sequelize'

const networkReceipt = [
  'networkReceipt',
  {
    cycleNumber: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: 'compositeIndex',
    },
    hash: { type: Sequelize.STRING, allowNull: false },
  },
]

export default networkReceipt
