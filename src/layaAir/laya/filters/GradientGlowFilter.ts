import { FlashGradientFilterEffect2D } from "../display/effect2d/FlashGradientFilterEffect2D";
import { PostProcess2DEffect } from "../display/PostProcess2DEffect";
import { ClassUtils } from "../utils/ClassUtils";
import { Filter } from "./Filter";

export class GradientGlowFilter extends Filter {
    _effect2D: FlashGradientFilterEffect2D;

    constructor(
        colors: string[] = ["rgba(0,0,0,0)", "#ffffff"],
        ratios: number[] = [0, 255],
        blurX = 4,
        blurY = 4,
        angle = 0,
        distance = 0,
        strength = 1,
        inner = false,
        knockout = false,
        onTop = false,
        compositeSource = true,
    ) {
        super();
        this._effect2D = new FlashGradientFilterEffect2D({
            mode: "gradientGlow",
            colors,
            ratios,
            blurX,
            blurY,
            angle,
            distance,
            strength,
            inner,
            knockout,
            onTop,
            compositeSource,
        });
    }

    getEffect(): PostProcess2DEffect {
        return this._effect2D;
    }
}

ClassUtils.regClass("GradientGlowFilter", GradientGlowFilter);
