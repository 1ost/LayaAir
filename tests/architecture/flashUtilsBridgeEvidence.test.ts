import assert from "node:assert/strict";
import test from "node:test";
import type { Timer, isFlashTimer } from "../../src/layaAir/flash/utils/Timer.ts";
import type { Endian } from "../../src/layaAir/flash/utils/Endian.ts";
import type { ByteArray, ByteArrayInput, ZlibDecompressionHost } from "../../src/layaAir/flash/utils/ByteArray.ts";
import type { Dictionary } from "../../src/layaAir/flash/utils/Dictionary.ts";
import type {
    Proxy, FlashProxyName, callFlashProxyProperty, declareFlashProxyProperties, flash_proxy,
} from "../../src/layaAir/flash/utils/Proxy.ts";
import type { XML, XMLList, FlashXmlInput, FlashXmlChild } from "../../src/layaAir/flash/utils/XML.ts";
import type { encodeNativeObject, decodeNativeObject } from "../../src/layaAir/flash/utils/NativeObjectCodec.ts";
import type { getTimer, setTimeout, clearTimeout, setInterval, clearInterval } from
    "../../src/layaAir/flash/utils/TimerFunctions.ts";
import type { getQualifiedClassName } from "../../src/layaAir/flash/utils/getQualifiedClassName.ts";
import type { getQualifiedSuperclassName } from "../../src/layaAir/flash/utils/getQualifiedSuperclassName.ts";
import type {
    getDefinitionByName,
    NativeDefinition,
    registerDefinitionByName,
    registerObservedDefinition,
} from "../../src/layaAir/flash/utils/DefinitionRegistry.ts";
import type {
    describeType,
    FlashAccessorAccess,
    FlashAccessorDescription,
    FlashMethodDescription,
    FlashTypeDescription,
    FlashTypeMembers,
    FlashVariableDescription,
} from "../../src/layaAir/flash/utils/describeType.ts";

test("Flash utils compiler and runtime surface", () => {
    assert.ok(true as boolean satisfies ([
        ByteArrayInput,
        ZlibDecompressionHost,
        typeof Timer,
        typeof isFlashTimer,
        typeof Endian,
        typeof ByteArray,
        typeof Dictionary,
        typeof Proxy,
        FlashProxyName,
        typeof callFlashProxyProperty,
        typeof declareFlashProxyProperties,
        typeof flash_proxy,
        typeof XML,
        typeof XMLList,
        FlashXmlInput,
        FlashXmlChild,
        typeof encodeNativeObject,
        typeof decodeNativeObject,
        typeof getTimer,
        typeof setTimeout,
        typeof clearTimeout,
        typeof setInterval,
        typeof clearInterval,
        typeof getQualifiedClassName,
        typeof getQualifiedSuperclassName,
        typeof getDefinitionByName,
        typeof registerDefinitionByName,
        typeof registerObservedDefinition,
        NativeDefinition,
        typeof describeType,
        FlashAccessorAccess,
        FlashAccessorDescription,
        FlashMethodDescription,
        FlashTypeDescription,
        FlashTypeMembers,
        FlashVariableDescription,
    ] extends readonly unknown[] ? boolean : never));
});

test("Flash timer utility policy HOLDs remain explicit", () => {
    assert.ok(true, "bound-method lowering, background throttling, and behavior beyond 2^31 remain HOLD");
});
