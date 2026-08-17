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
        private readonly eventDataOf: LayaAuthoredEventDataMapper = nativeEventData
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

function pointer(raw: unknown): LayaEvent {
    return raw instanceof LayaEvent ? raw : new LayaEvent();
}

function pointerData(raw: unknown): Record<string, unknown> {
    const event = pointer(raw);
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
        const value = record[name];
        if (value === null) return null;
        if (typeof value === "string") return value;
        if (typeof value === "boolean") return value;
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
}

function rawRecord(raw: unknown): Readonly<Record<string, unknown>> | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Readonly<Record<string, unknown>>;
}

function positiveInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function finite(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nativeEventData(node: Node, type: AuthoredEventType, nativeType: string, raw: unknown): unknown {
    if (type === "click" || type === "down" || type === "up") return pointerData(raw);
    if (type === "hover") return { ...pointerData(raw), active: nativeType === LayaEvent.MOUSE_OVER };
    if (type === "focus") return { focused: nativeType === LayaEvent.FOCUS, relatedNodeId: null };
    if (type === "input") {
        const value = String(nodeValue(node) ?? "");
        return { value, selectionStart: null, selectionEnd: null };
    }
    if (type === "change") return { value: nodeValue(node) };
    if (type === "submit") return { values: Object.create(null) as Record<string, AuthoredScalar> };
    const record = rawRecord(raw);
    if (type === "timeline-complete") return {
        timelineId: node.name,
        iteration: positiveInteger(record?.iteration, 1)
    };
    return {
        timelineId: node.name,
        cueId: typeof raw === "string" ? raw : String(record?.cueId ?? "cue"),
        frame: positiveInteger(record?.frame, 1),
        timeMs: finite(record?.timeMs, 0)
    };
}
