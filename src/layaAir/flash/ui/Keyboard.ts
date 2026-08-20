import { Keyboard as LayaKeyboard } from "../../laya/events/Keyboard";

export interface FlashKeyboardStateLease {
    dispose(): void;
}

interface LockState {
    capsLock: boolean;
    numLock: boolean;
}

let currentLockState: LockState | null = null;
let currentKeyboardOwner: object | null = null;
let keyboardInstallGeneration = 0;

function readLockState(event: Event): LockState {
    const keyboard = event as KeyboardEvent;
    if (typeof keyboard.getModifierState !== "function")
        return { capsLock: false, numLock: false };
    return {
        capsLock: keyboard.getModifierState("CapsLock"),
        numLock: keyboard.getModifierState("NumLock"),
    };
}

/**
 * Installs the narrow native producer for Flash's synchronous lock-key state.
 * The latest trusted keyboard event owns the snapshot; disposal clears it so
 * stale browser state cannot leak into a later Stage.
 */
export function installNativeKeyboardStateHost(target: EventTarget): FlashKeyboardStateLease {
    if (!target || typeof target.addEventListener !== "function"
        || typeof target.removeEventListener !== "function")
        throw new TypeError("Flash Keyboard state requires an EventTarget");
    const installGeneration = ++keyboardInstallGeneration;
    const owner = Object.freeze({});
    const update = (event: Event): void => {
        if (event.isTrusted && currentKeyboardOwner === owner) currentLockState = readLockState(event);
    };
    try {
        target.addEventListener("keydown", update);
        target.addEventListener("keyup", update);
    } catch (error) {
        for (const type of ["keydown", "keyup"]) {
            try { target.removeEventListener(type, update); }
            catch { /* Preserve the installation failure after attempting both removals. */ }
        }
        throw error;
    }
    if (keyboardInstallGeneration !== installGeneration) {
        const error = new Error("Flash Keyboard host installation was superseded reentrantly");
        for (const type of ["keydown", "keyup"]) {
            try { target.removeEventListener(type, update); }
            catch { /* Preserve the supersession error after attempting both removals. */ }
        }
        throw error;
    }
    currentKeyboardOwner = owner;
    currentLockState = null;
    let disposed = false;
    return Object.freeze({
        dispose(): void {
            if (disposed) return;
            disposed = true;
            if (currentKeyboardOwner === owner) {
                currentKeyboardOwner = null;
                currentLockState = null;
            }
            let caught = false;
            let firstError: unknown;
            for (const type of ["keydown", "keyup"]) {
                try { target.removeEventListener(type, update); }
                catch (error) {
                    if (!caught) {
                        caught = true;
                        firstError = error;
                    }
                }
            }
            if (caught) throw firstError;
        },
    });
}

