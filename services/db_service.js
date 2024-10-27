const { MongoClient } = require('mongodb');
const { getDifficultyForShare, targetToNBits } = require('./nbits_service')

let db;



const initDB = async () => {
    try {
        const uri = 'mongodb://localhost:27017';
        const dbName = 'mining_pool';

        const client = new MongoClient(uri);
        await client.connect();
        db = client.db(dbName);

        console.log("Connected to MongoDB database");

        const sharesCollection = db.collection('shares');
        await sharesCollection.createIndex({ timestamp: -1 });
        await sharesCollection.createIndex({ minerId: 1 });
        await sharesCollection.createIndex({ hash: 1 }, { unique: true });

        const minersCollection = db.collection('miners');
        await minersCollection.createIndex({ minerId: 1 }, { unique: true });

        const transactionsCollection = db.collection('transactions');
        await transactionsCollection.createIndex({ txid: 1 }, { unique: true });

        const bannedIpsCollection = db.collection('banned_ips');
        await bannedIpsCollection.createIndex({ ipAddress: 1 }, { unique: true });

        setInterval(deleteOldShares, 24 * 60 * 60 * 1000);
    } catch (error) {
        console.error("Error initializing the database:", error);
    }
};

const deleteOldShares = async () => {
    try {
        const sharesCollection = db.collection('shares');
        const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
        const result = await sharesCollection.deleteMany({ timestamp: { $lt: oneHourAgo } });
        console.log(`${result.deletedCount} old shares deleted.`);
    } catch (error) {
        console.error("Error deleting old shares:", error);
    }
};

const banIp = async (ipAddress) => {
    try {
        const bannedIpsCollection = db.collection('banned_ips');
        await bannedIpsCollection.insertOne({ ipAddress, bannedAt: new Date() });
    } catch (error) {
        if (error.code === 11000) {
            console.error(`IP ${ipAddress} is already banned.`);
        } else {
            console.error("Error banning IP:", error);
        }
    }
};

const unbanIp = async (ipAddress) => {
    try {
        const bannedIpsCollection = db.collection('banned_ips');
        const result = await bannedIpsCollection.deleteOne({ ipAddress });
        if (result.deletedCount > 0) {
            console.log(`IP ${ipAddress} has been unbanned.`);
        }
    } catch (error) {
        console.error("Error unbanning IP:", error);
    }
};

const isIpBanned = async (ipAddress) => {
    try {
        const bannedIpsCollection = db.collection('banned_ips');
        const ip = await bannedIpsCollection.findOne({ ipAddress });
        return !!ip;
    } catch (error) {
        console.error("Error checking if IP is banned:", error);
        return false;
    }
};

const isTransactionProcessed = async (txid) => {
    const transactionsCollection = db.collection('transactions');
    const existingTransaction = await transactionsCollection.findOne({ txid });
    return !!existingTransaction; // Return true if transaction exists
};

const markTransactionAsProcessed = async (txid) => {
    const transactionsCollection = db.collection('transactions');
    await transactionsCollection.insertOne({ txid, processedAt: new Date() });
};

const saveShare = async (minerId, share) => {
    try {
        if (!minerId || !share || !share.hash) {
            throw new Error("Invalid minerId, share data, or missing hash");
        }
        const sharesCollection = db.collection('shares');

        await sharesCollection.insertOne({
            minerId,
            ...share,
            timestamp: new Date(),
        });
    } catch (error) {
        if (error.code === 11000) {
            console.error("Duplicate share hash detected:", share.hash);
            if(!global.minersToBan.includes(minerId)){
                global.minersToBan.push(minerId)
            }
        } else {
            console.error("Error saving share:", error);
        }
    }
};

const updateMinerBalance = async (minerId, amount) => {
    try {
        if (!minerId || amount == null) {
            throw new Error("Invalid minerId or amount");
        }

        const minersCollection = db.collection('miners');
        
        if (amount === 0) {
            await minersCollection.updateOne(
                { minerId },
                { $set: { balance: 0 } },
                { upsert: true }
            );
        } else {
            await minersCollection.updateOne(
                { minerId },
                { $inc: { balance: amount } },
                { upsert: true }
            );
        }

    } catch (error) {
        console.error("Error updating miner balance:", error);
    }
};

