import bot from "./bot";
import { findNearestTree, getAllTreeBlocks } from "./actions/logging";
import { followPlayer, stopFollowing } from "./follow_player";
import { loader as autoEat } from 'mineflayer-auto-eat'
import { TaskController } from "./actions/taskController";
import { EatTask } from "./actions/survive";
import { setupAutoCombat } from "./actions/combat";
import { setupPositionRepair } from "./actions/position";
import { createFillChestWithLogsTaskFromPlayerView } from "./actions/fillChestWithLogs";

const main = () => {
    console.log("Bot is starting...");

    const taskController = new TaskController();
    setupAutoCombat(taskController);
    setupPositionRepair();

    const shouldEat = () => {
        if (!bot.autoEat || bot.autoEat.isEating) return false;
        if (bot.food >= 20) return false;

        return bot.food < bot.autoEat.opts.minHunger || bot.health < bot.autoEat.opts.minHealth;
    };
    const tryRunEatTask = (source: string) => {
        if (!shouldEat()) return;

        console.log(`Eat task requested by ${source}:`, {
            health: bot.health,
            food: bot.food,
            minHealth: bot.autoEat.opts.minHealth,
            minHunger: bot.autoEat.opts.minHunger,
            isEating: bot.autoEat.isEating,
        });
        taskController.run(new EatTask());
    };

    bot.on("spawn", () => {
        console.log("Bot has spawned in the world!");

        bot.loadPlugin(autoEat);
        if (!bot.autoEat) {
            console.log("Failed to load autoEat plugin.");
            return;
        }

        bot.autoEat.setOpts({
            minHunger: 15,
            minHealth: 14,
        });

        bot.on("physicsTick", () => tryRunEatTask("physicsTick"));
    });

    bot.on("entityHurt", (entity) => {
        if (entity === bot.entity) {
            console.log("bot hurt:", {
                health: bot.health,
                food: bot.food,
                autoEatEnabled: bot.autoEat?.enabled,
                isEating: bot.autoEat?.isEating,
                items: bot.inventory.items().map(item => item.name),
            })
            tryRunEatTask("entityHurt");
        }
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
            const player = bot.players[username];
            if (!player?.entity) {
                console.log(`Player ${username} not found.`);
                return;
            }

            const fillChestTask = createFillChestWithLogsTaskFromPlayerView(player.entity);
            if (!fillChestTask) {
                bot.chat("Look at a chest before asking me to chop tree.");
                return;
            }

            taskController.run(fillChestTask);
        }
    });
}

main();
