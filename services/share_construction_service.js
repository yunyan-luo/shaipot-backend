const BN = require('bn.js');
const crypto = require('crypto');
const addon = require('../build/Release/addon');

const USHRT_MAX = 65535;
const MAX_GRID_SIZE = 2008;

function extractBlockHexToNBits(blockData) {
    const { blockhex, nbits } = blockData;
    const nbitsLE = nbits.match(/../g).reverse().join('');
    const nbitsIndex = blockhex.indexOf(nbitsLE);

    if (nbitsIndex === -1) {
        throw new Error('nbits value not found in blockhex');
    }

    return blockhex.slice(0, nbitsIndex + nbitsLE.length);
}

function adjustTargetForDifficulty(difficulty) {
    const maxTarget = new BN('00007fffff000000000000000000000000000000000000000000000000000000', 16);
    const adjustedTarget = maxTarget.div(new BN(Math.round(difficulty)));
    if (adjustedTarget.gt(maxTarget)) {
        return maxTarget.toString(16).padStart(64, '0');
    }

    return adjustedTarget.toString(16).padStart(64, '0');
}

const generateJob = (ws, block_data) => {
    const jobId = Math.floor(Math.random() * 1000000).toString();
    const adjustedTarget = adjustTargetForDifficulty(ws.difficulty);
    return {
        jobId,
        data: block_data,
        target: adjustedTarget };
};

function verifyHamiltonianCycle(graph, path) {
    const USHRT_MAX = 65535;

    let path_size = path.indexOf(USHRT_MAX);
    if (path_size === -1) {
        path_size = path.length;
    }

    const n = graph.length;

    if (path_size !== n) {
        return false;
    }

    const verticesInPath = new Set(path.slice(0, path_size));
    if (verticesInPath.size !== n) {
        return false;
    }

    for (let i = 1; i < n; ++i) {
        if (!graph[path[i - 1]][path[i]]) {
            return false;
        }
    }

    if (!graph[path[n - 1]][path[0]]) {
        return false;
    }

    return true;
}

function verifyHamiltonianCycle_V3(graph, path) {
    const n = graph.length;

    if (path.length !== n) {
        console.log("V3: Path size doesn't match graph size", { pathLength: path.length, graphSize: n });
        return false;
    }

    if (path.length === 0) {
        console.log("V3: Path is empty");
        return false;
    }

    if (path[0] !== 0) {
        console.log("V3: First vertex must be 0", { firstVertex: path[0] });
        return false;
    }

    const USHRT_MAX = 65535;
    if (path.includes(USHRT_MAX)) {
        console.log("V3: Path contains USHRT_MAX values");
        return false;
    }

    const verticesInPath = new Set(path);
    if (verticesInPath.size !== n) {
        console.log("V3: Path doesn't contain all vertices exactly once", { uniqueVertices: verticesInPath.size, expectedSize: n });
        return false;
    }

    for (let i = 1; i < n; i++) {
        if (!graph[path[i - 1]][path[i]]) {
            console.log("V3: No edge exists", { from: path[i - 1], to: path[i], position: i });
            return false;
        }
    }

    if (!graph[path[n - 1]][path[0]]) {
        console.log("V3: No final edge from last to first vertex", { from: path[n - 1], to: path[0] });
        return false;
    }

    return true;
}

function getGridSize(hash) {
    const minGridSize = 2000;
    const maxGridSize = 2008;
    const grid_size_segment = hash.slice(0, 8);
    const grid_size = parseInt(grid_size_segment, 16);
    const grid_size_final = minGridSize + (grid_size % (maxGridSize - minGridSize));

    return grid_size_final > maxGridSize ? maxGridSize : grid_size_final;
}

function getWorkerGridSize(hash) {
    const minGridSize = 1892;
    const maxGridSize = 1920;
    const grid_size_segment = hash.slice(0, 8);
    const grid_size = parseInt(grid_size_segment, 16);
    const grid_size_final = minGridSize + (grid_size % (maxGridSize - minGridSize));
    return grid_size_final;
}

