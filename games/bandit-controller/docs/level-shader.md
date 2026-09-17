## Goal

Create a **curved-world / bending-world shader effect** similar to the visual feeling used by games such as Subway Surfers.

The game world should still be constructed from normal, straight 3D geometry, but when rendered it should appear as though the **entire world curves or bends into the distance**.

The important visual characteristic is:

* Objects close to the camera remain almost completely normal.
* Objects farther away progressively bend.
* The distant environment should appear to follow a large, smooth arc rather than continuing as a perfectly straight line.
* The effect should feel like the **world itself is curved**, not like individual objects are being rotated independently.
* All objects participating in the effect should bend consistently, so the track, obstacles, scenery, etc. remain visually connected.
* The player's immediate surroundings should have very little distortion.

## Shader Concept

The effect should be implemented primarily as a **vertex deformation**.

For every vertex, determine its distance/depth relative to the camera or the game's forward direction.

Use that depth to calculate a bend amount.

Conceptually:

```text
bendAmount = depth² × curvature
```

Then use `bendAmount` to offset the vertex.

The squared depth is important because it makes the effect subtle near the camera and increasingly strong farther away.

Conceptually:

```text
near camera
    |
    |   almost no deformation
    |
    |      slight deformation
    |
    |          more deformation
    |
    |               strong deformation
    |
    |                    /
    |                  /
    |                /
    |              /
    +------------/
              distance
```

The exact axis and deformation direction depend on the game's coordinate system.

## Desired Behaviour

The curvature should be controlled by a uniform such as:

```text
uBendStrength
```

Changing this value should smoothly transition between:

```text
0       = completely straight world
small   = subtle curvature
medium  = clearly curved
large   = exaggerated arcade-style bending
```

The shader should ideally also have a configurable **bend origin/reference point**, so the deformation can be calculated relative to the camera/player rather than being tied permanently to world coordinates.

## Important Visual Requirement

Do **not** bend each object around its own origin.

For example, if there are several boxes along a road:

```text
BAD:

box → bend around its own center
box → bend around its own center
box → bend around its own center
```

Instead, every vertex should be deformed according to its position in the **global world/track space**:

```text
GOOD:

camera
  |
  | box
  |
  |    box
  |
  |         box
  |
  |              box
  |
  |                    box
  |
  +-------------------------->

all vertices follow the same global curvature
```

This makes the road, objects, scenery and other geometry appear to belong to the same curved world.

## Smoothness

The deformation should be continuous and smooth.

Avoid a hard transition between curved and uncurved areas.

A useful approach is to calculate normalized depth and optionally apply a smoothstep/falloff before applying the bend.

For example, conceptually:

```text
depth
  ↓
normalize
  ↓
smooth falloff
  ↓
bend calculation
  ↓
vertex position
```

The exact formula can be chosen by the implementation as long as it produces the intended visual result.

## Perspective / Depth

The effect should preserve normal 3D perspective.

This is not intended to be a 2D screen-space warp where the entire final image is simply curved.

The preferred result is that the geometry itself is visually repositioned during vertex processing, allowing:

* perspective to remain believable
* objects to remain properly occluded
* depth testing to continue working
* the curved track/world to remain spatially coherent

## Optional Horizontal Curve

The system should ideally support bending in different directions.

For example:

```text
uBendX
uBendY
```

could control whether the distant world curves horizontally, vertically, or both.

A horizontal bend would create a feeling like:

```text
              /
            /
          /
        /
      /
-----/
```

while a vertical bend could create:

```text
       ______
     /
   /
 /
/
```

These should be parameters rather than hardcoded behaviour.

## Overall Target

The final effect should make a straight 3D game environment feel like it exists on a **large curved path/world**.

The player should not immediately notice that the geometry is actually straight.

The desired perception is:

> "The world continues into the distance and naturally bends away from me."

rather than:

> "The objects are being distorted by a shader."

The effect should therefore be subtle near the player and progressively stronger toward the far distance, with the entire environment sharing the same deformation.
