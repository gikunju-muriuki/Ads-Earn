// ============================================
// BeeEarn - Premium Ad Earning Platform
// Script.js - Core Logic
// ============================================

// ============================================
// DATABASE & STORAGE SETUP (IndexedDB + LocalStorage)
// ============================================

const DB_NAME = 'BeeEarnDB';
const DB_VERSION = 1;
const STORES = {
    users: 'users',
    sessions: 'sessions',
    earnings: 'earnings',
    withdrawals: 'withdrawals'
};

let db;

// Initialize IndexedDB
function initializeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            
            // Users store: id, username, password, email, createdAt, lastLogin
            if (!dbInstance.objectStoreNames.contains(STORES.users)) {
                const userStore = dbInstance.createObjectStore(STORES.users, { keyPath: 'id', autoIncrement: true });
                userStore.createIndex('username', 'username', { unique: true });
                userStore.createIndex('email', 'email', { unique: true });
            }
            
            // Sessions store: userId, loginTime, sessionExpiry, isActive
            if (!dbInstance.objectStoreNames.contains(STORES.sessions)) {
                const sessionStore = dbInstance.createObjectStore(STORES.sessions, { keyPath: 'userId' });
                sessionStore.createIndex('isActive', 'isActive', { unique: false });
            }
            
            // Earnings store: userId, clickCount, totalEarnings, dailyClicks, lastClickDate, withdrawnAmount
            if (!dbInstance.objectStoreNames.contains(STORES.earnings)) {
                const earningsStore = dbInstance.createObjectStore(STORES.earnings, { keyPath: 'userId' });
            }
            
            // Withdrawals store: id, userId, amount, method, address, date, status
            if (!dbInstance.objectStoreNames.contains(STORES.withdrawals)) {
                dbInstance.createObjectStore(STORES.withdrawals, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// Database transaction helper
function dbTransaction(storeName, mode = 'readonly', callback) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], mode);
        const store = transaction.objectStore(storeName);
        
        callback(store)
            .onsuccess = (event) => resolve(event.target.result);
        callback(store)
            .onerror = () => reject(transaction.error);
    });
}

// ============================================
// USER AUTHENTICATION
// ============================================

