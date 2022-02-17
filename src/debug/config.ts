import { ServerMode, ServerConfiguration } from "../shardus/shardus-types";
import { config } from '../p2p/Context'

export type DebugConfigurations = ServerConfiguration['debug'];

export function isDebugMode(): boolean {
    return !!(config && config.mode && config.mode.toLowerCase && config.mode.toLowerCase() === ServerMode.Debug)
}

export function isDebugModeAnd(predicate: (config: DebugConfigurations) => boolean): boolean {
    return isDebugMode() && !!predicate(config.debug || {} as Partial<DebugConfigurations>)
}
