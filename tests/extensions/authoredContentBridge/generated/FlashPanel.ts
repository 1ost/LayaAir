// Generated port fixture: source-visible Flash APIs over the canonical authored-content runtime.
import {
    DisplayObject, Event, MovieClip, MouseEvent, SimpleButton
} from "../../../../src/layaAir/flash";
import { bindAS3Method } from "../../../../src/extensions/authoredContent/runtime/bindAS3Method";

export class ButtonStateLinkage extends DisplayObject { }
export class SubmitButtonLinkage extends SimpleButton { }

export class FlashPanel extends MovieClip {
    declare public submitButton: SubmitButtonLinkage;
    public status = "idle";
    public clickCount = 0;

    constructor() {
        super();
        bindAS3Method(this, "onSubmit");
        bindAS3Method(this, "onChange");
    }

    activate(): void {
        this.submitButton.addEventListener(MouseEvent.CLICK, this.onSubmit);
        this.addEventListener(Event.CHANGE, this.onChange);
    }
    deactivate(): void {
        this.submitButton.removeEventListener(MouseEvent.CLICK, this.onSubmit);
        this.removeEventListener(Event.CHANGE, this.onChange);
    }
    private onSubmit(_event: MouseEvent): void {
        this.clickCount++;
        this.status = "clicked";
        this.gotoAndStop("done");
    }
    private onChange(event: Event): void { this.status = event.type; }
}
