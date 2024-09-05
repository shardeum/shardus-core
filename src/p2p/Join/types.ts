export interface JoinRequestResponse {
  /** Whether the join request was accepted. TODO: consider renaming to `accepted`? */
  success: boolean

  /** A message explaining the result of the join request. */
  reason: string

  /** Whether the join request could not be accepted due to some error, usually in validating a join request. TODO: consider renaming to `invalid`? */
  fatal: boolean
}
