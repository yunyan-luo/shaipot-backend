const { parentPort } = require('worker_threads');
const { constructShare } = require('../services/share_construction_service');

parentPort.on('message', (data) => {
    try {
        const { job, nonce, path, blockTarget, blockHex } = data;
        
        const obj = constructShare(job.data, nonce, path);
        const hashVal = Buffer.from(obj.hash, 'hex');
        const target = Buffer.from(job.target, 'hex');
        const block = Buffer.from(blockTarget, 'hex');

        if (hashVal.compare(target) < 0) {
            if (hashVal.compare(block) < 0) {
                const blockHexUpdated = obj.data + blockHex.slice(8192);
                parentPort.postMessage({ 
                    type: 'block_found',
                    blockHexUpdated 
                });
            }
            
            parentPort.postMessage({ 
                type: 'share_accepted',
                share: {
                    target: job.target,
                    nonce,
                    hash: obj.hash,
                    path
                }
            });
        } else {
            parentPort.postMessage({ type: 'share_rejected' });
        }
    } catch (error) {
        console.log(error)
        parentPort.postMessage({ type: 'error' });
    }
});