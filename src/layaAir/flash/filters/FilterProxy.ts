import { DisplayObject, isFlashDisplayObject } from "../display/DisplayObject";
import { BitmapData, isFlashBitmapData } from "../display/BitmapData";
import { Point } from "../geom/Point";
import { BitmapFilter } from "./BitmapFilter";
import { isBlurFilter } from "./BlurFilter";
import { isDropShadowFilter } from "./DropShadowFilter";
import { bitmapFilterEquals, isBitmapFilter } from "./FilterRegistry";
import { isGlowFilter } from "./GlowFilter";
import { isGradientBevelFilter } from "./GradientBevelFilter";

type FilterProxyProperty =
    "blurX" | "blurY" | "quality" | "color" | "alpha" | "strength"
    | "inner" | "knockout" | "distance" | "angle" | "hideObject" | "type";

/**
 * Sealed native replacement for the source dynamic Proxy.
 *
 * Property forwarding and detached-filter equality are explicit. This helper
 * does not depend on flash_proxy, AMF serialization, or JavaScript Proxy traps.
 */
export class FilterProxy {
    autoUpdateIndex: boolean;
    callLater: boolean;
    private _filter: BitmapFilter | null = null;
    private _owner: DisplayObject | null = null;
    private _index: number = -1;
    private _scheduled: boolean = false;
    private _generation: number = 0;

    constructor(filter: BitmapFilter | null = null, autoUpdateIndex = false, callLater = false) {
        this.filter = filter;
        this.autoUpdateIndex = Boolean(autoUpdateIndex);
        this.callLater = Boolean(callLater);
        Object.seal(this);
    }

    get filter(): BitmapFilter | null { return this._filter; }
    set filter(value: BitmapFilter | null) {
        if (value !== null && !isBitmapFilter(value)) throw new TypeError("FilterProxy.filter must be a concrete native BitmapFilter or null");
        this._filter = value;
    }
    get owner(): DisplayObject | null { return this._owner; }
    set owner(value: DisplayObject | null) {
        if (value !== null && !isFlashDisplayObject(value)) throw new TypeError("FilterProxy.owner must be a native flash.display.DisplayObject or null");
        this._owner = value;
    }
    get index(): number { return this._index; }
    get blurX(): number | null { return this.numericProperty("blurX"); }
    set blurX(value: number) { this.setProperty("blurX", value); }
    get blurY(): number | null { return this.numericProperty("blurY"); }
    set blurY(value: number) { this.setProperty("blurY", value); }

    updateIndex(): number {
        const owner = this.owner;
        const filter = this.filter;
        if (this._index !== -1 && owner && filter) {
            const values = owner.filters;
            if (bitmapFilterEquals(values[this._index] ?? null, filter)) return this._index;
            for (let index = 0; index < values.length; index++) {
                if (index !== this._index && bitmapFilterEquals(values[index], filter)) {
                    this._index = index;
                    return index;
                }
            }
        }
        this._index = -1;
        return -1;
    }

    applyFilter(owner: DisplayObject | BitmapData): void {
        if (isFlashBitmapData(owner)) {
            if (!this.filter) return;
            owner.applyFilter(owner, owner.rect, new Point(), this.filter);
            if (this.callLater) this.scheduleUpdate();
            return;
        }
        if (!isFlashDisplayObject(owner))
            throw new TypeError("FilterProxy.applyFilter requires a native flash.display.DisplayObject or BitmapData");
        if (!this.filter) return;
        this.owner = owner;
        const values = owner.filters;
        values.push(this.filter);
        owner.filters = values;
        this._index = values.length - 1;
    }

    changeFilter(filter: BitmapFilter | null): void {
        this.updateIndex();
        this.filter = filter;
        this.updateFilter();
    }

    removeFilter(): void {
        this.updateIndex();
        if (this.owner && this.index !== -1) {
            const values = this.owner.filters;
            values.splice(this.index, 1);
            this.owner.filters = values;
        }
        this.owner = null;
        this._index = -1;
    }

