import bot from "../bot";
import { FindBlockOptions } from "mineflayer";
import { Vec3 } from 'vec3'
import Denque from 'denque';
import { pathfinder, goals, Movements } from 'mineflayer-pathfinder';
import { plugin as tool } from 'mineflayer-tool';
import { DIG_REACH, LEGACY_TREE_LOG_IDS, isTreeLogBlock, isWithinDigReach, keyOf, sortLogsForChopping } from "./tree";
import { Task } from "./taskController";

export type ChopTreePhase =
    | "idle"
    | "finding_tree"
    | "moving_to_tree"
    | "chopping_logs"
    | "clearing_blocks"
    | "done"
    | "failed"
    | "paused"
    | "cancelled";

type SerializableVec3 = {
    x: number;
    y: number;
    z: number;
};

export type ChopTreeStateSnapshot = {
    phase: ChopTreePhase;
    previousPhase: ChopTreePhase | null;
    startBlock: SerializableVec3 | null;
    logsToChop: SerializableVec3[];
    nextLogIndex: number;
    placedBlocks: SerializableVec3[];
    choppedCount: number;
    failedLogs: SerializableVec3[];
    lastError: string | null;
};

type ChopTreeState = {
    phase: ChopTreePhase;
    previousPhase: ChopTreePhase | null;
    startBlock: Vec3 | null;
    logsToChop: Vec3[];
    nextLogIndex: number;
    placedBlocks: Vec3[];
    choppedCount: number;
    failedLogs: Vec3[];
    lastError: string | null;
};

const vec3ToSnapshot = (pos: Vec3): SerializableVec3 => ({
    x: pos.x,
    y: pos.y,
    z: pos.z,
});

const errorToMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
};

export const findNearestTree = (shouldMoveNearTree = true) => {
    const options: FindBlockOptions = {
        matching: [...LEGACY_TREE_LOG_IDS],
        maxDistance: 16,
        count: 5
    };

    const tree = bot.findBlocks(options);
    
    if (tree.length > 0) {
        console.log(tree);
        const botPos = bot.entity.position;
        console.log(`Bot is at position: ${botPos}`);
        const { x, y, z } = tree[0];
        if (shouldMoveNearTree) {
            moveNearBlock(new Vec3(x, y, z));
            console.log(`Found a tree at ${x}, ${y}, ${z} and moving towards it.`);
        } else {
            console.log(`Found a tree at ${x}, ${y}, ${z}.`);
        }
    } else {
        console.log("No trees found nearby.");
    }

    return tree[0];
}

export const bfs = (pos: Vec3) => {
    const startBlock = bot.blockAt(pos);
    if (!isTreeLogBlock(startBlock)) return new Set<string>();

    const queue = new Denque<Vec3>();
    const visited = new Set<string>();
    const result = new Set<string>();

    visited.add(keyOf(pos));
    queue.push(pos);

    while (!queue.isEmpty()) {
        const currentPos = queue.shift()!;
        const { x, y, z } = currentPos;
        const block = bot.blockAt(currentPos);

        if (!isTreeLogBlock(block)) {
            continue;
        }

        result.add(keyOf(currentPos));

        const neighbors = [
            new Vec3(x + 1, y, z),
            new Vec3(x - 1, y, z),
            new Vec3(x, y + 1, z),
            new Vec3(x, y - 1, z),
            new Vec3(x, y, z + 1),
            new Vec3(x, y, z - 1),
        ];

        for (const neighbor of neighbors) {
            const key = keyOf(neighbor);

            if (!visited.has(key)) {
                visited.add(key);
                queue.push(neighbor);
            }
        }
    }

    return result;
};

export const getAllTreeBlocks = (treeBlock: Vec3) => {
    const treeBlocks = bfs(treeBlock);
    console.log(`Found ${treeBlocks.size} connected tree blocks.`);
    console.log(treeBlocks);
    return treeBlocks;
};

const ensurePathfinder = () => {
    if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
    }
};

const setTreeChoppingMovements = () => {
    ensurePathfinder();
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.scafoldingBlocks = bot.registry.itemsArray
        .filter((item) => {
            const registryItem = bot.registry.items[item.type];
            const block = bot.registry.blocksByName[registryItem?.name];
            return Boolean(block?.boundingBox === 'block');
        })
        .map((item) => item.type);
    bot.pathfinder.setMovements(movements);
};

const moveNearBlock = async (pos: Vec3, range = 2) => {
    ensurePathfinder();
    const { GoalNear } = goals;
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, range));
};

const moveToReachBlock = async (pos: Vec3) => {
    ensurePathfinder();
    const { GoalLookAtBlock, GoalNear } = goals;
    const movements = new Movements(bot);
    (movements as any).canPlaceBlocks = true;
    (movements as any).scafoldingBlocks = [
        2
    ];
    movements.allow1by1towers = true;
    bot.pathfinder.setMovements(movements);

    try {
        await bot.pathfinder.goto(new GoalLookAtBlock(pos, bot.world, { reach: DIG_REACH }));
    } catch (error) {
        await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, Math.floor(DIG_REACH)));
    }
};

