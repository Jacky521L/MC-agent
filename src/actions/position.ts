import bot from "../bot";
import { Vec3 } from "vec3";

export const isValidPosition = (position?: Vec3 | null) => {
    if (!position) return false;

    return Number.isFinite(position.x)
        && Number.isFinite(position.y)
        && Number.isFinite(position.z);
};

export const setupPositionRepair = () => {
    let lastValidBotPosition: Vec3 | null = null;

    bot.on("physicsTick", () => {
        const currentPosition = bot.entity?.position;

        if (isValidPosition(currentPosition)) {
            lastValidBotPosition = currentPosition.clone();
            return;
        }

        if (lastValidBotPosition && bot.entity) {
            console.log("Restoring bot position after invalid coordinates:", currentPosition);
            bot.entity.position = lastValidBotPosition.clone();
        }
    });
};
