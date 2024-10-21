const axios = require('axios');

const {
    distributeRewards,
    isTransactionProcessed,
    markTransactionAsProcessed,
    getMinersWithBalanceAbove,
    updateMinerBalance
} = require("./db_service")

const config = require("../config.json")

let currentLongPollId = null;
let blockFetchInterval = null;
let abortController = null; 

async function rpcCall(method, params = [], wallet = null) {
    try {
        const url = wallet ? `/wallet/${wallet}` : '/';
        const requestBody = {
            jsonrpc: '1.0',
            method: method,
            params: params
        };

        const response = await axios.post(config.rpc_url + url, requestBody, { auth: {
            username: config.rpc_username,
            password: config.rpc_password
        }, });
        return response.data.result;
    } catch (error) {
        if (error.response) {
            console.error(`RPC call failed: ${error.message}`);
            console.error('Request:', {
                url: config.rpc_url + (wallet ? `/wallet/${wallet}` : '/'),
                method: method,
                params: params,
            });
            console.error('Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
            });
        } else if (error.request) {
            console.error(`RPC call failed: No response received for ${method}`);
            console.error('Request:', {
                url: config.rpc_url + (wallet ? `/wallet/${wallet}` : '/'),
                method: method,
                params: params,
            });
        } else {
            console.error(`RPC call setup failed: ${error.message}`);
        }
        throw new Error(`RPC call failed: ${error.message}`);
    }
}

async function getnewblockraw(minerAddress) {
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        const response = await axios.post(config.rpc_url, {
            jsonrpc: '1.0',
            id: 'mining_pool',
            method: 'getnewblockraw',
            params: [minerAddress]
        }, {
            auth: {
                username: config.rpc_username,
                password: config.rpc_password
            },
            signal
        });
        return response.data.result;
    } catch (error) {
        throw error;
    }
}

async function getMinerTransactions(minerAddress, wallet = null, batchSize = 100) {
    let allMinerTransactions = [];
    let skip = 0;
    let hasMoreTransactions = true;

    while (hasMoreTransactions) {
        const transactions = await rpcCall('listtransactions', ['*', batchSize, skip], wallet);
        if (transactions.length < batchSize) {
            hasMoreTransactions = false;
        }
        const minerTransactions = transactions
            .filter(tx => {
                return tx.address === minerAddress
                && tx.confirmations > 100
                && tx.amount > 0
            })
            .map(tx => ({
                ...tx,
                amountInSatoshis: BigInt(Math.floor(tx.amount * 100000000)),
            }));

        allMinerTransactions = allMinerTransactions.concat(minerTransactions);

        skip += batchSize;
    }

    var returnVal = []
    for(var i = 0, Length = allMinerTransactions.length; i < Length; i++) {
        var tx = allMinerTransactions[i]
        var txProcessed = await isTransactionProcessed(tx.txid)
        if(!txProcessed) {
            returnVal.push(tx)
        }
    }
    return returnVal;
}

const trackAndDistribute = async (minerAddress, wallet = null) => {
    try {
        const transactions = await getMinerTransactions(minerAddress, wallet);

        if (!transactions.length) {
            return;
        }

        for (const tx of transactions) {
            //console.log(`Processing transaction ${tx.txid} for miner ${minerAddress}. Allocating reward of ${tx.amountInSatoshis}`);
            const data = await getBlockTarget(tx.blockhash)
            await markTransactionAsProcessed(tx.txid)
            await distributeRewards(tx.amountInSatoshis, `0x${data.blockTarget}`, data.time);
        }

    } catch (error) {
        console.error(`Error tracking transactions or distributing rewards: ${error.message}`);
    }
};


async function innerRawDawg() {
    try {
        if(global.rawDawginIt) {
            global.rawDawginIt(null, await getnewblockraw(config.pool_mining_address));
        }
    } catch (error) {
        if(global.rawDawginIt) {
            global.rawDawginIt(error, null);
        }
    }
}

