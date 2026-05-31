import bot from "../bot";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { plugin as pvp } from "mineflayer-pvp";
import { pathfinder } from "mineflayer-pathfinder";
import { Task, TaskController } from "./taskController";

const THREAT_RANGE = 16;
const COMBAT_PRIORITY = 200;
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

    constructor(private readonly target: Entity) {}

    async start() {
        ensurePvp();
        console.log(`Starting combat with ${this.target.name ?? this.target.displayName ?? "mob"}.`);

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

            const cleanup = () => {
                bot.off("stoppedAttacking", onStoppedAttacking);
                bot.off("entityGone", onEntityGone);
            };

            bot.once("stoppedAttacking", onStoppedAttacking);
            bot.on("entityGone", onEntityGone);
            bot.pvp.attack(this.target);
        });
    }

    pause() {
    }

    async resume() {
        await this.start();
    }

    async cancel() {
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
