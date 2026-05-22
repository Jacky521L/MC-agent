import bot from "./bot";
import { pathfinder, goals } from 'mineflayer-pathfinder';

const { GoalFollow } = goals;

export async function followPlayer(targetPlayer: any) {
    const newGoal = new GoalFollow(targetPlayer.entity, 3);
    bot.loadPlugin(pathfinder);
    bot.chat(`I'm following you, ${targetPlayer.username}!`);
    await bot.pathfinder.setGoal(newGoal, true);
};

export async function stopFollowing() {
    if (bot.pathfinder) {
        bot.pathfinder.setGoal(null);
        bot.chat("I've stopped following.");
    }
};
