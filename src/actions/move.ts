import bot from "../bot";
import { pathfinder, goals } from 'mineflayer-pathfinder';

export const moveToBlockNear = (x: number, y: number, z: number) => {
    bot.loadPlugin(pathfinder);
    const { GoalNear } = goals;
    const goal = new GoalNear(x, y, z, 2);
    bot.pathfinder.setGoal(goal);
}