import { ILaya, Mutable } from "../../ILaya";
import { Laya } from "../../Laya";
import { Input, type InputSelectionDirection, type InputSelectionState } from "../display/Input";
import { type Stage } from "../display/Stage";
import { Text } from "../display/Text";
import { Event } from "../events/Event";
import { InputManager } from "../events/InputManager";
import { Browser } from "../utils/Browser";
import { SpriteUtils } from "../utils/SpriteUtils";
import { PAL } from "./PlatformAdapters";

export interface TextBeforeInputData {
    text: string;
    inputType: string;
    isComposing: boolean;
    selectionStart: number;
    selectionEnd: number;
    nativeEvent: InputEvent | null;
    defaultPrevented: boolean;
    preventDefault(): void;
}

export interface TextCompositionData {
    text: string;
    selectionStart: number;
    selectionEnd: number;
    nativeEvent: CompositionEvent;
}

interface RestrictRange {
    first: number;
    last: number;
    include: boolean;
}

function restrictRanges(value: string): { initiallyAllowed: boolean, ranges: RestrictRange[] } {
    const characters = Array.from(value);
    let index = 0;
    let include = true;
    let initiallyAllowed = false;
    const tokens: Array<{ codePoint: number, escaped: boolean } | "exclude"> = [];
    while (index < characters.length) {
        const character = characters[index++];
        if (character === "\\" && index < characters.length)
            tokens.push({ codePoint: characters[index++].codePointAt(0), escaped: true });
        else if (character === "^")
            tokens.push("exclude");
        else
            tokens.push({ codePoint: character.codePointAt(0), escaped: false });
    }
    if (tokens[0] === "exclude") {
        initiallyAllowed = true;
        include = false;
        tokens.shift();
    }
    const ranges: RestrictRange[] = [];
    for (let cursor = 0; cursor < tokens.length;) {
        const token = tokens[cursor++];
        if (token === "exclude") {
            include = false;
            continue;
        }
        let last = token.codePoint;
        const hyphen = tokens[cursor];
        const end = tokens[cursor + 1];
        if (hyphen !== "exclude" && hyphen?.codePoint === 45 && !hyphen.escaped && end && end !== "exclude") {
            last = end.codePoint;
            cursor += 2;
        }
        ranges.push({ first: Math.min(token.codePoint, last), last: Math.max(token.codePoint, last), include });
    }
    return { initiallyAllowed, ranges };
}

/** Applies Flash TextField.restrict syntax, including ranges, exclusion and allowed-case conversion. */
export function applyTextInputRestriction(value: string, restrict: string | null | undefined): string {
    if (restrict == null)
        return value;
    if (restrict === "")
        return "";
    const parsed = restrictRanges(restrict);
    const allowed = (character: string): boolean => {
        const codePoint = character.codePointAt(0);
        let result = parsed.initiallyAllowed;
        for (const range of parsed.ranges) {
            if (codePoint >= range.first && codePoint <= range.last)
                result = range.include;
        }
        return result;
    };
    let result = "";
    for (const character of value) {
        if (allowed(character)) {
            result += character;
            continue;
        }
        const upper = character.toLocaleUpperCase();
        const lower = character.toLocaleLowerCase();
        if (upper !== character && Array.from(upper).length === 1 && allowed(upper))
            result += upper;
        else if (lower !== character && Array.from(lower).length === 1 && allowed(lower))
            result += lower;
    }
    return result;
}

/**
 * @ignore
 */
export class TextInputAdapter {
    readonly target: Input;

    protected _eInput: HTMLInputElement;
    protected _ePassword: HTMLInputElement;
    protected _eTextArea: HTMLTextAreaElement;
    protected _visEle: HTMLInputElement | HTMLTextAreaElement;
    protected _container: HTMLDivElement;
    protected _promptStyleDOM: HTMLElement;
    protected _enterEvent: Event;
    protected _lastTransform: { x: number, y: number, width: number, height: number, scaleX: number, scaleY: number };
    protected _beginFlag: number = 0;
    protected _composing: boolean = false;
    protected _compositionCommittedByBeforeInput: boolean = false;
    protected _compositionSnapshot: { value: string, selection: InputSelectionState } | null = null;

