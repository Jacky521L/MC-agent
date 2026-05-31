import bot from "../bot";
import { Vec3 } from "vec3";
import { Entity } from "prismarine-entity";
import { Item } from "prismarine-item";
import { goals, Movements, pathfinder } from "mineflayer-pathfinder";
import { ChopTreeTask } from "./logging";
import { Task } from "./taskController";

type ChestWindowLike = {
    inventoryStart: number;
    slots: unknown[];
};

export type FillChestWithLogsPhase =
    | "idle"
    | "checking_chest"
    | "chopping_tree"
    | "collecting_drops"
    | "returning_to_chest"
    | "depositing_logs"
    | "done"
    | "failed"
    | "paused"
    | "cancelled";

type FillChestWithLogsState = {
    phase: FillChestWithLogsPhase;
    previousPhase: FillChestWithLogsPhase | null;
    chestPosition: Vec3;
    treesChopped: number;
    logsCollected: number;
    logsDeposited: number;
    lastError: string | null;
};

const CHEST_IDLE_RANGE = 3;
const PLAYER_CHEST_TARGET_RANGE = 64;
const LOG_DROP_COLLECTION_RADIUS = 16;
const LOG_DROP_PICKUP_RANGE = 1;
const LOG_DROP_COLLECTION_PASSES = 12;
const LOG_DROP_SETTLE_DELAY_MS = 350;
const LOG_PICKUP_WAIT_MS = 450;

const errorToMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
};

const ensurePathfinder = () => {
    if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
    }
};

