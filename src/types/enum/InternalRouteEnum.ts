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
}
