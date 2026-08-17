import {
    AUTHORED_BINDING_NODE_SOURCE_TYPES, AUTHORED_BINDING_RESERVED_SOURCE_SURFACES,
} from "./AuthoredBindingReservedSurfaces";

export const AUTHORED_CODE_BINDING_SCHEMA = "neutral-authored-code-bindings@1" as const;

export type AuthoredEventType =
    | "click" | "hover" | "down" | "up" | "focus"
    | "input" | "change" | "submit" | "timeline-complete" | "cue";

export type AuthoredNodeKind = "button" | "input" | "form" | "timeline" | "interactive";

export interface AuthoredPointerEventData {
    readonly x: number;
    readonly y: number;
    readonly button: number;
    readonly pointerId: number;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
}

export interface AuthoredHoverEventData extends AuthoredPointerEventData { readonly active: boolean; }
export interface AuthoredFocusEventData { readonly focused: boolean; readonly relatedNodeId: string | null; }
export interface AuthoredInputEventData { readonly value: string; readonly selectionStart: number | null; readonly selectionEnd: number | null; }
export interface AuthoredChangeEventData { readonly value: AuthoredScalar; }
export interface AuthoredSubmitEventData { readonly values: Readonly<Record<string, AuthoredScalar>>; }
export interface AuthoredTimelineCompleteEventData { readonly timelineId: string; readonly iteration: number; }
export interface AuthoredCueEventData { readonly timelineId: string; readonly cueId: string; readonly frame: number; readonly timeMs: number; }
export type AuthoredScalar = string | number | boolean | null;

export interface AuthoredEventDataByType {
    readonly click: AuthoredPointerEventData;
    readonly hover: AuthoredHoverEventData;
    readonly down: AuthoredPointerEventData;
    readonly up: AuthoredPointerEventData;
    readonly focus: AuthoredFocusEventData;
    readonly input: AuthoredInputEventData;
    readonly change: AuthoredChangeEventData;
    readonly submit: AuthoredSubmitEventData;
    readonly "timeline-complete": AuthoredTimelineCompleteEventData;
    readonly cue: AuthoredCueEventData;
}

export type AuthoredEventPayload<K extends AuthoredEventType> = Readonly<{
    bindingId: string;
    eventId: string;
    nodeId: string;
    type: K;
} & AuthoredEventDataByType[K]>;

export interface AuthoredBindingEventContract<K extends AuthoredEventType = AuthoredEventType> {
    readonly eventId: string;
    readonly type: K;
    readonly required: boolean;
}

export interface AuthoredNodeBindingContract {
    readonly bindingId: string;
    readonly memberName: string;
    readonly nodeId: string;
    readonly nodeKind: AuthoredNodeKind;
    readonly required: boolean;
    readonly events: readonly AuthoredBindingEventContract[];
}

export interface AuthoredCodeBindingContract {
    readonly schema: typeof AUTHORED_CODE_BINDING_SCHEMA;
    readonly documentId: string;
    readonly bindings: readonly AuthoredNodeBindingContract[];
}

export type AuthoredBindingHandler<K extends AuthoredEventType = AuthoredEventType> =
    (payload: AuthoredEventPayload<K>) => void;

export interface AuthoredHostListener<TNode> {
    readonly node: TNode;
    readonly nodeId: string;
    readonly type: AuthoredEventType;
    readonly receive: (data: unknown) => void;
}

/** A host detach is atomic: on throw, every listener remains attached. */
export interface AuthoredBindingHostLease { detach(): void; }

export interface AuthoredBindingHost<TRoot extends object, TNode> {
    findNodes(root: TRoot, nodeId: string): readonly TNode[];
    attach(listeners: readonly AuthoredHostListener<TNode>[]): AuthoredBindingHostLease;
}

export interface AuthoredBindingLease {
    readonly attached: boolean;
    detach(): void;
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const EVENT_TYPES = new Set<AuthoredEventType>([
    "click", "hover", "down", "up", "focus", "input", "change", "submit",
    "timeline-complete", "cue"
]);
const NODE_EVENT_TYPES: Readonly<Record<AuthoredNodeKind, ReadonlySet<AuthoredEventType>>> = {
    button: new Set(["click", "hover", "down", "up", "focus"]),
    input: new Set(["focus", "input", "change", "submit"]),
    form: new Set(["change", "submit"]),
    timeline: new Set(["timeline-complete", "cue"]),
    interactive: new Set(["click", "hover", "down", "up", "focus", "input", "change"])
};
const activeDocuments = new WeakMap<object, Set<string>>();

function plainRecord(value: unknown, label: string): Record<string, unknown> {
    if (value == null || typeof value !== "object" || Array.isArray(value))
        throw new TypeError(`${label} must be a plain object`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`${label} must be a plain object`);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor))
            throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
        throw new TypeError(`${label} must contain exactly: ${wanted.join(", ")}`);
}

function denseArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty array`);
    const expected = new Set(["length", ...value.map((_item, index) => String(index))]);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !expected.has(key)) throw new TypeError(`${label} must be a dense array without extra fields`);
        if (key !== "length") {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (!descriptor.enumerable || !("value" in descriptor))
                throw new TypeError(`${label}[${key}] must be an enumerable data property`);
        }
    }
    if (Reflect.ownKeys(value).length !== expected.size) throw new TypeError(`${label} must be a dense array without extra fields`);
    return value;
}

function identifier(value: unknown, label: string): string {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${label} must be a stable identifier`);
    return value;
}

const reservedMemberNames = new Map(Object.entries(AUTHORED_BINDING_NODE_SOURCE_TYPES).map(([kind, sourceType]) => [
    kind, new Set(AUTHORED_BINDING_RESERVED_SOURCE_SURFACES[sourceType]),
]));

function memberName(value: unknown, nodeKind: AuthoredNodeKind, label: string): string {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_$]{0,127}$/.test(value))
        throw new TypeError(`${label} must be a public authored TypeScript member name`);
    if (value === "constructor" || value === "prototype" || value === "__proto__"
        || reservedMemberNames.get(nodeKind)?.has(value))
        throw new TypeError(`${label} collides with the ${AUTHORED_BINDING_NODE_SOURCE_TYPES[nodeKind]} public surface`);
    return value;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
    return value;
}

function finite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
}

function nonnegativeFinite(value: unknown, label: string): number {
    const result = finite(value, label);
    if (result < 0) throw new TypeError(`${label} must be >= 0`);
    return result;
}

function integer(value: unknown, label: string, minimum = 0): number {
    const result = finite(value, label);
    if (!Number.isInteger(result) || result < minimum) throw new TypeError(`${label} must be an integer >= ${minimum}`);
    return result;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string") throw new TypeError(`${label} must be string`);
    return value;
}

function nullableInteger(value: unknown, label: string): number | null {
    return value === null ? null : integer(value, label);
}

function scalar(value: unknown, label: string): AuthoredScalar {
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new TypeError(`${label} must be a scalar`);
}

export function normalizeAuthoredCodeBindingContract(value: unknown): AuthoredCodeBindingContract {
    const root = plainRecord(value, "binding contract");
    exactKeys(root, ["schema", "documentId", "bindings"], "binding contract");
    if (root.schema !== AUTHORED_CODE_BINDING_SCHEMA)
        throw new TypeError(`binding contract.schema must be ${AUTHORED_CODE_BINDING_SCHEMA}`);
    const documentId = identifier(root.documentId, "binding contract.documentId");
    const bindingIds = new Set<string>();
    const memberNames = new Set<string>();
    const eventIds = new Set<string>();
    const nodeEventOwners = new Set<string>();
    const bindings = denseArray(root.bindings, "binding contract.bindings").map((raw, bindingIndex) => {
        const label = `binding contract.bindings[${bindingIndex}]`;
        const item = plainRecord(raw, label);
        exactKeys(item, ["bindingId", "memberName", "nodeId", "nodeKind", "required", "events"], label);
        const bindingId = identifier(item.bindingId, `${label}.bindingId`);
        if (typeof item.nodeKind !== "string" || !(item.nodeKind in NODE_EVENT_TYPES))
            throw new TypeError(`${label}.nodeKind is unsupported`);
        const nodeKind = item.nodeKind as AuthoredNodeKind;
        const member = memberName(item.memberName, nodeKind, `${label}.memberName`);
        const nodeId = identifier(item.nodeId, `${label}.nodeId`);
        if (bindingIds.has(bindingId)) throw new TypeError(`duplicate binding ID: ${bindingId}`);
        if (memberNames.has(member)) throw new TypeError(`duplicate member name: ${member}`);
        bindingIds.add(bindingId);
        memberNames.add(member);
        const localTypes = new Set<AuthoredEventType>();
        const events = denseArray(item.events, `${label}.events`).map((eventRaw, eventIndex) => {
            const eventLabel = `${label}.events[${eventIndex}]`;
            const event = plainRecord(eventRaw, eventLabel);
            exactKeys(event, ["eventId", "type", "required"], eventLabel);
            const eventId = identifier(event.eventId, `${eventLabel}.eventId`);
            if (eventIds.has(eventId)) throw new TypeError(`duplicate event ID: ${eventId}`);
            eventIds.add(eventId);
            if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type as AuthoredEventType))
                throw new TypeError(`${eventLabel}.type is unsupported`);
            const type = event.type as AuthoredEventType;
            if (!NODE_EVENT_TYPES[nodeKind].has(type)) throw new TypeError(`${type} is not admitted for ${nodeKind}`);
            if (localTypes.has(type)) throw new TypeError(`duplicate ${type} event on binding ${bindingId}`);
            localTypes.add(type);
            const ownership = `${nodeId}\0${type}`;
            if (nodeEventOwners.has(ownership)) throw new TypeError(`duplicate node/event ownership: ${nodeId} ${type}`);
            nodeEventOwners.add(ownership);
            return Object.freeze({ eventId, type, required: boolean(event.required, `${eventLabel}.required`) });
        });
        return Object.freeze({
            bindingId,
            memberName: member,
            nodeId,
            nodeKind,
            required: boolean(item.required, `${label}.required`),
            events: Object.freeze(events)
        });
    });
    return Object.freeze({ schema: AUTHORED_CODE_BINDING_SCHEMA, documentId, bindings: Object.freeze(bindings) });
}

