process.title = 'shaicoin_mining_pool'
global.totalMiners = 0
//global.minersToBan = global.minersToBan || new Set();

// Parse command line arguments
let customStartDiff = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-s' && i + 1 < args.length) {
        const hexValue = args[i + 1];
        // Validate hex string
        if (/^[0-9a-fA-F]+$/.test(hexValue)) {
            // Pad to 64 characters with zeros
            customStartDiff = hexValue.toLowerCase().padEnd(64, '0');
            console.log(`Custom start difficulty set: ${customStartDiff}`);
        } else {
            console.error(`Invalid hex value for -s parameter: ${hexValue}`);
            process.exit(1);
        }
        break;
    }
}

// Make customStartDiff globally available
global.customStartDiff = customStartDiff;

const express = require('express');
const rateLimit = require('express-rate-limit');
const { startMiningService } = require('./services/mining_service');
const { calculatePoolHashrate, getMinerBalance, getRecentShares } = require('./services/db_service');
const { withdraw_threshold, fee_percentage_outof1000, pool_port, web_port, pool_mining_address, pool_connection } = require('./config.json')
const app = express();
const PORT = process.env.PORT || web_port;

app.set('trust proxy', true);
app.use(express.static('public'));

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

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
        const poolConnection = pool_connection ? `${pool_connection}${pool_port}` : 'Unset';
        const poolStats = {
            totalHashrate: `${(totalHashrate).toFixed(2)} H/s`,
            connectedMiners: global.totalMiners,
            minimumPayout: `${(withdraw_threshold / 100000000).toFixed(8)} SHA`,
            pool_fee: (fee_percentage_outof1000 / 1000) * 100,
            poolMiningAddress: pool_mining_address,
            poolConnection: poolConnection
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

app.get('/recent-shares', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const shares = await getRecentShares(limit);
        res.json(shares);
    } catch (error) {
        console.error('Error retrieving recent shares:', error);
        res.status(500).json({ error: 'Error retrieving recent shares' });
    }
});

app.listen(PORT, async () => {
    console.log(`Web server is running on http://localhost:${PORT}`);
    await startMiningService(pool_port);
});


process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Optionally exit or restart the process after logging
});
  
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    // Optionally exit or restart the process after logging
});
  