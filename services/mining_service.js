const WebSocket = require('ws');
const { processShare } = require('./share_processing_service');
const { adjustDifficulty, minerLeft } = require('./difficulty_adjustment_service');
const { generateJob, extractBlockHexToNBits } = require('./share_construction_service');
const { initDB, banIp, isIpBanned } = require('./db_service');
const shaicoin_service = require('./shaicoin_service')

var current_raw_block = null
var block_data = null
var gwss = null

const getIpAddress = (ws) => {
    try {
        const forwardedFor = ws.upgradeReq?.headers['x-forwarded-for'];
    
        if (forwardedFor) {
            const ip = forwardedFor.split(',')[0].trim();
            return ip;
        }
        
        const ip = ws._socket.remoteAddress;
        return ip.replace(/^::ffff:/, '');
    } catch {
        return null
    }
};

const sendJobToWS = (ws) => {
    if (ws.readyState === ws.OPEN) {
        const job = generateJob(ws, block_data);
        ws.job = job;
        ws.send(JSON.stringify({
            type: 'job',
            job_id: job.jobId,
            data: job.data,
            target: job.target,
        }));
    }
}

const distributeJobs = () => {
    if(block_data == null) {
        return
    }

    gwss.clients.forEach((ws) => {
        sendJobToWS(ws)
    });
};

const handleShareSubmission = async (data, ws) => {
    const { miner_id, nonce, job_id, path } = data;
    if (!ws.minerId) {
        var isValid = await shaicoin_service.validateAddress(miner_id)
        if(isValid) {
            ws.minerId = miner_id;
        } else {
            // turn them into a frog
            ws.close(1008, 'Bye.');
            return
        }
    }
    
    await processShare({
        minerId: miner_id,
        nonce: nonce,
        job_id: job_id,
        path: path,
        blockTarget: current_raw_block.expanded,
        blockHex: current_raw_block.blockhex
    }, ws, async () => {
        // if this fires we need to ban.
        await banAndDisconnectIp(ws)
    });

    await adjustDifficulty(miner_id, ws);

    sendJobToWS(ws)
};

const banAndDisconnectIp = async (ws) => {
    try {
        const ipAddress = getIpAddress(ws);
        if(ipAddress) {
            await banIp(ipAddress);
            gwss.clients.forEach((client) => {
                if (getIpAddress(client) === ipAddress) {
                    client.close(1008, 'Bye.');
                }
            });
        }
    } catch (error) {
        console.error(`Error banning and disconnecting IP ${ipAddress}:`, error);
    }
};

const startMiningService = async (port) => {
    await initDB();

    gwss = new WebSocket.Server({ port });
    
    gwss.on('connection', async (ws) => {
        const ipAddress = getIpAddress(ws);
        
        if (ipAddress == null) {
            ws.close(1008, 'Bye.');
            return;
        }

        if (await isIpBanned(ipAddress)) {
            ws.close(1008, 'Bye.');
            return;
        }

        ws.difficulty = 1
        sendJobToWS(ws)
        global.totalMiners += 1;

        ws.on('message', async (message) => {
            const data = JSON.parse(message);
            if (data.type === 'submit') {
                await handleShareSubmission(data, ws);
            }
        });

        ws.on('close', () => {
            if(ws.minerId) {
                minerLeft(ws.minerId)
            }
            global.totalMiners -= 1;
        });
    });

    global.rawDawginIt = (error, rawBlock) => {
        if(error == null) {
            current_raw_block = rawBlock
            block_data = extractBlockHexToNBits(current_raw_block)
            distributeJobs()
        }
    }
    
    await shaicoin_service.sendBalanceToMiners()
    setInterval(shaicoin_service.sendBalanceToMiners, 30 * 60 * 1000);

    await shaicoin_service.getBlockTemplate()
    console.log(`Mining service started on port ${port}`);
};

module.exports = {
    startMiningService
};
