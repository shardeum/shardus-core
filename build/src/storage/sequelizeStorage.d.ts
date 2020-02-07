export = SequelizeStorage;
declare class SequelizeStorage {
    constructor(models: any, storageConfig: any, logger: any, baseDir: any, profiler: any);
    baseDir: any;
    models: any;
    storageConfig: any;
    profiler: any;
    mainLogger: any;
    init(): Promise<void>;
    sequelize: any;
    storageModels: any;
    initialized: boolean | undefined;
    close(): Promise<void>;
    dropAndCreateModel(model: any): Promise<void>;
    _checkInit(): void;
    _create(table: any, values: any, opts: any): any;
    _read(table: any, where: any, opts: any): any;
    _update(table: any, values: any, where: any, opts: any): any;
    _delete(table: any, where: any, opts: any): any;
    _rawQuery(table: any, query: any): any;
}