    /**
     * If true, the input box will be displayed inline with the canvas.
     * If false, use a pop-up keyboard to enter text.
     */
    protected _editInline: boolean = true;

    constructor() {
        this._enterEvent = new Event();
        this._lastTransform = <any>{};

        Laya.addAfterInitCallback(() => {
            ILaya.stage.on(Event.MOUSE_UP, this, this.onTouchEnd);
            InputManager.onMouseDownCapture.add(this.onTouchBegin, this);
        });
    }

    begin(target: Input, fromTouchBegin?: boolean): Promise<void> {
        if (this.target === target || this._beginFlag !== 0)
            return Promise.resolve();

        this._beginFlag = 1;
        return (this.target ? this.end(false, this.target.editable) : Promise.resolve()).then(() => {
            (<Mutable<this>>this).target = target;
            (<Mutable<Stage>>ILaya.stage).focus = target;

            this._lastTransform.x = null;

            target.on(Event.UNDISPLAY, this, this.end);

            return this.onBegin().catch(e => {
                console.error("TextInputAdapter begin error:", e);
            });
        }).then(() => {
            if (this._editInline) {
                this.target.hideText(true);
                ILaya.stage.on(Event.KEY_DOWN, this, this.onKeyDown);
            }
            target.event(Event.FOCUS);
        }).then(() => {
            if (!fromTouchBegin) {
                this._beginFlag = 0;
                return this.onCanShowKeyboard().catch(e => {
                    console.error("TextInputAdapter begin error:", e);
                });
            }
            else { //等待touchEnd再调用
                this._beginFlag = 2;
                return Promise.resolve();
            }
        });
    }

    end(complete?: boolean, switching?: boolean): Promise<void> {
        let target = this.target;
        if (!target)
            return Promise.resolve();

        (<Mutable<this>>this).target = null;
        (<Mutable<Stage>>ILaya.stage).focus = null;
        target.off(Event.UNDISPLAY, this, this.end);
        if (this._editInline)
            ILaya.stage.off(Event.KEY_DOWN, this, this.onKeyDown);

        return this.onEnd(target, !!complete, !!switching).then(() => {
            if (this._editInline)
                target.hideText(false);

            if (target.editable)
                target.event(Event.CHANGE);

            target.event(Event.BLUR);
        }).catch(e => {
            console.error("TextInputAdapter end error:", e);
        });
    }

    protected onBegin(): Promise<void> {
        this.showInputElement();

        let ele = this._visEle;
        let target = this.target;

        if (ele instanceof HTMLInputElement)
            ele.type = this.target.type;
        ele.readOnly = !target.editable;
        ele.maxLength = target.maxChars <= 0 ? 1E5 : target.maxChars;
        ele.value = this.target.text;
        ele.placeholder = target.localizedPrompt;
        const selection = target._getSelectionState();
        this.setSelection(selection.start, selection.end, selection.direction);

        let style = ele.style;
        style.fontFamily = target.realFont;
        style.color = target.color;
        style.fontSize = target.fontSize + 'px';
        style.whiteSpace = (target.wordWrap ? "pre-wrap" : "nowrap");
        style.lineHeight = (target.leading + target.fontSize) + "px";
        style.fontStyle = (target.italic ? "italic" : "normal");
        style.fontWeight = (target.bold ? "bold" : "normal");
        style.textAlign = target.align;
        style.padding = "0 0";
        style.direction = Text.RightToLeft ? "rtl" : "";

        this.setPromptColor();
        this.syncTransform();
        if (this._editInline)
            ILaya.systemTimer.frameLoop(1, this, this.syncTransform);

        return Promise.resolve();
    }

    //和onBegin区别在于，onBegin在touchBegin调用，这个在touchEnd调用
    protected onCanShowKeyboard(): Promise<void> {
        if (this._visEle)
            this._visEle.focus();
        return Promise.resolve();
    }

