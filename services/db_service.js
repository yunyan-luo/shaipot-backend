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

        deleteOldShares()
        setInterval(deleteOldShares, 60 * 60 * 1000);
    } catch (error) {
        console.error("Error initializing the database:", error);
    }
}

const deleteOldShares = async () => {
    try {
        const sharesCollection = db.collection('shares');
        const oneDayAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));
        const result = await sharesCollection.deleteMany({ timestamp: { $lt: oneDayAgo } });
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
    return !!existingTransaction;
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
        if (error.code === 11000) { // Duplicate share hash
            
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

const calculatePoolHashrate = async (minerId = null, batchSize = 1000) => {
    const currentTime = Date.now();
    const timeWindow = (minerId != null) ? 1800 : 600;
    const timeWindowInMs = timeWindow * 1000;
    const timeThreshold = new Date(currentTime - timeWindowInMs);

    let query = { timestamp: { $gte: timeThreshold } };
    if (minerId !== null) {
        query.minerId = minerId;
    }

    let totalWork = 0;
    let firstShare = null;
    let lastShare = null;
    let skip = 0;

    while (true) {
        const shares = await db.collection('shares')
            .find(query)
            .sort({ timestamp: 1 })
            .skip(skip)
            .limit(batchSize)
            .toArray();

        if (shares.length === 0) break;

        if (!firstShare) firstShare = shares[0];
        lastShare = shares[shares.length - 1];

        shares.forEach((share) => {
            totalWork += getDifficultyForShare(targetToNBits(share.target));
        });
 
        if (shares.length < batchSize) break;
        skip += batchSize;
    }

    if (!firstShare || !lastShare) return 0;

    const timeDiff = (new Date(lastShare.timestamp) - new Date(firstShare.timestamp)) / 1000;
    if (timeDiff <= 0) return 0;

    return (totalWork / timeDiff) * 512;
};

const distributeRewards = async (rewardAmount, blockNonce, blockTime) => {
    try {
        const blockDifficulty = getDifficultyForShare(blockNonce);
        const maxCumulativeDifficulty = 2 * blockDifficulty;
        let cumulativeDifficulty = 0;
        const batchSize = 1000;

        const sharesCollection = db.collection('shares');
        let minerShareCounts = {};
        let skip = 0;

        while (true) {
            const shares = await sharesCollection
                .find({
                    timestamp: { $lte: new Date(blockTime * 1000) }
                })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(batchSize)
                .toArray();

            if (!shares.length) {
                break;
            }

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

            if (cumulativeDifficulty > maxCumulativeDifficulty || shares.length < batchSize) {
                break;
            }

            skip += batchSize;
        }

        if (Object.keys(minerShareCounts).length === 0) {
            return;
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

const getRecentShares = async (limit = 20) => {
    try {
        const sharesCollection = db.collection('shares');
        const shares = await sharesCollection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        return shares.map(share => ({
            minerId: share.minerId,
            hash: share.hash,
            timestamp: share.timestamp,
            target: share.target,
            difficulty: getDifficultyForShare(targetToNBits(share.target))
        }));
    } catch (error) {
        console.error("Error retrieving recent shares:", error);
        return [];
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
    getRecentShares,

    isTransactionProcessed,
    markTransactionAsProcessed,

    banIp,
    unbanIp,
    isIpBanned,

    getBannedIps
};
