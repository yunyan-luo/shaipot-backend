const submissionTimestamps = {};
const kalmanFilters = {};
const rollingSubmissionTimes = {};

const targetRate = 333;
const maxRollingWindow = 10;

const initializeKalmanFilter = () => {
    return {
        estimate: 0,
        errorEstimate: 4,
        measurementNoise: 1,
        processNoise: 1,
    };
};

const adjustDifficulty = async (minerId, ws) => {
    const now = Date.now() / 1000;

    if (!kalmanFilters[minerId]) {
        kalmanFilters[minerId] = initializeKalmanFilter();

        if (!submissionTimestamps[minerId]) {
            submissionTimestamps[minerId] = now;
        }

        if (!rollingSubmissionTimes[minerId]) {
            rollingSubmissionTimes[minerId] = [];
        }
        return;
    }

    const kalman = kalmanFilters[minerId];
    const lastSubmissionTime = submissionTimestamps[minerId];
    const elapsedTime = now - lastSubmissionTime;

    submissionTimestamps[minerId] = now;

    if (rollingSubmissionTimes[minerId].length >= maxRollingWindow) {
        rollingSubmissionTimes[minerId].shift();
    }
    rollingSubmissionTimes[minerId].push(elapsedTime);

    const avgElapsedTime = rollingSubmissionTimes[minerId].reduce((a, b) => a + b, 0) / rollingSubmissionTimes[minerId].length;
    kalman.errorEstimate += kalman.processNoise;
    const kalmanGain = kalman.errorEstimate / (kalman.errorEstimate + kalman.measurementNoise);
    kalman.estimate = kalman.estimate + kalmanGain * (avgElapsedTime - kalman.estimate);
    kalman.errorEstimate = (1 - kalmanGain) * kalman.errorEstimate;
    const error = targetRate - kalman.estimate;
    let currentDifficulty = ws.difficulty || 1.0;
    currentDifficulty += error * 0.05;
    currentDifficulty = Math.max(currentDifficulty, 1);
    ws.difficulty = currentDifficulty;
};

const minerLeft = (minerId) => {
    delete submissionTimestamps[minerId];
    delete kalmanFilters[minerId];
    delete rollingSubmissionTimes[minerId];
};

module.exports = { adjustDifficulty, minerLeft };
