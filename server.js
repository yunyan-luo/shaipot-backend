process.title = 'shaicoin_mining_pool'
global.totalMiners = 0
//global.minersToBan = global.minersToBan || new Set();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { startMiningService } = require('./services/mining_service');
const { calculatePoolHashrate, getMinerBalance } = require('./services/db_service');
const { withdraw_threshold, fee_percentage_outof1000, pool_port, web_port } = require('./config.json')
const app = express();
const PORT = process.env.PORT || web_port;

app.set('trust proxy', true);
app.use(express.static('public'));

const bannedIps = new Map();
const BAN_DURATION = 10 * 60 * 1000;

app.use((req, res, next) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.ip;

    const banExpireTime = bannedIps.get(clientIp);
    if (banExpireTime && Date.now() < banExpireTime) {
        return res.status(403).json({ error: 'Just chill for a moment.' });
    }

    if (banExpireTime && Date.now() >= banExpireTime) {
        bannedIps.delete(clientIp);
    }

    next();
});

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    handler: (req, res) => {
        const clientIp = req.headers['cf-connecting-ip'] || req.ip;
        bannedIps.set(clientIp, Date.now() + BAN_DURATION);
        return res.status(429).json({ error: 'Just chill for a moment.' });
    }
}));

app.get('/pool-stats', async (req, res) => {
    try {
        const totalHashrate = await calculatePoolHashrate();
        const poolStats = {
            totalHashrate: `${(totalHashrate).toFixed(2)} H/s`,
            connectedMiners: global.totalMiners,
            minimumPayout: `${(withdraw_threshold / 100000000).toFixed(8)} SHA`,
            pool_fee: (fee_percentage_outof1000 / 1000) * 100,
        };
        res.json(poolStats);
    } catch (error) {
        console.error('Error calculating pool hashrate:', error);
        res.status(500).json({ error: 'Error calculating pool hashrate' });
    }
});

app.get('/miner', async (req, res) => {
    try {
        const address = req.query.address;
        if (address) {
            const hashRate = await calculatePoolHashrate(address);
            res.json({
                hashrate: `${(hashRate).toFixed(2)} H/s`,
                currentReward: `${(await getMinerBalance(address) / 100000000).toFixed(8)} SHA`
            });
        } else {
            res.status(404).send();
        }
    } catch (error) {
        res.status(404).send();
    }
});

app.listen(PORT, async () => {
    await startMiningService(pool_port);
});
