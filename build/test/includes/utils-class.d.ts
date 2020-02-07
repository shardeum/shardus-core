export function getInstances(loggerConf?: any, externalPort?: any): Promise<{
    storage: import("../../src/storage");
    logger: import("../../src/logger");
    crypto: import("../../src/crypto");
    p2p: any;
    newConfStorage: any;
}>;
