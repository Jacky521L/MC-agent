import bot from "../bot";
import { Task } from "./taskController";

export class EatTask implements Task {
    readonly name = "eat";
    readonly priority = 100;

    async start() {
        console.log("Starting to eat...");
        await bot.autoEat.eat();
    }

    async pause() {

    }

    async resume() {
        return this.start();
    }

    async cancel() {
        bot.autoEat.cancelEat();
    }

    getState() {
        return {
            name: this.name,
            isEating: bot.autoEat?.isEating ?? false,
        }
    }
}
