import { createBot } from "mineflayer";

export const bot = createBot({
    host: "localhost",
    port: 25565,
    username: "Bot",
})

bot.on("spawn", () => {
    console.log("Bot has spawned in the world!");
});

bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    bot.chat(`Hello ${username}, you said: ${message}`);
});

bot.on('death', () => {
    console.log("Bot has died.");
    bot.on('spawn', () => {
        console.log("Bot has respawned after death.");
    });
});


bot.on('kicked', console.log);
bot.on('error', console.log);
