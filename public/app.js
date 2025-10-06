// Theme Management
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    init() {
        this.applyTheme();
        this.bindEvents();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        localStorage.setItem('theme', this.theme);
    }

    toggle() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        
        // Add a subtle animation feedback
        const toggleBtn = document.getElementById('theme-toggle');
        toggleBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            toggleBtn.style.transform = '';
        }, 150);
    }

    bindEvents() {
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }
    }
}

// Animation Utilities
class AnimationUtils {
    static fadeIn(element, duration = 300) {
        element.style.opacity = '0';
        element.style.display = 'block';
        
        let start = null;
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            const opacity = Math.min(progress / duration, 1);
            
            element.style.opacity = opacity;
            
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }

    static slideIn(element, duration = 300) {
        element.classList.add('show');
    }

    static addLoadingState(element) {
        element.classList.add('loading');
        element.textContent = 'Loading...';
    }

    static removeLoadingState(element, content) {
        element.classList.remove('loading');
        element.textContent = content;
    }

    static showError(element, message) {
        element.style.color = 'var(--accent)';
        element.textContent = message;
        
        // Reset color after 3 seconds
        setTimeout(() => {
            element.style.color = '';
        }, 3000);
    }
}

// Data Formatting Utilities
class DataFormatter {
    static formatHashrate(hashrate) {
        if (!hashrate || hashrate === 'Not found') return 'Not found';
        
        const num = parseFloat(hashrate);
        if (isNaN(num)) return hashrate;
        
        if (num >= 1e12) return `${(num / 1e12).toFixed(2)} TH/s`;
        if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GH/s`;
        if (num >= 1e6) return `${(num / 1e6).toFixed(2)} MH/s`;
        if (num >= 1e3) return `${(num / 1e3).toFixed(2)} KH/s`;
        return `${num.toFixed(2)} H/s`;
    }

    static formatReward(reward) {
        if (!reward || reward === 'No reward yet') return 'No reward yet';
        
        const num = parseFloat(reward);
        if (isNaN(num)) return reward;
        
        return `${num.toFixed(8)} SHAI`;
    }

    static formatNumber(num) {
        if (typeof num !== 'number') return num;
        return num.toLocaleString();
    }

    static formatPayout(payout) {
        if (!payout || payout === 'N/A') return 'N/A';
        
        const num = parseFloat(payout);
        if (isNaN(num)) return payout;
        
        return `${num.toFixed(4)} SHAI`;
    }
}

// Mining Pool Dashboard
class MiningPoolDashboard {
    constructor() {
        this.isSearching = false;
        this.updateInterval = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.startAutoUpdate();
        this.updatePoolData();
    }

    bindEvents() {
        // Search functionality
        const searchBtn = document.getElementById('search-button');
        const addressInput = document.getElementById('miner-address');
        
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.searchMiner());
        }
        
        if (addressInput) {
            // Search on Enter key
            addressInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchMiner();
                }
            });
            
            // Clear results when input is cleared
            addressInput.addEventListener('input', (e) => {
                if (!e.target.value.trim()) {
                    this.hideMinerResults();
                }
            });
        }
    }

    async searchMiner() {
        if (this.isSearching) return;
        
        const address = document.getElementById('miner-address').value.trim();
        if (!address) {
            this.showNotification('Please enter a miner address', 'warning');
            return;
        }

        this.isSearching = true;
        const searchBtn = document.getElementById('search-button');
        const originalContent = searchBtn.innerHTML;
        
        // Update button state
        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Searching...</span>';
        searchBtn.disabled = true;

        try {
            const response = await fetch(`/miner?address=${encodeURIComponent(address)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.displayMinerData(data);
            
        } catch (error) {
            console.error('Error fetching miner data:', error);
            this.showNotification('Failed to fetch miner data. Please try again.', 'error');
        } finally {
            // Restore button state
            searchBtn.innerHTML = originalContent;
            searchBtn.disabled = false;
            this.isSearching = false;
        }
    }

