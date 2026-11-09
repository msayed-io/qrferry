# Physical specular rim

## Chosen reference

The user explicitly selected the surface-normal model when asked to resolve the conflict between that model and the alternative fixed 48/36px gradient approximation. The physical model is authoritative:

`I(n) = .06 + .54 * max(0, n·L)^6 + .28 * max(0, -n·L)^6`, with `L=(-1,-1)/sqrt(2)`.

Reference alpha: upper-left `.60`, lower-right `.34`, straight upper edge `.1275`, straight lower edge `.095`, perpendicular diagonals `.06`. White RGB only. The fixed-length cubic-gradient alternative is deliberately not combined with this incompatible model. No claim of a measured perceptual ranking against an Apple device is made.

## Implementation

- `lib/specular-rim.ts`: signed-distance rounded-rectangle boundary, outward normals, inverse-transpose transformation of normals into screen coordinates, a one-CSS-pixel inner ring and one-device-pixel antialiasing. Interior contribution is zero beyond that edge band.
- `app/rim.ts`: a single pointer-transparent, aria-hidden Canvas 2D texture per explicitly opted-in small control. Raster work is restricted to the perimeter, not every interior pixel. Static geometry is retained without continuous repainting. ResizeObserver handles geometry; inline spring mutations are drawn before presentation; CSS animation/transition sampling also settles the final frame.
- Translation, scrolling, theme and text direction do not change the light. Rotation changes the normal, not the light vector. Scaling changes the local sampling and compensates the stroke to remain one screen-space CSS pixel.
- Native Glisse rim painting is disabled by the version-checked opt-in `--qf-specular-rim:physical` patch; its pointer controller, springs and foreground refraction are unchanged. Existing pseudo-element rims were removed rather than layered beneath the new rim. The selected segment uses the lens as its single edge owner, not both lens and thumb.
- Targets: glass buttons, capsule links, circular buttons, floating tab-bar material and its lens, support-title capsule, composer input capsule and small pills. No new rim on cards, menu panels, lists, camera/QR surfaces, backgrounds or the extended chat header.
- `--rim` is the sole public intensity control, default `1`, clamped to `[0,1]`. Nested selection lenses multiply by `.85`. Reduced transparency supplies an opaque material, no backdrop blur and an additional `.5` intensity factor. No new manual theme/language/settings toggle was introduced.

## Verification

The source includes mandatory regression coverage rather than a screenshot-only claim:

1. Pure-red recolouring of the actual ring bitmap over black; screenshot pixel audit finds no interior leakage or non-red colour. Geometry/AA remain unchanged.
2. Exact normal-model reference values and exhaustive raster-versus-SDF checks, allowing only 8-bit quantization and device-pixel edge coverage.
3. `350×60`, `44×44` and `36×36` controls, retaining the same screen-space stroke and normal law.
4. DPR `1`, `2`, `3`, including every bitmap pixel checked for unintended omissions from the perimeter optimization. A circle's nearest pixel has a tilted normal; it is not falsely treated as a straight edge.
5. Black, light and animated backdrops do not change the rim bitmap or its zero-alpha interior.
6. Rotation, width/height animation, scrolling, and the existing held/diagonal Glisse drag regressions. Rotation-only animation has independent coverage.
7. Reduced-transparency opaque material/no blur, retained half-strength rim, nested `.85` attenuation, and master intensity down to zero.

Android instrumentation additionally reads the packaged canvas, checks straight-edge values and zero interior, verifies one owner per edge/no panel rims, and exercises the master intensity. Existing native long-press/scrollbar tests remain in the release gate.

The implementation uses Canvas 2D rather than an SVG/CSS gradient, so mask declaration ordering and gradient endpoint formulas are not applicable. At fractional device positions, ordinary compositor antialiasing remains necessary; there is no forced layout shift or permanent scale to hide it. Full physical-device navigation feel still requires the user's phone trial.