    protected onEnd(target: Input, complete: boolean, switching: boolean): Promise<void> {
        Browser.document.body.scrollTop = 0;
        this.updateTargetSelection(target);
        target.text = this._visEle.value;

        this._visEle.blur();
        this.hideInputElement();
        this._visEle = null;

        if (this._editInline)
            ILaya.systemTimer.clear(this, this.syncTransform);

        return Promise.resolve();
    }

    syncText() {
        if (this._visEle && this._beginFlag === 0 && !this._composing)
            this.updateTargetText(this._visEle.value);
    }

    setText(value: string) {
        if (this._visEle)
            this._visEle.value = value;
    }

    setSelection(startIndex: number, endIndex: number, direction: InputSelectionDirection = "none"): void {
        if (this._visEle) {
            const length = this._visEle.value.length;
            startIndex = Math.max(0, Math.min(length, startIndex));
            endIndex = endIndex < 0 ? length : Math.max(0, Math.min(length, endIndex));
            try {
                this._visEle.setSelectionRange(startIndex, endIndex, direction);
            } catch {
                // Some non-text HTML input types do not expose a selection.
            }
        }
    }

    syncSelection(): InputSelectionState | null {
        if (!this.target || !this._visEle)
            return null;
        return this.updateTargetSelection(this.target);
    }

    /** @internal Protected for platform adapters and real-input integration probes. */
    protected onTouchBegin(_touchId?: number, capturedTarget?: unknown): void {
        let lastFocus = ILaya.stage.focus;
        let touchTarget = capturedTarget ?? InputManager.touchTarget;
        if (lastFocus != touchTarget) {
            if (touchTarget instanceof Input && (touchTarget.editable || touchTarget.selectable))
                this.begin(touchTarget, true);
            else if (lastFocus instanceof Input)
                this.end();
        }
    }

    /** @internal Protected for platform adapters and real-input integration probes. */
    protected onTouchEnd(): void {
        if (this._beginFlag !== 0) {
            if (this._beginFlag === 1) { //如果onBegin还没完成，需要延时。一般不会发生
                ILaya.systemTimer.frameOnce(1, this, this.onTouchEnd);
            }
            else { //==2
                this._beginFlag = 0;
                this.onCanShowKeyboard().catch(e => {
                    console.error("TextInputAdapter begin error:", e);
                });
            }
        }
    }

    protected setPromptColor(): void {
        // 创建style标签
        this._promptStyleDOM = Browser.document.getElementById("promptStyle");
        if (!this._promptStyleDOM) {
            this._promptStyleDOM = Browser.document.createElement("style");
            this._promptStyleDOM.setAttribute("id", "promptStyle");
            Browser.document.head.appendChild(this._promptStyleDOM);
        }

        let color = this.target.promptColor;

        // 设置style标签
        this._promptStyleDOM.innerText = `input::-webkit-input-placeholder, textarea::-webkit-input-placeholder {
                color: ${color}
            }
            input:-moz-placeholder, textarea:-moz-placeholder {
                color: ${color}
            }
            input::-moz-placeholder, textarea::-moz-placeholder {
                color: ${color}
            }
            input:-ms-input-placeholder, textarea:-ms-input-placeholder {
                color: ${color}
            }
        `;
    }

    protected validateText(str: string): string {
        if (str == null)
            str = "";
        if (!this.target.multiline)
            str = str.replace(/[\r\n]/g, '');
        return applyTextInputRestriction(str, this.target.restrict);
    }

    protected showInputElement(): void {
        if (!this._eInput)
            this.createElements();

        let password = this.target.type === "password";
        let multiline = this.target.multiline && !password;
        let inputElement = (multiline ? this._eTextArea : password ? this._ePassword : this._eInput);
        this._visEle = inputElement;
        this._container.appendChild(inputElement);
    }

    protected hideInputElement(): void {
        if (this._visEle && this._visEle.parentElement)
            this._visEle.remove();
    }

    protected updateTargetText(value: string): boolean {
        let target = this.target;
        (<Mutable<this>>this).target = null;
        const before = target.text;
        target.text = value;
        const ret = target.text != before;
        (<Mutable<this>>this).target = target;
        return ret;
    }

