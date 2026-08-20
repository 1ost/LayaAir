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
    readonly frameCaller: object;
    readonly frameMethod: (generation: number) => void;
    frameScheduled: boolean;
    frameCleanupPending: boolean;
    frameCleanupInProgress: boolean;
    removalListenerInstalled: boolean;
    removalListenerCleanupPending: boolean;
    removalListenerCleanupInProgress: boolean;
    operationDepth: number;
    releasePending: boolean;
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
        const frameCaller = {};
        const record: FlashDisplayRootRecord<TRoot> = {
            stage,
            onFrame,
            destroyRootOnDispose,
            phase: "idle",
            root: null,
            generation: 0,
            frameScheduler: null,
            frameCaller,
            frameMethod: generation => this._advanceFrame(generation),
            frameScheduled: false,
            frameCleanupPending: false,
            frameCleanupInProgress: false,
            removalListenerInstalled: false,
            removalListenerCleanupPending: false,
            removalListenerCleanupInProgress: false,
            operationDepth: 0,
            releasePending: false
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
            && record.frameScheduled && !record.frameCleanupPending
            && record.removalListenerInstalled && !record.removalListenerCleanupPending
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
        this._enterOperation(record);
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
        } finally {
            this._leaveOperation(record);
        }
    }

    detach(): TRoot | null {
        const record = requireRecord<TRoot>(this);
        this._assertUsable(record);
        const root = record.root;
        if (!root) return null;
        if (record.phase === "detached" && !this._hasFrameCleanup(record)
            && !this._hasRemovalListenerCleanup(record)) return root;

        this._enterOperation(record);
        try {
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
            try {
                // A failed prior off/clear leaves indeterminate host ownership.
                // Resolve that authority before installing exactly one new pair.
                if (record.removalListenerCleanupPending)
                    this._removeRemovalListener(record, root);
                this._installRemovalListener(record, root);
            } catch (error) {
                if (failure === NO_FAILURE) failure = error;
            }
            if (record.frameCleanupPending) {
                try {
                    this._stopFrames(record);
                } catch (error) {
                    if (failure === NO_FAILURE) failure = error;
                }
            }
            if (!this._hasFrameCleanup(record)) {
                try {
                    this._startFrames(record);
                } catch (error) {
                    if (failure === NO_FAILURE) failure = error;
                }
            }
            record.phase = record.frameScheduled && !record.frameCleanupPending
                && record.removalListenerInstalled && !record.removalListenerCleanupPending
                ? "attached" : "detaching";
        } else {
            if (this._hasFrameCleanup(record)) {
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
            record.phase = this._hasFrameCleanup(record) || this._hasRemovalListenerCleanup(record)
                ? "detaching" : "detached";
        }

        if (failure !== NO_FAILURE) throw failure;
        return root;
        } finally {
            this._leaveOperation(record);
        }
    }

    dispose(): void {
        const record = requireRecord<TRoot>(this);
        if (record.phase === "disposed" || record.phase === "disposing") return;
        this._enterOperation(record);
        try {
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
            const hostCleanupComplete = !this._hasFrameCleanup(record)
                && !this._hasRemovalListenerCleanup(record);
            if (rootCleanupComplete && hostCleanupComplete) {
                this._release(record, root);
            } else {
                record.phase = "dispose-pending";
            }
        } else if (!this._hasFrameCleanup(record) && !this._hasRemovalListenerCleanup(record)) {
            this._release(record, null);
        } else {
            record.phase = "dispose-pending";
        }

        if (record.phase === "dispose-pending" && failure === NO_FAILURE && !invokedDuringDetach)
            failure = this._pendingDisposalError();
        if (failure !== NO_FAILURE) throw failure;
        } finally {
            this._leaveOperation(record);
        }
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
                record.phase = this._hasFrameCleanup(record) || this._hasRemovalListenerCleanup(record)
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
        record.phase = this._hasFrameCleanup(record) || this._hasRemovalListenerCleanup(record)
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
        if (record.removalListenerInstalled && !record.removalListenerCleanupPending) return;
        if (record.removalListenerCleanupPending)
            throw new Error("Flash display-root removal-listener cleanup must complete before installation");

        // Claim cleanup authority before entering overridable EventDispatcher
        // code: `on` may install then throw, or reentrantly dispose before it
        // returns. Either way a later off remains mandatory and retryable.
        record.removalListenerInstalled = false;
        record.removalListenerCleanupPending = true;
        try {
            root.on(LayaEvent.REMOVED, this, this._handleRootRemoved);
        } catch (error) {
            // `on` may have installed after reentrant cleanup and then thrown.
            // Reacquire exact cleanup authority regardless of flags mutated by
            // the nested lifecycle operation before attempting reconciliation.
            record.removalListenerInstalled = false;
            record.removalListenerCleanupPending = true;
            try {
                this._removeRemovalListener(record, root);
            } catch {
                // Preserve the installation error and retained cleanup authority.
            }
            throw error;
        }

        if (record.phase === "attaching" || record.phase === "detaching") {
            record.removalListenerInstalled = true;
            record.removalListenerCleanupPending = false;
            return;
        }

        // Reentrant disposal/removal may have called off before an override
        // completed installation. Reacquire and reconcile after `on` returns.
        record.removalListenerCleanupPending = true;
        this._removeRemovalListener(record, root);
        throw new Error("Flash display-root removal-listener installation was interrupted");
    }

    private _removeRemovalListener(record: FlashDisplayRootRecord<TRoot>, root: TRoot): void {
        if (!this._hasRemovalListenerCleanup(record)) return;
        if (record.removalListenerCleanupInProgress) return;

        record.removalListenerInstalled = false;
        record.removalListenerCleanupPending = true;
        record.removalListenerCleanupInProgress = true;
        try {
            root.off(LayaEvent.REMOVED, this, this._handleRootRemoved);
        } catch (error) {
            throw error;
        } finally {
            record.removalListenerCleanupInProgress = false;
        }
        record.removalListenerCleanupPending = false;
        record.removalListenerInstalled = false;
    }

    private _startFrames(record: FlashDisplayRootRecord<TRoot>): void {
        if (record.frameScheduled && !record.frameCleanupPending) return;
        if (record.frameCleanupPending)
            throw new Error("Flash display-root frame cleanup must complete before registration");
        const scheduler = ILaya.timer;
        if (!scheduler || typeof scheduler.frameLoop !== "function" || typeof scheduler.clear !== "function")
            throw new Error("Canonical Laya timer is unavailable for the Flash display root");
        const generation = record.generation + 1;
        record.generation = generation;
        record.frameScheduler = scheduler;
        record.frameScheduled = false;
        record.frameCleanupPending = true;
        try {
            scheduler.frameLoop(1, record.frameCaller, record.frameMethod, [generation], true);
        } catch (error) {
            // Fence and reacquire the exact scheduler even if a reentrant
            // lifecycle operation cleared the provisional flags before
            // frameLoop installed a callback and then threw.
            record.generation++;
            record.frameScheduler = scheduler;
            record.frameScheduled = false;
            record.frameCleanupPending = true;
            try {
                this._stopFrames(record);
            } catch {
                // Keep retryable ownership of a possibly live subscription.
            }
            throw error;
        }
        if (record.frameScheduler !== scheduler || !record.frameCleanupPending
            || (record.phase !== "attached" && record.phase !== "detaching")) {
            // A reentrant host may have cleared before completing registration.
            // Reacquire cleanup authority after frameLoop returns so an
            // install-after-clear subscription cannot escape the lease.
            record.frameScheduler = scheduler;
            record.frameScheduled = false;
            record.frameCleanupPending = true;
            try {
                this._stopFrames(record);
            } catch {
                // Retain the indeterminate scheduler authority for retry.
            }
            throw new Error("Flash display-root frame registration was interrupted");
        }
        record.frameCleanupPending = false;
        record.frameScheduled = true;
    }

    private _stopFrames(record: FlashDisplayRootRecord<TRoot>): void {
        if (!this._hasFrameCleanup(record)) return;
        if (record.frameCleanupInProgress) return;
        const scheduler = record.frameScheduler;
        record.generation++;
        if (!scheduler) throw new Error("Flash display-root frame ownership is unavailable");
        // Fence first, then move known-live ownership into an indeterminate,
        // retryable cleanup state before entering the overridable scheduler.
        record.frameScheduled = false;
        record.frameCleanupPending = true;
        record.frameCleanupInProgress = true;
        try {
            scheduler.clear(record.frameCaller, record.frameMethod);
        } catch (error) {
            throw error;
        } finally {
            record.frameCleanupInProgress = false;
        }
        record.frameScheduler = null;
        record.frameCleanupPending = false;
        record.frameScheduled = false;
    }

    private _hasFrameCleanup(record: FlashDisplayRootRecord<TRoot>): boolean {
        return record.frameScheduled || record.frameCleanupPending || record.frameCleanupInProgress;
    }

    private _hasRemovalListenerCleanup(record: FlashDisplayRootRecord<TRoot>): boolean {
        return record.removalListenerInstalled || record.removalListenerCleanupPending
            || record.removalListenerCleanupInProgress;
    }

    private _enterOperation(record: FlashDisplayRootRecord<TRoot>): void {
        record.operationDepth++;
    }

    private _leaveOperation(record: FlashDisplayRootRecord<TRoot>): void {
        if (record.operationDepth <= 0)
            throw new Error("Flash display-root lifecycle operation accounting underflow");
        record.operationDepth--;
        if (record.operationDepth !== 0) return;
        if (!record.releasePending && record.phase !== "dispose-pending") return;

        record.releasePending = false;
        const root = record.root;
        const rootCleanupComplete = root === null || (record.destroyRootOnDispose
            ? root.destroyed
            : !stageOwns(record, root) && root.parent == null);
        const hostCleanupComplete = !this._hasFrameCleanup(record)
            && !this._hasRemovalListenerCleanup(record);
        if (rootCleanupComplete && hostCleanupComplete) {
            this._releaseNow(record, root);
        } else if (record.phase !== "disposed") {
            record.phase = "dispose-pending";
        }
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

        const cleanupPending = stageOwns(record, root) || this._hasFrameCleanup(record)
            || this._hasRemovalListenerCleanup(record);
        if (firstClaim && !cleanupPending && root.parent == null) {
            if (ROOT_LEASES.get(root) === this) ROOT_LEASES.delete(root);
            record.root = null;
            record.phase = "idle";
        } else {
            record.phase = cleanupPending ? "detaching" : "detached";
        }
    }

    private _release(record: FlashDisplayRootRecord<TRoot>, root: TRoot | null): void {
        if (record.operationDepth !== 0) {
            record.releasePending = true;
            return;
        }
        this._releaseNow(record, root);
    }

    private _releaseNow(record: FlashDisplayRootRecord<TRoot>, root: TRoot | null): void {
        if (root && ROOT_LEASES.get(root) === this) ROOT_LEASES.delete(root);
        if (STAGE_LEASES.get(record.stage) === this) STAGE_LEASES.delete(record.stage);
        record.releasePending = false;
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
