import bot from "../bot";
import { FindBlockOptions } from "mineflayer";
import { Vec3 } from 'vec3'
import Denque from 'denque';
import { pathfinder, goals, Movements } from 'mineflayer-pathfinder';
import { DIG_REACH, LEGACY_TREE_LOG_IDS, isTreeLogBlock, isWithinDigReach, keyOf, sortLogsForChopping } from "./tree";


export const findNearestTree = (shouldMoveNearTree = true) => {
    const options: FindBlockOptions = {
        matching: [...LEGACY_TREE_LOG_IDS],
        maxDistance: 16,
        count: 5
    };

    const tree = bot.findBlocks(options);
    
    if (tree.length > 0) {
        console.log(tree);
        const botPos = bot.entity.position;
        console.log(`Bot is at position: ${botPos}`);
        const { x, y, z } = tree[0];
        if (shouldMoveNearTree) {
            moveNearBlock(new Vec3(x, y, z));
            console.log(`Found a tree at ${x}, ${y}, ${z} and moving towards it.`);
        } else {
            console.log(`Found a tree at ${x}, ${y}, ${z}.`);
        }
    } else {
        console.log("No trees found nearby.");
    }

    return tree[0];
}

export const bfs = (pos: Vec3) => {
    const startBlock = bot.blockAt(pos);
    if (!isTreeLogBlock(startBlock)) return new Set<string>();

    const queue = new Denque<Vec3>();
    const visited = new Set<string>();
    const result = new Set<string>();

    visited.add(keyOf(pos));
    queue.push(pos);

    while (!queue.isEmpty()) {
        const currentPos = queue.shift()!;
        const { x, y, z } = currentPos;
        const block = bot.blockAt(currentPos);

        if (!isTreeLogBlock(block)) {
            continue;
        }

        result.add(keyOf(currentPos));

        const neighbors = [
            new Vec3(x + 1, y, z),
            new Vec3(x - 1, y, z),
            new Vec3(x, y + 1, z),
            new Vec3(x, y - 1, z),
            new Vec3(x, y, z + 1),
            new Vec3(x, y, z - 1),
        ];

        for (const neighbor of neighbors) {
            const key = keyOf(neighbor);

            if (!visited.has(key)) {
                visited.add(key);
                queue.push(neighbor);
            }
        }
    }

    return result;
};

export const getAllTreeBlocks = (treeBlock: Vec3) => {
    const treeBlocks = bfs(treeBlock);
    console.log(`Found ${treeBlocks.size} connected tree blocks.`);
    console.log(treeBlocks);
    return treeBlocks;
};

const ensurePathfinder = () => {
    if (!bot.pathfinder) {
        bot.loadPlugin(pathfinder);
    }
};

const setTreeChoppingMovements = () => {
    ensurePathfinder();
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.scafoldingBlocks = bot.registry.itemsArray
        .filter((item) => {
            const registryItem = bot.registry.items[item.type];
            const block = bot.registry.blocksByName[registryItem?.name];
            return Boolean(block?.boundingBox === 'block');
        })
        .map((item) => item.type);
    bot.pathfinder.setMovements(movements);
};

const moveNearBlock = async (pos: Vec3, range = 2) => {
    ensurePathfinder();
    const { GoalNear } = goals;
    await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, range));
};

const moveToReachBlock = async (pos: Vec3) => {
    ensurePathfinder();
    const { GoalLookAtBlock, GoalNear } = goals;
    const movements = new Movements(bot);
    (movements as any).canPlaceBlocks = true;
    (movements as any).scafoldingBlocks = [
        2
    ];
    movements.allow1by1towers = true;
    bot.pathfinder.setMovements(movements);

    try {
        await bot.pathfinder.goto(new GoalLookAtBlock(pos, bot.world, { reach: DIG_REACH }));
    } catch (error) {
        await bot.pathfinder.goto(new GoalNear(pos.x, pos.y, pos.z, Math.floor(DIG_REACH)));
    }
};

const digReachableLog = async (pos: Vec3) => {
    let block = bot.blockAt(pos);
    if (!isTreeLogBlock(block)) return false;

    if (!isWithinDigReach(bot.entity.position, pos) || !bot.canDigBlock(block)) {
        await moveToReachBlock(pos);
        block = bot.blockAt(pos);
        if (!isTreeLogBlock(block)) return false;
    }

    try {
        await bot.dig(block, false, 'raycast');
        return true;
    } catch (error) {
        await moveToReachBlock(pos);
        console.log(`Retrying dig after moving: ${pos.x}, ${pos.y}, ${pos.z}`);
        block = bot.blockAt(pos);
        if (!isTreeLogBlock(block)) return false;
        await bot.dig(block, false, 'raycast');
        return true;
    }
};

const clearBlocks = async (blocks: Vec3[]) => {
    for (const blockPos of blocks) {
        const block = bot.blockAt(blockPos);
        if (block && block.name !== "air") {
            try {
                await bot.dig(block, false, 'raycast');
                console.log(`Cleared block at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}.`);
            } catch (error) {
                console.log(`Failed to clear block at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}:`, error);
            }
        }
    }
};


export const chopTree = async (treeBlock?: Vec3) => {
    let numPlacedBlocks = 0;
    let botPlacedBlocks: Vec3[] = [];

    bot.on('blockUpdate', (oldBlock, newBlock) => {
        if (oldBlock.name === "air" && newBlock.name !== "air") {

            const dist = bot.entity.position.distanceTo(newBlock.position);
            if (dist < 5) {
                numPlacedBlocks++;
                botPlacedBlocks.unshift(newBlock.position);
                console.log(`bot placed ${numPlacedBlocks} block.`);
            }
        }
    });
    const startBlock = treeBlock ?? findNearestTree(false);
    if (!startBlock) {
        console.log("No tree found to chop.");
        return 0;
    }

    const treeBlocks = getAllTreeBlocks(startBlock);
    const logsToChop = sortLogsForChopping(startBlock, treeBlocks);

    console.log(`Chopping ${logsToChop.length} log blocks.`);
    setTreeChoppingMovements();
    await moveNearBlock(startBlock);

    let choppedCount = 0;
    for (const logPos of logsToChop) {
        try {
            if (await digReachableLog(logPos)) {
                choppedCount++;
                console.log(`Chopped log at ${logPos.x}, ${logPos.y}, ${logPos.z}.`);
            }
        } catch (error) {
            console.log(`Failed to chop log at ${logPos.x}, ${logPos.y}, ${logPos.z}:`, error);
        }
    }

    console.log(`Finished chopping tree. Chopped ${choppedCount}/${logsToChop.length} blocks.`);

    await clearBlocks(botPlacedBlocks);
    console.log(`Cleared ${botPlacedBlocks.length} blocks placed by the bot during chopping.`);
    return choppedCount;
};
