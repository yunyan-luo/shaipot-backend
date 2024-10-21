const readline = require('readline');
const { updateMinerBalance, initDB, getMinerBalance } = require('../services/db_service');

(async () => {
    await initDB();
    await updateBalance();
})();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const updateBalance = async () => {
    rl.question('Enter minerId: ', async (minerId) => {
        if (!minerId) {
            console.error('Miner ID is required!');
            rl.close();
            return;
        }

        rl.question('Enter amount to update (positive to add, negative to subtract): ', async (amount) => {
            if (isNaN(amount)) {
                console.error('Invalid amount! Please enter a number.');
                rl.close();
                return;
            }

            amount = parseFloat(amount);

            try {
                const oldBalance = await getMinerBalance(minerId);
                await updateMinerBalance(minerId, amount);
                const newBalance = await getMinerBalance(minerId);

                console.log(`Miner ${minerId} balance updated successfully.`);
                console.log(`Old Balance: ${oldBalance}`);
                console.log(`New Balance: ${newBalance}`);
            } catch (error) {
                console.error('Error updating miner balance:', error);
            } finally {
                rl.close();
                process.exit()
            }
        });
    });
};
