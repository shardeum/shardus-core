export = Sqlite3Storage;
declare class Sqlite3Storage {
    constructor(models: any, storageConfig: any, logger: any, baseDir: any, profiler: any);
    baseDir: any;
    storageConfig: any;
    profiler: any;
    mainLogger: any;
    initialized: boolean;
    storageModels: {};
    sqlite3Define(modelName: any, modelAttributes: any): void;
    init(): Promise<void>;
    db: any;
    close(): Promise<void>;
    runCreate(createStatement: any): Promise<void>;
    dropAndCreateModel(model: any): Promise<void>;
    _checkInit(): void;
    _create(table: any, object: any, opts: any): Promise<any> | undefined;
    _read(table: any, params: any, opts: any): Promise<any>;
    _update(table: any, values: any, where: any, opts: any): Promise<any>;
    _delete(table: any, where: any, opts: any): Promise<any>;
    _rawQuery(queryString: any, valueArray: any): Promise<any>;
    params2Array(paramsObj: any, table: any): {
        name: string;
    }[];
    paramsToWhereStringAndValues(paramsArray: any): {
        whereString: string;
        whereValueArray: any[];
    };
    paramsToAssignmentStringAndValues(paramsArray: any): {
        resultString: string;
        valueArray: any[];
    };
    options2string(optionsObj: any): string;
    run(sql: any, params?: any[]): Promise<any>;
    get(sql: any, params?: any[]): Promise<any>;
    all(sql: any, params?: any[]): Promise<any>;
}
