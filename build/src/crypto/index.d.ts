export = Crypto;
declare class Crypto {
    constructor(config: any, logger: any, storage: any);
    config: any;
    mainLogger: any;
    storage: any;
    keypair: {};
    curveKeypair: {};
    powGenerators: {};
    sharedKeys: {};
    init(): Promise<void>;
    _generateKeypair(): any;
    convertPublicKeyToCurve(pk: any): any;
    getPublicKey(): any;
    getCurvePublicKey(): any;
    getSharedKey(curvePk: any): any;
    tag(obj: any, recipientCurvePk: any): any;
    authenticate(obj: any, senderCurvePk: any): any;
    sign(obj: any): any;
    verify(obj: any, expectedPk: any): any;
    hash(obj: any): any;
    isGreaterHash(hash1: any, hash2: any): boolean;
    getComputeProofOfWork(seed: any, difficulty: any): Promise<any>;
    stopAllGenerators(): void;
    _runProofOfWorkGenerator(generator: any, seed: any, difficulty: any): Promise<any>;
    _stopProofOfWorkGenerator(generator: any): Promise<any>;
}
