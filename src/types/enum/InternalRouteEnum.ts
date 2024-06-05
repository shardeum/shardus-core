export enum InternalRouteEnum {
  apoptosize = 'apoptosize', // ask & tell
  binary_broadcast_state = 'binary/broadcast_state', // tell
  binary_send_cachedAppData = 'binary/send_cachedAppData', // tell
  binary_get_account_data_with_queue_hints = 'binary/get_account_data_with_queue_hints', // ask
  binary_get_account_queue_count = 'binary/get_account_queue_count', // ask
  binary_get_account_data_by_list = 'binary/get_account_data_by_list', // ask
  binary_broadcast_finalstate = 'binary/broadcast_finalstate', // tell
  binary_get_account_data = 'binary/get_account_data', // ask
  binary_sync_trie_hashes = 'binary/sync_trie_hashes', // tell
  binary_compare_cert = 'binary/compare_cert', // ask
  binary_get_tx_timestamp = 'binary/get_tx_timestamp', // ask
  binary_get_trie_hashes = 'binary/get_trie_hashes', // ask
  binary_get_account_data_by_hashes = 'binary/get_account_data_by_hashes', // ask
  binary_spread_tx_to_group_syncing = 'binary/spread_tx_to_group_syncing', // tell
  binary_request_state_for_tx_post = 'binary/request_state_for_tx_post', // ask
  binary_make_receipt = 'binary/make_receipt', // tell
  binary_spread_appliedVoteHash = 'binary/spread_applied_vote_hash', // tell
  binary_get_globalaccountreport = 'binary/get_globalaccountreport', // ask
  binary_get_confirm_or_challenge = 'binary/get_confirm_or_challenge', // ask
  binary_sign_app_data = 'binary/sign_app_data', // ask
  binary_get_trie_account_hashes = 'binary/get_trie_account_hashes', // ask
  binary_get_cached_app_data = 'binary/get_cached_app_data', // ask
  binary_request_tx_and_state = 'binary/request_tx_and_state', // ask
  binary_lost_archiver_investigate = 'binary/lost_archiver_investigate', // tell
  binary_request_state_for_tx = 'binary/request_state_for_tx', // ask
  binary_request_receipt_for_tx = 'binary/request_receipt_for_tx', // ask
  binary_get_applied_vote = 'binary/get_applied_vote', // ask
  binary_lost_report = 'binary/lost_report', // tell
  binary_gossip = 'binary/gossip', // tell,
  binary_repair_oos_accounts = 'binary/repair_oos_accounts' // tell
}

const askRoutes = new Set([
  InternalRouteEnum.apoptosize,
  InternalRouteEnum.binary_get_account_data_with_queue_hints,
  InternalRouteEnum.binary_get_account_queue_count,
  InternalRouteEnum.binary_get_account_data_by_list,
  InternalRouteEnum.binary_get_account_data,
  InternalRouteEnum.binary_compare_cert,
  InternalRouteEnum.binary_get_tx_timestamp,
  InternalRouteEnum.binary_get_trie_hashes,
  InternalRouteEnum.binary_get_account_data_by_hashes,
  InternalRouteEnum.binary_request_state_for_tx_post,
  InternalRouteEnum.binary_get_globalaccountreport,
  InternalRouteEnum.binary_get_confirm_or_challenge,
  InternalRouteEnum.binary_sign_app_data,
  InternalRouteEnum.binary_get_trie_account_hashes,
  InternalRouteEnum.binary_get_cached_app_data,
  InternalRouteEnum.binary_request_tx_and_state,
  InternalRouteEnum.binary_request_state_for_tx,
  InternalRouteEnum.binary_request_receipt_for_tx,
  InternalRouteEnum.binary_get_applied_vote,
])

export function isAskRoute(route: string): boolean {
  return askRoutes.has(route as InternalRouteEnum)
}

export function isTellRoute(route: string): boolean {
  return !isAskRoute(route) || route === InternalRouteEnum.apoptosize
}
