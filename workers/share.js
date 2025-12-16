const { parentPort } = require('worker_threads');
const { constructShareV2 } = require('../services/share_construction_service');

parentPort.on('message', (data) => {
    const { requestId, job, nonce, path, blockTarget, blockHex } = data;
    
    try {
        const obj = constructShareV2(job.data, nonce, path);
        const hashVal = Buffer.from(obj.hash, 'hex');
        const target = Buffer.from(job.target, 'hex');
        const block = Buffer.from(blockTarget, 'hex');

        if (hashVal.compare(target) < 0) {
            if (hashVal.compare(block) < 0) {
                const blockHexUpdated = obj.data + blockHex.slice(8192);
                parentPort.postMessage({ 
                    requestId,
                    type: 'block_found',
                    blockHexUpdated 
                });
            }
            
            parentPort.postMessage({ 
                requestId,
                type: 'share_accepted',
                share: {
                    target: job.target,
                    nonce,
                    hash: obj.hash,
                    path
                }
            });
        } else {
            parentPort.postMessage({ requestId, type: 'share_rejected' });
        }
    } catch (error) {
        parentPort.postMessage({ requestId, type: 'error' });
    }
});