    protected updateTargetSelection(target: Input): InputSelectionState {
        const previous = target._getSelectionState();
        const length = this._visEle?.value.length ?? target.text.length;
        const start = Math.max(0, Math.min(length, this._visEle?.selectionStart ?? previous.start));
        const end = Math.max(start, Math.min(length, this._visEle?.selectionEnd ?? previous.end));
        const direction = (this._visEle?.selectionDirection || "none") as InputSelectionDirection;
        if (target._setSelectionState(start, end, direction))
            target.event(Event.SELECTION_CHANGE, target._getSelectionState());
        return target._getSelectionState();
    }

    protected getTargetTransform() {
        let padding = this.target.padding;
        let { x, y, scaleX, scaleY } = SpriteUtils.getTransformRelativeToWindow(this.target, padding[3], padding[0]);
        let w = this.target.width - padding[1] - padding[3];
        let h = this.target.height - padding[0] - padding[2];

        let t = this._lastTransform;
        if (x !== t.x || y !== t.y || w !== t.width || h !== t.height || scaleX !== t.scaleX || scaleY !== t.scaleY) {
            t.x = x;
            t.y = y;
            t.width = w;
            t.height = h;
            t.scaleX = scaleX;
            t.scaleY = scaleY;
            return t;
        }
        else
            return null;
    }

    protected syncTransform(): void {
        let t = this.getTargetTransform();
        if (t != null) {
            let style = this._visEle.style;

            style.width = t.width + 'px';
            style.height = t.height + 'px';
            PAL.browser.setStyleTransform(style, "scale(" + t.scaleX + "," + t.scaleY + ") rotate(" + (ILaya.stage.canvasDegree) + "deg)");

            this._container.style.left = t.x + 'px';
            this._container.style.top = t.y + 'px';
        }
    }

    protected createElements(): void {
        this._container = Browser.document.createElement("div");
        Browser.container.appendChild(this._container);

        let style = this._container.style;
        style.position = "absolute";
        style.zIndex = '1E5';

        this.initElement(this._eTextArea = Browser.document.createElement("textarea"));
        this.initElement(this._eInput = Browser.document.createElement("input"));
        this.initElement(this._ePassword = Browser.document.createElement("input"));
    }

    protected initElement(input: HTMLInputElement | HTMLTextAreaElement): void {
        let style = input.style;
        style.cssText = "position:absolute;overflow:hidden;resize:none;";
        style.resize = 'none';
        style.backgroundColor = 'transparent';
        style.border = 'none';
        style.outline = 'none';
        style.zIndex = '1';
        PAL.browser.setStyleTransformOrigin(style, "0 0");

        input.addEventListener("beforeinput", ev => this.processBeforeInput(ev as InputEvent));
        input.addEventListener('input', ev => {
            const inputEvent = ev as InputEvent;
            if (!inputEvent.isComposing && !this._composing)
                this.processInputting(ev);
        });
        input.addEventListener("compositionstart", ev => this.processCompositionStart(ev as CompositionEvent));
        input.addEventListener("compositionupdate", ev => this.processCompositionUpdate(ev as CompositionEvent));
        input.addEventListener("compositionend", ev => this.processCompositionEnd(ev as CompositionEvent));
        input.addEventListener("select", () => this.syncSelection());
        input.addEventListener("keyup", () => this.syncSelection());
        input.addEventListener("mouseup", () => this.syncSelection());

        input.addEventListener('mousemove', ev => this.stopEvent(ev), { passive: false });
        input.addEventListener('mousedown', ev => this.stopEvent(ev), { passive: false });
        input.addEventListener('touchmove', ev => this.stopEvent(ev), { passive: false });
    }

    protected processInputting(ev: globalThis.Event): void {
        if (!this.target)
            return;

        let ele = <HTMLInputElement | HTMLTextAreaElement>ev.target;
        const rawValue = ele.value;
        const rawStart = ele.selectionStart ?? rawValue.length;
        const rawEnd = ele.selectionEnd ?? rawStart;
        const direction = (ele.selectionDirection || "none") as InputSelectionDirection;
        let value = this.validateText(rawValue);
        if (value !== rawValue) {
            // Assigning value resets the browser caret to the end. Map both
            // UTF-16 selection endpoints through the same validation pass so
            // a rejected character disappears in place instead.
            const start = this.validateText(rawValue.slice(0, rawStart)).length;
            const end = this.validateText(rawValue.slice(0, rawEnd)).length;
            ele.value = value;
            this.setSelection(start, end, direction);
        }
        this.updateTargetSelection(this.target);
        if (this.updateTargetText(value))
            this.target.event(Event.INPUT);
    }

