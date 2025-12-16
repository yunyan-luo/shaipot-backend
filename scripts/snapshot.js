const fs = require('fs');
const path = require('path');
const { initDB } = require('../services/db_service');

const snapshotBalances = async () => {
    try {
        await initDB();
        
        const { MongoClient } = require('mongodb');
        const uri = 'mongodb://localhost:27017';
        const dbName = 'mining_pool';
        
        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db(dbName);
        
        const minersCollection = db.collection('miners');
        const allMiners = await minersCollection.find({}).toArray();
        
        // Filter out miners with 0 balance
        const minersWithBalance = allMiners.filter(miner => (miner.balance || 0) > 0);
        
        const snapshot = {
            timestamp: new Date().toISOString(),
            totalMiners: minersWithBalance.length,
            totalBalance: minersWithBalance.reduce((sum, miner) => sum + (miner.balance || 0), 0),
            miners: minersWithBalance.map(miner => ({
                address: miner.minerId,
                balance: miner.balance || 0,
                balanceSHA: ((miner.balance || 0) / 100000000).toFixed(8)
            }))
        };
        
        const snapshotsDir = path.join(__dirname, '..', 'snapshots');
        if (!fs.existsSync(snapshotsDir)) {
            fs.mkdirSync(snapshotsDir, { recursive: true });
        }
        
        const filename = `balance_snapshot_${Date.now()}.json`;
        const filepath = path.join(snapshotsDir, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
        
        console.log(`Snapshot created: ${filepath}`);
        console.log(`Total miners: ${snapshot.totalMiners}`);
        console.log(`Total balance: ${(snapshot.totalBalance / 100000000).toFixed(8)} SHA`);
        
        await client.close();
        process.exit(0);
    } catch (error) {
        console.error('Error creating snapshot:', error);
        process.exit(1);
    }
};

snapshotBalances();
