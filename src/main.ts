import bot from "./bot";
import { pickUpItems } from "./actions/status";
import { findNearestTree, getAllTreeBlocks } from "./actions/logging";

const main = () => {
    console.log("Bot is starting...");
    bot.on("spawn", () => {
        console.log("Bot has spawned in the world!");
    });
    
    
    bot.on('chat', (username, message) => {
        if (username === "Bot") return;

        if (message === "find tree") {
            const tree = findNearestTree();
            if (tree) {
                getAllTreeBlocks(tree);
            }
        }
    });
}

main();