const AUTH = {
    currentUser: null,
    sessionTimeout: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
    
    async register(email, username, password) {
        try {
            // Validate inputs
            if (!email || !username || !password) {
                throw new Error('All fields are required');
            }
            
            if (password.length < 6) {
                throw new Error('Password must be at least 6 characters');
            }
            
            if (!this.isValidEmail(email)) {
                throw new Error('Invalid email format');
            }
            
            const hashedPassword = await this.hashPassword(password);
            const newUser = {
                username,
                email,
                password: hashedPassword,
                createdAt: new Date(),
                balance: 0,
                withdrawnAmount: 0
            };
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.users], 'readwrite');
                const store = transaction.objectStore(STORES.users);
                const request = store.add(newUser);
                
                request.onsuccess = () => {
                    // Initialize earnings record
                    this.initializeEarnings(request.result);
                    resolve(request.result);
                };
                
                request.onerror = () => {
                    if (request.error.name === 'ConstraintError') {
                        reject(new Error('Username or email already exists'));
                    } else {
                        reject(request.error);
                    }
                };
            });
        } catch (error) {
            throw error;
        }
    },
    
    async login(username, password) {
        try {
            const hashedPassword = await this.hashPassword(password);
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.users], 'readonly');
                const store = transaction.objectStore(STORES.users);
                const index = store.index('username');
                const request = index.get(username);
                
                request.onsuccess = () => {
                    const user = request.result;
                    
                    if (!user) {
                        reject(new Error('Username or password incorrect'));
                        return;
                    }
                    
                    // Compare password (in production, use bcrypt)
                    if (user.password !== hashedPassword) {
                        reject(new Error('Username or password incorrect'));
                        return;
                    }
                    
                    // Check session timeout
                    const now = new Date().getTime();
                    if (user.lastLogin) {
                        const lastLogin = new Date(user.lastLogin).getTime();
                        if (now - lastLogin > this.sessionTimeout) {
                            reject(new Error('Session expired. Please login again.'));
                            return;
                        }
                    }
                    
                    // Update last login
                    this.updateLastLogin(user.id);
                    this.currentUser = user;
                    this.setUserSession(user.id);
                    resolve(user);
                };
                
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            throw error;
        }
    },
    
    async updateLastLogin(userId) {
        return new Promise((resolve) => {
            const transaction = db.transaction([STORES.users], 'readwrite');
            const store = transaction.objectStore(STORES.users);
            const request = store.get(userId);
            
            request.onsuccess = () => {
                const user = request.result;
                user.lastLogin = new Date();
                store.put(user);
                resolve();
            };
        });
    },
    
    setUserSession(userId) {
        localStorage.setItem('currentUserId', userId);
        localStorage.setItem('sessionStartTime', new Date().getTime());
    },
    
    clearUserSession() {
        localStorage.removeItem('currentUserId');
        localStorage.removeItem('sessionStartTime');
    },
    
    isSessionValid() {
        const sessionStartTime = localStorage.getItem('sessionStartTime');
        if (!sessionStartTime) return false;
        
        const now = new Date().getTime();
        const elapsed = now - parseInt(sessionStartTime);
        return elapsed < this.sessionTimeout;
    },
    
    getCurrentUserId() {
        return localStorage.getItem('currentUserId');
    },
    
    initializeEarnings(userId) {
        const earningsData = {
            userId,
            clickCount: 0,
            totalEarnings: 0.00,
            dailyClicks: 0,
            lastClickDate: new Date().toDateString(),
            withdrawnAmount: 0.00
        };
        
        const transaction = db.transaction([STORES.earnings], 'readwrite');
        const store = transaction.objectStore(STORES.earnings);
        store.add(earningsData);
    },
    
    hashPassword(password) {
        // Simple hash (use bcrypt in production)
        return Promise.resolve(btoa(password));
    },
    
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    
    async logout() {
        this.currentUser = null;
        this.clearUserSession();
        showNotification('Logged out successfully', 'success');
    }
};

// ============================================
// EARNINGS & CLICK MANAGEMENT
// ============================================

const EARNINGS = {
    minEarning: 0.04,
    maxEarning: 0.13,
    maxClicksPerDay: 12,
    
    async recordClick(userId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.earnings], 'readwrite');
            const store = transaction.objectStore(STORES.earnings);
            const request = store.get(userId);
            
            request.onsuccess = () => {
                const earnings = request.result;
                const today = new Date().toDateString();
                
                // Reset daily clicks if new day
                if (earnings.lastClickDate !== today) {
                    earnings.dailyClicks = 0;
                    earnings.lastClickDate = today;
                }
                
                // Check if max clicks reached
                if (earnings.dailyClicks >= this.maxClicksPerDay) {
                    reject(new Error(`Maximum ${this.maxClicksPerDay} clicks per day reached`));
                    return;
                }
                
                // Generate random earning
                const earning = this.generateRandomEarning();
                earnings.totalEarnings += earning;
                earnings.clickCount += 1;
                earnings.dailyClicks += 1;
                
                store.put(earnings);
                resolve({ earning, totalEarnings: earnings.totalEarnings, dailyClicks: earnings.dailyClicks });
            };
            
            request.onerror = () => reject(request.error);
        });
    },
    
    generateRandomEarning() {
        // Generate random earning between min and max
        return parseFloat((Math.random() * (this.maxEarning - this.minEarning) + this.minEarning).toFixed(2));
    },
    
    async getBalance(userId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.earnings], 'readonly');
            const store = transaction.objectStore(STORES.earnings);
            const request = store.get(userId);
            
            request.onsuccess = () => {
                const earnings = request.result;
                resolve(earnings ? earnings.totalEarnings : 0);
            };
            
            request.onerror = () => reject(request.error);
        });
    },
    
    async getEarningsData(userId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.earnings], 'readonly');
            const store = transaction.objectStore(STORES.earnings);
            const request = store.get(userId);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
};

