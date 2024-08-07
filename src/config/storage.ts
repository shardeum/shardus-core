import { StrictStorageConfiguration } from '../shardus/shardus-types';

const STORAGE_CONFIG: StrictStorageConfiguration = {
  database: 'database',
  username: 'username',
  password: 'password',
  options: {
    logging: false,
    host: 'localhost',
    dialect: 'sqlite',
    operatorsAliases: false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
    storage: 'db/db.sqlite',
    sync: { force: false },
    memoryFile: false,
    saveOldDBFiles: false,
    walMode: true,
    exclusiveLockMode: true,
  },
};

export default STORAGE_CONFIG;