async function getBlockTemplate(longpollid = null, retryCount = 0) {
    const maxRetries = 5;
    const maxBackoff = 60000;

    try {
        const params = {
            capabilities: ['coinbasetxn', 'workid', 'coinbase/append', 'longpoll', 'segwit'],
            rules: ['segwit'],
            longpollid: longpollid
        };

        const response = await axios.post(config.rpc_url, {
            jsonrpc: '1.0',
            id: 'mining_pool',
            method: 'getblocktemplate',
            params: [params]
        }, {
            auth: {
                username: config.rpc_username,
                password: config.rpc_password
            }
        });

        console.log(`${new Date().toISOString()} - getBlockTemplate has returned; let's start mining`);

        const blockTemplate = response.data.result;

        if (blockTemplate.longpollid && blockTemplate.longpollid !== currentLongPollId) {
            currentLongPollId = blockTemplate.longpollid;

            if (blockFetchInterval) {
                clearInterval(blockFetchInterval);
            }

            if (abortController) {
                abortController.abort();
            }

            await innerRawDawg();
            scheduleNewBlockFetch();
        }

        await trackAndDistribute(config.pool_mining_address);

        await getBlockTemplate(currentLongPollId);
    } catch (error) {
        if (error.response && error.response.status === 403) {
            return;  // Do not retry on 403 error, requires user intervention
        }

        if (retryCount < maxRetries) {
            const backoffTime = Math.min(Math.pow(2, retryCount) * 1000, maxBackoff);
            console.log(`Retrying getBlockTemplate in ${backoffTime / 1000} seconds... (Retry ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            return getBlockTemplate(longpollid, retryCount + 1);
        } else {
            console.error('Max retries reached. Giving up on fetching block template.');
        }
    }
}


function scheduleNewBlockFetch() {
    blockFetchInterval = setInterval(async () => {
        await innerRawDawg()
    }, 45000);
}

async function getBlockTarget(blockHash) {
    try {
        const blockHeaderResponse = await axios.post(config.rpc_url, {
            jsonrpc: '1.0',
            id: 'mining_pool',
            method: 'getblockheader',
            params: [blockHash]
        }, {
            auth: {
                username: config.rpc_username,
                password: config.rpc_password
            }
        });
        const blockHeader = blockHeaderResponse.data.result;
        const targetBits = blockHeader.bits;
        return {
            blockTarget: targetBits,
            time: blockHeader.time
        }
    } catch (error) {
        throw error;
    }
}

async function validateAddress(address) {
    try {
        const validationResult = await rpcCall('validateaddress', [address]);
        return validationResult.isvalid;
    } catch (error) {
        return false
    }
}

const sendBalanceToMiners = async () => {
    try {
        const miners = await getMinersWithBalanceAbove(config.withdraw_threshold);

        if (!miners.length) {
            //console.log("No miners with balance above the threshold.");
            return;
        }

        var outputs = [];
        let totalFeesCollected = 0;

        for (const miner of miners) {
            const minerBalance = miner.balance;

            const feePercentage = config.fee_percentage_outof1000 / 1000;
            const feeAmount = Math.floor(minerBalance * feePercentage);

            const finalPayout = minerBalance - feeAmount;

            if (finalPayout <= 0) {
                continue;
            }

            const isValid = await validateAddress(miner.minerId);
            if (!isValid) {
                continue;
            }

            outputs.push({
                address: miner.minerId,
                amount: finalPayout
            });

            totalFeesCollected += feeAmount;

            //console.log(`Sending ${finalPayout} satoshis to miner ${miner.minerId}`);
            await updateMinerBalance(miner.minerId, 0);
        }

        if (totalFeesCollected > 0) {
            outputs.push({
                address: config.pool_fee_address,
                amount: totalFeesCollected
            });
            //console.log(`Sending ${totalFeesCollected} satoshis to the pool fee address ${config.pool_fee_address}`);
        }

        try {
            //console.log(outputs);
            await createAndSendTransaction(outputs);
        } catch (sendError) {
            console.error(`Error sending: ${sendError.message}`);
        }
    } catch (error) {
        console.error("Error sending balances to miners:", error);
    }
};

function satoshisToBitcoin(satoshis) {
    const satoshiBigInt = BigInt(satoshis);
    const divisor = BigInt(1e8);
    const integerPart = satoshiBigInt / divisor;
    const decimalPart = satoshiBigInt % divisor;
    let decimalPartStr = decimalPart.toString().padStart(8, '0');
    decimalPartStr = decimalPartStr.replace(/0+$/, '') || '0';
    return `${integerPart.toString()}.${decimalPartStr}`;
}

async function createAndSendTransaction(outputs, wallet = null, confirmationTarget = 6) {
    try {
        const formattedOutputs = {};
        outputs.forEach(output => {
            const address = output.address;
            const amountSatoshis = BigInt(output.amount);
            if (formattedOutputs[address] !== undefined) {
                formattedOutputs[address] += amountSatoshis;
            } else {
                formattedOutputs[address] = amountSatoshis;
            }
        });

        for (const address in formattedOutputs) {
            formattedOutputs[address] = satoshisToBitcoin(formattedOutputs[address]);
        }

        const rawTx = await rpcCall('createrawtransaction', [[], formattedOutputs], wallet);

        let feeRateSatsPerVByte;
        try {
            const feeEstimate = await rpcCall('estimatesmartfee', [confirmationTarget], wallet);
            if (feeEstimate.feerate) {
                feeRateSatsPerVByte = Math.ceil((feeEstimate.feerate * 1e8) / 1000);
            } else {
                feeRateSatsPerVByte = 1;
            }
        } catch (error) {
            feeRateSatsPerVByte = 1;
        }

        const feeRateInBTCPerKB = (feeRateSatsPerVByte * 1000) / 1e8;

        const fundedTx = await rpcCall('fundrawtransaction', [rawTx, { feeRate: feeRateInBTCPerKB }], wallet);

        const signedTx = await rpcCall('signrawtransactionwithwallet', [fundedTx.hex], wallet);
        const txId = await rpcCall('sendrawtransaction', [signedTx.hex], wallet);

        return txId;
    } catch (error) {
        console.error(`Error creating and sending transaction: ${error.message}`);
        throw error;
    }
}

async function submitBlock(rawBlockHex) {
    try {
        await axios.post(config.rpc_url, {
            jsonrpc: '1.0',
            id: 'mining_pool',
            method: 'submitblock',
            params: [rawBlockHex]
        }, {
            auth: {
                username: config.rpc_username,
                password: config.rpc_password
            }
        });
    } catch (error) {
        console.error('Error submitting block:', error);
    }
}

module.exports = {
    rpcCall,
    getBlockTemplate,
    trackAndDistribute,
    sendBalanceToMiners,
    submitBlock,
    validateAddress
};