const digReachableLog = async (pos: Vec3) => {
    let block = bot.blockAt(pos);
    if (!isTreeLogBlock(block)) return false;

    bot.loadPlugin(tool);
    await bot.tool.equipForBlock(block, {});

    if (!isWithinDigReach(bot.entity.position, pos) || !bot.canDigBlock(block)) {
        await moveToReachBlock(pos);
        block = bot.blockAt(pos);
        if (!isTreeLogBlock(block)) return false;
    }

    try {
        await bot.dig(block, false, 'raycast');
        return true;
    } catch (error) {
        await moveToReachBlock(pos);
        console.log(`Retrying dig after moving: ${pos.x}, ${pos.y}, ${pos.z}`);
        block = bot.blockAt(pos);
        if (!isTreeLogBlock(block)) return false;
        await bot.tool.equipForBlock(block, {});
        await bot.dig(block, false, 'raycast');
        return true;
    }
};

const clearBlocks = async (blocks: Vec3[]) => {
    for (const blockPos of blocks) {
        const block = bot.blockAt(blockPos);
        if (block && block.name !== "air") {
            try {
                await bot.dig(block, false, 'raycast');
                console.log(`Cleared block at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}.`);
            } catch (error) {
                console.log(`Failed to clear block at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}:`, error);
            }
        }
    }
};

const createInitialChopTreeState = (): ChopTreeState => ({
    phase: "idle",
    previousPhase: null,
    startBlock: null,
    logsToChop: [],
    nextLogIndex: 0,
    placedBlocks: [],
    choppedCount: 0,
    failedLogs: [],
    lastError: null,
});

export class ChopTreeTask implements Task {
    readonly name = "chop_tree";
    readonly priority = 50;

    private state: ChopTreeState = createInitialChopTreeState();
    private blockUpdateListener: ((oldBlock: any, newBlock: any) => void) | null = null;
    private runningPromise: Promise<number> | null = null;

    constructor(private readonly treeBlock?: Vec3) {}

    async start() {
        if (this.state.phase === "cancelled") {
            console.log("Cannot start a cancelled chop tree task.");
            return this.state.choppedCount;
        }

        if (this.runningPromise) {
            return this.runningPromise;
        }

        if (this.state.phase === "idle") {
            this.state.phase = "finding_tree";
            this.state.startBlock = this.treeBlock ?? null;
        }

        this.runningPromise = this.run().finally(() => {
            this.runningPromise = null;
        });
        return this.runningPromise;
    }

    async pause() {
        if (!this.canPause()) return;

        this.state.previousPhase = this.state.phase;
        this.state.phase = "paused";
        this.stopCurrentBotAction();
        console.log("Chop tree task paused.");
    }

    async resume() {
        if (this.state.phase === "cancelled") {
            console.log("Cannot resume a cancelled chop tree task.");
            return this.state.choppedCount;
        }

        if (this.state.phase !== "paused") {
            return this.start();
        }

        this.state.phase = this.state.previousPhase ?? "chopping_logs";
        this.state.previousPhase = null;
        console.log("Chop tree task resumed.");
        return this.start();
    }

    async cancel() {
        this.state.phase = "cancelled";
        this.state.previousPhase = null;
        this.stopCurrentBotAction();
        this.stopTrackingPlacedBlocks();
        console.log("Chop tree task cancelled.");
    }

    getState(): ChopTreeStateSnapshot {
        return {
            phase: this.state.phase,
            previousPhase: this.state.previousPhase,
            startBlock: this.state.startBlock ? vec3ToSnapshot(this.state.startBlock) : null,
            logsToChop: this.state.logsToChop.map(vec3ToSnapshot),
            nextLogIndex: this.state.nextLogIndex,
            placedBlocks: this.state.placedBlocks.map(vec3ToSnapshot),
            choppedCount: this.state.choppedCount,
            failedLogs: this.state.failedLogs.map(vec3ToSnapshot),
            lastError: this.state.lastError,
        };
    }

    private async run() {
        this.startTrackingPlacedBlocks();

        try {
            while (this.shouldKeepRunning()) {
                if (this.state.phase === "finding_tree") {
                    this.prepareTree();
                    continue;
                }

                if (this.state.phase === "moving_to_tree") {
                    await this.moveToTree();
                    continue;
                }

                if (this.state.phase === "chopping_logs") {
                    await this.chopNextLog();
                    continue;
                }

                if (this.state.phase === "clearing_blocks") {
                    await this.clearPlacedBlocks();
                    continue;
                }

                break;
            }
        } catch (error) {
            this.state.lastError = errorToMessage(error);

            if (this.state.phase === "paused" || this.state.phase === "cancelled") {
                return this.state.choppedCount;
            }

            this.state.phase = "failed";
            console.log("Chop tree task failed:", error);
        } finally {
            if (this.state.phase === "done" || this.state.phase === "failed" || this.state.phase === "cancelled") {
                this.stopTrackingPlacedBlocks();
            }
        }

        return this.state.choppedCount;
    }

