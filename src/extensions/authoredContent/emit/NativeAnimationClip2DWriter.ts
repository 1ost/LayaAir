import type { NativeAnimationClip2D } from "./NativeLayaEmitter";

const NATIVE_ANIMATION_VERSION = "LAYAANIMATION2D:01";

/** Native binary writer paired with Laya.AnimationClip2D._parse. */
export class NativeAnimationClip2DWriter {
    static write(clip: Laya.AnimationClip2D): ArrayBuffer {
        const nativeClip = clip as NativeAnimationClip2D;
        if (!Number.isInteger(nativeClip._frameRate)
            || nativeClip._frameRate < 1
            || nativeClip._frameRate > 0x7fff) {
            throw new Error("AUTHORED_CONTENT_NATIVE_FRAME_RATE_RANGE: Frame rate must fit the signed native parser field.");
        }
        const strings: string[] = [];
        const numbers: number[] = [];
        const byte = new Laya.Byte();

        byte.writeUTFString(NATIVE_ANIMATION_VERSION);
        const contentMark = byte.pos;
        byte.writeUint32(0);
        byte.writeUint32(0);

        const blockMark = byte.pos;
        byte.writeUint16(1);
        byte.writeUint32(0);
        byte.writeUint32(0);

        const stringMark = byte.pos;
        byte.writeUint32(0);
        byte.writeUint16(0);

        const contentStart = byte.pos;
        byte.writeUint16(this.stringIndex(strings, "ANIMATIONS2D"));
        this.collectNumbers(clip, numbers);
        byte.writeUint16(numbers.length);
        numbers.forEach(value => byte.writeFloat32(value));
        byte.writeUint16(this.numberIndex(numbers, nativeClip._duration));
        byte.writeByte(clip.islooping ? 1 : 0);
        byte.writeUint16(nativeClip._frameRate);

        const nodeCount = nativeClip._nodes ? nativeClip._nodes.count : 0;
        byte.writeUint16(nodeCount);
        for (let index = 0; index < nodeCount; index++) {
            const node = nativeClip._nodes!.getNodeByIndex(index);
            byte.writeUint16(node.ownerPathCount);
            for (let pathIndex = 0; pathIndex < node.ownerPathCount; pathIndex++)
                byte.writeUint16(this.stringIndex(strings, node.getOwnerPathByIndex(pathIndex)));
            byte.writeUint16(node.propertyCount);
            for (let propertyIndex = 0; propertyIndex < node.propertyCount; propertyIndex++)
                byte.writeUint16(this.stringIndex(strings, node.getPropertyByIndex(propertyIndex)));

            byte.writeUint16(node._keyFrames.length);
            for (const keyframe of node._keyFrames) {
                const data = keyframe.data as any;
                byte.writeUint16(this.numberIndex(numbers, keyframe.time));
                if (data.tweenType) {
                    byte.writeByte(1);
                    byte.writeUint16(this.stringIndex(strings, data.tweenType));
                }
                else {
                    byte.writeByte(0);
                }

                if (data.tweenInfo) {
                    byte.writeByte(1);
                    byte.writeUint16(this.numberIndex(numbers, data.tweenInfo.inTangent ?? 0));
                    byte.writeUint16(this.numberIndex(numbers, data.tweenInfo.outTangent ?? 0));
                    this.writeOptionalNumber(byte, numbers, data.tweenInfo.inWeight);
                    this.writeOptionalNumber(byte, numbers, data.tweenInfo.outWeight);
                }
                else {
                    byte.writeByte(0);
                }

                const value = data.val;
                if (typeof value === "number") {
                    byte.writeByte(0);
                    byte.writeUint16(this.numberIndex(numbers, value));
                }
                else if (typeof value === "string") {
                    byte.writeByte(1);
                    byte.writeUint16(this.stringIndex(strings, value));
                }
                else if (typeof value === "boolean") {
                    byte.writeByte(2);
                    byte.writeByte(value ? 1 : 0);
                }
                else if (value && typeof value === "object") {
                    byte.writeByte(3);
                    byte.writeUTFString(JSON.stringify((value as any)._$data ?? value));
                }
                else {
                    throw new Error("AUTHORED_CONTENT_NATIVE_KEYFRAME_VALUE_UNSUPPORTED");
                }

                if (data.extend !== undefined && data.extend !== null) {
                    byte.writeByte(1);
                    byte.writeUint16(this.stringIndex(strings, JSON.stringify(data.extend)));
                }
                else {
                    byte.writeByte(0);
                }
            }
        }

        const events = nativeClip._animationEvents || [];
        byte.writeUint16(events.length);
        for (const event of events) {
            byte.writeUint16(this.numberIndex(numbers, event.time));
            byte.writeUint16(this.stringIndex(strings, event.eventName));
            const params = event.params || [];
            byte.writeUint16(params.length);
            for (const param of params) {
                if (typeof param === "boolean") {
                    byte.writeByte(0);
                    byte.writeByte(param ? 1 : 0);
                }
                else if (typeof param === "number" && Number.isInteger(param)) {
                    byte.writeByte(1);
                    byte.writeInt32(param);
                }
                else if (typeof param === "number") {
                    byte.writeByte(2);
                    byte.writeUint16(this.numberIndex(numbers, param));
                }
                else if (typeof param === "string") {
                    byte.writeByte(3);
                    byte.writeUint16(this.stringIndex(strings, param));
                }
                else {
                    throw new Error("AUTHORED_CONTENT_NATIVE_EVENT_PARAMETER_UNSUPPORTED");
                }
            }
        }

        const stringsStart = byte.pos;
        strings.forEach(value => byte.writeUTFString(value));
        const stringsEnd = byte.pos;

        byte.pos = stringMark + 4;
        byte.writeUint16(strings.length);
        byte.pos = blockMark + 6;
        byte.writeUint32(stringsStart - contentStart);
        byte.pos = contentMark;
        byte.writeUint32(stringsStart);
        byte.writeUint32(stringsEnd - stringsStart);
        return byte.buffer;
    }

