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
    mode: { type: Sequelize.TEXT, allowNull: true },
    safetyMode: { type: Sequelize.TEXT, allowNull: true },
    safetyNum: { type: Sequelize.BIGINT, allowNull: true },
    networkStateHash: { type: Sequelize.TEXT, allowNull: true },
    networkDataHash: { type: Sequelize.JSON, allowNull: true },
    networkReceiptHash: { type: Sequelize.JSON, allowNull: true },
    networkSummaryHash: { type: Sequelize.JSON, allowNull: true },
    certificate: { type: Sequelize.JSON, allowNull: false },
    previous: { type: Sequelize.TEXT, allowNull: false },
    marker: { type: Sequelize.TEXT, allowNull: false },
    start: { type: Sequelize.BIGINT, allowNull: false },
    duration: { type: Sequelize.BIGINT, allowNull: false },
    networkConfigHash: { type: Sequelize.TEXT, allowNull: true },
    maxSyncTime: { type: Sequelize.BIGINT, allowNull: true },
    active: { type: Sequelize.BIGINT, allowNull: false },
    syncing: { type: Sequelize.BIGINT, allowNull: false },
    desired: { type: Sequelize.BIGINT, allowNull: false },
    expired: { type: Sequelize.BIGINT, allowNull: false },
    joined: { type: Sequelize.JSON, allowNull: false },
    joinedArchivers: { type: Sequelize.JSON, allowNull: false },
    leavingArchivers: { type: Sequelize.JSON, allowNull: false },
    joinedConsensors: { type: Sequelize.JSON, allowNull: false },
    refreshedArchivers: { type: Sequelize.JSON, allowNull: false },
    refreshedConsensors: { type: Sequelize.JSON, allowNull: false },
    activated: { type: Sequelize.JSON, allowNull: false },
    activatedPublicKeys: { type: Sequelize.JSON, allowNull: false },
    removed: { type: Sequelize.JSON, allowNull: false },
    returned: { type: Sequelize.JSON, allowNull: false },
    lost: { type: Sequelize.JSON, allowNull: false },
    lostSyncing: { type: Sequelize.JSON, allowNull: false },
    refuted: { type: Sequelize.JSON, allowNull: false },
    nodeListHash: { type: Sequelize.TEXT, allowNull: false },
    archiverListHash: { type: Sequelize.TEXT, allowNull: false },
    ...P2PApoptosis.sequelizeCycleFieldModel,
  },
]

export default cycles
