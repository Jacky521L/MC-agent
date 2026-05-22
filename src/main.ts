import bot from "./bot";
import { chopTree, findNearestTree, getAllTreeBlocks } from "./actions/logging";
import { followPlayer, stopFollowing } from "./follow_player";

const main = () => {
    console.log("Bot is starting...");
    bot.on("spawn", () => {
        console.log("Bot has spawned in the world!");
    });
    
    
    bot.on('chat', async (username, message) => {
        if (username === "Bot") return;

        if (message === "follow") {
            const targetPlayer = bot.players[username];
            if (targetPlayer) {
                await followPlayer(targetPlayer);
            } else {
                console.log(`Player ${username} not found.`);
            }
        };
        if (message === "stop following") {
            await stopFollowing();
        }
        if (message === "find tree") {
            const tree = findNearestTree();
            if (tree) {
                getAllTreeBlocks(tree);
            }
        } else if (message === "chop tree") {
            chopTree().catch((error) => console.log("Failed to chop tree:", error));
        }
    });
}

main();