function getQueenBeeGridSize(workerSize) {
    return MAX_GRID_SIZE - workerSize;
}

function createInitialHash(blockData, nonce) {
    const ushrtMaxArray = new Array(MAX_GRID_SIZE).fill(USHRT_MAX);
    const dataToHash = Buffer.concat([
        Buffer.from(blockData, 'hex'),
        Buffer.from(nonce, 'hex'),
        Buffer.from(ushrtMaxArray.map(num => num.toString(16).padStart(4, '0')).join(''), 'hex'),
    ]);
    return crypto.createHash('sha256').update(dataToHash).digest().reverse().toString('hex');
}

function parsePathToArray(pathBuffer, startIndex, length) {
    const result = [];
    for (let i = startIndex; i < startIndex + length * 2; i += 2) {
        const val = pathBuffer.readUInt16LE(i);
        if (val === USHRT_MAX) continue;
        result.push(val);
    }
    return result;
}

function constructShare(blockData, nonce, path) {
    if(blockData.length > 10000) {
        throw new Error('Invalid data');
    }
    const pathBuffer = Buffer.from(path, 'hex');
    const pathArray = [];

    for (let i = 0; i < pathBuffer.length; i += 2) {
        const val = pathBuffer.readUInt16LE(i);
        if(val === USHRT_MAX) {
            continue;
        }
        pathArray.push(val);
    }

    const ushrtMaxArray = new Array(MAX_GRID_SIZE).fill(USHRT_MAX);

    const dataToHash = Buffer.concat([
        Buffer.from(blockData, 'hex'),
        Buffer.from(nonce, 'hex'),
        Buffer.from(ushrtMaxArray.map(num => num.toString(16).padStart(4, '0')).join(''), 'hex'),
    ]);

    const hash1 = crypto.createHash('sha256').update(dataToHash).digest().reverse().toString('hex');
    const gridSize = getGridSize(hash1);
    const graph = addon.generateGraph(hash1, gridSize);
    const isValidCycle = verifyHamiltonianCycle(graph, pathArray);

    if (!isValidCycle) {
        throw new Error('Invalid Hamiltonian cycle');
    }

    const finalDataToHash = Buffer.concat([
        Buffer.from(blockData, 'hex'),
        Buffer.from(nonce, 'hex'),
        Buffer.from(path, 'hex'),
    ]);
    const hash2 = crypto.createHash('sha256').update(finalDataToHash).digest();

    return {
        hash: hash2.reverse().toString('hex'),
        data: `${blockData}${nonce}${path}`
    }
}