// ============================================
// WITHDRAWAL SYSTEM
// ============================================

const PAYMENT_METHODS = {
    paypal: { min: 50, fee: 1, currency: 'USD' },
    bitcoin: { min: 65, fee: 0, currency: 'BTC' },
    usdc: { min: 65, fee: 0, currency: 'USDC' }
};

const WITHDRAWAL = {
    async requestWithdrawal(userId, method, address) {
        try {
            if (!PAYMENT_METHODS[method]) {
                throw new Error('Invalid payment method');
            }
            
            const earnings = await EARNINGS.getEarningsData(userId);
            const minAmount = PAYMENT_METHODS[method].min;
            const balance = earnings.totalEarnings - earnings.withdrawnAmount;
            
            if (balance < minAmount) {
                throw new Error(`Minimum balance for ${method} is $${minAmount}`);
            }
            
            // Record withdrawal
            const withdrawal = {
                userId,
                amount: balance,
                method,
                address,
                date: new Date(),
                status: 'pending',
                processDate: this.getNextProcessDate()
            };
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.withdrawals, STORES.earnings], 'readwrite');
                const withdrawStore = transaction.objectStore(STORES.withdrawals);
                const earningsStore = transaction.objectStore(STORES.earnings);
                
                const withdrawRequest = withdrawStore.add(withdrawal);
                
                withdrawRequest.onsuccess = () => {
                    // Update withdrawn amount in earnings
                    earnings.withdrawnAmount += withdrawal.amount;
                    earningsStore.put(earnings);
                    
                    resolve({
                        id: withdrawRequest.result,
                        ...withdrawal
                    });
                };
                
                withdrawRequest.onerror = () => reject(withdrawRequest.error);
            });
        } catch (error) {
            throw error;
        }
    },
    
    getNextProcessDate() {
        // First of next month at 00:00 UTC
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        return nextMonth;
    },
    
    async getWithdrawalHistory(userId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.withdrawals], 'readonly');
            const store = transaction.objectStore(STORES.withdrawals);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const withdrawals = request.result.filter(w => w.userId === userId);
                resolve(withdrawals);
            };
            
            request.onerror = () => reject(request.error);
        });
    }
};

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(error => {
            console.warn('Service Worker registration failed:', error);
        });
    }
}

// ============================================
// UI INTERACTION HANDLERS
// ============================================

// Join Modal Handler
document.getElementById('joinBtn')?.addEventListener('click', () => {
    document.getElementById('joinModal').classList.remove('hidden');
    // Add ripple effect
    addRippleEffect(event.target);
});

document.getElementById('openTerms')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('termsModal').classList.remove('hidden');
});

document.getElementById('closeTerms')?.addEventListener('click', () => {
    document.getElementById('termsModal').classList.add('hidden');
});

document.getElementById('submitJoin')?.addEventListener('click', async () => {
    const email = document.getElementById('joinEmail').value;
    const username = document.getElementById('joinUser').value;
    const password = document.getElementById('joinPass').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;
    
    if (!agreeTerms) {
        showNotification('Please agree to the terms and conditions', 'error');
        return;
    }
    
    try {
        const userId = await AUTH.register(email, username, password);
        showNotification('Account created successfully! Please log in.', 'success');
        document.getElementById('joinModal').classList.add('hidden');
        closeAllModals();
        clearJoinForm();
    } catch (error) {
        showNotification(error.message, 'error');
    }
});

// Login Modal Handler
document.getElementById('loginBtn')?.addEventListener('click', () => {
    document.getElementById('loginModal').classList.remove('hidden');
    addRippleEffect(event.target);
});

