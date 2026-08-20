export type FlashGlobalErrorSource = "error" | "unhandledrejection";

/** Immutable observation of one native browser global-error event. */
interface FlashGlobalErrorReportBase {
    readonly error: unknown;
    readonly nativeEvent: globalThis.Event;
    readonly defaultPrevented: boolean;
}

export interface FlashGlobalErrorReport extends FlashGlobalErrorReportBase {
    readonly source: "error";
    readonly error: unknown;
    readonly nativeEvent: globalThis.ErrorEvent;
}

export interface FlashUnhandledRejectionReport extends Omit<FlashGlobalErrorReportBase, "error"> {
    readonly source: "unhandledrejection";
    readonly reason: unknown;
    readonly nativeEvent: globalThis.PromiseRejectionEvent;
}

export type FlashGlobalErrorObservation = FlashGlobalErrorReport | FlashUnhandledRejectionReport;

export type FlashGlobalErrorReceiver = (report: FlashGlobalErrorObservation) => void;

const FLASH_GLOBAL_ERROR_LEASE: unique symbol = Symbol("LayaAir.FlashGlobalErrorLease");
// Capture the current realm's Window once. Application code cannot replace a
// global property later to make a structural event target canonical.
const CANONICAL_WINDOW: globalThis.Window | undefined =
    typeof globalThis.window === "undefined" ? undefined : globalThis.window;

/** Opaque engine-issued ownership of the two native browser listeners. */
export interface FlashGlobalErrorLease {
    readonly [FLASH_GLOBAL_ERROR_LEASE]: true;
    dispose(): void;
}

interface LeaseRecord {
    readonly target: globalThis.Window;
    readonly errorListener: globalThis.EventListener;
    readonly rejectionListener: globalThis.EventListener;
    accepting: boolean;
    errorAttached: boolean;
    rejectionAttached: boolean;
}

const LEASE_RECORDS = new WeakMap<object, LeaseRecord>();

class EngineFlashGlobalErrorLease implements FlashGlobalErrorLease {
    declare readonly [FLASH_GLOBAL_ERROR_LEASE]: true;

    constructor(record: LeaseRecord) {
        Object.defineProperty(this, FLASH_GLOBAL_ERROR_LEASE, { value: true });
        LEASE_RECORDS.set(this, record);
        Object.freeze(this);
    }

    dispose(): void {
        const record = LEASE_RECORDS.get(this);
        if (!record) return;

        // Stop delivery before touching the host. Even a hostile host that
        // throws while removing a listener cannot publish after disposal.
        record.accepting = false;
        const failures: unknown[] = [];
        if (record.errorAttached) {
            try {
                record.target.removeEventListener("error", record.errorListener);
                record.errorAttached = false;
            } catch (error) {
                failures.push(error);
            }
        }
        if (record.rejectionAttached) {
            try {
                record.target.removeEventListener("unhandledrejection", record.rejectionListener);
                record.rejectionAttached = false;
            } catch (error) {
                failures.push(error);
            }
        }
        if (!record.errorAttached && !record.rejectionAttached)
            LEASE_RECORDS.delete(this);
        if (failures.length > 0)
            throw cleanupFailure("Flash global error listener disposal failed", failures);
    }
}

/**
 * Explicit browser-global error ingress owned by LayaAir.
 *
 * The boundary observes native cancellation state but never cancels an event.
 * It does not infer an ambient Window, route through LoaderInfo, or apply an
 * application logging/restart policy.
 */
export class FlashGlobalErrorBoundary {
    private constructor() {}

    static subscribe(
        target: globalThis.Window,
        receiver: FlashGlobalErrorReceiver,
    ): FlashGlobalErrorLease {
        requireTarget(target);
        if (typeof receiver !== "function")
            throw new TypeError("FlashGlobalErrorBoundary receiver must be a function");

        const record = {} as LeaseRecord;
        const publish = (source: FlashGlobalErrorSource, nativeEvent: globalThis.Event): void => {
            if (!record.accepting) return;
            if (source === "error") {
                const errorEvent = nativeEvent as globalThis.ErrorEvent;
                receiver(Object.freeze({
                    source,
                    error: errorEvent.error,
                    nativeEvent: errorEvent,
                    defaultPrevented: errorEvent.defaultPrevented === true,
                }));
            } else {
                const rejectionEvent = nativeEvent as globalThis.PromiseRejectionEvent;
                receiver(Object.freeze({
                    source,
                    reason: rejectionEvent.reason,
                    nativeEvent: rejectionEvent,
                    defaultPrevented: rejectionEvent.defaultPrevented === true,
                }));
            }
        };
        const errorListener: globalThis.EventListener = event => publish("error", event);
        const rejectionListener: globalThis.EventListener = event => publish("unhandledrejection", event);
        Object.assign(record, {
            target,
            errorListener,
            rejectionListener,
            accepting: true,
            errorAttached: false,
            rejectionAttached: false,
        });

        target.addEventListener("error", errorListener);
        record.errorAttached = true;
        try {
            target.addEventListener("unhandledrejection", rejectionListener);
            record.rejectionAttached = true;
        } catch (registrationError) {
            record.accepting = false;
            try {
                target.removeEventListener("error", errorListener);
                record.errorAttached = false;
            } catch (rollbackError) {
                throw cleanupFailure(
                    "Flash global error listener registration and rollback failed",
                    [registrationError, rollbackError],
                );
            }
            throw registrationError;
        }

        return new EngineFlashGlobalErrorLease(record);
    }
}

function requireTarget(value: globalThis.Window): asserts value is globalThis.Window {
    if ((typeof value !== "object" && typeof value !== "function") || value === null
        || value !== CANONICAL_WINDOW
        || typeof value.addEventListener !== "function"
        || typeof value.removeEventListener !== "function")
        throw new TypeError("FlashGlobalErrorBoundary requires an explicit canonical Window");
}

function cleanupFailure(message: string, failures: readonly unknown[]): Error {
    const error = new Error(`${message}: ${failures.map(describeFailure).join("; ")}`);
    Object.defineProperty(error, "failures", {
        value: Object.freeze([...failures]),
        enumerable: false,
    });
    return error;
}

function describeFailure(value: unknown): string {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}
