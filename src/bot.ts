import { createBot } from "mineflayer";

export const bot = createBot({
    host: "localhost",
    port: 25565,
    username: "Bot",
})

export default bot;