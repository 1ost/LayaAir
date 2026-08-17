import { Node } from "../../../layaAir/laya/display/Node";
import { Event as LayaEvent } from "../../../layaAir/laya/events/Event";
import {
    type AuthoredBindingHost,
    type AuthoredBindingHostLease,
    type AuthoredEventType,
    type AuthoredHostListener,
    type AuthoredScalar
} from "./AuthoredCodeBindings";

type NativeDetach = () => void;
export type LayaAuthoredEventDataMapper =
    (node: Node, type: AuthoredEventType, nativeType: string, raw: unknown) => unknown;

/** Concrete neutral-binding host over LayaAir Nodes and EventDispatcher. */
export class LayaAuthoredBindingHost implements AuthoredBindingHost<Node, Node> {
    constructor(
        private readonly nodeIdOf: (node: Node) => string | null = node => node.name || null,
        private readonly eventDataOf: LayaAuthoredEventDataMapper = mapLayaAuthoredEventData
    ) {}

    findNodes(root: Node, nodeId: string): readonly Node[] {
        const matches: Node[] = [];
        const visit = (node: Node): void => {
            if (this.nodeIdOf(node) === nodeId) matches.push(node);
            for (let index = 0; index < node.numChildren; index++) visit(node.getChildAt(index));
        };
        visit(root);
        return matches;
    }

    attach(listeners: readonly AuthoredHostListener<Node>[]): AuthoredBindingHostLease {
        const detach: NativeDetach[] = [];
        try {
            for (const listener of listeners) detach.push(...this.attachOne(listener));
        } catch (error) {
            for (const remove of detach.reverse()) remove();
            throw error;
        }
        let attached = true;
        return Object.freeze({
            detach(): void {
                if (!attached) return;
                // Laya EventDispatcher.off is synchronous and nonthrowing. Consequently
                // this concrete lease satisfies the host's atomic-detach contract.
                for (const remove of detach.reverse()) remove();
                attached = false;
            }
        });
    }

    private attachOne(listener: AuthoredHostListener<Node>): NativeDetach[] {
        const nativeTypes = nativeEventTypes(listener.type);
        const detach: NativeDetach[] = [];
        for (const nativeType of nativeTypes) {
            const receive = (raw?: unknown): void => listener.receive(this.eventDataOf(listener.node, listener.type, nativeType, raw));
            listener.node.on(nativeType, receive);
            detach.push(() => listener.node.off(nativeType, receive));
        }
        return detach;
    }
}

function nativeEventTypes(type: AuthoredEventType): readonly string[] {
    switch (type) {
        case "click": return [LayaEvent.CLICK];
        case "hover": return [LayaEvent.MOUSE_OVER, LayaEvent.MOUSE_OUT];
        case "down": return [LayaEvent.MOUSE_DOWN];
        case "up": return [LayaEvent.MOUSE_UP];
        case "focus": return [LayaEvent.FOCUS, LayaEvent.BLUR];
        case "input": return [LayaEvent.INPUT];
        case "change": return [LayaEvent.CHANGE];
        case "submit": return [LayaEvent.ENTER];
        case "timeline-complete": return [LayaEvent.COMPLETE];
        case "cue": return [LayaEvent.LABEL];
    }
}

function nativeEvent(raw: unknown, type: AuthoredEventType): LayaEvent {
    if (!(raw instanceof LayaEvent)) throw new TypeError(`${type} requires a native Laya Event`);
    return raw;
}

function pointerData(raw: unknown, type: AuthoredEventType): Record<string, unknown> {
    const event = nativeEvent(raw, type);
    return {
        x: event.touchPos.x,
        y: event.touchPos.y,
        button: event.button,
        pointerId: event.touchId,
        altKey: Boolean(event.altKey),
        ctrlKey: Boolean(event.ctrlKey),
        shiftKey: Boolean(event.shiftKey),
        metaKey: Boolean(event.metaKey)
    };
}

function nodeValue(node: Node): AuthoredScalar {
    const record = node as unknown as Record<string, unknown>;
    for (const name of ["value", "text", "selectedIndex"]) {
        if (!(name in record)) continue;
        const value = record[name];
        if (value === null) return null;
        if (typeof value === "string") return value;
        if (typeof value === "boolean") return value;
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    throw new TypeError(`change requires value/text/selectedIndex on authored node '${node.name}'`);
}

function rawRecord(raw: unknown): Readonly<Record<string, unknown>> | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Readonly<Record<string, unknown>>;
}

function positiveInteger(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
        throw new TypeError(`${label} must be an integer >= 1`);
    return value;
}

function nonnegativeFinite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new TypeError(`${label} must be a nonnegative finite number`);
    return value;
}

function requiredId(value: unknown, label: string): string {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/.test(value))
        throw new TypeError(`${label} must be a stable identifier`);
    return value;
}

function selection(node: Node): { selectionStart: number; selectionEnd: number } {
    const record = node as unknown as Record<string, unknown>;
    const start = record.selectionStart;
    const end = record.selectionEnd;
    if (!Number.isInteger(start) || (start as number) < 0 || !Number.isInteger(end) || (end as number) < (start as number))
        throw new TypeError("input requires valid selectionStart/selectionEnd on the authored node");
    return { selectionStart: start as number, selectionEnd: end as number };
}

function submittedValues(raw: unknown): Record<string, AuthoredScalar> {
    const record = rawRecord(raw);
    if (!record || !Object.prototype.hasOwnProperty.call(record, "values"))
        throw new TypeError("submit requires an explicit values payload");
    const values = rawRecord(record.values);
    if (!values) throw new TypeError("submit.values must be a record");
    const result: Record<string, AuthoredScalar> = Object.create(null);
    for (const [key, value] of Object.entries(values)) {
        requiredId(key, "submit value key");
        if (value !== null && typeof value !== "string" && typeof value !== "boolean"
            && (typeof value !== "number" || !Number.isFinite(value)))
            throw new TypeError(`submit value '${key}' must be an authored scalar`);
        result[key] = value as AuthoredScalar;
    }
    return result;
}

export function mapLayaAuthoredEventData(node: Node, type: AuthoredEventType, nativeType: string, raw: unknown): unknown {
    if (type === "click" || type === "down" || type === "up") return pointerData(raw, type);
    if (type === "hover") return { ...pointerData(raw, type), active: nativeType === LayaEvent.MOUSE_OVER };
    if (type === "focus") {
        nativeEvent(raw, type);
        return { focused: nativeType === LayaEvent.FOCUS, relatedNodeId: null };
    }
    if (type === "input") {
        nativeEvent(raw, type);
        const value = nodeValue(node);
        if (typeof value !== "string") throw new TypeError("input node value must be a string");
        return { value, ...selection(node) };
    }
    if (type === "change") { nativeEvent(raw, type); return { value: nodeValue(node) }; }
    if (type === "submit") return { values: submittedValues(raw) };
    const record = rawRecord(raw);
    if (!record) throw new TypeError(`${type} requires an explicit event payload`);
    if (type === "timeline-complete") return {
        timelineId: requiredId(record.timelineId, "timeline-complete.timelineId"),
        iteration: positiveInteger(record.iteration, "timeline-complete.iteration")
    };
    return {
        timelineId: requiredId(record.timelineId, "cue.timelineId"),
        cueId: requiredId(record.cueId, "cue.cueId"),
        frame: positiveInteger(record.frame, "cue.frame"),
        timeMs: nonnegativeFinite(record.timeMs, "cue.timeMs")
    };
}
