interface WeakReference<T extends object> {
    deref(): T | undefined;
}

interface WeakReferenceConstructor {
    new<T extends object>(target: T): WeakReference<T>;
}

interface FinalizationRegistryValue<HeldValue> {
    register(target: object, heldValue: HeldValue, unregisterToken?: object): void;
    unregister(unregisterToken: object): boolean;
}

interface FinalizationRegistryConstructor {
    new<HeldValue>(cleanup: (heldValue: HeldValue) => void): FinalizationRegistryValue<HeldValue>;
}

interface WeakMemoryGlobals {
    readonly WeakRef?: WeakReferenceConstructor;
    readonly FinalizationRegistry?: FinalizationRegistryConstructor;
}

interface ListenerEntryBase {
    readonly priority: number;
    readonly ordinal: number;
}

interface StrongListenerEntry<T extends object> extends ListenerEntryBase {
    readonly weak: false;
    readonly strongListener: T;
}

interface WeakListenerEntry<T extends object> extends ListenerEntryBase {
    readonly weak: true;
    readonly weakListener: WeakReference<T>;
    readonly unregisterToken: object | null;
}

type ListenerEntry<T extends object> = StrongListenerEntry<T> | WeakListenerEntry<T>;

function readListener<T extends object>(entry: ListenerEntry<T>): T | undefined {
    if ("weakListener" in entry) return entry.weakListener.deref();
    return entry.strongListener;
}

/** @internal Ordered listener ownership with optional native weak retention. */
export class WeakListenerList<T extends object> {
    private readonly _entries: ListenerEntry<T>[] = [];
    private readonly _weakReference: WeakReferenceConstructor | null;
    private readonly _finalizer: FinalizationRegistryValue<number> | null;

    constructor(private readonly _onCollected: () => void) {
        const globals = globalThis as unknown as WeakMemoryGlobals;
        this._weakReference = typeof globals.WeakRef === "function" ? globals.WeakRef : null;
        this._finalizer = this._weakReference !== null && typeof globals.FinalizationRegistry === "function"
            ? new globals.FinalizationRegistry<number>(ordinal => this._finalize(ordinal))
            : null;
    }

    add(listener: T, priority: number, ordinal: number, useWeakReference: boolean): boolean {
        this._pruneDead();
        if (this._entries.some(entry => readListener(entry) === listener)) return false;

        let entry: ListenerEntry<T>;
        if (useWeakReference && this._weakReference !== null) {
            const unregisterToken = this._finalizer === null ? null : {};
            entry = {
                weak: true,
                weakListener: new this._weakReference(listener),
                unregisterToken,
                priority,
                ordinal,
            };
            if (unregisterToken !== null) this._finalizer!.register(listener, ordinal, unregisterToken);
        } else {
            // A strong fallback keeps listener delivery and explicit removal deterministic
            // on older hosts where weak references cannot be represented.
            entry = { weak: false, strongListener: listener, priority, ordinal };
        }

        this._entries.push(entry);
        this._entries.sort((left, right) => right.priority - left.priority || left.ordinal - right.ordinal);
        return true;
    }

    remove(listener: T): boolean {
        this._pruneDead();
        const index = this._entries.findIndex(entry => readListener(entry) === listener);
        if (index < 0) return false;
        this._unregister(this._entries[index]);
        this._entries.splice(index, 1);
        return true;
    }

    hasListeners(): boolean {
        this._pruneDead();
        return this._entries.length > 0;
    }

    snapshot(): T[] {
        this._pruneDead();
        if (this._entries.length === 0) this._onCollected();
        const listeners: T[] = [];
        for (const entry of this._entries) {
            const listener = readListener(entry);
            if (listener !== undefined) listeners.push(listener);
        }
        return listeners;
    }

    clear(): void {
        for (const entry of this._entries) this._unregister(entry);
        this._entries.length = 0;
    }

    private _pruneDead(): void {
        for (let index = this._entries.length - 1; index >= 0; index--) {
            const entry = this._entries[index];
            if (entry.weak && entry.weakListener.deref() === undefined) {
                this._unregister(entry);
                this._entries.splice(index, 1);
            }
        }
    }

    private _finalize(ordinal: number): void {
        const index = this._entries.findIndex(entry => entry.ordinal === ordinal);
        if (index < 0) return;
        const entry = this._entries[index];
        if (!entry.weak || entry.weakListener.deref() !== undefined) return;
        this._entries.splice(index, 1);
        try {
            this._onCollected();
        } catch {
            // Finalizers have no synchronous caller. The owner retains an empty
            // entry after failed native cleanup so a later explicit operation can retry.
        }
    }

    private _unregister(entry: ListenerEntry<T>): void {
        if (entry.weak && entry.unregisterToken !== null)
            this._finalizer!.unregister(entry.unregisterToken);
    }
}
