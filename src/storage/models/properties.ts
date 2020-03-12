import { Sequelize } from 'sequelize'

const properties = [
  'properties',
  {
    key: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    value: Sequelize.JSON
  }
]

export default properties