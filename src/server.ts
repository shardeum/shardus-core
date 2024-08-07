import { join, resolve } from 'path';

import Shardus from './shardus';
import { readJSONDir } from './utils';

const baseDirPath = resolve(process.argv[2] || './');

// if configs exist in baseDir, use them
// if not, use default configs
let config;
try {
  config = readJSONDir(join(baseDirPath, 'config'));
  if (Object.keys(config).length === 0 && config.constructor === Object) throw new Error('Empty configs');
} catch (e) {
  config = readJSONDir(join(__dirname, 'config'));
}
config.server.baseDir = baseDirPath;

const shardus = new Shardus(config);

async function init(): Promise<void> {
  shardus.setup(null);
  await shardus.start();
  shardus.registerExceptionHandler();
}

init();
