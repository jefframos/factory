# Mining Demo Stable FIFO Fix

This version removes the fragile queue promotion logic.

Important behavior:
- Queue array is the source of truth for FIFO order.
- Visual queue slots are only visual targets.
- A worker can only start mining/depositing if:
  1. it is first in the queue,
  2. it has reached its visible queue slot,
  3. a service slot is free.
- When a worker leaves service, the next queued worker is started automatically.
- Deposit works exactly like mining: queue -> deposit spot -> timed deposit -> next.
- The collect button only collects lane storage into the persistent wallet.
- Workers deposit into lane storage automatically after mining.
- No `delta / 60`; all systems use `delta` directly.

Changed files:
- MiningDemoTypes.ts
- TextPopSystem.ts
- WorkerEntity.ts
- LaneEntity.ts
- AutonomousEntitySystem.ts
- GameEconomyStorage.ts
- BaseDemoScene.ts

Assumption:
Your scene update receives delta in seconds.
If your engine gives milliseconds, convert once before passing it here:
`const dt = delta * 0.001`.
