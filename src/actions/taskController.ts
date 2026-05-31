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
    private pausedTasks: Task[] = [];

    addTask(task: Task) {
        this.taskQueue.push(task);
        this.taskQueue.sort((a, b) => b.priority - a.priority);
    }

    run(task: Task) {
        if (this.hasTaskNamed(task.name)) {
            return;
        }

        if (!this.currentTask) {
            this.startTask(task);
            return;
        }

        if (task.priority > this.currentTask.priority) {
            const pausedTask = this.currentTask;
            this.pausedTasks.push(pausedTask);
            this.currentTask = null;
            Promise.resolve(pausedTask.pause())
                .catch((error) => {
                    console.log(`Task ${pausedTask.name} failed during pause:`, error);
                })
                .finally(() => {
                    this.startTask(task);
                });
            return;
        }

        this.addTask(task);
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

        const taskToResume = this.pausedTasks.pop();
        if (taskToResume) {
            this.resumeTask(taskToResume);
            return;
        }

        const nextTask = this.taskQueue.shift();
        if (nextTask) {
            this.startTask(nextTask);
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

    private hasTaskNamed(name: string) {
        return this.currentTask?.name === name
            || this.pausedTasks.some((task) => task.name === name)
            || this.taskQueue.some((task) => task.name === name);
    }
}
