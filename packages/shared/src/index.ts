/**
 * A @cca/shared csomag nyilvanos felulete.
 *
 * FONTOS (projekt-terv 15.6): a jarmu-fizika parametereinek EGY helyen
 * kell letezniuk. Ha a kliens es a szerver eltero konstansokkal
 * szamolna, a szerver plauzibilitas-ellenorzese hamis riasztasokat
 * adna. Ezert minden fizikai konstans, tipus es maga a szimulacio is
 * innen jon -- a kliens es a szerver egyarant ezt importalja.
 *
 * A csomag SZANDEKOSAN mellekhatas-mentes es DOM/Three.js-fuggetlen,
 * hogy Node.js alatt, headless modon is futtathato (es tesztelheto)
 * legyen -- lasd scripts/node-physics-check.ts.
 */

export * from "./config";
export * from "./arenaProps";
export * from "./abilities";
export * from "./arenaLayout";
export * from "./raycast";
export * from "./math";
export * from "./types";
export * from "./wheelVisuals";
export * from "./freeLook";
export * from "./heatVisuals";
export * from "./wheelDamage";
export * from "./pickups";
export * from "./match";
export * from "./playerName";
export * from "./combat";
export * from "./rocket";
export * from "./weapons";
export * from "./cameraCollision";
export * from "./audioMix";
export * from "./spawn";
export * from "./carGeometry";
export * from "./carSkins";
export * from "./carSizes";
export * from "./carModels";
export * from "./physics/arcade";
export * from "./physics/rapier";
export * from "./net/protocol";
export * from "./net/plausibility";
