declare function _exports(config?: {}): ServerStartUtils;
export = _exports;
declare class ServerStartUtils {
    constructor(config?: {});
    baseDir: string;
    instanceDir: string;
    instanceNames: string;
    serverPath: string;
    Shardus: any;
    models: any;
    verbose: boolean;
    defaultConfigs: any;
    servers: {};
    setInstanceNames(name: any): void;
    setDefaultConfig(changes?: {}): void;
    setServerConfig(port: any, changes?: {}): Promise<void>;
    startServer(extPort?: any, intPort?: any, successFn?: any, changes?: any, outputToFile?: boolean, instance?: boolean): Promise<any>;
    startServerInstance(extPort?: any, intPort?: any, successFn?: string, changes?: any, outputToFile?: boolean): Promise<any>;
    stopServer(port: any): Promise<any>;
    deleteServer(port: any): Promise<void>;
    startServers(num: any, extPort?: any, intPort?: any, successFn?: string, changes?: any, outputToFile?: boolean, instance?: boolean, wait?: number): Promise<{}>;
    startAllStoppedServers(changes?: any, outputToFile?: boolean, instance?: boolean): Promise<void>;
    stopAllServers(): Promise<void>;
    deleteAllServers(): Promise<void>;
    getRequests(port: any): Promise<void | any[]>;
    getState(port: any): Promise<void | {}>;
    _log(...params: any[]): void;
}
