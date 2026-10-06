/** Engine-independent, baked package contract. Workbench files remain authoritative. */
export interface Point { x: number; y: number }
export interface FrameBox {
    kind: string;
    enabled: boolean;
    /** Center, relative to the animation origin, in pixels with Y down. */
    position: Point;
    size: Point;
    /** Clockwise degrees in the package coordinate system. */
    rotation: number;
}
export interface FrameAudio { path: string; volume?: number }
export interface BakedFrame {
    sourceFrame: number;
    path: string;
    width: number;
    height: number;
    origin: Point;
    /** Optional crop within an already baked atlas; sourceCrop metadata is never applied twice. */
    atlasRect?: { x: number; y: number; width: number; height: number };
    durationMs: number;
    disabled?: boolean;
    boxes: FrameBox[];
    audio: FrameAudio[];
}
export interface BakedAnimation {
    id: string;
    name: string;
    profileId?: string;
    loop: boolean;
    sourceFacesLeft?: boolean;
    frames: BakedFrame[];
}
export interface FrameTunerPackage {
    schema: 'frame-tuner-package-v1';
    version: 1;
    projectId: string;
    bakedVisual: true;
    coordinateSystem: { unit: 'pixel'; x: 'right'; y: 'down' };
    animations: BakedAnimation[];
}

/** Sprite position and anchor already contain every visual transform from the workbench. */
export function frameAnchor(frame: BakedFrame): Point {
    return { x: frame.origin.x / frame.width, y: 1 - frame.origin.y / frame.height };
}

export function boxCorners(box: FrameBox, mirrored: boolean, pixelsPerUnit = 1): Point[] {
    if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) throw new Error('pixelsPerUnit must be positive.');
    const angle = box.rotation * Math.PI / 180;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const dx = x * box.size.x / 2, dy = y * box.size.y / 2;
        return {
            x: (box.position.x + dx * cosine - dy * sine) * (mirrored ? -1 : 1) / pixelsPerUnit,
            y: -(box.position.y + dx * sine + dy * cosine) / pixelsPerUnit,
        };
    });
}
