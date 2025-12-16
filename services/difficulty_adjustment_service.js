const { getDifficultyForShare, targetToNBits } = require('./nbits_service');

const minerData = {};

const TARGET_SHARE_TIME = 60;
const SHARE_EXPIRATION_TIME = 90;
const ROLLING_WINDOW_SIZE = 15;

const PID_KP = 0.1;
const PID_KI = 0.01;
const PID_KD = 0.05;

const initializeMinerData = () => {
    return {
        lastShareTimestamp: Date.now(),
        shareIssuedTimestamp: Date.now(),
        pidState: {
            integral: 0,
            lastError: 0
        },
        rollingSubmissionTimes: [],
        invalidShareCount: 0
    };
};

const adjustDifficulty = async (minerId, ws, blockNBits) => {
    const blockDifficulty = getDifficultyForShare(blockNBits);
    const now = Date.now();

    if (!minerData[minerId]) {
        minerData[minerId] = initializeMinerData();
        return;
    }

    const data = minerData[minerId];
    const elapsedTime = (now - data.lastShareTimestamp) / 1000;

    data.lastShareTimestamp = now;

    if (data.rollingSubmissionTimes.length >= ROLLING_WINDOW_SIZE) {
        data.rollingSubmissionTimes.shift();
    }
    data.rollingSubmissionTimes.push(elapsedTime);

    const avgElapsedTime = data.rollingSubmissionTimes.reduce((a, b) => a + b, 0) / data.rollingSubmissionTimes.length;

    const error = avgElapsedTime - TARGET_SHARE_TIME;

    data.pidState.integral += error;

    data.pidState.integral = Math.max(-100, Math.min(100, data.pidState.integral));

    const derivative = error - data.pidState.lastError;
    data.pidState.lastError = error;

    const pidOutput = (PID_KP * error) + (PID_KI * data.pidState.integral) + (PID_KD * derivative);

    let currentDifficulty = ws.difficulty || 1.0;
    currentDifficulty = currentDifficulty * (1 - pidOutput);

    currentDifficulty = Math.min(currentDifficulty, blockDifficulty);
    currentDifficulty = Math.max(currentDifficulty, 1);

    ws.difficulty = currentDifficulty;
};

const trackShareIssued = (minerId) => {
    if (!minerData[minerId]) {
        minerData[minerId] = initializeMinerData();
    }
    minerData[minerId].shareIssuedTimestamp = Date.now();
};

const checkStaleShares = (wss, sendJobCallback) => {
    const now = Date.now();
    
    wss.clients.forEach((ws) => {
        if (!ws.minerId || !minerData[ws.minerId]) {
            return;
        }

        const data = minerData[ws.minerId];
        const timeSinceLastSubmission = (now - data.lastShareTimestamp) / 1000;

        if (timeSinceLastSubmission > SHARE_EXPIRATION_TIME && ws.readyState === ws.OPEN) {
            const currentDifficulty = ws.difficulty || 1.0;
            ws.difficulty = Math.max(currentDifficulty * 0.5, 1);
            
            data.lastShareTimestamp = now;
            
            if (ws.jobBuffer) {
                ws.jobBuffer.forEach(job => job.jobId = -1);
            }
            
            sendJobCallback(ws);
        }
    });
};

const minerLeft = (minerId) => {
    delete minerData[minerId];
};

const trackInvalidShare = (minerId) => {
    if (!minerData[minerId]) {
        minerData[minerId] = initializeMinerData();
    }
    minerData[minerId].invalidShareCount++;
    return minerData[minerId].invalidShareCount;
};

const resetInvalidShareCount = (minerId) => {
    if (minerData[minerId]) {
        minerData[minerId].invalidShareCount = 0;
    }
};

module.exports = { adjustDifficulty, minerLeft, trackShareIssued, checkStaleShares, trackInvalidShare, resetInvalidShareCount };
