// Harness SDK state is authoritative; a stale DOM Stop button must not lock
// an already-completed conversation. The handoff service rechecks before writes.
function handoffWorkflowIdle(state, operationBusy) {
  return !operationBusy && state?.available === true && state.running === false
    && state.pending === 0 && state.approvals === 0 && state.jobs === 0 && state.turnOpen === false;
}
module.exports = { handoffWorkflowIdle };
