export enum InternalRouteEnum {
  apoptosize = 'apoptosize', // ask & tell
  binary_broadcast_state = 'binary/broadcast_state', // tell
  binary_send_cachedAppData = 'binary/send_cachedAppData', // tell
  binary_get_account_data_with_queue_hints = 'binary/get_account_data_with_queue_hints', // ask
  binary_get_account_queue_count = 'binary/get_account_queue_count', // ask
  binary_get_account_data_by_list = 'binary/get_account_data_by_list', // ask
  binary_broadcast_finalstate = 'binary/broadcast_finalstate', // tell
}
