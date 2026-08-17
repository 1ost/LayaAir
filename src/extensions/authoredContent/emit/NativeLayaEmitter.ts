import {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode,
    NeutralTimelineTrack
} from "../core/NeutralAuthoredContentIR";

export class NativeLayaEmitter {
    static createPrefabRoot(
        content: NeutralAuthoredContentIR,
        timelineAssetId: string,
        clip: Laya.AnimationClip2D
    ): Laya.Sprite {
        if (!timelineAssetId)
            throw new Error("AUTHORED_CONTENT_TIMELINE_ID_REQUIRED");
        const root = this.createNode(content.root);
        clip._setCreateURL(`res://${timelineAssetId}`, timelineAssetId);
        const AnimatorComponent = Laya.AnimatorClip2D as unknown as new () => Laya.Component;
        const animator = root.addComponent(AnimatorComponent) as unknown as Laya.AnimatorClip2D;
        animator.clip = clip;
        animator.autoPlay = true;
        return root;
    }

    static createTimeline(content: NeutralAuthoredContentIR): Laya.AnimationClip2D {
        const clip = new Laya.AnimationClip2D();
        const nativeClip = clip as NativeAnimationClip2D;
        nativeClip._frameRate = content.timeline.frameRate;
        nativeClip._duration = content.timeline.duration;
        clip.islooping = content.timeline.loop;
        nativeClip._nodesDic = {};
        nativeClip._nodesMap = {};

        const nodeList = new Laya.KeyframeNodeList2D();
        nodeList.count = content.timeline.tracks.length;
        const nativeOwnerPaths = this.collectNodeBindings(content).nativeOwnerPaths;
        content.timeline.tracks.forEach((track, index) => {
            const node = this.createTrack(track, nativeOwnerPaths);
            node._indexInList = index;
            nodeList.setNodeByIndex(index, node);
            nativeClip._nodesDic[node.fullPath] = node;
            const nodeMap = nativeClip._nodesMap[node.nodePath] || (nativeClip._nodesMap[node.nodePath] = []);
            nodeMap.push(node);
        });
        nativeClip._nodes = nodeList;
        return clip;
    }

    static createMetadata(content: NeutralAuthoredContentIR, timelineAssetId: string): NativeAuthoredContentMetadata {
        if (!timelineAssetId)
            throw new Error("AUTHORED_CONTENT_TIMELINE_ID_REQUIRED");
        const { nodes } = this.collectNodeBindings(content);
        return {
            schema: "laya-authored-content-metadata@1",
            documentId: content.documentId,
            rootLinkageClass: content.root.linkage,
            timelineAssetId,
            nodes
        };
    }

    private static createNode(source: NeutralAuthoredNode): Laya.Sprite {
        const node = source.kind === "text" ? new Laya.Text() : new Laya.Sprite();
        node.name = source.name ?? source.linkage;
        if (source.x !== undefined) node.x = source.x;
        if (source.y !== undefined) node.y = source.y;
        if (source.width !== undefined) node.width = source.width;
        if (source.height !== undefined) node.height = source.height;
        if (source.alpha !== undefined) node.alpha = source.alpha;
        if (source.visible !== undefined) node.visible = source.visible;
        if (node instanceof Laya.Text) {
            node.text = source.text!;
            if (source.fontSize !== undefined) node.fontSize = source.fontSize;
            if (source.color !== undefined) node.color = source.color;
        }
        source.children.forEach(child => node.addChild(this.createNode(child)));
        return node;
    }

    private static createTrack(
        track: NeutralTimelineTrack,
        nativeOwnerPaths: ReadonlyMap<string, ReadonlyArray<string>>
    ): Laya.KeyframeNode2D {
        const node = new Laya.KeyframeNode2D();
        const semanticPath = track.targetPath.join("/");
        const nativeOwnerPath = nativeOwnerPaths.get(semanticPath);
        if (!nativeOwnerPath)
            throw new Error(`AUTHORED_CONTENT_NATIVE_TIMELINE_TARGET_MISSING: ${semanticPath}`);
        const ownerPath = ["", ...nativeOwnerPath];
        node._setOwnerPathCount(ownerPath.length);
        ownerPath.forEach((value, index) => node._setOwnerPathByIndex(index, value));
        node._setPropertyCount(1);
        node._setPropertyByIndex(0, track.property);
        node.nodePath = node._joinOwnerPath("/");
        node.fullPath = `${node.nodePath}.${node._joinProperty(".")}`;
        node._setKeyframeCount(track.keyframes.length);
        track.keyframes.forEach((source, index) => {
            const keyframe = new Laya.Keyframe2D();
            keyframe.time = source.time;
            keyframe.data = {
                f: Math.round(source.time * 1000000),
                val: source.value,
                tweenType: source.tweenType
            };
            node._keyFrames[index] = keyframe;
        });
        return node;
    }

    private static collectNodeBindings(content: NeutralAuthoredContentIR): {
        nodes: NativeAuthoredContentNodeMetadata[];
        nativeOwnerPaths: Map<string, ReadonlyArray<string>>;
    } {
        const nodes: NativeAuthoredContentNodeMetadata[] = [];
        const nativeOwnerPaths = new Map<string, ReadonlyArray<string>>();
        const visit = (
            node: NeutralAuthoredNode,
            semanticParent: ReadonlyArray<string>,
            nativeParent: ReadonlyArray<string>,
            isRoot: boolean
        ) => {
            const semanticPath = [...semanticParent, node.linkage];
            const instanceName = node.name ?? node.linkage;
            const nativePath = [...nativeParent, instanceName];
            const animatorOwnerPath = isRoot ? [] : nativePath.slice(1);
            nodes.push({
                semanticPath,
                nativePath,
                animatorOwnerPath,
                linkageClass: node.linkage,
                instanceName,
                kind: node.kind
            });
            nativeOwnerPaths.set(semanticPath.join("/"), animatorOwnerPath);
            node.children.forEach(child => visit(child, semanticPath, nativePath, false));
        };
        visit(content.root, [], [], true);
        return { nodes, nativeOwnerPaths };
    }
}

export interface NativeAuthoredContentNodeMetadata {
    readonly semanticPath: ReadonlyArray<string>;
    readonly nativePath: ReadonlyArray<string>;
    readonly animatorOwnerPath: ReadonlyArray<string>;
    readonly linkageClass: string;
    readonly instanceName: string;
    readonly kind: "container" | "text";
}

export interface NativeAuthoredContentMetadata {
    readonly schema: "laya-authored-content-metadata@1";
    readonly documentId: string;
    readonly rootLinkageClass: string;
    readonly timelineAssetId: string;
    readonly nodes: ReadonlyArray<NativeAuthoredContentNodeMetadata>;
}

export type NativeAnimationClip2D = Laya.AnimationClip2D & {
    _frameRate: number;
    _duration: number;
    _animationEvents: Laya.Animation2DEvent[];
    _nodesDic: Record<string, Laya.KeyframeNode2D>;
    _nodesMap: Record<string, Laya.KeyframeNode2D[]>;
    _nodes: Laya.KeyframeNodeList2D | null;
};