document.getElementById('submitLogin')?.addEventListener('click', async () => {
    const username = document.getElementById('loginUser').value;
    const password = document.getElementById('loginPass').value;
    
    try {
        const user = await AUTH.login(username, password);
        showNotification(`Welcome back, ${user.username}!`, 'success');
        document.getElementById('loginModal').classList.add('hidden');
        closeAllModals();
        updateDashboard();
        showDashboard();
        clearLoginForm();
    } catch (error) {
        showNotification(error.message, 'error');
    }
});

// Logout Handler
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await AUTH.logout();
    hideDashboard();
    updateNavigation();
    addRippleEffect(event.target);
});

// Close Modal Handlers
document.querySelectorAll('.close-modal')?.forEach(btn => {
    btn.addEventListener('click', () => {
        closeAllModals();
        addRippleEffect(btn);
    });
});

// Ad Type Toggle
document.getElementById('showSocialBtn')?.addEventListener('click', function() {
    switchAds('social');
    this.classList.add('active');
    document.getElementById('showAdultBtn').classList.remove('active');
    addRippleEffect(this);
});

document.getElementById('showAdultBtn')?.addEventListener('click', function() {
    switchAds('adult');
    this.classList.add('active');
    document.getElementById('showSocialBtn').classList.remove('active');
    addRippleEffect(this);
});

// Ad Click Handler
document.getElementById('socialAdPlaceholder')?.addEventListener('click', () => {
    handleAdClick();
});

document.getElementById('adultAdPlaceholder')?.addEventListener('click', () => {
    handleAdClick();
});