const getMinerBalance = async (minerId) => {
    try {
        const minersCollection = db.collection('miners');
        const miner = await minersCollection.findOne({ minerId });
        return miner ? miner.balance : 0;
    } catch (error) {
        console.error("Error retrieving miner balance:", error);
        return 0;
    }
};

const getMinersWithBalanceAbove = async (balanceThreshold) => {
    try {
        const minersCollection = db.collection('miners');
        const miners = await minersCollection.find({ balance: { $gt: balanceThreshold } }).toArray();
        return miners;
    } catch (error) {
        console.error("Error retrieving miners with balance above threshold:", error);
        return [];
    }
};

const calculatePoolHashrate = async (minerId = null) => {
    const currentTime = Date.now();
    const timeWindow = (minerId != null) ? 1800 : 600
    const timeWindowInMs = timeWindow * 1000;
    const timeThreshold = new Date(currentTime - timeWindowInMs);

    let query = { timestamp: { $gte: timeThreshold } };
    if (minerId !== null) {
        query.minerId = minerId;
    }

    const shares = await db.collection('shares')
        .find(query)
        .sort({ timestamp: 1 })
        .toArray();

    if (shares.length < 2) {
        return 0;
    }

    const firstShare = shares[0];
    const lastShare = shares[shares.length - 1];

    let totalWork = 0;

    shares.forEach((share) => {
        totalWork += getDifficultyForShare(targetToNBits(share.target));
    });

    const timeDiff = (new Date(lastShare.timestamp) - new Date(firstShare.timestamp)) / 1000;

    if (timeDiff <= 0) {
        return 0;
    }

    // Average work per second (hashrate)
    return (totalWork / timeDiff) * 512;
};

const distributeRewards = async (rewardAmount, blockNonce, blockTime) => {
    try {
        const blockDifficulty = getDifficultyForShare(blockNonce);
        const maxCumulativeDifficulty = 2 * blockDifficulty;
        let cumulativeDifficulty = 0;

        const sharesCollection = db.collection('shares');
        const shares = await sharesCollection
        .find({
            timestamp: { $lte: new Date(blockTime * 1000) }
        })
        .sort({ timestamp: -1 })
        .toArray();

        if (!shares.length) {
            return;
        }

        let minerShareCounts = {};
        for (const share of shares) {
            const shareDifficulty = getDifficultyForShare(targetToNBits(share.target));
            cumulativeDifficulty += shareDifficulty;
            if (cumulativeDifficulty > maxCumulativeDifficulty) {
                break;
            }

            const { minerId } = share;
            if (!minerShareCounts[minerId]) {
                minerShareCounts[minerId] = 0;
            }
            minerShareCounts[minerId] += shareDifficulty;
        }

        const totalReward = BigInt(rewardAmount);
        const totalDifficulty = Object.values(minerShareCounts).reduce((acc, val) => acc + BigInt(val), BigInt(0));

        let totalDistributed = BigInt(0);
        const minerRewards = {};

        for (const minerId in minerShareCounts) {
            const minerDifficulty = BigInt(minerShareCounts[minerId]);
            //
            // we could make instead divide by maxCumulativeDifficulty
            // which would mean we keep the remainder if we dont
            // have enough shares for the mined block. In spirit of giving
            // back to the community miners we will do this instead 
            // and just collect a 0.1% fee
            //
            const minerReward = (totalReward * minerDifficulty) / totalDifficulty;
            minerRewards[minerId] = minerReward;
            totalDistributed += minerReward;
        }

        for (const minerId in minerRewards) {
            const minerReward = Number(minerRewards[minerId]);
            //console.log(`Updated ${minerId} with ${minerReward}`)
            await updateMinerBalance(minerId, minerReward);
        }
    } catch (error) {
        console.error("Error distributing rewards:", error);
    }
};

const getBannedIps = async () => {
    try {
        const bannedIpsCollection = db.collection('banned_ips');
        return await bannedIpsCollection.find({}).toArray();
    } catch (error) {
        console.error("Error retrieving banned IPs:", error);
        throw error;
    }
};

module.exports = {
    initDB,
    saveShare,
    distributeRewards,
    updateMinerBalance,
    getMinerBalance,
    getMinersWithBalanceAbove,

    calculatePoolHashrate,

    isTransactionProcessed,
    markTransactionAsProcessed,

    banIp,
    unbanIp,
    isIpBanned,

    getBannedIps
};
