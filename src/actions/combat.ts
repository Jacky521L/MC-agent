import bot from "../bot";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { plugin as pvp } from "mineflayer-pvp";
import { goals, pathfinder } from "mineflayer-pathfinder";
import { Task, TaskController } from "./taskController";

const THREAT_RANGE = 16;
const COMBAT_PRIORITY = 200;
const COMBAT_RECOVERY_INTERVAL_MS = 750;
const COMBAT_DELAYED_RECOVERY_MS = [150, 500, 1000, 2000];
const HOSTILE_MOBS = new Set([
    "blaze",
    "cave_spider",
    "creeper",
    "drowned",
    "elder_guardian",
    "enderman",
    "endermite",
    "evoker",
    "ghast",
    "guardian",
    "hoglin",
    "husk",
    "magma_cube",
    "phantom",
    "piglin_brute",
    "pillager",
    "ravager",
    "shulker",
    "silverfish",
    "skeleton",
    "slime",
    "spider",
    "stray",
    "vex",
    "vindicator",
    "witch",
    "wither_skeleton",
    "zoglin",
    "zombie",
    "zombie_villager",
    "zombified_piglin",
]);

type ThreatLike = {
    type?: string;
    name?: string;
    displayName?: string;
    position: Vec3;
};

export const isThreatEntity = (entity: ThreatLike, botPosition: Vec3, range = THREAT_RANGE) => {
    if (entity.type !== "mob") return false;
    if (entity.displayName === "Armor Stand" || entity.name === "armor_stand") return false;
    if (!entity.name || !HOSTILE_MOBS.has(entity.name)) return false;
    return entity.position.distanceTo(botPosition) < range;
};

export const findNearestThreat = () => {
    return bot.nearestEntity((entity) => isThreatEntity(entity, bot.entity.position)) as Entity | null;
};

const ensurePvp = () => {
    if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
    }

    if (!bot.pvp) {
        bot.loadPlugin(pvp);
    }
};

export class CombatTask implements Task {
    readonly name = "combat";
    readonly priority = COMBAT_PRIORITY;

    private isCancelled = false;
    private recoveryTimer: ReturnType<typeof setInterval> | null = null;
    private delayedRecoveryTimers: ReturnType<typeof setTimeout>[] = [];

    constructor(private readonly target: Entity) {}

    async start() {
        ensurePvp();
        console.log(`Starting combat with ${this.target.name ?? this.target.displayName ?? "mob"}.`);
        this.isCancelled = false;

        await new Promise<void>((resolve) => {
            const onStoppedAttacking = () => {
                cleanup();
                resolve();
            };

            const onEntityGone = (entity: Entity) => {
                if (entity !== this.target) return;
                cleanup();
                resolve();
            };

            const onBotHurt = (entity: Entity) => {
                if (entity !== bot.entity) return;
                this.recoverCombatPath("hurt");
                this.scheduleDelayedRecovery("hurt");
            };

            const onForcedMove = () => {
                this.recoverCombatPath("forced move");
                this.scheduleDelayedRecovery("forced move");
            };

            const onPathStop = () => {
                this.recoverCombatPath("path stop");
                this.scheduleDelayedRecovery("path stop");
            };

            const cleanup = () => {
                this.stopRecoveryTimer();
                this.clearDelayedRecovery();
                bot.off("stoppedAttacking", onStoppedAttacking);
                bot.off("entityGone", onEntityGone);
                bot.off("entityHurt", onBotHurt);
                bot.off("forcedMove", onForcedMove);
                bot.off("path_stop", onPathStop);
            };

            bot.once("stoppedAttacking", onStoppedAttacking);
            bot.on("entityGone", onEntityGone);
            bot.on("entityHurt", onBotHurt);
            bot.on("forcedMove", onForcedMove);
            bot.on("path_stop", onPathStop);
            bot.pvp.attack(this.target);
            this.startRecoveryTimer();
        });
    }

    pause() {
    }

    async resume() {
        await this.start();
    }

    async cancel() {
        this.isCancelled = true;
        this.stopRecoveryTimer();
        this.clearDelayedRecovery();
        if (bot.pvp) {
            await bot.pvp.stop();
        }
    }

    getState() {
        return {
            name: this.name,
            target: this.target.name ?? this.target.displayName ?? null,
            targetId: this.target.id,
        };
    }

    private startRecoveryTimer() {
        this.stopRecoveryTimer();
        this.recoveryTimer = setInterval(() => {
            this.recoverCombatPath("watchdog");
        }, COMBAT_RECOVERY_INTERVAL_MS);
    }

    private stopRecoveryTimer() {
        if (!this.recoveryTimer) return;

        clearInterval(this.recoveryTimer);
        this.recoveryTimer = null;
    }

    private scheduleDelayedRecovery(reason: string) {
        for (const delay of COMBAT_DELAYED_RECOVERY_MS) {
            const timer = setTimeout(() => {
                this.recoverCombatPath(`${reason} delayed ${delay}ms`);
            }, delay);
            this.delayedRecoveryTimers.push(timer);
        }
    }

    private clearDelayedRecovery() {
        for (const timer of this.delayedRecoveryTimers) {
            clearTimeout(timer);
        }
        this.delayedRecoveryTimers = [];
    }

    private recoverCombatPath(reason: string) {
        if (this.isCancelled) return;
        if (!bot.pvp?.target) return;
        if (bot.pvp.target !== this.target) return;
        if (bot.entities[this.target.id] !== this.target) return;

        ensurePvp();
        if (bot.pvp.movements) {
            bot.pathfinder.setMovements(bot.pvp.movements);
        }

        bot.pathfinder.setGoal(new goals.GoalFollow(this.target, bot.pvp.followRange ?? 2), true);
        if (reason !== "watchdog") {
            console.log(`Recovered combat path after ${reason}.`);
        }
    }
}

export const setupAutoCombat = (taskController: TaskController) => {
    ensurePvp();

    bot.on("physicsTick", () => {
        if (bot.pvp?.target) return;

        const threat = findNearestThreat();
        if (!threat) return;

        taskController.run(new CombatTask(threat));
    });
};
