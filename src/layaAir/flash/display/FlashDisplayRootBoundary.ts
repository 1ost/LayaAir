import { ILaya } from "../../ILaya";
import { Node as LayaNode } from "../../laya/display/Node";
import { isLayaStage, type Stage as LayaStage } from "../../laya/display/Stage";
import { Event as LayaEvent } from "../../laya/events/Event";
import { Timer as LayaTimer } from "../../laya/utils/Timer";

const NO_FAILURE = Symbol("no Flash display-root cleanup failure");

type FlashDisplayRootPhase =
    | "idle"
    | "attaching"
    | "attached"
    | "detaching"
    | "detached"
    | "disposing"
    | "dispose-pending"
    | "disposed";

declare const FLASH_DISPLAY_ROOT_LEASE: unique symbol;

/** Engine-owned policy for releasing an application's canonical display root. */
export interface FlashDisplayRootOptions {
    /** Destroy the root and its descendants during disposal. Defaults to true. */
    readonly destroyRootOnDispose?: boolean;
}

/**
 * Opaque authority for the one application display root owned by a live Stage.
 * The engine keeps all mutable lifecycle state outside this public object.
 */
export interface FlashDisplayRootLease<TRoot extends LayaNode = LayaNode> {
    readonly [FLASH_DISPLAY_ROOT_LEASE]: true;
    readonly root: TRoot | null;
    readonly attached: boolean;
    readonly disposed: boolean;
    attach(root: TRoot): TRoot;
    detach(): TRoot | null;
    dispose(): void;
}

interface FlashDisplayRootRecord<TRoot extends LayaNode = LayaNode> {
    readonly stage: LayaStage;
    readonly onFrame: (root: TRoot) => void;
    readonly destroyRootOnDispose: boolean;
    phase: FlashDisplayRootPhase;
    root: TRoot | null;
    generation: number;
    frameScheduler: LayaTimer | null;
    frameScheduled: boolean;
    removalListenerInstalled: boolean;
}

const LEASE_RECORDS = new WeakMap<object, FlashDisplayRootRecord<any>>();
const STAGE_LEASES = new WeakMap<object, object>();
const ROOT_LEASES = new WeakMap<object, object>();

function requireRecord<TRoot extends LayaNode>(value: unknown): FlashDisplayRootRecord<TRoot> {
    if ((typeof value !== "object" && typeof value !== "function") || value === null)
        throw new TypeError("Flash display-root lifecycle requires an engine-issued lease");
    const record = LEASE_RECORDS.get(value as object);
    if (!record)
        throw new TypeError("Flash display-root lifecycle requires an engine-issued lease");
    return record as unknown as FlashDisplayRootRecord<TRoot>;
}

function requireCurrentStage(stage: LayaStage): LayaStage {
    if (stage !== ILaya.stage || !isLayaStage(stage) || stage.destroyed)
        throw new TypeError("Flash display-root lifecycle requires the live canonical Laya Stage");
    return stage;
}

function isPublished<TRoot extends LayaNode>(record: FlashDisplayRootRecord<TRoot>, root: TRoot): boolean {
    return record.stage.children.includes(root) && root.parent === record.stage;
}

function stageOwns<TRoot extends LayaNode>(record: FlashDisplayRootRecord<TRoot>, root: TRoot): boolean {
    return record.stage.children.includes(root);
}

class EngineFlashDisplayRootLease<TRoot extends LayaNode> implements FlashDisplayRootLease<TRoot> {
    declare readonly [FLASH_DISPLAY_ROOT_LEASE]: true;

    constructor(stage: LayaStage, onFrame: (root: TRoot) => void, destroyRootOnDispose: boolean) {
        const record: FlashDisplayRootRecord<TRoot> = {
            stage,
            onFrame,
            destroyRootOnDispose,
            phase: "idle",
            root: null,
            generation: 0,
            frameScheduler: null,
            frameScheduled: false,
            removalListenerInstalled: false
        };
        LEASE_RECORDS.set(this, record);
        for (const name of ["attach", "detach", "dispose"] as const) {
            Object.defineProperty(this, name, {
                value: EngineFlashDisplayRootLease.prototype[name].bind(this),
                writable: false,
                enumerable: false,
                configurable: false
            });
        }
        Object.freeze(this);
    }

    get root(): TRoot | null { return requireRecord<TRoot>(this).root; }

