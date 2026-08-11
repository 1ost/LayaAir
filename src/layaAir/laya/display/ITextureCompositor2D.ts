import type { IRenderContext2D } from "../RenderDriver/DriverDesign/2DRenderPass/IRenderContext2D";
import type { Material } from "../resource/Material";
import type { RenderTexture2D } from "../resource/RenderTexture2D";

/**
 * Replaces the final textured-quad material used to composite an off-screen
 * Sprite into its parent pass. The hooks run at the exact draw position, so a
 * compositor can capture pixels already drawn in the active target.
 */
export interface ITextureCompositor2D {
    readonly material: Material;
    beforeComposite?(context: IRenderContext2D, source: RenderTexture2D): void;
    afterComposite?(context: IRenderContext2D, source: RenderTexture2D): void;
    destroy?(): void;
}