function constructShareV2(blockData, nonce, path) {
    // Enable debug logging for this share validation
    process.env.SHARE_DEBUG = "1";
    
    const hash1 = createInitialHash(blockData, nonce);
    const worker_grid_size = getWorkerGridSize(hash1);
    const queen_bee_grid_size = getQueenBeeGridSize(worker_grid_size);

    console.log("DEBUG V3: hash1:", hash1);
    console.log("DEBUG V3: worker_grid_size:", worker_grid_size, "queen_bee_grid_size:", queen_bee_grid_size);
    console.log("DEBUG V3: path length:", path.length);

    const pathBuffer = Buffer.from(path, 'hex');
    const workerSolution = parsePathToArray(pathBuffer, 0, worker_grid_size);
    const queenBeeSolution = parsePathToArray(pathBuffer, worker_grid_size * 2, queen_bee_grid_size);

    console.log("DEBUG V3: workerSolution length:", workerSolution.length, "first 4:", workerSolution.slice(0,4));
    console.log("DEBUG V3: queenBeeSolution length:", queenBeeSolution.length, "first 4:", queenBeeSolution.slice(0,4));

    console.log("GRAPH DEBUG: About to generate worker graph with:", {
        hash1,
        worker_grid_size,
        percentage: 500
    });
    
    const workerGraph = addon.generateGraphV2(hash1, worker_grid_size, 500);
    
    console.log("GRAPH DEBUG: Generated worker graph, checking first few edges:");
    for (let i = 0; i < Math.min(10, worker_grid_size); i++) {
        for (let j = i + 1; j < Math.min(10, worker_grid_size); j++) {
            console.log(`GRAPH DEBUG: Edge [${i}][${j}] = ${workerGraph[i][j]}`);
        }
    }
    
    console.log("GRAPH DEBUG: Verifying worker path edges:");
    for (let i = 1; i < Math.min(10, workerSolution.length); i++) {
        const from = workerSolution[i-1];
        const to = workerSolution[i];
        const edgeExists = workerGraph[from][to];
        console.log(`GRAPH DEBUG: Worker path edge [${from}]->[${to}] exists: ${edgeExists}`);
        if (!edgeExists) {
            console.log(`GRAPH DEBUG: MISSING EDGE FOUND AT POSITION ${i}`);
            break;
        }
    }
    
    const workerValid = verifyHamiltonianCycle_V3(workerGraph, workerSolution);
    if (!workerValid) {
        console.log("V3 worker verify failed", { 
            worker_grid_size, 
            first_four: workerSolution.slice(0,4),
            hash1,
            path_first_16: path.slice(0, 32)
        });
        throw new Error('Invalid worker Hamiltonian cycle');
    }

    // Bitcoin Core HashWriter serialization: << worker_solution << first_hash
    const workerSolutionBuffer = Buffer.alloc(0);
    const buffers = [workerSolutionBuffer];
    
    // Serialize vector size as compact integer (Bitcoin Core style)
    const size = workerSolution.length;
    if (size < 0xfd) {
        buffers.push(Buffer.from([size]));
    } else if (size <= 0xffff) {
        buffers.push(Buffer.from([0xfd]));
        const sizeBuffer = Buffer.allocUnsafe(2);
        sizeBuffer.writeUInt16LE(size, 0);
        buffers.push(sizeBuffer);
    } else {
        buffers.push(Buffer.from([0xfe]));
        const sizeBuffer = Buffer.allocUnsafe(4);
        sizeBuffer.writeUInt32LE(size, 0);
        buffers.push(sizeBuffer);
    }
    
    // Serialize each uint16_t in little-endian format
    for (const val of workerSolution) {
        const valBuffer = Buffer.allocUnsafe(2);
        valBuffer.writeUInt16LE(val, 0);
        buffers.push(valBuffer);
    }
    
    // Append first_hash bytes (32 bytes) in little-endian (uint256 serialization)
    const hash1Bytes = Buffer.from(hash1, 'hex');
    buffers.push(Buffer.from(hash1Bytes.reverse()));
    
    const finalBuffer = Buffer.concat(buffers);
    const queenBeeHash = crypto.createHash('sha256').update(finalBuffer).digest().reverse().toString('hex');

    const queenBeeGraph = addon.generateGraphV2(queenBeeHash, queen_bee_grid_size, 125);
    const queenBeeValid = verifyHamiltonianCycle_V3(queenBeeGraph, queenBeeSolution);
    if (!queenBeeValid) {
        console.log("V3 queen verify failed", { queen_bee_grid_size, first_four: queenBeeSolution.slice(0,4) });
        throw new Error('Invalid queen bee Hamiltonian cycle');
    }

    const finalDataToHash = Buffer.concat([
        Buffer.from(blockData, 'hex'),
        Buffer.from(nonce, 'hex'),
        Buffer.from(path, 'hex'),
    ]);
    const hash2 = crypto.createHash('sha256').update(finalDataToHash).digest();
    
    // Disable debug logging
    delete process.env.SHARE_DEBUG;
    
    return {
        hash: hash2.reverse().toString('hex'),
        data: `${blockData}${nonce}${path}`
    }
}

module.exports = { generateJob, constructShare, constructShareV2, extractBlockHexToNBits };