    private prepareTree() {
        const startBlock = this.state.startBlock ?? findNearestTree(false);
        if (!startBlock) {
            console.log("No tree found to chop.");
            this.state.phase = "done";
            return;
        }

        this.state.startBlock = startBlock;
        const treeBlocks = getAllTreeBlocks(startBlock);
        this.state.logsToChop = sortLogsForChopping(startBlock, treeBlocks);
        this.state.nextLogIndex = 0;
        this.state.choppedCount = 0;
        this.state.failedLogs = [];
        this.state.lastError = null;

        console.log(`Chopping ${this.state.logsToChop.length} log blocks.`);
        this.state.phase = this.state.logsToChop.length > 0 ? "moving_to_tree" : "done";
    }

    private async moveToTree() {
        if (!this.state.startBlock) {
            this.state.phase = "finding_tree";
            return;
        }

        setTreeChoppingMovements();
        await moveNearBlock(this.state.startBlock);

        if (this.state.phase !== "paused" && this.state.phase !== "cancelled") {
            this.state.phase = "chopping_logs";
        }
    }

    private async chopNextLog() {
        if (this.state.nextLogIndex >= this.state.logsToChop.length) {
            this.state.phase = "clearing_blocks";
            return;
        }

        const logPos = this.state.logsToChop[this.state.nextLogIndex];
        let shouldAdvanceLogIndex = false;
        try {
            const didChop = await digReachableLog(logPos);
            if (this.state.phase === "paused" || this.state.phase === "cancelled") return;

            shouldAdvanceLogIndex = true;
            if (didChop) {
                this.state.choppedCount++;
                console.log(`Chopped log at ${logPos.x}, ${logPos.y}, ${logPos.z}.`);
            } else {
                this.state.failedLogs.push(logPos);
                console.log(`Skipped missing or unreachable log at ${logPos.x}, ${logPos.y}, ${logPos.z}.`);
            }
        } catch (error) {
            if (this.state.phase === "paused" || this.state.phase === "cancelled") return;

            shouldAdvanceLogIndex = true;
            this.state.failedLogs.push(logPos);
            this.state.lastError = errorToMessage(error);
            console.log(`Failed to chop log at ${logPos.x}, ${logPos.y}, ${logPos.z}:`, error);
        } finally {
            if (shouldAdvanceLogIndex) {
                this.state.nextLogIndex++;
            }
        }
    }

    private async clearPlacedBlocks() {
        await clearBlocks(this.state.placedBlocks);
        console.log(`Cleared ${this.state.placedBlocks.length} blocks placed by the bot during chopping.`);
        console.log(`Finished chopping tree. Chopped ${this.state.choppedCount}/${this.state.logsToChop.length} blocks.`);
        this.state.phase = "done";
    }

    private startTrackingPlacedBlocks() {
        if (this.blockUpdateListener) return;

        this.blockUpdateListener = (oldBlock, newBlock) => {
            if (this.state.phase === "paused" || this.state.phase === "cancelled") return;
            if (oldBlock.name !== "air" || newBlock.name === "air") return;

            const dist = bot.entity.position.distanceTo(newBlock.position);
            if (dist < 5) {
                this.state.placedBlocks.unshift(newBlock.position);
                console.log(`bot placed ${this.state.placedBlocks.length} block.`);
            }
        };
        bot.on('blockUpdate', this.blockUpdateListener);
    }

    private stopTrackingPlacedBlocks() {
        if (!this.blockUpdateListener) return;

        bot.removeListener('blockUpdate', this.blockUpdateListener);
        this.blockUpdateListener = null;
    }

    private canPause() {
        return this.state.phase !== "idle"
            && this.state.phase !== "paused"
            && this.state.phase !== "done"
            && this.state.phase !== "failed"
            && this.state.phase !== "cancelled";
    }

    private shouldKeepRunning() {
        return this.state.phase !== "paused"
            && this.state.phase !== "cancelled"
            && this.state.phase !== "done"
            && this.state.phase !== "failed";
    }

    private stopCurrentBotAction() {
        if (bot.pathfinder) {
            bot.pathfinder.setGoal(null);
        }

        const digger = bot as typeof bot & { stopDigging?: () => void };
        if (typeof digger.stopDigging === "function") {
            digger.stopDigging();
        }
    }
}

export const chopTree = async (treeBlock?: Vec3) => {
    const task = new ChopTreeTask(treeBlock);
    return task.start();
};
