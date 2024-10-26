const WebSocket = require('ws');
const { adjustDifficulty, minerLeft } = require('./difficulty_adjustment_service');
const { generateJob, extractBlockHexToNBits } = require('./share_construction_service');
const { initDB, banIp, isIpBanned, saveShare } = require('./db_service');
const shaicoin_service = require('./shaicoin_service')

const { Worker } = require('worker_threads');
const path = require('path');
const numCPUs = require('os').cpus().length;

const workerPool = new Array(numCPUs).fill(null).map(() => 
    new Worker(path.join(__dirname, '../workers/share.js'))
);
var currentWorker = 0;

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
    const { miner_id, nonce, job_id, path: minerPath } = data;

    if (!ws.minerId) {
        var isValid = await shaicoin_service.validateAddress(miner_id);
        if(isValid) {
            ws.minerId = miner_id;
        } else {
            ws.close(1008, 'Bye.');
            return;
        }
    }

    if (ws.job && job_id !== ws.job.jobId) {
        ws.send(JSON.stringify({ type: 'rejected', message: 'Job ID mismatch' }));
        return;
    }

    ws.job.jobId = -1;

    // Get next worker in round-robin fashion
    const worker = workerPool[currentWorker];
    currentWorker = (currentWorker + 1) % workerPool.length;

    try {
        const processSharePromise = new Promise((resolve, reject) => {
            const messageHandler = async (result) => {
                try {
                    switch(result.type) {
                        case 'block_found':
                            await shaicoin_service.submitBlock(result.blockHexUpdated);
                            break;
                            
                        case 'share_accepted':
                            await saveShare(miner_id, result.share);
                            ws.send(JSON.stringify({ type: 'accepted' }));
                            break;
                            
                        case 'share_rejected':
                            ws.send(JSON.stringify({ type: 'rejected' }));
                            break;
                        case 'error':
                            //await banAndDisconnectIp(ws);
                            break;
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                } finally {
                    worker.off('message', messageHandler);
                    worker.off('error', errorHandler);
                }
            };

            const errorHandler = (error) => {
                console.log(error)
                worker.off('message', messageHandler);
                worker.off('error', errorHandler);
                reject(error);
            };

            worker.on('message', messageHandler);
            worker.on('error', errorHandler);
        });

        worker.postMessage({
            job: ws.job,
            nonce,
            path: minerPath,
            blockTarget: current_raw_block.expanded,
            blockHex: current_raw_block.blockhex
        });

        await processSharePromise;

        await adjustDifficulty(miner_id, ws);

        sendJobToWS(ws);
    } catch (error) {
        console.error('Error processing share:', error);
        ws.send(JSON.stringify({ type: 'rejected' }));
    }
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