    updateFilter(): void {
        if (!this.owner || this.index === -1 || !this.filter) return;
        const values = this.owner.filters;
        if (!values[this.index]) this.updateIndex();
        if (this.index !== -1 && values[this.index]) {
            values[this.index] = this.filter;
            this.owner.filters = values;
        }
    }

    getProperty(name: FilterProxyProperty): number | boolean | string | null {
        const filter = this.filter;
        if (!filter) return null;
        switch (name) {
            case "blurX": return isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.blurX : null;
            case "blurY": return isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.blurY : null;
            case "quality": return isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.quality : null;
            case "color": return isGlowFilter(filter) || isDropShadowFilter(filter) ? filter.color : null;
            case "alpha": return isGlowFilter(filter) || isDropShadowFilter(filter) ? filter.alpha : null;
            case "strength": return isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.strength : null;
            case "inner": return isGlowFilter(filter) || isDropShadowFilter(filter) ? filter.inner : null;
            case "knockout": return isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.knockout : null;
            case "distance": return isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.distance : null;
            case "angle": return isDropShadowFilter(filter) || isGradientBevelFilter(filter) ? filter.angle : null;
            case "hideObject": return isDropShadowFilter(filter) ? filter.hideObject : null;
            case "type": return isGradientBevelFilter(filter) ? filter.type : null;
        }
    }

    setProperty(name: FilterProxyProperty, value: number | boolean | string): void {
        if (this.autoUpdateIndex) this.updateIndex();
        const filter = this.filter;
        if (filter) {
            switch (name) {
                case "blurX":
                    if (isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.blurX = Number(value);
                    else this.unsupported(name);
                    break;
                case "blurY":
                    if (isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.blurY = Number(value);
                    else this.unsupported(name);
                    break;
                case "quality":
                    if (isBlurFilter(filter) || isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.quality = Number(value);
                    else this.unsupported(name);
                    break;
                case "color":
                    if (isGlowFilter(filter) || isDropShadowFilter(filter)) filter.color = Number(value);
                    else this.unsupported(name);
                    break;
                case "alpha":
                    if (isGlowFilter(filter) || isDropShadowFilter(filter)) filter.alpha = Number(value);
                    else this.unsupported(name);
                    break;
                case "strength":
                    if (isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.strength = Number(value);
                    else this.unsupported(name);
                    break;
                case "inner":
                    if (isGlowFilter(filter) || isDropShadowFilter(filter)) filter.inner = Boolean(value);
                    else this.unsupported(name);
                    break;
                case "knockout":
                    if (isGlowFilter(filter) || isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.knockout = Boolean(value);
                    else this.unsupported(name);
                    break;
                case "distance":
                    if (isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.distance = Number(value); else this.unsupported(name);
                    break;
                case "angle":
                    if (isDropShadowFilter(filter) || isGradientBevelFilter(filter)) filter.angle = Number(value); else this.unsupported(name);
                    break;
                case "hideObject":
                    if (isDropShadowFilter(filter)) filter.hideObject = Boolean(value); else this.unsupported(name);
                    break;
                case "type":
                    if (isGradientBevelFilter(filter)) filter.type = String(value); else this.unsupported(name);
                    break;
            }
        }
        if (this.callLater) this.scheduleUpdate(); else this.updateFilter();
    }

    destroy(): void {
        this._generation++;
        this._scheduled = false;
        this.owner = null;
        this._index = -1;
    }

    /** Source spelling retained as a narrow migration alias. */
    destory(): void { this.destroy(); }

    private numericProperty(name: "blurX" | "blurY"): number | null {
        const value = this.getProperty(name);
        return typeof value === "number" ? value : null;
    }

    private unsupported(name: FilterProxyProperty): never {
        throw new TypeError(`Filter property '${name}' is not supported by the authenticated filter kind`);
    }

    private scheduleUpdate(): void {
        if (this._scheduled) return;
        this._scheduled = true;
        const generation = this._generation;
        queueMicrotask(() => {
            if (generation !== this._generation) return;
            this._scheduled = false;
            this.updateFilter();
        });
    }
}
