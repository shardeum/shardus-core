export = ExitHandler;
declare class ExitHandler {
    exited: boolean;
    syncFuncs: Map<any, any>;
    asyncFuncs: Map<any, any>;
    registerSync(who: any, func: any): void;
    registerAsync(who: any, func: any): void;
    _cleanupAsync(): Promise<void>;
    _cleanupSync(): void;
    exitCleanly(exitProcess?: boolean): Promise<void>;
    addSigListeners(sigint?: boolean, sigterm?: boolean): void;
}
