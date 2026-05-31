import bot from "../bot";
import { Vec3 } from "vec3";

const RESPAWN_REPAIR_COOLDOWN_MS = 2000;
const FALL_OR_HURT_REPAIR_COOLDOWN_MS = 1500;
const MAX_STABLE_GROUND_VELOCITY_Y = 0.08;

let isPositionRepairSetup = false;

export const isValidPosition = (position?: Vec3 | null) => {
    if (!position) return false;

    return Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && Number.isFinite(position.z);
};

export const shouldRepairInvalidPosition = (
    currentPosition: Vec3 | null | undefined,
    lastValidBotPosition: Vec3 | null,
    isBotAlive: boolean,
    isInRepairCooldown: boolean,
    isOnStableGround = true,
) => {
    return !isInRepairCooldown
        && isBotAlive
        && isOnStableGround
        && !isValidPosition(currentPosition)
        && isValidPosition(lastValidBotPosition);
};

const isSafeToRepairNow = () => {
    if (!bot.entity) return false;
    if (!bot.entity.onGround) return false;
    if (!isValidPosition(bot.entity.velocity)) return false;

    return Math.abs(bot.entity.velocity.y) <= MAX_STABLE_GROUND_VELOCITY_Y;
};

const isStableGroundState = () => {
    return isSafeToRepairNow() && isValidPosition(bot.entity.position);
};

export const setupPositionRepair = () => {
    if (isPositionRepairSetup) return;
    isPositionRepairSetup = true;

    let lastStableGroundPosition: Vec3 | null = null;
    let repairCooldownUntil = Date.now() + RESPAWN_REPAIR_COOLDOWN_MS;

    const pauseRepair = (reason: string, cooldownMs: number) => {
        repairCooldownUntil = Date.now() + cooldownMs;
        console.log(`Position repair paused after ${reason}.`);
    };

    const resetRepairState = (reason: string) => {
        lastStableGroundPosition = null;
        pauseRepair(reason, RESPAWN_REPAIR_COOLDOWN_MS);
    };

    bot.on("death", () => resetRepairState("death"));
    bot.on("respawn", () => resetRepairState("respawn"));
    bot.on("spawn", () => resetRepairState("spawn"));
    bot.on("forcedMove", () => pauseRepair("forced move", FALL_OR_HURT_REPAIR_COOLDOWN_MS));
    bot.on("entityHurt", (entity) => {
        if (entity === bot.entity) {
            pauseRepair("hurt", FALL_OR_HURT_REPAIR_COOLDOWN_MS);
        }
    });

    bot.on("physicsTick", () => {
        const currentPosition = bot.entity?.position;
        const isInRepairCooldown = Date.now() < repairCooldownUntil;

        if (!isInRepairCooldown && isStableGroundState()) {
            lastStableGroundPosition = bot.entity.position.clone();
            return;
        }

        if (bot.entity && shouldRepairInvalidPosition(
            currentPosition,
            lastStableGroundPosition,
            bot.isAlive !== false && bot.health > 0,
            isInRepairCooldown,
            isSafeToRepairNow(),
        )) {
            console.log("Restoring bot position after invalid coordinates:", currentPosition);
            bot.entity.position = lastStableGroundPosition.clone();
            bot.entity.velocity.set(0, 0, 0);
            bot.clearControlStates();
        }
    });
};
