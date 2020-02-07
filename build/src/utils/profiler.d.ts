export = Profiler;
declare class Profiler {
    sectionTimes: {};
    profileSectionStart(sectionName: any): void;
    profileSectionEnd(sectionName: any): void;
    cleanInt(x: any): number;
    printAndClearReport(delta: any): void;
}