/** Source-used Flash key-code authority backed by Laya's canonical constants. */
export class Keyboard {
    static readonly NUMBER_0 = LayaKeyboard.NUMBER_0;
    static readonly NUMBER_1 = LayaKeyboard.NUMBER_1;
    static readonly NUMBER_2 = LayaKeyboard.NUMBER_2;
    static readonly NUMBER_3 = LayaKeyboard.NUMBER_3;
    static readonly NUMBER_4 = LayaKeyboard.NUMBER_4;
    static readonly NUMBER_5 = LayaKeyboard.NUMBER_5;
    static readonly NUMBER_6 = LayaKeyboard.NUMBER_6;
    static readonly NUMBER_7 = LayaKeyboard.NUMBER_7;
    static readonly NUMBER_8 = LayaKeyboard.NUMBER_8;
    static readonly NUMBER_9 = LayaKeyboard.NUMBER_9;
    static readonly A = LayaKeyboard.A;
    static readonly B = LayaKeyboard.B;
    static readonly C = LayaKeyboard.C;
    static readonly D = LayaKeyboard.D;
    static readonly E = LayaKeyboard.E;
    static readonly F = LayaKeyboard.F;
    static readonly G = LayaKeyboard.G;
    static readonly H = LayaKeyboard.H;
    static readonly I = LayaKeyboard.I;
    static readonly J = LayaKeyboard.J;
    static readonly K = LayaKeyboard.K;
    static readonly L = LayaKeyboard.L;
    static readonly M = LayaKeyboard.M;
    static readonly N = LayaKeyboard.N;
    static readonly O = LayaKeyboard.O;
    static readonly P = LayaKeyboard.P;
    static readonly Q = LayaKeyboard.Q;
    static readonly R = LayaKeyboard.R;
    static readonly S = LayaKeyboard.S;
    static readonly T = LayaKeyboard.T;
    static readonly U = LayaKeyboard.U;
    static readonly V = LayaKeyboard.V;
    static readonly W = LayaKeyboard.W;
    static readonly X = LayaKeyboard.X;
    static readonly Y = LayaKeyboard.Y;
    static readonly Z = LayaKeyboard.Z;
    static readonly F1 = LayaKeyboard.F1;
    static readonly F2 = LayaKeyboard.F2;
    static readonly F3 = LayaKeyboard.F3;
    static readonly F4 = LayaKeyboard.F4;
    static readonly F5 = LayaKeyboard.F5;
    static readonly F6 = LayaKeyboard.F6;
    static readonly F7 = LayaKeyboard.F7;
    static readonly F8 = LayaKeyboard.F8;
    static readonly F9 = LayaKeyboard.F9;
    static readonly F10 = LayaKeyboard.F10;
    static readonly F11 = LayaKeyboard.F11;
    static readonly F12 = LayaKeyboard.F12;
    static readonly NUMPAD_0 = LayaKeyboard.NUMPAD_0;
    static readonly NUMPAD_1 = LayaKeyboard.NUMPAD_1;
    static readonly NUMPAD_2 = LayaKeyboard.NUMPAD_2;
    static readonly NUMPAD_3 = LayaKeyboard.NUMPAD_3;
    static readonly NUMPAD_4 = LayaKeyboard.NUMPAD_4;
    static readonly NUMPAD_5 = LayaKeyboard.NUMPAD_5;
    static readonly NUMPAD_6 = LayaKeyboard.NUMPAD_6;
    static readonly NUMPAD_7 = LayaKeyboard.NUMPAD_7;
    static readonly NUMPAD_8 = LayaKeyboard.NUMPAD_8;
    static readonly NUMPAD_9 = LayaKeyboard.NUMPAD_9;
    static readonly NUMPAD_MULTIPLY = LayaKeyboard.NUMPAD_MULTIPLY;
    static readonly NUMPAD_ADD = LayaKeyboard.NUMPAD_ADD;
    static readonly NUMPAD_ENTER = LayaKeyboard.NUMPAD_ENTER;
    static readonly NUMPAD_SUBTRACT = LayaKeyboard.NUMPAD_SUBTRACT;
    static readonly NUMPAD_DECIMAL = LayaKeyboard.NUMPAD_DECIMAL;
    static readonly NUMPAD_DIVIDE = LayaKeyboard.NUMPAD_DIVIDE;
    static readonly SEMICOLON = LayaKeyboard.SEMICOLON;
    static readonly QUOTE = LayaKeyboard.QUOTE;
    static readonly ALTERNATE = LayaKeyboard.ALTERNATE;
    static readonly BACKSPACE = LayaKeyboard.BACKSPACE;
    static readonly CAPS_LOCK = LayaKeyboard.CAPS_LOCK;
    static readonly COMMAND = LayaKeyboard.COMMAND;
    static readonly CONTROL = LayaKeyboard.CONTROL;
    static readonly DELETE = LayaKeyboard.DELETE;
    static readonly ENTER = LayaKeyboard.ENTER;
    static readonly ESCAPE = LayaKeyboard.ESCAPE;
    static readonly PAGE_UP = LayaKeyboard.PAGE_UP;
    static readonly PAGE_DOWN = LayaKeyboard.PAGE_DOWN;
    static readonly END = LayaKeyboard.END;
    static readonly HOME = LayaKeyboard.HOME;
    static readonly LEFT = LayaKeyboard.LEFT;
    static readonly UP = LayaKeyboard.UP;
    static readonly RIGHT = LayaKeyboard.RIGHT;
    static readonly DOWN = LayaKeyboard.DOWN;
    static readonly SHIFT = LayaKeyboard.SHIFT;
    static readonly SPACE = LayaKeyboard.SPACE;
    static readonly TAB = LayaKeyboard.TAB;
    static readonly INSERT = LayaKeyboard.INSERT;

    static get capsLock(): boolean { return currentLockState?.capsLock ?? false; }
    static get numLock(): boolean { return currentLockState?.numLock ?? false; }
    static isAccessible(): boolean {
        if (arguments.length !== 0) throw new TypeError("Keyboard.isAccessible does not accept arguments");
        return true;
    }

    private constructor() { throw new TypeError("Keyboard is a static class"); }
}

Object.freeze(Keyboard);
