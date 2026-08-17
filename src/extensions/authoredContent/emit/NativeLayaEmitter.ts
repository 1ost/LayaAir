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
        content.timeline.tracks.forEach((track, index) => {
            const node = this.createTrack(track);
            node._indexInList = index;
            nodeList.setNodeByIndex(index, node);
            nativeClip._nodesDic[node.fullPath] = node;
            const nodeMap = nativeClip._nodesMap[node.nodePath] || (nativeClip._nodesMap[node.nodePath] = []);
            nodeMap.push(node);
        });
        nativeClip._nodes = nodeList;
        return clip;
    }

    private static createNode(source: NeutralAuthoredNode): Laya.Sprite {
        const node = source.kind === "text" ? new Laya.Text() : new Laya.Sprite();
        node.name = source.linkage;
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

    private static createTrack(track: NeutralTimelineTrack): Laya.KeyframeNode2D {
        const node = new Laya.KeyframeNode2D();
        const ownerPath = ["", ...track.targetPath];
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
}

export type NativeAnimationClip2D = Laya.AnimationClip2D & {
    _frameRate: number;
    _duration: number;
    _animationEvents: Laya.Animation2DEvent[];
    _nodesDic: Record<string, Laya.KeyframeNode2D>;
    _nodesMap: Record<string, Laya.KeyframeNode2D[]>;
    _nodes: Laya.KeyframeNodeList2D | null;
};
