export = generateContext;
declare function generateContext(seed: any): false | {
    rand: () => number;
    randomInt: (min: any, max: any) => any;
};
declare namespace generateContext {
    export { generateSeed };
}
declare function generateSeed(): any;
