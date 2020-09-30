import * as Sequelize from 'sequelize'

const summary = [
    'summary',
    {
        partitionId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
        cycleNumber: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
        hash: { type: Sequelize.STRING, allowNull: false }
    }
]

export default summary