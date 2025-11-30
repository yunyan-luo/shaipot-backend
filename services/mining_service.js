const WebSocket = require('ws');
const { adjustDifficulty, minerLeft } = require('./difficulty_adjustment_service');
const { generateJob, extractBlockHexToNBits } = require('./share_construction_service');
const { initDB, banIp, isIpBanned, saveShare } = require('./db_service');
const shaicoin_service = require('./shaicoin_service')

const { Worker } = require('worker_threads');
const path = require('path');
const numCPUs = require('os').cpus().length - 1;

let workerPool = new Array(numCPUs).fill(null).map(() => {
    const worker = new Worker(path.join(__dirname, '../workers/share.js'))
    worker.setMaxListeners(1000)
    return worker;
});
var currentWorker = 0;

var current_raw_block = null
var block_data = null
var gwss = null

const MAX_MESSAGE_SIZE = 10000

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
            // turn them into a frog
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

    var isAFrog = false
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
                            isAFrog = true
                            // dont close but cool them off by
                            // not sending a new share
                            // // turn them into a frog
                            // ws.close(1008, 'Bye.');
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
                try {
                    worker.off('message', messageHandler);
                    worker.off('error', errorHandler);
                    reject(error);
                } catch (error) {
                    reject(error);
                } finally {
                    worker.off('message', messageHandler);
                    worker.off('error', errorHandler);
                }
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

        if(isAFrog) {
            return;
        }

        await adjustDifficulty(miner_id, ws, `0x${current_raw_block.nbits}`);

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

function isHexOrAlphabet(str) {
    return /^[0-9a-fA-FA-Za-z]+$/.test(str);
}

