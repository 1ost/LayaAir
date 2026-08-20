const ACCESSIBILITY_PROPERTY_VALUES = new WeakSet<object>();
const PROPERTY_OBSERVERS = new WeakMap<AccessibilityProperties, Set<() => void>>();
interface AccessibilityBindingAuthority {
    readonly token: object;
    readonly baseline: ReadonlyMap<string, string | null>;
    deactivate(restore: boolean): void;
}
const ELEMENT_BINDINGS = new WeakMap<Element, AccessibilityBindingAuthority>();

/** @internal Read-only nominal proof for canonical Flash accessibility metadata. */
export function isFlashAccessibilityProperties(value: unknown): value is AccessibilityProperties {
    return typeof value === "object" && value !== null && ACCESSIBILITY_PROPERTY_VALUES.has(value);
}

function flashString(value: unknown): string | null {
    return value === null || value === undefined ? null : String(value);
}

function notify(value: AccessibilityProperties): void {
    for (const observer of PROPERTY_OBSERVERS.get(value) ?? []) observer();
}

/** Flash accessibility metadata retained without inventing a canvas accessibility tree. */
export class AccessibilityProperties {
    private _description: string | null = "";
    private _forceSimple = false;
    private _name: string | null = "";
    private _noAutoLabeling = false;
    private _shortcut: string | null = "";
    private _silent = false;

    constructor() { ACCESSIBILITY_PROPERTY_VALUES.add(this); }

    get description(): string | null { return this._description; }
    set description(value: unknown) { this._description = flashString(value); notify(this); }
    get forceSimple(): boolean { return this._forceSimple; }
    set forceSimple(value: unknown) { this._forceSimple = !!value; notify(this); }
    get name(): string | null { return this._name; }
    set name(value: unknown) { this._name = flashString(value); notify(this); }
    get noAutoLabeling(): boolean { return this._noAutoLabeling; }
    set noAutoLabeling(value: unknown) { this._noAutoLabeling = !!value; notify(this); }
    get shortcut(): string | null { return this._shortcut; }
    set shortcut(value: unknown) { this._shortcut = flashString(value); notify(this); }
    get silent(): boolean { return this._silent; }
    set silent(value: unknown) { this._silent = !!value; notify(this); }
}

export interface AccessibilityPropertiesBinding {
    update(properties: AccessibilityProperties | null): void;
    dispose(): void;
}

const PROJECTED_ATTRIBUTES = ["aria-description", "aria-hidden", "aria-keyshortcuts", "aria-label"] as const;

/**
 * Binds source metadata to a concrete browser element owned by a higher-level
 * display/accessibility host. Disposal restores every preexisting attribute.
 */
export function bindAccessibilityProperties(element: Element,
    initial: AccessibilityProperties | null): AccessibilityPropertiesBinding {
    if (!element || typeof element.setAttribute !== "function")
        throw new TypeError("AccessibilityProperties binding requires an Element");
    const predecessor = ELEMENT_BINDINGS.get(element);
    let previous: ReadonlyMap<string, string | null>;
    if (predecessor) previous = predecessor.baseline;
    else {
        const baseline = new Map<string, string | null>();
        for (const name of PROJECTED_ATTRIBUTES) baseline.set(name, element.getAttribute(name));
        previous = baseline;
    }
    predecessor?.deactivate(false);
    const token = Object.freeze({});
    let current: AccessibilityProperties | null = null;
    let disposed = false;

    const project = (): void => {
        if (disposed) return;
        const set = (name: string, value: string | null): void => {
            if (value === null || value.length === 0) element.removeAttribute(name);
            else element.setAttribute(name, value);
        };
        set("aria-label", current?.name ?? null);
        set("aria-description", current?.description ?? null);
        set("aria-keyshortcuts", current?.shortcut ?? null);
        set("aria-hidden", current?.silent ? "true" : null);
    };
    const unsubscribe = (): void => {
        if (!current) return;
        PROPERTY_OBSERVERS.get(current)?.delete(project);
    };
    const update = (value: AccessibilityProperties | null): void => {
        if (disposed) throw new Error("AccessibilityProperties binding is disposed");
        if (value !== null && !isFlashAccessibilityProperties(value))
            throw new TypeError("AccessibilityProperties binding requires canonical metadata or null");
        unsubscribe();
        current = value;
        if (current) {
            let observers = PROPERTY_OBSERVERS.get(current);
            if (!observers) PROPERTY_OBSERVERS.set(current, observers = new Set());
            observers.add(project);
        }
        project();
    };
    const deactivate = (restore: boolean): void => {
        if (!disposed) {
            unsubscribe();
            disposed = true;
            current = null;
        }
        if (restore && ELEMENT_BINDINGS.get(element)?.token === token) {
            ELEMENT_BINDINGS.delete(element);
            for (const [name, value] of previous) {
                if (value === null) element.removeAttribute(name);
                else element.setAttribute(name, value);
            }
        }
    };
    ELEMENT_BINDINGS.set(element, { token, baseline: previous, deactivate });
    try { update(initial); }
    catch (error) {
        deactivate(true);
        throw error;
    }
    return Object.freeze({
        update,
        dispose(): void { deactivate(true); },
    });
}