const moveNearChest = async (chestPosition: Vec3) => {
    ensurePathfinder();
    const movements = new Movements(bot);
    bot.pathfinder.setMovements(movements);
    await bot.pathfinder.goto(new goals.GoalNear(
        chestPosition.x,
        chestPosition.y,
        chestPosition.z,
        CHEST_IDLE_RANGE,
    ));
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const isChestBlockName = (name?: string | null) => {
    return name === "chest" || name === "trapped_chest";
};

export const isLogItem = (item?: Pick<Item, "name"> | null) => {
    if (!item?.name) return false;
    return item.name.includes("log") || item.name.endsWith("_wood");
};

export const isChestFull = (chest: ChestWindowLike) => {
    const containerSlots = chest.slots.slice(0, chest.inventoryStart);
    return containerSlots.length > 0 && containerSlots.every(Boolean);
};

export const findChestTargetFromPlayerView = (playerEntity: Entity) => {
    const block = bot.blockAtEntityCursor(playerEntity, PLAYER_CHEST_TARGET_RANGE);
    if (!isChestBlockName(block?.name)) return null;
    return block;
};

const getChestBlock = (chestPosition: Vec3) => {
    const block = bot.blockAt(chestPosition);
    if (!isChestBlockName(block?.name)) {
        throw new Error(`Target block is no longer a chest at ${chestPosition.x}, ${chestPosition.y}, ${chestPosition.z}`);
    }
    return block;
};

const openTargetChest = async (chestPosition: Vec3) => {
    await moveNearChest(chestPosition);
    const chestBlock = getChestBlock(chestPosition);
    return bot.openChest(chestBlock);
};

const getNextLogItem = (chest: ChestWindowLike) => {
    return chest.slots
        .slice(chest.inventoryStart)
        .find(isLogItem) as Item | null ?? null;
};

const getDroppedLogItem = (entity: Entity) => {
    try {
        const droppedItem = entity.getDroppedItem?.();
        return isLogItem(droppedItem) ? droppedItem : null;
    } catch {
        return null;
    }
};

const findNearestDroppedLog = (origin: Vec3, radius = LOG_DROP_COLLECTION_RADIUS) => {
    return Object.values(bot.entities)
        .filter((entity) => {
            return Boolean(getDroppedLogItem(entity))
                && entity.position.distanceTo(origin) <= radius;
        })
        .sort((a, b) => {
            return a.position.distanceSquared(bot.entity.position)
                - b.position.distanceSquared(bot.entity.position);
        })[0] ?? null;
};

export class FillChestWithLogsTask implements Task {
    readonly name = "fill_chest_with_logs";
    readonly priority = 40;

    private state: FillChestWithLogsState;
    private runningPromise: Promise<void> | null = null;
    private currentChopTask: ChopTreeTask | null = null;

    constructor(chestPosition: Vec3) {
        this.state = {
            phase: "idle",
            previousPhase: null,
            chestPosition: chestPosition.clone(),
            treesChopped: 0,
            logsCollected: 0,
            logsDeposited: 0,
            lastError: null,
        };
    }

    async start() {
        if (this.state.phase === "cancelled") {
            console.log("Cannot start a cancelled fill chest task.");
            return;
        }

        if (this.runningPromise) {
            return this.runningPromise;
        }

        if (this.state.phase === "idle") {
            this.state.phase = "checking_chest";
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
        await this.currentChopTask?.pause();
        this.stopCurrentBotAction();
        console.log("Fill chest with logs task paused.");
    }

    async resume() {
        if (this.state.phase === "cancelled") {
            console.log("Cannot resume a cancelled fill chest task.");
            return;
        }

        if (this.state.phase === "paused") {
            this.state.phase = this.state.previousPhase ?? "checking_chest";
            this.state.previousPhase = null;
            console.log("Fill chest with logs task resumed.");
        }

        return this.start();
    }

    async cancel() {
        const runningPromise = this.runningPromise;
        this.state.phase = "cancelled";
        this.state.previousPhase = null;
        await this.currentChopTask?.cancel();
        this.stopCurrentBotAction();
        console.log("Fill chest with logs task cancelled.");
        await runningPromise?.catch(() => undefined);
    }

    getState() {
        return {
            phase: this.state.phase,
            previousPhase: this.state.previousPhase,
            chestPosition: {
                x: this.state.chestPosition.x,
                y: this.state.chestPosition.y,
                z: this.state.chestPosition.z,
            },
            treesChopped: this.state.treesChopped,
            logsCollected: this.state.logsCollected,
            logsDeposited: this.state.logsDeposited,
            currentChopState: this.currentChopTask?.getState() ?? null,
            lastError: this.state.lastError,
        };
    }

    private async run() {
        try {
            while (this.shouldKeepRunning()) {
                if (this.state.phase === "checking_chest") {
                    await this.checkChest();
                    continue;
                }

                if (this.state.phase === "chopping_tree") {
                    await this.chopOneTree();
                    continue;
                }

                if (this.state.phase === "collecting_drops") {
                    await this.collectDroppedLogs();
                    continue;
                }

                if (this.state.phase === "returning_to_chest") {
                    await this.returnToChest();
                    continue;
                }

                if (this.state.phase === "depositing_logs") {
                    await this.depositLogs();
                    continue;
                }

                break;
            }
        } catch (error) {
            this.state.lastError = errorToMessage(error);

            if (this.state.phase === "paused" || this.state.phase === "cancelled") {
                return;
            }

            this.state.phase = "failed";
            console.log("Fill chest with logs task failed:", error);
        } finally {
            if (this.state.phase === "done" || this.state.phase === "failed") {
                await this.finishNearChest();
            }
        }
    }

    private async checkChest() {
        const chest = await openTargetChest(this.state.chestPosition);
        try {
            if (isChestFull(chest)) {
                console.log("Target chest is full. Waiting near chest.");
                this.state.phase = "done";
                return;
            }
        } finally {
            chest.close();
        }

        this.state.phase = "chopping_tree";
    }

    private async chopOneTree() {
        if (!this.currentChopTask) {
            this.currentChopTask = new ChopTreeTask();
        }

        const chopState = this.currentChopTask.getState();
        const choppedCount = chopState.phase === "paused"
            ? await this.currentChopTask.resume()
            : await this.currentChopTask.start();

        if (!this.shouldKeepRunning()) return;

        const finalChopState = this.currentChopTask.getState();
        if (finalChopState.phase === "failed") {
            this.state.lastError = finalChopState.lastError;
            this.state.phase = "failed";
            this.currentChopTask = null;
            return;
        }

        this.currentChopTask = null;
        if (choppedCount <= 0) {
            console.log("No tree was chopped. Waiting near chest.");
            this.state.phase = "done";
            return;
        }

        this.state.treesChopped++;
        this.state.phase = "collecting_drops";
    }

    private async collectDroppedLogs() {
        ensurePathfinder();
        const movements = new Movements(bot);
        movements.canDig = true;
        bot.pathfinder.setMovements(movements);

        await wait(LOG_DROP_SETTLE_DELAY_MS);
        const collectionOrigin = bot.entity.position.clone();
        let collectedThisPass = 0;

        for (let pass = 0; pass < LOG_DROP_COLLECTION_PASSES && this.shouldKeepRunning(); pass++) {
            const droppedLog = findNearestDroppedLog(collectionOrigin);
            if (!droppedLog) break;

            const item = getDroppedLogItem(droppedLog);
            if (!item) continue;

            const countBefore = this.countInventoryLogs();
            try {
                await bot.pathfinder.goto(new goals.GoalNear(
                    droppedLog.position.x,
                    droppedLog.position.y,
                    droppedLog.position.z,
                    LOG_DROP_PICKUP_RANGE,
                ));
                await wait(LOG_PICKUP_WAIT_MS);
            } catch (error) {
                if (!this.shouldKeepRunning()) return;
                console.log(`Failed to move to dropped ${item.name}:`, error);
            }

            const collectedCount = Math.max(0, this.countInventoryLogs() - countBefore);
            if (collectedCount > 0) {
                collectedThisPass += collectedCount;
                this.state.logsCollected += collectedCount;
                console.log(`Picked up ${collectedCount} dropped log item(s).`);
            }
        }

        if (collectedThisPass === 0) {
            console.log("No dropped logs found to pick up.");
        }

        if (!this.shouldKeepRunning()) return;
        this.state.phase = "returning_to_chest";
    }

    private async returnToChest() {
        await moveNearChest(this.state.chestPosition);
        if (!this.shouldKeepRunning()) return;
        this.state.phase = "depositing_logs";
    }

    private async depositLogs() {
        const chest = await openTargetChest(this.state.chestPosition);
        try {
            while (this.shouldKeepRunning()) {
                if (isChestFull(chest)) {
                    console.log("Target chest became full. Waiting near chest.");
                    this.state.phase = "done";
                    return;
                }

                const logItem = getNextLogItem(chest);
                if (!logItem) {
                    this.state.phase = "checking_chest";
                    return;
                }

                const count = logItem.count;
                try {
                    await chest.deposit(logItem.type, logItem.metadata ?? null, count);
                    this.state.logsDeposited += count;
                    console.log(`Deposited ${count} ${logItem.name} into target chest.`);
                } catch (error) {
                    if (isChestFull(chest)) {
                        console.log("Target chest filled while depositing. Waiting near chest.");
                        this.state.phase = "done";
                        return;
                    }
                    throw error;
                }
            }
        } finally {
            chest.close();
        }
    }

    private countInventoryLogs() {
        return bot.inventory.items()
            .filter(isLogItem)
            .reduce((total, item) => total + item.count, 0);
    }

    private async finishNearChest() {
        try {
            await moveNearChest(this.state.chestPosition);
        } catch (error) {
            console.log("Failed to return near chest:", error);
        }
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

export const createFillChestWithLogsTaskFromPlayerView = (playerEntity: Entity) => {
    const chestBlock = findChestTargetFromPlayerView(playerEntity);
    if (!chestBlock) return null;
    return new FillChestWithLogsTask(chestBlock.position);
};
