export = Debug;
declare class Debug {
    constructor(baseDir: any, network: any);
    baseDir: any;
    network: any;
    archiveName: string;
    files: {};
    addToArchive(src: any, dest: any): void;
    createArchiveStream(): any;
    _registerRoutes(): void;
}
