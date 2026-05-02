import bot from "./bot";
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder';
import mcData from 'minecraft-data';

const { GoalFollow } = goals;

bot.on("spawn", () => {
    console.log("Bot has spawned in the world!");
});

bot.on('death', () => {
    console.log("Bot has died.");
    bot.on('spawn', () => {
        console.log("Bot has respawned after death.");
    });
});


bot.on("chat",async (username, message) => {
    if (username === "Bot") return;
    const targetPlayer = bot.players[username];
    if (!targetPlayer) {
        bot.chat(`I can't see you, ${username}!`);
        return;
    }

    if (message === "follow") {
    const newGoal = new GoalFollow(targetPlayer.entity, 3);
    bot.loadPlugin(pathfinder);
    bot.chat(`I'm following you, ${username}!`);
    await bot.pathfinder.setGoal(newGoal, true);
});

bot.on("chat", (username, message) => {
    if (username === "Bot") return;

    if (message === "stop") {
        try {
            bot.pathfinder.stop();
            bot.chat(`I have stopped following you, ${username}!`);
        } catch (error) {
            console.error("Error stopping pathfinder:", error);
        }
    }
});