function clonePointer(record: Record<string, unknown>, label: string): AuthoredPointerEventData {
    exactKeys(record, ["x", "y", "button", "pointerId", "altKey", "ctrlKey", "shiftKey", "metaKey"], label);
    return Object.freeze({
        x: finite(record.x, `${label}.x`), y: finite(record.y, `${label}.y`),
        button: integer(record.button, `${label}.button`), pointerId: integer(record.pointerId, `${label}.pointerId`),
        altKey: boolean(record.altKey, `${label}.altKey`), ctrlKey: boolean(record.ctrlKey, `${label}.ctrlKey`),
        shiftKey: boolean(record.shiftKey, `${label}.shiftKey`), metaKey: boolean(record.metaKey, `${label}.metaKey`)
    });
}

function cloneEventData<K extends AuthoredEventType>(type: K, value: unknown, label: string): AuthoredEventDataByType[K] {
    const record = plainRecord(value, label);
    if (type === "click" || type === "down" || type === "up") return clonePointer(record, label) as AuthoredEventDataByType[K];
    if (type === "hover") {
        exactKeys(record, ["x", "y", "button", "pointerId", "altKey", "ctrlKey", "shiftKey", "metaKey", "active"], label);
        const pointerRecord: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const key of ["x", "y", "button", "pointerId", "altKey", "ctrlKey", "shiftKey", "metaKey"])
            pointerRecord[key] = record[key];
        const pointer = clonePointer(pointerRecord, label);
        const result = { ...pointer, active: boolean(record.active, `${label}.active`) };
        return Object.freeze(result) as AuthoredEventDataByType[K];
    }
    if (type === "focus") {
        exactKeys(record, ["focused", "relatedNodeId"], label);
        const related = record.relatedNodeId === null ? null : identifier(record.relatedNodeId, `${label}.relatedNodeId`);
        return Object.freeze({ focused: boolean(record.focused, `${label}.focused`), relatedNodeId: related }) as AuthoredEventDataByType[K];
    }
    if (type === "input") {
        exactKeys(record, ["value", "selectionStart", "selectionEnd"], label);
        return Object.freeze({
            value: string(record.value, `${label}.value`),
            selectionStart: nullableInteger(record.selectionStart, `${label}.selectionStart`),
            selectionEnd: nullableInteger(record.selectionEnd, `${label}.selectionEnd`)
        }) as AuthoredEventDataByType[K];
    }
    if (type === "change") {
        exactKeys(record, ["value"], label);
        return Object.freeze({ value: scalar(record.value, `${label}.value`) }) as AuthoredEventDataByType[K];
    }
    if (type === "submit") {
        exactKeys(record, ["values"], label);
        const values = plainRecord(record.values, `${label}.values`);
        const cloned: Record<string, AuthoredScalar> = Object.create(null) as Record<string, AuthoredScalar>;
        for (const key of Object.keys(values)) cloned[key] = scalar(values[key], `${label}.values.${key}`);
        return Object.freeze({ values: Object.freeze(cloned) }) as AuthoredEventDataByType[K];
    }
    if (type === "timeline-complete") {
        exactKeys(record, ["timelineId", "iteration"], label);
        return Object.freeze({
            timelineId: identifier(record.timelineId, `${label}.timelineId`),
            iteration: integer(record.iteration, `${label}.iteration`, 1)
        }) as AuthoredEventDataByType[K];
    }
    exactKeys(record, ["timelineId", "cueId", "frame", "timeMs"], label);
    return Object.freeze({
        timelineId: identifier(record.timelineId, `${label}.timelineId`),
        cueId: identifier(record.cueId, `${label}.cueId`),
        frame: integer(record.frame, `${label}.frame`, 1),
        timeMs: nonnegativeFinite(record.timeMs, `${label}.timeMs`)
    }) as AuthoredEventDataByType[K];
}