    protected processBeforeInput(ev: InputEvent): void {
        if (!this.target || ev.isComposing)
            return;
        if (this._composing)
            this._compositionCommittedByBeforeInput = true;
        const selection = this.updateTargetSelection(this.target);
        const dataTransfer = (ev as InputEvent & { dataTransfer?: DataTransfer | null }).dataTransfer;
        const text = ev.data ?? dataTransfer?.getData("text/plain") ?? "";
        const payload = this.createBeforeInputData(text, ev.inputType ?? "", false, selection, ev);
        this.target.event(Event.BEFORE_INPUT, payload);
        if (payload.defaultPrevented && ev.cancelable)
            ev.preventDefault();
    }

    protected processCompositionStart(ev: CompositionEvent): void {
        if (!this.target || !this._visEle)
            return;
        const selection = this.updateTargetSelection(this.target);
        this._composing = true;
        this._compositionCommittedByBeforeInput = false;
        this._compositionSnapshot = { value: this._visEle.value, selection };
        this.target._setCompositionState(true, ev.data ?? "");
        this.target.event(Event.COMPOSITION_START, this.compositionData(ev));
    }

    protected processCompositionUpdate(ev: CompositionEvent): void {
        if (!this.target)
            return;
        this.updateTargetSelection(this.target);
        this.target._setCompositionState(true, ev.data ?? "");
        this.target.event(Event.COMPOSITION_UPDATE, this.compositionData(ev));
    }

    protected processCompositionEnd(ev: CompositionEvent): void {
        if (!this.target || !this._visEle)
            return;
        const snapshot = this._compositionSnapshot;
        if (!this._compositionCommittedByBeforeInput && snapshot) {
            const payload = this.createBeforeInputData(
                ev.data ?? "",
                "insertCompositionText",
                false,
                snapshot.selection,
                null,
            );
            this.target.event(Event.BEFORE_INPUT, payload);
            if (payload.defaultPrevented) {
                this._visEle.value = snapshot.value;
                this.setSelection(snapshot.selection.start, snapshot.selection.end, snapshot.selection.direction);
            }
        }
        this._compositionSnapshot = null;
        this._compositionCommittedByBeforeInput = false;
        this.target._setCompositionState(false, "");
        this.target.event(Event.COMPOSITION_END, this.compositionData(ev));
        this._composing = false;
        this.processInputting(ev);
    }

    protected createBeforeInputData(
        text: string,
        inputType: string,
        isComposing: boolean,
        selection: InputSelectionState,
        nativeEvent: InputEvent | null,
    ): TextBeforeInputData {
        return {
            text,
            inputType,
            isComposing,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            nativeEvent,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
        };
    }

    protected compositionData(ev: CompositionEvent): TextCompositionData {
        const selection = this.target?._getSelectionState() ?? { start: 0, end: 0 };
        return {
            text: ev.data ?? "",
            selectionStart: selection.start,
            selectionEnd: selection.end,
            nativeEvent: ev,
        };
    }

    protected stopEvent(e: any): void {
        if (e.type == 'touchmove')
            e.preventDefault();
        e.stopPropagation && e.stopPropagation();
    }

    protected onKeyDown(e: KeyboardEvent): void {
        if (e.key === "Enter" || e.key === "NumpadEnter") {
            let target = this.target;
            if (!target.multiline) {
                e.preventDefault();

                this._enterEvent.setTo(Event.ENTER, this.target, this.target);
                target.event(Event.ENTER, this._enterEvent);
                if (!this._enterEvent._defaultPrevented && this.target === target)
                    this.end();
            }
        }
    }
}

PAL.register("textInput", TextInputAdapter);
