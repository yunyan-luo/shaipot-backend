const readline = require('readline');
const { initDB, getBannedIps, unbanIp } = require('../services/db_service');

(async () => {
    await initDB();
    await displayMenu();
})();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const displayMenu = async () => {
    rl.question('Select an option:\n1. View all banned IPs\n2. Remove a banned IP\n3. Exit\nEnter your choice: ', async (choice) => {
        switch (choice) {
            case '1':
                await listBannedIps();
                break;
            case '2':
                await removeIp();
                break;
            case '3':
                rl.close();
                process.exit();
                break;
            default:
                console.log('Invalid choice, please try again.');
                await displayMenu();
        }
    });
};

const listBannedIps = async () => {
    try {
        const bannedIps = await getBannedIps();
        if (bannedIps.length === 0) {
            console.log("No banned IPs found.");
        } else {
            console.log("Banned IPs:");
            bannedIps.forEach((ip, index) => console.log(`${index + 1}. ${ip.ipAddress}`));
        }
    } catch (error) {
        console.error("Error retrieving banned IPs:", error);
    } finally {
        await displayMenu();
    }
};

const removeIp = async () => {
    rl.question('Enter the IP address to remove: ', async (ipAddress) => {
        try {
            const success = await unbanIp(ipAddress);
            if (success) {
                console.log(`IP address ${ipAddress} removed successfully.`);
            } else {
                console.log(`IP address ${ipAddress} not found in the banned list.`);
            }
        } catch (error) {
            console.error("Error removing banned IP:", error);
        } finally {
            await displayMenu();
        }
    });
};
