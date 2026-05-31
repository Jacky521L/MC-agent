import bot from "../bot";
import { Vec3 } from "vec3";

const RESPAWN_REPAIR_COOLDOWN_MS = 2000;

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
) => {
    return !isInRepairCooldown
        && isBotAlive
        && !isValidPosition(currentPosition)
        && isValidPosition(lastValidBotPosition);
};

export const setupPositionRepair = () => {
    if (isPositionRepairSetup) return;
    isPositionRepairSetup = true;

    let lastValidBotPosition: Vec3 | null = null;
    let repairCooldownUntil = Date.now() + RESPAWN_REPAIR_COOLDOWN_MS;

    const resetRepairState = (reason: string) => {
        lastValidBotPosition = null;
        repairCooldownUntil = Date.now() + RESPAWN_REPAIR_COOLDOWN_MS;
        console.log(`Position repair paused after ${reason}.`);
    };

    bot.on("death", () => resetRepairState("death"));
    bot.on("respawn", () => resetRepairState("respawn"));
    bot.on("spawn", () => resetRepairState("spawn"));

    bot.on("physicsTick", () => {
        const currentPosition = bot.entity?.position;
        const isInRepairCooldown = Date.now() < repairCooldownUntil;

        if (!isInRepairCooldown && isValidPosition(currentPosition)) {
            lastValidBotPosition = currentPosition.clone();
            return;
        }

        if (bot.entity && shouldRepairInvalidPosition(
            currentPosition,
            lastValidBotPosition,
            bot.isAlive !== false && bot.health > 0,
            isInRepairCooldown,
        )) {
            console.log("Restoring bot position after invalid coordinates:", currentPosition);
            bot.entity.position = lastValidBotPosition.clone();
            bot.entity.velocity.set(0, 0, 0);
            bot.clearControlStates();
        }
    });
};