async function handleAdClick() {
    const userId = AUTH.getCurrentUserId();
    if (!userId) {
        showNotification('Please log in to earn', 'error');
        return;
    }
    
    try {
        const result = await EARNINGS.recordClick(userId);
        showNotification(`+$${result.earning.toFixed(2)} earned!`, 'success');
        updateEarningsDisplay();
        // Add click animation
        const adBanner = document.querySelector('.ad-banner:not(.hidden)');
        if (adBanner) {
            adBanner.style.animation = 'none';
            setTimeout(() => {
                adBanner.style.animation = 'pulse 0.5s ease';
            }, 10);
        }
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Withdrawal Handler
document.getElementById('withdrawBtn')?.addEventListener('click', () => {
    document.getElementById('withdrawModal').classList.remove('hidden');
    updateWithdrawModal();
    addRippleEffect(event.target);
});

document.querySelectorAll('.method-card')?.forEach(card => {
    card.addEventListener('click', function() {
        const method = this.dataset.method;
        const balance = parseFloat(document.getElementById('balanceDisplay').textContent.replace('$', ''));
        const minRequired = parseInt(this.dataset.min);
        
        // Deselect all
        document.querySelectorAll('.method-card').forEach(c => c.classList.remove('selected'));
        
        if (balance >= minRequired) {
            this.classList.add('selected');
            document.getElementById('paymentDetails').classList.remove('hidden');
            document.getElementById('walletAddress').placeholder = `Enter your ${method.toUpperCase()} address`;
            document.getElementById('walletAddress').dataset.method = method;
        } else {
            showNotification(`Insufficient balance. Minimum $${minRequired} required.`, 'error');
            document.getElementById('paymentDetails').classList.add('hidden');
        }
        addRippleEffect(this);
    });
});

document.getElementById('confirmWithdraw')?.addEventListener('click', async () => {
    const userId = AUTH.getCurrentUserId();
    const method = document.querySelector('.method-card.selected')?.dataset.method;
    const address = document.getElementById('walletAddress').value;
    
    if (!method || !address) {
        showNotification('Please select a payment method and enter address', 'error');
        return;
    }
    
    try {
        const withdrawal = await WITHDRAWAL.requestWithdrawal(userId, method, address);
        showNotification(`Withdrawal request submitted. Processing on ${withdrawal.processDate.toDateString()}`, 'success');
        document.getElementById('withdrawModal').classList.add('hidden');
        closeAllModals();
        updateEarningsDisplay();
    } catch (error) {
        showNotification(error.message, 'error');
    }
});

// ============================================
// UI UPDATE FUNCTIONS
// ============================================

async function updateDashboard() {
    const userId = AUTH.getCurrentUserId();
    if (!userId) return;
    
    try {
        const earnings = await EARNINGS.getEarningsData(userId);
        const balance = earnings.totalEarnings - earnings.withdrawnAmount;
        
        document.getElementById('balanceDisplay').textContent = `$${balance.toFixed(2)}`;
        document.getElementById('clicksDisplay').textContent = `${earnings.dailyClicks} / ${EARNINGS.maxClicksPerDay}`;
    } catch (error) {
        console.error('Error updating dashboard:', error);
    }
}

async function updateEarningsDisplay() {
    await updateDashboard();
}

function updateWithdrawModal() {
    const userId = AUTH.getCurrentUserId();
    EARNINGS.getBalance(userId).then(balance => {
        document.getElementById('modalBalance').textContent = `$${balance.toFixed(2)}`;
    });
}

function showDashboard() {
    document.getElementById('dashboard').classList.remove('hidden');
    document.getElementById('hero').classList.add('hidden');
}

function hideDashboard() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('hero').classList.remove('hidden');
}

function updateNavigation() {
    const userId = AUTH.getCurrentUserId();
    if (userId) {
        document.getElementById('loginBtn').classList.add('hidden');
        document.getElementById('joinBtn').classList.add('hidden');
        document.getElementById('logoutBtn').classList.remove('hidden');
    } else {
        document.getElementById('loginBtn').classList.remove('hidden');
        document.getElementById('joinBtn').classList.remove('hidden');
        document.getElementById('logoutBtn').classList.add('hidden');
    }
}

function switchAds(type) {
    const socialAd = document.getElementById('socialAdPlaceholder');
    const adultAd = document.getElementById('adultAdPlaceholder');
    
    if (type === 'social') {
        socialAd.classList.remove('hidden');
        adultAd.classList.add('hidden');
    } else {
        socialAd.classList.add('hidden');
        adultAd.classList.remove('hidden');
    }
}

function clearJoinForm() {
    document.getElementById('joinEmail').value = '';
    document.getElementById('joinUser').value = '';
    document.getElementById('joinPass').value = '';
    document.getElementById('agreeTerms').checked = false;
}

function clearLoginForm() {
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.add('hidden');
    });
}

// ============================================
// CUSTOM NOTIFICATIONS
// ============================================

function showNotification(message, type = 'info') {
    const notificationArea = document.getElementById('notificationArea');
    const toast = document.createElement('div');
    toast.className = 'notify-toast';
    toast.textContent = message;
    
    // Add type-specific styling
    if (type === 'success') {
        toast.style.borderLeftColor = '#FFD700';
    } else if (type === 'error') {
        toast.style.borderLeftColor = '#FF6B6B';
    }
    
    notificationArea.appendChild(toast);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

// Add slideOut animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
    }
    
    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 215, 0, 0.6);
        transform: scale(0);
        animation: ripple-animation 0.6s ease-out;
        pointer-events: none;
    }
    
    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ============================================
// RIPPLE EFFECT (PREMIUM ANIMATIONS)
// ============================================

