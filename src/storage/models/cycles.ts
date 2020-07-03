import * as Sequelize from 'sequelize'
import P2PApoptosis = require('../../p2p/Apoptosis')

// dont forget to add the certificate field as JSON
const cycles = [
  'cycles',
  {
    networkId: { type: Sequelize.TEXT, allowNull: false },
    counter: {
      type: Sequelize.BIGINT,
      unique: true,
      primaryKey: true,
      allowNull: false,
    },
    safetyMode: { type: Sequelize.TEXT, allowNull: true },
    safetyNum: { type: Sequelize.BIGINT, allowNull: true },
    networkStateHash: { type: Sequelize.TEXT, allowNull: true },
    certificate: { type: Sequelize.JSON, allowNull: false },
    previous: { type: Sequelize.TEXT, allowNull: false },
    marker: { type: Sequelize.TEXT, allowNull: false },
    start: { type: Sequelize.BIGINT, allowNull: false },
    duration: { type: Sequelize.BIGINT, allowNull: false },
    active: { type: Sequelize.BIGINT, allowNull: false },
    syncing: { type: Sequelize.BIGINT, allowNull: false },
    desired: { type: Sequelize.BIGINT, allowNull: false },
    expired: { type: Sequelize.BIGINT, allowNull: false },
    joined: { type: Sequelize.JSON, allowNull: false },
    joinedArchivers: { type: Sequelize.JSON, allowNull: false },
    joinedConsensors: { type: Sequelize.JSON, allowNull: false },
    refreshedArchivers: { type: Sequelize.JSON, allowNull: false },
    refreshedConsensors: { type: Sequelize.JSON, allowNull: false },
    activated: { type: Sequelize.JSON, allowNull: false },
    activatedPublicKeys: { type: Sequelize.JSON, allowNull: false },
    removed: { type: Sequelize.JSON, allowNull: false },
    returned: { type: Sequelize.JSON, allowNull: false },
    lost: { type: Sequelize.JSON, allowNull: false },
    refuted: { type: Sequelize.JSON, allowNull: false },
    ...P2PApoptosis.sequelizeCycleFieldModel,
  },
]

export default cycles