function payload<K extends AuthoredEventType>(
    binding: AuthoredNodeBindingContract,
    event: AuthoredBindingEventContract<K>,
    value: unknown
): AuthoredEventPayload<K> {
    const data = cloneEventData(event.type, value, `event data for ${event.eventId}`);
    return Object.freeze(Object.assign(Object.create(null), data, {
        bindingId: binding.bindingId,
        eventId: event.eventId,
        nodeId: binding.nodeId,
        type: event.type
    })) as AuthoredEventPayload<K>;
}

function normalizeHandlers(value: object, declared: ReadonlySet<string>): ReadonlyMap<string, AuthoredBindingHandler> {
    const handlers = plainRecord(value, "binding handlers");
    const result = new Map<string, AuthoredBindingHandler>();
    for (const key of Reflect.ownKeys(handlers)) {
        if (typeof key !== "string" || !declared.has(key)) throw new TypeError(`unknown authored handler: ${String(key)}`);
        const descriptor = Object.getOwnPropertyDescriptor(handlers, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`handler ${key} must be an enumerable data property`);
        if (typeof descriptor.value !== "function") throw new TypeError(`handler ${key} must be a function`);
        result.set(key, descriptor.value as AuthoredBindingHandler);
    }
    return result;
}

export function attachAuthoredCodeBindings<TRoot extends object, TNode>(
    root: TRoot,
    host: AuthoredBindingHost<TRoot, TNode>,
    contractValue: unknown,
    handlerValue: object
): AuthoredBindingLease {
    if (root == null || typeof root !== "object") throw new TypeError("binding root must be an object");
    const contract = normalizeAuthoredCodeBindingContract(contractValue);
    if (host == null || typeof host !== "object" || typeof host.findNodes !== "function" || typeof host.attach !== "function")
        throw new TypeError("binding host must provide findNodes and attach");
    const declared = new Set(contract.bindings.flatMap(binding => binding.events.map(event => event.eventId)));
    const handlers = normalizeHandlers(handlerValue, declared);
    const listeners: AuthoredHostListener<TNode>[] = [];
    for (const binding of contract.bindings) {
        const nodes = host.findNodes(root, binding.nodeId);
        if (!Array.isArray(nodes)) throw new TypeError(`findNodes(${binding.nodeId}) must return an array`);
        if (nodes.length > 1) throw new TypeError(`duplicate authored node: ${binding.nodeId}`);
        if (nodes.length === 0 && binding.required) throw new TypeError(`missing authored node: ${binding.nodeId}`);
        for (const event of binding.events) {
            const handler = handlers.get(event.eventId);
            if (!handler && event.required) throw new TypeError(`missing required authored handler: ${event.eventId}`);
            if (handler && nodes.length === 1) listeners.push(Object.freeze({
                node: nodes[0], nodeId: binding.nodeId, type: event.type,
                receive: (data: unknown) => handler(payload(binding, event, data))
            }));
        }
    }
    let documents = activeDocuments.get(root);
    if (!documents) activeDocuments.set(root, documents = new Set());
    if (documents.has(contract.documentId)) throw new TypeError(`authored bindings already attached: ${contract.documentId}`);
    documents.add(contract.documentId);
    let hostLease: AuthoredBindingHostLease;
    try {
        hostLease = host.attach(Object.freeze(listeners));
        if (hostLease == null || typeof hostLease !== "object" || typeof hostLease.detach !== "function")
            throw new TypeError("binding host attach must return a lease");
    } catch (error) {
        documents.delete(contract.documentId);
        if (documents.size === 0) activeDocuments.delete(root);
        throw error;
    }
    let attached = true;
    return Object.freeze({
        get attached(): boolean { return attached; },
        detach(): void {
            if (!attached) return;
            // The host contract guarantees throw means no listener changed.
            hostLease.detach();
            attached = false;
            documents!.delete(contract.documentId);
            if (documents!.size === 0) activeDocuments.delete(root);
        }
    });
}