function addRippleEffect(element) {
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    
    element.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function checkSessionValidity() {
    const userId = AUTH.getCurrentUserId();
    
    if (userId && !AUTH.isSessionValid()) {
        AUTH.logout();
        hideDashboard();
        updateNavigation();
        showNotification('Session expired. Please log in again.', 'error');
        return false;
    }
    
    return true;
}

// Check session every minute
setInterval(checkSessionValidity, 60000);

// ============================================
// PAGE INITIALIZATION
// ============================================

async function initializePage() {
    try {
        await initializeDB();
        registerServiceWorker();
        
        // Check if user is already logged in
        if (AUTH.getCurrentUserId() && checkSessionValidity()) {
            updateNavigation();
            showDashboard();
            updateDashboard();
        } else {
            updateNavigation();
        }
        
        console.log('BeeEarn Platform Initialized');
    } catch (error) {
        console.error('Initialization error:', error);
        showNotification('Failed to initialize platform', 'error');
    }
}

// Start on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

// ============================================
// TERMS & CONDITIONS TEXT (Full)
// ============================================

const FULL_TERMS = `
1. INTRODUCTION & ACCEPTANCE
Welcome to BeeEarn ("Platform"). By accessing, browsing, or using this website and all associated services, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions. If you do not agree to these terms, please discontinue your use immediately.

2. USER ELIGIBILITY
- Users must be at least 18 years of age (or the legal age of majority in their jurisdiction).
- Users must provide accurate, current, and complete information during registration.
- Users are responsible for maintaining the confidentiality of their login credentials.
- Each user may only maintain one active account.

3. ACCOUNT REGISTRATION & CREATION
- Users must complete the registration process by providing a valid email address, username, and password.
- Passwords must be at least 6 characters long and should contain a mix of letters and numbers for security.
- Users agree not to share their account credentials with third parties.
- BeeEarn reserves the right to terminate accounts that violate these terms.

4. EARNINGS MECHANISM
- Users earn money by clicking on advertisements displayed on the platform.
- Earnings per click range from $0.04 USD to $0.13 USD.
- The exact earning amount for each click is randomly generated by the system.
- Users are limited to a maximum of 12 clicks per day (24-hour period).
- Daily click limits reset at 00:00 UTC.
- Only registered and logged-in users can view ads and earn money.
- Fraudulent clicks, automated bots, or any form of click manipulation will result in immediate account termination and forfeiture of earnings.

5. ADVERTISEMENT TYPES
- BeeEarn displays two types of advertisements: Social Ads and Adult Ads.
- Users can select their preferred ad category before viewing.
- Selection of Adult Ads means the user will primarily be shown adult-oriented content.
- Selection of Social Ads means the user will primarily be shown socially-appropriate content.
- Users can switch between ad types at any time.
- BeeEarn is not responsible for the content of third-party advertisements.

6. PAYMENT & WITHDRAWAL
- Payments are processed monthly on the 1st of every month at 00:00 UTC.
- Three payment methods are available: PayPal, Bitcoin, and USDC (USD Coin).

PAYMENT METHOD DETAILS:
  PayPal: Minimum $50 USD with a fixed $1 fee per transaction.
  Bitcoin: Minimum $65 USD with 0% platform fee (Blockchain network fees apply).
  USDC: Minimum $65 USD with 0% platform fee (Blockchain network fees apply).

- Users can only request withdrawal if their balance meets the minimum threshold for their chosen payment method.
- Withdrawal requests submitted before the 1st of the month will be processed on the 1st.
- Processing times depend on the selected payment method and third-party processors.
- BeeEarn is not responsible for delays caused by payment processors or blockchain networks.
- Withdrawn funds are final; cancellations cannot be made once processed.

7. DATA STORAGE & PRIVACY
- User data, account information, and earnings records are stored locally on the user's device using IndexedDB.
- BeeEarn does not operate a centralized server for data storage.
- Users are responsible for backing up their device and browser data.
- BeeEarn is not responsible for data loss due to device malfunction, browser cache clearing, or device reset.
- Cookie and local storage data may be cleared by the browser or user; BeeEarn recommends regular backups.

8. SESSION MANAGEMENT & SECURITY
- User sessions automatically expire 6 hours after the last login.
- Users must log in again after session expiration to access their account and view advertisements.
- Session expiration is a security measure to protect account integrity.
- Multiple simultaneous logins on different devices are not permitted.
- Users are responsible for logging out on shared or public devices.

9. PROHIBITED ACTIVITIES
Users agree NOT to:
- Use automated scripts, bots, or software to generate fraudulent clicks.
- Click the same advertisement repeatedly without genuine interest.
- Use proxies, VPNs, or other methods to bypass daily click limits or geographic restrictions.
- Share, sell, or transfer their account to another person.
- Engage in any form of hacking, phishing, or unauthorized access.
- Interfere with the platform's normal operation or security.
- Create multiple accounts to circumvent earning limits.
- Click on ads with the sole intention of earning without legitimate interest in the advertised content.
- Engage in any illegal activity or activity that violates local, state, or federal laws.

Violation of these prohibitions will result in immediate account suspension and forfeiture of all earnings.

10. TERMINATION & ACCOUNT CLOSURE
- BeeEarn reserves the right to terminate any account at its sole discretion.
- Accounts may be terminated for violations of these Terms and Conditions.
- Upon termination, all earned funds may be forfeited.
- Users may request account closure by contacting support.
- Closed accounts cannot be reactivated.

11. LIABILITY & DISCLAIMERS
- The Platform is provided "as-is" without warranties of any kind.
- BeeEarn is not liable for loss of earnings due to technical issues, browser crashes, or device malfunctions.
- BeeEarn does not guarantee specific earnings or minimum income.
- Users acknowledge that cryptocurrency and digital payments carry inherent risks.
- BeeEarn is not responsible for fluctuations in cryptocurrency exchange rates.
- Third-party payment processors (PayPal, Bitcoin, USDC networks) operate independently; BeeEarn is not liable for their actions.

12. INTELLECTUAL PROPERTY
- All content, design, and branding on the Platform are owned by BeeEarn.
- Users may not reproduce, distribute, or transmit any part of the Platform without permission.
- The BeeEarn logo, "EARN," and all associated trademarks are protected.

13. MODIFICATIONS TO TERMS
- BeeEarn reserves the right to modify these Terms and Conditions at any time.
- Changes will be effective immediately upon posting.
- Continued use of the Platform constitutes acceptance of modified terms.

14. GOVERNING LAW & JURISDICTION
- These Terms and Conditions are governed by applicable international law.
- Disputes arising from the use of BeeEarn shall be resolved through binding arbitration.
- Users waive the right to pursue legal action in court.

15. CONTACT & SUPPORT
- For questions or concerns regarding these Terms and Conditions, please contact support.
- BeeEarn is committed to resolving disputes fairly and promptly.

16. SEVERABILITY
- If any provision of these Terms and Conditions is deemed invalid or unenforceable, the remaining provisions shall continue in full force and effect.

17. ENTIRE AGREEMENT
- These Terms and Conditions constitute the entire agreement between the user and BeeEarn.
- No prior understandings or agreements, whether written or oral, shall supersede these terms.

ACKNOWLEDGMENT:
By clicking "Join" or "Create Account," you confirm that you have read, understood, and agree to be bound by all terms and conditions outlined above.

Last Updated: 2026
BeeEarn - Premium Ad Monetization Platform
`;

// Populate terms text
window.addEventListener('DOMContentLoaded', () => {
    const termsTextDiv = document.querySelector('.terms-text');
    if (termsTextDiv && !termsTextDiv.textContent.includes('ACKNOWLEDGMENT')) {
        termsTextDiv.innerHTML = FULL_TERMS.split('\n').map(line => {
            if (line.startsWith('##')) return `<h3>${line.replace('##', '')}</h3>`;
            if (line.startsWith('#')) return `<h2>${line.replace('#', '')}</h2>`;
            if (line) return `<p>${line}</p>`;
            return '';
        }).join('');
    }
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AUTH, EARNINGS, WITHDRAWAL, PAYMENT_METHODS };
}
