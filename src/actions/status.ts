import bot from "../bot";

export const pickUpItems = () => {
    bot.once("playerCollect", () => {
        console.log("Inventory updated!");
        setTimeout(() => {
            const nowItems = bot.inventory.items()
            console.log("Current inventory:", nowItems);
        }, 1000);
    });
}