    displayMinerData(data) {
        const hashrateElement = document.getElementById('miner-hashrate');
        const rewardElement = document.getElementById('miner-reward');
        const resultsContainer = document.getElementById('miner-data');

        if (hashrateElement && rewardElement && resultsContainer) {
            // Format and display data
            hashrateElement.textContent = DataFormatter.formatHashrate(data.hashrate);
            rewardElement.textContent = DataFormatter.formatReward(data.currentReward);
            
            // Show results with animation
            AnimationUtils.slideIn(resultsContainer);
            
            // Show success notification
            this.showNotification('Miner data loaded successfully!', 'success');
        }
    }

    hideMinerResults() {
        const resultsContainer = document.getElementById('miner-data');
        if (resultsContainer) {
            resultsContainer.classList.remove('show');
        }
    }

    async updatePoolData() {
        const elements = {
            hashrate: document.getElementById('total-hashrate'),
            miners: document.getElementById('connected-miners'),
            payout: document.getElementById('minimum-payout'),
            fee: document.getElementById('pool_fee'),
            poolAddress: document.getElementById('pool-mining-address'),
            poolConnection: document.getElementById('pool-connection')
        };

        // Add loading states
        Object.values(elements).forEach(el => {
            if (el) AnimationUtils.addLoadingState(el);
        });

        try {
            const response = await fetch('/pool-stats');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Update elements with formatted data
            if (elements.hashrate) {
                AnimationUtils.removeLoadingState(
                    elements.hashrate, 
                    DataFormatter.formatHashrate(data.totalHashrate)
                );
            }
            
            if (elements.miners) {
                AnimationUtils.removeLoadingState(
                    elements.miners, 
                    DataFormatter.formatNumber(data.connectedMiners)
                );
            }
            
            if (elements.payout) {
                AnimationUtils.removeLoadingState(
                    elements.payout, 
                    DataFormatter.formatPayout(data.minimumPayout)
                );
            }
            
            if (elements.fee) {
                AnimationUtils.removeLoadingState(
                    elements.fee, 
                    `${data.pool_fee}%`
                );
            }
            
            if (elements.poolAddress && data.poolMiningAddress) {
                elements.poolAddress.textContent = data.poolMiningAddress;
                elements.poolAddress.href = `https://blocks.shaicoin.com/address/${data.poolMiningAddress}`;
                elements.poolAddress.classList.remove('loading');
            }
            
            if (elements.poolConnection) {
                const connectionValue = data.poolConnection || 'Unset';
                elements.poolConnection.textContent = connectionValue;
                if (connectionValue !== 'Unset') {
                    elements.poolConnection.href = connectionValue;
                } else {
                    elements.poolConnection.href = '#';
                }
                elements.poolConnection.classList.remove('loading');
            }
            
        } catch (error) {
            console.error('Error fetching pool stats:', error);
            
            // Show error states
            Object.values(elements).forEach(el => {
                if (el) AnimationUtils.showError(el, 'Error loading');
            });
        }
    }

    startAutoUpdate() {
        // Update pool data every 15 seconds
        this.updateInterval = setInterval(() => {
            this.updatePoolData();
        }, 15000);
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element if it doesn't exist
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 500;
                z-index: 1000;
                transform: translateX(100%);
                transition: transform 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
            `;
            document.body.appendChild(notification);
        }

        // Set notification style based on type
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        
        notification.style.backgroundColor = colors[type] || colors.info;
        notification.textContent = message;
        
        // Show notification
        notification.style.transform = 'translateX(0)';
        
        // Hide after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
        }, 3000);
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme manager
    new ThemeManager();
    
    // Initialize dashboard
    window.dashboard = new MiningPoolDashboard();
    
    // Add smooth scrolling for better UX
    document.documentElement.style.scrollBehavior = 'smooth';
});

// Handle page visibility changes to pause/resume updates
document.addEventListener('visibilitychange', () => {
    if (window.dashboard) {
        if (document.hidden) {
            window.dashboard.stopAutoUpdate();
        } else {
            window.dashboard.startAutoUpdate();
            window.dashboard.updatePoolData();
        }
    }
});

// Handle window beforeunload to cleanup
window.addEventListener('beforeunload', () => {
    if (window.dashboard) {
        window.dashboard.stopAutoUpdate();
    }
});
