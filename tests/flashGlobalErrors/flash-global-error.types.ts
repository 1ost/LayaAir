import type { FlashGlobalErrorLease } from "../../src/layaAir/flash/browser/FlashGlobalErrorBoundary";

// The module-private lease brand deliberately prevents application code from
// fabricating listener ownership with a structural object literal.
// @ts-expect-error engine-issued FlashGlobalErrorLease is opaque
const forgedLease: FlashGlobalErrorLease = { dispose() {} };
void forgedLease;