const startMiningService = async (port) => {
    await initDB();

    gwss = new WebSocket.Server({ port, maxPayload: MAX_MESSAGE_SIZE });
    
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
            if (message.length > MAX_MESSAGE_SIZE) {
                ws.close(1008, 'Message too large');
                return;
            }
        
            try {
                const data = JSON.parse(message);
                if (data.type === 'submit') {
                    if (!isHexOrAlphabet(data.miner_id)) {
                        // check if they have a . in their address
                        // if so, check if the target is valid
                        // if so, set their difficulty to the target
                        // if not, turn them into a frog
                        if (data.miner_id.includes('.')) {
                            const parts = data.miner_id.split('.')
                            const address = parts[0]
                            const target = parts[1]
                            
                            if (!isHexOrAlphabet(address) || !isHexOrAlphabet(target)) {
                                ws.close(1008, 'Invalid data format');
                                return;
                            }

                            data.miner_id = address

                            if (!ws.minerId) {
                                var isValid = await shaicoin_service.validateAddress(data.miner_id);
                                if(isValid) {
                                    ws.minerId = data.miner_id;

                                    // Calculate difficulty from target
                                    // User provides a prefix of the target
                                    // If target is 1f, it means 1f0000...
                                    // If target is 007f, it means 007f0000...
                                    // Max target allowed is 1f (which corresponds to 1f0000... in the top bits)
                                    
                                    const BN = require('bn.js');
                                    
                                    // 1. Normalize user input to lower case
                                    const targetPrefix = target.toLowerCase();
                                    
                                    // 2. Check if the user input exceeds '1f' conceptually when padded
                                    // The user says: "if this target is larger than 1f, e.g. 2f, then unify to 1f followed by all 0s"
                                    // This implies we are comparing the prefix value.
                                    // '1f' is the max prefix allowed.
                                    
                                    // We need to interpret the prefix.
                                    // If user gives '2f', it's > '1f'.
                                    // If user gives '007f', is it > '1f'? No.
                                    // But '007f' should be treated as '007f...'
                                    
                                    // Let's use BN to compare the prefix directly? 
                                    // No, '007f' as a number is > '1f'? Yes (127 > 31).
                                    // Wait, '007f' hex string is 127. '1f' is 31.
                                    // But in terms of target difficulty, 007f... is SMALLER than 1f... ?
                                    // No, 007f... is smaller than 1f00...
                                    // Wait, 007f is 7f. 1f is 1f.
                                    // 007f00... starts with 00 byte.
                                    // 1f00... starts with 1f byte.
                                    // So 1f... is MUCH larger than 007f...
                                    
                                    // The user constraint "if > 1f" likely refers to the value of the target when fully expanded.
                                    // Or maybe just the prefix string value?
                                    // "if this target is larger than 1f, e.g. 2f"
                                    // 2f > 1f.
                                    // So if I pass 2f, it gets capped to 1f.
                                    
                                    // Let's pad the user string to the right to make it a full 64-char (256-bit) target.
                                    // BUT we need to be careful about alignment.
                                    // Does "1f" mean "0000...1f" or "1f00...00"?
                                    // Standard mining: lower target = harder.
                                    // Higher target = easier.
                                    // Max target usually means minimum difficulty.
                                    // User says "if target > 1f... unify to 1f".
                                    // This implies 1f is the maximum allowed target (easiest allowed difficulty).
                                    // Wait, if 1f is the MAX target, then you can't have anything easier than that.
                                    // But usually pools want to set a minimum difficulty (maximum target).
                                    // So maybe 1f is the limit.
                                    
                                    // User clarification: "If it is 1f, it is 1f00000000... If it is 007f, then it is 007f... padded."
                                    // This confirms left-alignment (padding with 0s on the right).
                                    
                                    // User also said: "default is 007ffff" (if not defined).
                                    // And "frontend diff calc wrong, default 007fff is min difficulty, should be fffffff full f".
                                    // This means the base target for difficulty 1 is FFFFFF....
                                    // So Difficulty = FFFFFF... / Target.
                                    
                                    // Let's implement the target construction first.
                                    let paddedTargetStr = targetPrefix.padEnd(64, '0');
                                    
                                    // Max target allowed is 1f0000...
                                    const maxTargetStr = '1f'.padEnd(64, '0');
                                    const maxTargetBN = new BN(maxTargetStr, 16);
                                    
                                    let userTargetBN = new BN(paddedTargetStr, 16);
                                    
                                    if (userTargetBN.gt(maxTargetBN)) {
                                        userTargetBN = maxTargetBN;
                                    }
                                    
                                    // Calculate difficulty
                                    // User said: "should be fffffff full f... then calculate this difficulty value"
                                    // Standard formula: Difficulty = Difficulty_1_Target / Current_Target
                                    // If Difficulty_1_Target is FFFFFF..., then Difficulty = FFFFF... / Current_Target.
                                    
                                    const diff1Target = new BN('f'.repeat(64), 16);
                                    
                                    let newDiff = diff1Target.div(userTargetBN).toNumber();
                                    if (newDiff < 1) newDiff = 1;
                                    
                                    ws.difficulty = newDiff;
                                    
                                    sendJobToWS(ws);
                                } else {
                                    ws.close(1008, 'Bye.');
                                    return;
                                }
                            }
                        } else {
                            ws.close(1008, 'Invalid data format');
                            return;
                        }
                    }
                    if (!isHexOrAlphabet(data.nonce)) {
                        ws.close(1008, 'Invalid data format');
                        return;
                    }
                    if (!isHexOrAlphabet(data.job_id)) {
                        ws.close(1008, 'Invalid data format');
                        return;
                    }
                    if (!isHexOrAlphabet(data.path)) {
                        ws.close(1008, 'Invalid data format');
                        return;
                    }                    
                    await handleShareSubmission(data, ws);
                }
            } catch (err) {
                console.log(err)
                ws.close(1003, 'Invalid JSON');
            }
        });

        ws.on('close', () => {
            if(ws.minerId) {
                minerLeft(ws.minerId)
            }
            global.totalMiners -= 1;
            ws.removeAllListeners('message');
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
