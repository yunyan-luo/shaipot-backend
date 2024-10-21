document.getElementById('search-button').addEventListener('click', () => {
    const address = document.getElementById('miner-address').value;
    fetch(`/miner?address=${address}`)
        .then(response => response.json())
        .then(data => {
            document.getElementById('miner-hashrate').textContent = data.hashrate || 'Not found';
            document.getElementById('miner-reward').textContent = data.currentReward || 'No reward yet';
            document.getElementById('miner-data').style.display = 'block';
        });
});

const updatePoolData = () => {
    fetch('/pool-stats')
        .then(response => response.json())
        .then(data => {
            document.getElementById('total-hashrate').textContent = data.totalHashrate
            document.getElementById('connected-miners').textContent = data.connectedMiners
            document.getElementById('minimum-payout').textContent = data.minimumPayout || 'N/A'
            document.getElementById('pool_fee').textContent = `${data.pool_fee} %`
        });
};

// Initial load
updatePoolData();