    get attached(): boolean {
        const record = requireRecord<TRoot>(this);
        const root = record.root;
        return record.phase === "attached" && root !== null
            && !record.stage.destroyed && record.stage === ILaya.stage
            && !root.destroyed && isPublished(record, root);
    }

    get disposed(): boolean {
        const phase = requireRecord<TRoot>(this).phase;
        return phase === "disposing" || phase === "disposed";
    }

    attach(root: TRoot): TRoot {
        const record = requireRecord<TRoot>(this);
        this._assertUsable(record);
        requireCurrentStage(record.stage);
        if (!(root instanceof LayaNode))
            throw new TypeError("Flash display root must be a Laya Node");
        if ((root as LayaNode) === record.stage)
            throw new Error("Flash display root cannot be the Stage");

        // Read potentially overridden Node properties before publishing any
        // authority, then re-authenticate the lease and Stage afterwards.
        const destroyed = root.destroyed;
        const parent = root.parent;
        this._assertUsable(record);
        requireCurrentStage(record.stage);
        if (destroyed)
            throw new Error("Destroyed Flash display roots cannot be attached");
        if (parent != null)
            throw new Error("Flash display root must be detached before attachment");
        if (record.root && record.root !== root)
            throw new Error("Flash display-root lease already owns a different root");
        if (record.phase === "attaching" || record.phase === "attached" || record.phase === "detaching")
            throw new Error("Flash display-root lease already has an active attachment");

        const owner = ROOT_LEASES.get(root);
        if (owner && owner !== this)
            throw new Error("Flash display root is retained by a different lease");

        const firstClaim = !owner;
        record.root = root;
        ROOT_LEASES.set(root, this);
        record.phase = "attaching";
        try {
            this._installRemovalListener(record, root);
            record.stage.addChild(root);
            if (record.phase !== "attaching" || !isPublished(record, root)
                || root.destroyed || record.stage.destroyed || record.stage !== ILaya.stage)
                throw new Error("Flash display-root attachment was interrupted");
            record.phase = "attached";
            this._startFrames(record);
            if (record.phase !== "attached" || !isPublished(record, root)
                || root.destroyed || record.stage.destroyed || record.stage !== ILaya.stage)
                throw new Error("Flash display-root attachment was interrupted");
            return root;
        } catch (error) {
            this._rollbackAttachment(record, root, firstClaim);
            throw error;
        }
    }

    detach(): TRoot | null {
        const record = requireRecord<TRoot>(this);
        this._assertUsable(record);
        const root = record.root;
        if (!root) return null;
        if (record.phase === "detached" && !record.frameScheduled
            && !record.removalListenerInstalled) return root;

        record.phase = "detaching";
        let failure: unknown = NO_FAILURE;
        try {
            this._stopFrames(record);
        } catch (error) {
            failure = error;
        }
        if (this._disposalHasStarted(record)) {
            failure = this._retryPendingDisposal(record, failure);
            if (failure !== NO_FAILURE) throw failure;
            if (this._disposalIsPending(record)) throw this._pendingDisposalError();
            return root;
        }

        if (stageOwns(record, root)) {
            try {
                record.stage.removeChild(root);
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }
        }
        if (this._disposalHasStarted(record)) {
            failure = this._retryPendingDisposal(record, failure);
            if (failure !== NO_FAILURE) throw failure;
            if (this._disposalIsPending(record)) throw this._pendingDisposalError();
            return root;
        }

        if (stageOwns(record, root) && !root.destroyed && !record.stage.destroyed
            && record.stage === ILaya.stage) {
            record.phase = "attached";
            try {
                this._installRemovalListener(record, root);
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }
            if (!record.frameScheduled) {
                try {
                    this._startFrames(record);
                } catch (error) {
                    if (failure === NO_FAILURE) failure = error;
                }
            }
        } else {
            if (record.frameScheduled) {
                try {
                    this._stopFrames(record);
                } catch (error) {
                    if (failure === NO_FAILURE) failure = error;
                }
            }
            try {
                this._removeRemovalListener(record, root);
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }
            record.phase = record.frameScheduled || record.removalListenerInstalled
                ? "detaching" : "detached";
        }

        if (failure !== NO_FAILURE) throw failure;
        return root;
    }

