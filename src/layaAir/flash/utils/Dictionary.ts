interface WeakReference<T extends object> {
    deref(): T | undefined;
}

type WeakReferenceConstructor = new <T extends object>(target: T) => WeakReference<T>;

interface StrongEntry<K, V> {
    kind: "strong";
    key: K;
    value: V;
    active: boolean;
}

interface WeakEntry<V> {
    kind: "weak";
    key: WeakReference<object>;
    value: V;
    active: boolean;
}

type DictionaryEntry<K, V> = StrongEntry<K, V> | WeakEntry<V>;

function isObjectKey(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Flash-shaped identity dictionary with insertion-ordered native iteration.
 *
 * Ports use explicit get/set/delete/iteration operations because JavaScript
 * cannot represent object identities as property names. Weak-key instances use
 * native WeakMap/WeakRef authority and fail closed on hosts without WeakRef.
 */
export class Dictionary<K = unknown, V = unknown> {
    private _strong = new Map<K, StrongEntry<K, V>>();
    private _weak = new WeakMap<object, WeakEntry<V>>();
    private _entries: Array<DictionaryEntry<K, V>> = [];
    private readonly _weakReference: WeakReferenceConstructor | null;
    readonly weakKeys: boolean;

    constructor(weakKeys = false) {
        this.weakKeys = weakKeys;
        const weakReference = (globalThis as unknown as { WeakRef?: WeakReferenceConstructor }).WeakRef ?? null;
        if (weakKeys && !weakReference)
            throw new Error("Weak-key Dictionary requires native WeakRef support");
        this._weakReference = weakReference;
    }

    get size(): number {
        let count = 0;
        for (const _entry of this.liveEntries()) count++;
        return count;
    }

    has(key: K): boolean {
        return this.entryFor(key) !== undefined;
    }

    get(key: K): V | undefined {
        return this.entryFor(key)?.value;
    }

    set(key: K, value: V): this {
        const existing = this.entryFor(key);
        if (existing) {
            existing.value = value;
            return this;
        }
        if (this.weakKeys && isObjectKey(key)) {
            const entry: WeakEntry<V> = {
                kind: "weak",
                key: new this._weakReference!(key),
                value,
                active: true,
            };
            this._weak.set(key, entry);
            this._entries.push(entry);
        } else {
            const entry: StrongEntry<K, V> = { kind: "strong", key, value, active: true };
            this._strong.set(key, entry);
            this._entries.push(entry);
        }
        return this;
    }

    delete(key: K): boolean {
        const entry = this.entryFor(key);
        if (!entry) return false;
        entry.active = false;
        if (entry.kind === "weak") this._weak.delete(key as unknown as object);
        else this._strong.delete(key);
        return true;
    }

    clear(): void {
        for (const entry of this._entries) entry.active = false;
        this._entries = [];
        this._strong.clear();
        this._weak = new WeakMap<object, WeakEntry<V>>();
    }

    *keys(): IterableIterator<K> {
        for (const entry of this.liveEntries()) yield entry[0];
    }

    *values(): IterableIterator<V> {
        for (const entry of this.liveEntries()) yield entry[1];
    }

    *entries(): IterableIterator<[K, V]> {
        yield* this.liveEntries();
    }

    private entryFor(key: K): DictionaryEntry<K, V> | undefined {
        if (this.weakKeys && isObjectKey(key)) return this._weak.get(key) as WeakEntry<V> | undefined;
        return this._strong.get(key);
    }

    private *liveEntries(): IterableIterator<[K, V]> {
        let stale = 0;
        for (const entry of this._entries) {
            if (!entry.active) {
                stale++;
                continue;
            }
            if (entry.kind === "strong") {
                yield [entry.key, entry.value];
                continue;
            }
            const key = entry.key.deref();
            if (key !== undefined) yield [key as unknown as K, entry.value];
            else {
                entry.active = false;
                stale++;
            }
        }
        if (stale > 32 && stale * 2 >= this._entries.length)
            this._entries = this._entries.filter(entry => entry.active);
    }
}
