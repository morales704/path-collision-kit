/**
 * Public entry point for path-collision-kit.
 *
 * Re-exports every name a consumer would reach for from the core module.
 */
export {
  resolveUniquePath,
  PathCollisionResolver,
  generateNumericSuffix,
  generateTimestampSuffix,
} from "./core.js";
