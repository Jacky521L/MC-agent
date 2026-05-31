import bot from "./bot";
import { pathfinder, goals } from "mineflayer-pathfinder";
import { Player } from "mineflayer";
import { Task } from "./actions/taskController";

const { GoalFollow } = goals;
const FOLLOW_DISTANCE = 3;

const ensurePathfinder = () => {
    if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
    }
};

export class FollowPlayerTask implements Task {
    readonly name = "follow_player";
    readonly priority = 30;

    private isCancelled = false;
    private isPaused = false;
    private finishTask: (() => void) | null = null;
    private completionPromise: Promise<void>;

    constructor(private readonly targetPlayer: Player) {
        this.completionPromise = new Promise<void>((resolve) => {
            this.finishTask = resolve;
        });
    }

    async start() {
        if (this.isCancelled) return;

        this.isPaused = false;
        this.followTarget();
        bot.chat(`I'm following you, ${this.targetPlayer.username}!`);

        await this.completionPromise;
    }

    pause() {
        if (this.isCancelled) return;

        this.isPaused = true;
        this.stopPathing();
        console.log("Follow player task paused.");
    }

    async resume() {
        if (this.isCancelled) return;

        this.isPaused = false;
        this.followTarget();
        console.log("Follow player task resumed.");

        await this.completionPromise;
    }

    cancel() {
        this.isCancelled = true;
        this.isPaused = false;
        this.stopPathing();
        this.finishTask?.();
        this.finishTask = null;
        console.log("Follow player task cancelled.");
    }

    getState() {
        return {
            name: this.name,
            target: this.targetPlayer.username,
            isPaused: this.isPaused,
            isCancelled: this.isCancelled,
        };
    }

    private followTarget() {
        ensurePathfinder();

        if (!this.targetPlayer.entity) {
            throw new Error(`Cannot follow ${this.targetPlayer.username}; player entity is not visible.`);
        }

        bot.pathfinder.setGoal(new GoalFollow(this.targetPlayer.entity, FOLLOW_DISTANCE), true);
    }

    private stopPathing() {
        if (bot.pathfinder) {
            bot.pathfinder.setGoal(null);
        }
    }
}
