import bot from "./bot";
import { mineflayer as viewer } from "prismarine-viewer";

const viewerPort = Number(process.env.VIEWER_PORT ?? 3007);

bot.on("kicked", (reason) => {
    console.log("Bot was kicked:", reason);
});

bot.on("end", (reason) => {
    console.log("Bot connection ended:", reason);
});

bot.on("error", (error) => {
    console.error("Bot error:", error);
});

bot.once("spawn", () => {
    viewer(bot, { port: viewerPort, firstPerson: true });
    console.log(`Viewer ready at http://localhost:${viewerPort}`);
});

import("./main").catch((error) => {
    console.error("Failed to start bot main loop:", error);
});
