# Lane System Refactor

This package is based on the uploaded source files and refactors the mining demo into:

```txt
BaseDemoScene
  TextPopSystem
  LaneManager
    LaneEntity
      LaneView
      WorkerEntity[]
```

## Main changes

- Lane positions are now local to each lane.
- `LaneDefinition` no longer uses `entranceX`, `miningX`, `depositX`, etc.
- Layout is handled by `LaneLayoutDefinition`.
- `LaneView` owns all visual/local lane positions.
- `LaneEntity` owns the simulation and its `LaneView`.
- `LaneManager` stacks lanes vertically and handles lane unlock cost progression.
- Multiple lane resource types are supported.
- Economy supports `gold`, `iron`, `coal`, and `crystal`.
- Mining popup shows one-second mining ticks plus the final remainder.
- Queue behavior is preserved from the latest stable version.

## Delta assumption

All update methods expect `delta` in seconds.

If your engine passes milliseconds, convert once before calling this system:

```ts
const dt = delta * 0.001;
```

Do not use `delta / 60`.
