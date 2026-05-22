import { Vec3 } from "vec3";

export const DIG_REACH = 4.5;
export const BOT_EYE_HEIGHT = 1.6;
export const LEGACY_TREE_LOG_IDS = new Set([17, 162]);

export const keyOf = (pos: Vec3) => `${pos.x},${pos.y},${pos.z}`;

export const keyToVec3 = (key: string) => {
    const [x, y, z] = key.split(",").map(Number);
    return new Vec3(x, y, z);
};

export const isModernLogBlockName = (name?: string) => {
    if (!name) return false;
    return name.endsWith("_log") || name.endsWith("_wood") || name.endsWith("_stem") || name.endsWith("_hyphae");
};

export const isTreeLogBlock = (block?: { type?: number; name?: string } | null) => {
    if (!block) return false;
    return LEGACY_TREE_LOG_IDS.has(block.type ?? -1) || isModernLogBlockName(block.name);
};

export const isWithinDigReach = (botFeetPos: Vec3, blockPos: Vec3, reach = DIG_REACH) => {
    const eyePos = botFeetPos.offset(0, BOT_EYE_HEIGHT, 0);
    const blockCenter = blockPos.offset(0.5, 0.5, 0.5);
    return eyePos.distanceTo(blockCenter) <= reach;
};

export const sortLogsForChopping = (startBlock: Vec3, treeBlocks: Set<string>) => {
    return [...treeBlocks]
        .map(keyToVec3)
        .sort((a, b) => {
            const yDiff = a.y - b.y;
            if (yDiff !== 0) return yDiff;

            const aDistance = a.distanceTo(startBlock);
            const bDistance = b.distanceTo(startBlock);
            if (aDistance !== bDistance) return aDistance - bDistance;

            if (a.x !== b.x) return a.x - b.x;
            return a.z - b.z;
        });
};