    private static collectNumbers(clip: Laya.AnimationClip2D, numbers: number[]): void {
        const nativeClip = clip as NativeAnimationClip2D;
        this.numberIndex(numbers, nativeClip._duration);
        const count = nativeClip._nodes ? nativeClip._nodes.count : 0;
        for (let index = 0; index < count; index++) {
            const node = nativeClip._nodes!.getNodeByIndex(index);
            for (const keyframe of node._keyFrames) {
                const data = keyframe.data as any;
                this.numberIndex(numbers, keyframe.time);
                if (data.tweenInfo) {
                    this.numberIndex(numbers, data.tweenInfo.inTangent ?? 0);
                    this.numberIndex(numbers, data.tweenInfo.outTangent ?? 0);
                    if (data.tweenInfo.inWeight !== undefined && data.tweenInfo.inWeight !== null)
                        this.numberIndex(numbers, data.tweenInfo.inWeight);
                    if (data.tweenInfo.outWeight !== undefined && data.tweenInfo.outWeight !== null)
                        this.numberIndex(numbers, data.tweenInfo.outWeight);
                }
                if (typeof data.val === "number")
                    this.numberIndex(numbers, data.val);
            }
        }
        for (const event of nativeClip._animationEvents || []) {
            this.numberIndex(numbers, event.time);
            for (const param of event.params || []) {
                if (typeof param === "number" && !Number.isInteger(param))
                    this.numberIndex(numbers, param);
            }
        }
    }

    private static writeOptionalNumber(byte: Laya.Byte, numbers: number[], value: number | undefined | null): void {
        if (value !== undefined && value !== null) {
            byte.writeByte(1);
            byte.writeUint16(this.numberIndex(numbers, value));
        }
        else {
            byte.writeByte(0);
        }
    }

    private static stringIndex(values: string[], value: string): number {
        const normalized = value ?? "";
        const index = values.indexOf(normalized);
        if (index >= 0)
            return index;
        values.push(normalized);
        return values.length - 1;
    }

    private static numberIndex(values: number[], value: number): number {
        const normalized = value ?? 0;
        const index = values.indexOf(normalized);
        if (index >= 0)
            return index;
        values.push(normalized);
        return values.length - 1;
    }
}