    dispose(): void {
        const record = requireRecord<TRoot>(this);
        if (record.phase === "disposed" || record.phase === "disposing") return;
        const invokedDuringDetach = record.phase === "detaching";
        record.phase = "disposing";
        const root = record.root;
        let failure: unknown = NO_FAILURE;

        try {
            this._stopFrames(record);
        } catch (error) {
            failure = error;
        }

        if (root) {
            try {
                this._removeRemovalListener(record, root);
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }

            try {
                if (record.destroyRootOnDispose) {
                    if (!root.destroyed) root.destroy(true);
                } else if (stageOwns(record, root)) {
                    record.stage.removeChild(root);
                }
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }

            const rootCleanupComplete = record.destroyRootOnDispose
                ? root.destroyed
                : !stageOwns(record, root) && root.parent == null;
            const hostCleanupComplete = !record.frameScheduled && !record.removalListenerInstalled;
            if (rootCleanupComplete && hostCleanupComplete) {
                this._release(record, root);
            } else {
                record.phase = "dispose-pending";
            }
        } else if (!record.frameScheduled && !record.removalListenerInstalled) {
            this._release(record, null);
        } else {
            record.phase = "dispose-pending";
        }

        if (record.phase === "dispose-pending" && failure === NO_FAILURE && !invokedDuringDetach)
            failure = this._pendingDisposalError();
        if (failure !== NO_FAILURE) throw failure;
    }

    private _advanceFrame(generation: number): void {
        const record = requireRecord<TRoot>(this);
        if (!record.frameScheduled || record.generation !== generation) return;
        const root = record.root;
        if (record.phase !== "attached" || !root || root.destroyed || record.stage.destroyed
            || record.stage !== ILaya.stage || !isPublished(record, root)) {
            let failure: unknown = NO_FAILURE;
            try {
                this._stopFrames(record);
            } catch (error) {
                failure = error;
            }
            if (root && !stageOwns(record, root)) {
                try {
                    this._removeRemovalListener(record, root);
                } catch (error) {
                    if (failure === NO_FAILURE) failure = error;
                }
            }
            if (record.phase === "attached") {
                record.phase = record.frameScheduled || record.removalListenerInstalled
                    ? "detaching" : "detached";
            }
            if (failure !== NO_FAILURE) throw failure;
            return;
        }
        record.onFrame(root);
    }

    private _handleRootRemoved(): void {
        const record = requireRecord<TRoot>(this);
        if (record.phase !== "attached" && record.phase !== "attaching") return;
        record.phase = "detaching";
        try {
            this._stopFrames(record);
        } catch {
            // Native removal must finish even when cleanup needs a later retry.
        }
        if (this._disposalHasStarted(record)) return;
        const root = record.root;
        if (root) {
            try {
                this._removeRemovalListener(record, root);
            } catch {
                // detach(), dispose(), or the frame audit retries exact cleanup.
            }
        }
        if (this._disposalHasStarted(record)) return;
        record.phase = record.frameScheduled || record.removalListenerInstalled
            ? "detaching" : "detached";
    }

    private _assertUsable(record: FlashDisplayRootRecord<TRoot>): void {
        if (record.phase === "disposed" || record.phase === "disposing")
            throw new Error("Flash display-root lease has been disposed");
        if (record.phase === "dispose-pending")
            throw new Error("Flash display-root lease disposal is pending; retry dispose()");
    }

    private _disposalHasStarted(record: FlashDisplayRootRecord<TRoot>): boolean {
        return record.phase === "disposing" || record.phase === "dispose-pending"
            || record.phase === "disposed";
    }

    private _pendingDisposalError(): Error {
        return new Error("Flash display-root lease disposal is pending until Laya cleanup can be retried");
    }

    private _disposalIsPending(record: FlashDisplayRootRecord<TRoot>): boolean {
        return record.phase === "dispose-pending";
    }

    private _retryPendingDisposal(record: FlashDisplayRootRecord<TRoot>, failure: unknown): unknown {
        if (record.phase !== "dispose-pending") return failure;
        try {
            this.dispose();
        } catch (error) {
            if (failure === NO_FAILURE) return error;
        }
        return failure;
    }

    private _installRemovalListener(record: FlashDisplayRootRecord<TRoot>, root: TRoot): void {
        if (record.removalListenerInstalled) return;
        root.on(LayaEvent.REMOVED, this, this._handleRootRemoved);
        record.removalListenerInstalled = true;
    }

