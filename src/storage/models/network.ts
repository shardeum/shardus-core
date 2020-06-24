import * as Sequelize from 'sequelize'

const network = [
    'network',
    {
        cycleNumber: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
        hash: { type: Sequelize.STRING, allowNull: false }
    }
]

export default network