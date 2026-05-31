export interface Task {
    readonly name: string;
    readonly priority: number;
    start: () => Promise<unknown>;
    pause: () => Promise<void> | void;
    resume: () => Promise<unknown>;
    cancel: () => Promise<void> | void;
    getState: () => unknown;
};

export class TaskController {
    private taskQueue: Task[] = [];
    private currentTask: Task | null = null;
    private pausedTask: Task | null = null;

    addTask(task: Task) {
        this.taskQueue.push(task);
        this.taskQueue.sort((a, b) => b.priority - a.priority);
    }

    run(task: Task) {
        if (!this.currentTask) {
            this.startTask(task);
            return;
        }

        if (task.priority > this.currentTask.priority) {
            this.currentTask.pause();
            this.pausedTask = this.currentTask;
            this.startTask(task);
            return;
        }

        this.currentTask.cancel();
        this.startTask(task);
    }

    private async startTask(task: Task) {
        this.currentTask = task;

        task.start()
            .catch((error) => {
                console.log(`Task ${task.name} failed during start:`, error)
            })
            .finally(() => {
                this.onTaskFinished(task)
            });
    }

    private onTaskFinished(task: Task) {
        if (this.currentTask !== task) {
            return;
        }
        this.currentTask = null;

        if (this.pausedTask) {
            const taskToResume = this.pausedTask;
            this.pausedTask = null;
            this.resumeTask(taskToResume);
            return;
        }
    }

    private resumeTask(task: Task) {
        this.currentTask = task;

        task.resume()
            .catch((error) => {
                console.log(`Task ${task.name} failed during resume:`, error)
            })
            .finally(() => {
                this.onTaskFinished(task)
            });
    }       
}