    private _removeRemovalListener(record: FlashDisplayRootRecord<TRoot>, root: TRoot): void {
        if (!record.removalListenerInstalled) return;
        root.off(LayaEvent.REMOVED, this, this._handleRootRemoved);
        record.removalListenerInstalled = false;
    }

    private _startFrames(record: FlashDisplayRootRecord<TRoot>): void {
        if (record.frameScheduled) return;
        const scheduler = ILaya.timer;
        if (!scheduler || typeof scheduler.frameLoop !== "function" || typeof scheduler.clear !== "function")
            throw new Error("Canonical Laya timer is unavailable for the Flash display root");
        const generation = record.generation + 1;
        record.generation = generation;
        record.frameScheduler = scheduler;
        record.frameScheduled = true;
        try {
            scheduler.frameLoop(1, this, this._advanceFrame, [generation], true);
        } catch (error) {
            // Fence a callback that may have been installed before frameLoop threw.
            record.generation++;
            try {
                scheduler.clear(this, this._advanceFrame);
                record.frameScheduler = null;
                record.frameScheduled = false;
            } catch {
                // Keep retryable ownership of a possibly live subscription.
            }
            throw error;
        }
    }

    private _stopFrames(record: FlashDisplayRootRecord<TRoot>): void {
        if (!record.frameScheduled) return;
        const scheduler = record.frameScheduler;
        record.generation++;
        if (!scheduler) throw new Error("Flash display-root frame ownership is unavailable");
        scheduler.clear(this, this._advanceFrame);
        record.frameScheduler = null;
        record.frameScheduled = false;
    }

    private _rollbackAttachment(record: FlashDisplayRootRecord<TRoot>, root: TRoot, firstClaim: boolean): void {
        try {
            this._stopFrames(record);
        } catch {
            // Preserve the original attachment failure and retain cleanup ownership.
        }
        try {
            this._removeRemovalListener(record, root);
        } catch {
            // Preserve the original failure; the retained lease can retry cleanup.
        }
        if (stageOwns(record, root)) {
            try {
                record.stage.removeChild(root);
            } catch {
                // Preserve the original failure and never counterfeit rollback.
            }
        }
        if (this._disposalHasStarted(record)) {
            if (record.phase !== "disposed") record.phase = "dispose-pending";
            return;
        }

        const cleanupPending = stageOwns(record, root) || record.frameScheduled
            || record.removalListenerInstalled;
        if (firstClaim && !cleanupPending && root.parent == null) {
            if (ROOT_LEASES.get(root) === this) ROOT_LEASES.delete(root);
            record.root = null;
            record.phase = "idle";
        } else {
            record.phase = cleanupPending ? "detaching" : "detached";
        }
    }

    private _release(record: FlashDisplayRootRecord<TRoot>, root: TRoot | null): void {
        if (root && ROOT_LEASES.get(root) === this) ROOT_LEASES.delete(root);
        if (STAGE_LEASES.get(record.stage) === this) STAGE_LEASES.delete(record.stage);
        record.root = null;
        record.phase = "disposed";
    }
}

/**
 * Canonical engine boundary for the native application's one display root.
 * It owns attachment, one Laya frame subscription, and deterministic teardown;
 * it does not load assets, establish sessions, or assert application readiness.
 */
export class FlashDisplayRootBoundary {
    private constructor() {}

    static claim<TRoot extends LayaNode = LayaNode>(stage: LayaStage,
        onFrame: (root: TRoot) => void,
        options?: FlashDisplayRootOptions): FlashDisplayRootLease<TRoot> {
        requireCurrentStage(stage);
        if (typeof onFrame !== "function")
            throw new TypeError("Flash display-root lifecycle requires a frame callback");
        if (options !== undefined && (!options || typeof options !== "object"))
            throw new TypeError("Flash display-root options must be an object");
        const destroyOption = options?.destroyRootOnDispose;
        if (destroyOption !== undefined && typeof destroyOption !== "boolean")
            throw new TypeError("destroyRootOnDispose must be boolean when provided");
        const destroyRootOnDispose = destroyOption !== false;

        // Re-authenticate after the caller-controlled option read.
        requireCurrentStage(stage);
        if (STAGE_LEASES.has(stage))
            throw new Error("The live Laya Stage already has a Flash display-root lease");
        const lease = new EngineFlashDisplayRootLease<TRoot>(stage, onFrame, destroyRootOnDispose);
        STAGE_LEASES.set(stage, lease);
        return lease;
    }
}
