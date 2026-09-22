// BuildingId.ts
//
// Split out from BuildingTypes.ts specifically to break a real circular
// VALUE dependency between it and GateTypes.ts: GateTypes.ts's GATE_CONFIG
// references `BuildingId.Camp` (Gate1's own {type:'building', buildingId}
// requirement), while BuildingTypes.ts's BUILDING_CONFIG references
// `GateId.GateAxe` right back (its own {type:'gate', gateId}
// appearRequirement) — two config files each importing an ENUM VALUE from
// the other, not just a type. ES modules resolve imports depth-first before
// running the importing module's own top-level code, so whichever of the
// two ends up entered first (via whatever unrelated import chain happens to
// reach it first at runtime) sees the OTHER's enum as still `undefined` —
// its module body hasn't reached the `export enum` declaration yet — which
// crashes ("Cannot read properties of undefined (reading 'Camp')") the
// instant the other file's own top-level config object tries to read a
// member off it. This isn't a one-time fluke: which file wins the race can
// flip from an entirely unrelated change elsewhere in the import graph.
//
// Keeping the enum ITSELF in a leaf file with zero imports of its own
// removes the cycle at the root: GateTypes.ts now imports `BuildingId` from
// HERE, not from BuildingTypes.ts, so there's nothing left for
// BuildingTypes.ts's own import of `GateId` to circle back into.
// BuildingTypes.ts re-exports this so every EXISTING
// `import { BuildingId } from '.../BuildingTypes'` across the codebase
// keeps working completely unchanged.

export enum BuildingId {
    Camp = "tower",
    Tower2 = "tower2",
    Floor1 = "floor1",
    Stall1 = "stall1"
}
