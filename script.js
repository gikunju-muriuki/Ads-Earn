// ============================================
// BeeEarn - Premium Ad Earning Platform
// Script.js - Core Logic (Fixed & Complete)
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

let db = null;

// Initialize IndexedDB
function initializeDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB not supported'));
            return;
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('[DB] Error:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('[DB] Initialized successfully');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            console.log('[DB] Upgrading schema...');
            
            // Users store
            if (!dbInstance.objectStoreNames.contains(STORES.users)) {
                const userStore = dbInstance.createObjectStore(STORES.users, { keyPath: 'id', autoIncrement: true });
                userStore.createIndex('username', 'username', { unique: true });
                userStore.createIndex('email', 'email', { unique: true });
            }
            
            // Sessions store
            if (!dbInstance.objectStoreNames.contains(STORES.sessions)) {
                const sessionStore = dbInstance.createObjectStore(STORES.sessions, { keyPath: 'userId' });
                sessionStore.createIndex('isActive', 'isActive', { unique: false });
            }
            
            // Earnings store
            if (!dbInstance.objectStoreNames.contains(STORES.earnings)) {
                const earningsStore = dbInstance.createObjectStore(STORES.earnings, { keyPath: 'userId' });
            }
            
            // Withdrawals store
            if (!dbInstance.objectStoreNames.contains(STORES.withdrawals)) {
                dbInstance.createObjectStore(STORES.withdrawals, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// Database transaction helper
function dbTransaction(storeName, mode = 'readonly', callback) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);
            
            const request = callback(store);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            
            transaction.onerror = () => reject(transaction.error);
        } catch (error) {
            reject(error);
        }
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
            
            username = username.trim();
            email = email.trim().toLowerCase();
            
            if (username.length < 3) {
                throw new Error('Username must be at least 3 characters');
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
                createdAt: new Date().toISOString(),
                balance: 0,
                withdrawnAmount: 0,
                lastLogin: null,
                lastAdPreference: 'social'
            };
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.users], 'readwrite');
                const store = transaction.objectStore(STORES.users);
                const request = store.add(newUser);
                
                request.onsuccess = () => {
                    const userId = request.result;
                    this.initializeEarnings(userId);
                    resolve(userId);
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
            username = username.trim();
            const hashedPassword = await this.hashPassword(password);
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.users], 'readonly');
                const store = transaction.objectStore(STORES.users);
                const index = store.index('username');
                const request = index.get(username);
                
                request.onsuccess = () => {
                    const user = request.result;
                    
                    if (!user) {
                        reject(new Error('__USERNAME_NOT_FOUND__'));
                        return;
                    }
                    
                    // Compare password
                    if (user.password !== hashedPassword) {
                        reject(new Error('__PASSWORD_INCORRECT__'));
                        return;
                    }
                    
                    // Check session timeout
                    const now = Date.now();
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
                    
                    // Restore ad preference
                    const savedAdPref = localStorage.getItem(`adPref_${user.id}`);
                    if (savedAdPref) {
                        localStorage.setItem('currentAdPreference', savedAdPref);
                    } else {
                        localStorage.setItem('currentAdPreference', 'social');
                    }
                    
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
            try {
                const transaction = db.transaction([STORES.users], 'readwrite');
                const store = transaction.objectStore(STORES.users);
                const request = store.get(userId);
                
                request.onsuccess = () => {
                    const user = request.result;
                    user.lastLogin = new Date().toISOString();
                    store.put(user);
                    resolve();
                };
            } catch (error) {
                console.error('[Auth] Update last login error:', error);
                resolve();
            }
        });
    },
    
    setUserSession(userId) {
        try {
            localStorage.setItem('currentUserId', userId.toString());
            localStorage.setItem('sessionStartTime', Date.now().toString());
        } catch (error) {
            console.error('[Auth] Session storage error:', error);
        }
    },
    
    clearUserSession() {
        try {
            localStorage.removeItem('currentUserId');
            localStorage.removeItem('sessionStartTime');
            localStorage.removeItem('currentAdPreference');
        } catch (error) {
            console.error('[Auth] Clear session error:', error);
        }
    },
    
    isSessionValid() {
        try {
            const sessionStartTime = localStorage.getItem('sessionStartTime');
            if (!sessionStartTime) return false;
            
            const now = Date.now();
            const elapsed = now - parseInt(sessionStartTime, 10);
            
            if (elapsed >= this.sessionTimeout) {
                console.log('[Auth] Session expired after', Math.floor(elapsed / 1000 / 60), 'minutes');
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('[Auth] Session validation error:', error);
            return false;
        }
    },
    
    getCurrentUserId() {
        try {
            const userId = localStorage.getItem('currentUserId');
            return userId ? parseInt(userId, 10) : null;
        } catch (error) {
            console.error('[Auth] Get user ID error:', error);
            return null;
        }
    },
    
    initializeEarnings(userId) {
        try {
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
        } catch (error) {
            console.error('[Auth] Initialize earnings error:', error);
        }
    },
    
    async hashPassword(password) {
        try {
            // Simple hash (use bcrypt or proper crypto in production)
            return btoa(unescape(encodeURIComponent(password)));
        } catch (error) {
            console.error('[Auth] Password hash error:', error);
            throw error;
        }
    },
    
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    
    async logout() {
        try {
            this.currentUser = null;
            this.clearUserSession();
            showNotification('Logged out successfully', 'success');
        } catch (error) {
            console.error('[Auth] Logout error:', error);
        }
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
            try {
                const transaction = db.transaction([STORES.earnings], 'readwrite');
                const store = transaction.objectStore(STORES.earnings);
                const request = store.get(userId);
                
                request.onsuccess = () => {
                    const earnings = request.result;
                    
                    if (!earnings) {
                        reject(new Error('Earnings record not found'));
                        return;
                    }
                    
                    const today = new Date().toDateString();
                    
                    // Reset daily clicks if new day
                    if (earnings.lastClickDate !== today) {
                        earnings.dailyClicks = 0;
                        earnings.lastClickDate = today;
                    }
                    
                    // Check if max clicks reached
                    if (earnings.dailyClicks >= this.maxClicksPerDay) {
                        reject(new Error(`Maximum ${this.maxClicksPerDay} clicks per day reached. Reset at 00:00 UTC.`));
                        return;
                    }
                    
                    // Generate random earning
                    const earning = this.generateRandomEarning();
                    earnings.totalEarnings = parseFloat((earnings.totalEarnings + earning).toFixed(2));
                    earnings.clickCount += 1;
                    earnings.dailyClicks += 1;
                    
                    const updateRequest = store.put(earnings);
                    
                    updateRequest.onsuccess = () => {
                        resolve({
                            earning: earning,
                            totalEarnings: earnings.totalEarnings,
                            dailyClicks: earnings.dailyClicks
                        });
                    };
                    
                    updateRequest.onerror = () => reject(updateRequest.error);
                };
                
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    },
    
    generateRandomEarning() {
        const random = Math.random();
        const earning = random * (this.maxEarning - this.minEarning) + this.minEarning;
        return parseFloat(earning.toFixed(2));
    },
    
    async getBalance(userId) {
        return new Promise((resolve) => {
            try {
                const transaction = db.transaction([STORES.earnings], 'readonly');
                const store = transaction.objectStore(STORES.earnings);
                const request = store.get(userId);
                
                request.onsuccess = () => {
                    const earnings = request.result;
                    resolve(earnings ? earnings.totalEarnings : 0);
                };
                
                request.onerror = () => resolve(0);
            } catch (error) {
                console.error('[Earnings] Get balance error:', error);
                resolve(0);
            }
        });
    },
    
    async getEarningsData(userId) {
        return new Promise((resolve) => {
            try {
                const transaction = db.transaction([STORES.earnings], 'readonly');
                const store = transaction.objectStore(STORES.earnings);
                const request = store.get(userId);
                
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch (error) {
                console.error('[Earnings] Get earnings data error:', error);
                resolve(null);
            }
        });
    }
};

// ============================================
// WITHDRAWAL SYSTEM
// ============================================

const PAYMENT_METHODS = {
    paypal: { min: 50, fee: 1, currency: 'USD', name: 'PayPal' },
    bitcoin: { min: 65, fee: 0, currency: 'BTC', name: 'Bitcoin' },
    usdc: { min: 65, fee: 0, currency: 'USDC', name: 'USD Coin' }
};

const WITHDRAWAL = {
    async requestWithdrawal(userId, method, address) {
        try {
            if (!PAYMENT_METHODS[method]) {
                throw new Error('Invalid payment method');
            }
            
            if (!address || address.trim().length === 0) {
                throw new Error('Payment address is required');
            }
            
            const earnings = await EARNINGS.getEarningsData(userId);
            
            if (!earnings) {
                throw new Error('Earnings data not found');
            }
            
            const minAmount = PAYMENT_METHODS[method].min;
            const balance = earnings.totalEarnings - earnings.withdrawnAmount;
            
            if (balance < minAmount) {
                throw new Error(`Insufficient balance. Minimum $${minAmount} required for ${method.toUpperCase()}`);
            }
            
            const withdrawal = {
                userId,
                amount: balance,
                method,
                address: address.trim(),
                date: new Date().toISOString(),
                status: 'pending',
                processDate: this.getNextProcessDate(),
                fee: PAYMENT_METHODS[method].fee,
                amountAfterFee: balance - PAYMENT_METHODS[method].fee
            };
            
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORES.withdrawals, STORES.earnings], 'readwrite');
                const withdrawStore = transaction.objectStore(STORES.withdrawals);
                const earningsStore = transaction.objectStore(STORES.earnings);
                
                const withdrawRequest = withdrawStore.add(withdrawal);
                
                withdrawRequest.onsuccess = () => {
                    earnings.withdrawnAmount += withdrawal.amount;
                    const updateRequest = earningsStore.put(earnings);
                    
                    updateRequest.onsuccess = () => {
                        resolve({
                            id: withdrawRequest.result,
                            ...withdrawal
                        });
                    };
                    
                    updateRequest.onerror = () => reject(updateRequest.error);
                };
                
                withdrawRequest.onerror = () => reject(withdrawRequest.error);
            });
        } catch (error) {
            throw error;
        }
    },
    
    getNextProcessDate() {
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        nextMonth.setUTCHours(0, 0, 0, 0);
        return nextMonth.toISOString();
    },
    
    async getWithdrawalHistory(userId) {
        return new Promise((resolve) => {
            try {
                const transaction = db.transaction([STORES.withdrawals], 'readonly');
                const store = transaction.objectStore(STORES.withdrawals);
                const request = store.getAll();
                
                request.onsuccess = () => {
                    const withdrawals = request.result.filter(w => w.userId === userId);
                    resolve(withdrawals);
                };
                
                request.onerror = () => resolve([]);
            } catch (error) {
                console.error('[Withdrawal] Get history error:', error);
                resolve([]);
            }
        });
    }
};

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then((registration) => {
                console.log('[SW] Registered successfully:', registration);
                
                // Check for updates periodically
                setInterval(() => {
                    registration.update();
                }, 60000); // Every minute
            })
            .catch((error) => {
                console.warn('[SW] Registration failed:', error);
            });
    } else {
        console.warn('[SW] Service Workers not supported');
    }
}

// ============================================
// UI INTERACTION HANDLERS
// ============================================

// Join Modal Handler
document.getElementById('joinBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('joinModal').classList.remove('hidden');
    addRippleEffect(event.target);
});

document.getElementById('openTerms')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('termsModal').classList.remove('hidden');
});

document.getElementById('closeTerms')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('termsModal').classList.add('hidden');
});

document.getElementById('submitJoin')?.addEventListener('click', async (event) => {
    event.preventDefault();
    
    const email = document.getElementById('joinEmail')?.value || '';
    const username = document.getElementById('joinUser')?.value || '';
    const password = document.getElementById('joinPass')?.value || '';
    const agreeTerms = document.getElementById('agreeTerms')?.checked || false;
    
    if (!agreeTerms) {
        showNotification('Please agree to the terms and conditions', 'error');
        return;
    }
    
    try {
        const userId = await AUTH.register(email, username, password);
        showNotification('Account created successfully! Please log in.', 'success');
        document.getElementById('joinModal')?.classList.add('hidden');
        closeAllModals();
        clearJoinForm();
    } catch (error) {
        showNotification(error.message || 'Registration failed', 'error');
    }
});

// Login Modal Handler
document.getElementById('loginBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('loginModal').classList.remove('hidden');
    addRippleEffect(event.target);
});

document.getElementById('submitLogin')?.addEventListener('click', async (event) => {
    event.preventDefault();
    
    const username = document.getElementById('loginUser')?.value || '';
    const password = document.getElementById('loginPass')?.value || '';
    
    if (!username || !password) {
        showNotification('Please enter username and password', 'error');
        return;
    }
    
    try {
        const user = await AUTH.login(username, password);
        showNotification(`Welcome back, ${user.username}!`, 'success');
        document.getElementById('loginModal')?.classList.add('hidden');
        closeAllModals();
        updateDashboard();
        showDashboard();
        clearLoginForm();
    } catch (error) {
        let message = error.message || 'Login failed';
        
        if (message === '__USERNAME_NOT_FOUND__') {
            message = 'Username not found';
        } else if (message === '__PASSWORD_INCORRECT__') {
            message = 'Password is incorrect';
        }
        
        showNotification(message, 'error');
        console.error('[Auth] Login error:', message);
    }
});

// Logout Handler
document.getElementById('logoutBtn')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await AUTH.logout();
    hideDashboard();
    updateNavigation();
    addRippleEffect(event.target);
});

// Close Modal Handlers
document.querySelectorAll('.close-modal')?.forEach(btn => {
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        closeAllModals();
    });
});

// Close modals when clicking outside
document.querySelectorAll('.modal-overlay')?.forEach(overlay => {
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeAllModals();
        }
    });
});

// Ad Type Toggle - Social Ads
document.getElementById('showSocialBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    switchAds('social');
    saveAdPreference('social');
    document.getElementById('showSocialBtn')?.classList.add('active');
    document.getElementById('showAdultBtn')?.classList.remove('active');
    addRippleEffect(event.target);
});

// Ad Type Toggle - Adult Ads
document.getElementById('showAdultBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    switchAds('adult');
    saveAdPreference('adult');
    document.getElementById('showAdultBtn')?.classList.add('active');
    document.getElementById('showSocialBtn')?.classList.remove('active');
    addRippleEffect(event.target);
});

function saveAdPreference(preference) {
    try {
        const userId = AUTH.getCurrentUserId();
        if (userId) {
            localStorage.setItem(`adPref_${userId}`, preference);
            localStorage.setItem('currentAdPreference', preference);
        }
    } catch (error) {
        console.error('[UI] Save ad preference error:', error);
    }
}

// Ad Click Handler - Social Ads
document.getElementById('socialAdPlaceholder')?.addEventListener('click', (event) => {
    // Only trigger on actual placeholder click, not ad content
    if (event.target.id === 'socialAdPlaceholder' || event.target.classList.contains('ad-banner')) {
        event.preventDefault();
        handleAdClick();
    }
});

// Ad Click Handler - Adult Ads
document.getElementById('adultAdPlaceholder')?.addEventListener('click', (event) => {
    // Only trigger on actual placeholder click, not ad content
    if (event.target.id === 'adultAdPlaceholder' || event.target.classList.contains('ad-banner')) {
        event.preventDefault();
        handleAdClick();
    }
});

async function handleAdClick() {
    const userId = AUTH.getCurrentUserId();
    
    if (!userId) {
        showNotification('Please log in to earn', 'error');
        return;
    }
    
    if (!AUTH.isSessionValid()) {
        showNotification('Session expired. Please log in again.', 'error');
        await AUTH.logout();
        hideDashboard();
        updateNavigation();
        return;
    }
    
    try {
        const result = await EARNINGS.recordClick(userId);
        showNotification(`+$${result.earning.toFixed(2)} earned! (${result.dailyClicks}/${EARNINGS.maxClicksPerDay})`, 'success');
        updateEarningsDisplay();
        
        // Add click animation
        const adBanner = document.querySelector('.ad-banner:not(.hidden)');
        if (adBanner) {
            adBanner.style.animation = 'none';
            setTimeout(() => {
                adBanner.style.animation = 'pulse 0.5s ease';
            }, 10);
        }
        
        // Trigger ads reload (Adsterra will auto-refresh)
        if (window.adsbygoogle) {
            try {
                (adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
                console.log('[Ads] AdSense refresh skipped');
            }
        }
    } catch (error) {
        showNotification(error.message || 'Click failed', 'error');
    }
}

// Withdrawal Handler
document.getElementById('withdrawBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('withdrawModal')?.classList.remove('hidden');
    updateWithdrawModal();
    addRippleEffect(event.target);
});

document.querySelectorAll('.method-card')?.forEach(card => {
    card.addEventListener('click', (event) => {
        event.preventDefault();
        
        const method = card.dataset.method;
        const balance = parseFloat(document.getElementById('balanceDisplay')?.textContent?.replace('$', '') || '0');
        const minRequired = parseInt(card.dataset.min, 10);
        
        // Deselect all
        document.querySelectorAll('.method-card')?.forEach(c => c.classList.remove('selected'));
        
        if (balance >= minRequired) {
            card.classList.add('selected');
            document.getElementById('paymentDetails')?.classList.remove('hidden');
            
            const walletInput = document.getElementById('walletAddress');
            if (walletInput) {
                walletInput.placeholder = `Enter your ${PAYMENT_METHODS[method]?.name || method} address`;
                walletInput.dataset.method = method;
                walletInput.value = '';
            }
        } else {
            showNotification(`Insufficient balance. Minimum $${minRequired} required for ${PAYMENT_METHODS[method]?.name}.`, 'error');
            document.getElementById('paymentDetails')?.classList.add('hidden');
        }
        
        addRippleEffect(card);
    });
});

document.getElementById('confirmWithdraw')?.addEventListener('click', async (event) => {
    event.preventDefault();
    
    const userId = AUTH.getCurrentUserId();
    const selectedCard = document.querySelector('.method-card.selected');
    const method = selectedCard?.dataset?.method;
    const address = document.getElementById('walletAddress')?.value || '';
    
    if (!method) {
        showNotification('Please select a payment method', 'error');
        return;
    }
    
    if (!address || address.trim().length === 0) {
        showNotification('Please enter your payment address', 'error');
        return;
    }
    
    try {
        const withdrawal = await WITHDRAWAL.requestWithdrawal(userId, method, address);
        const processDate = new Date(withdrawal.processDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        showNotification(
            `Withdrawal of $${withdrawal.amountAfterFee.toFixed(2)} requested. Processing on ${processDate} (UTC)`,
            'success'
        );
        
        document.getElementById('withdrawModal')?.classList.add('hidden');
        closeAllModals();
        updateEarningsDisplay();
    } catch (error) {
        showNotification(error.message || 'Withdrawal request failed', 'error');
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
        
        if (!earnings) {
            console.warn('[UI] Earnings data not found');
            return;
        }
        
        const balance = earnings.totalEarnings - earnings.withdrawnAmount;
        
        const balanceDisplay = document.getElementById('balanceDisplay');
        const clicksDisplay = document.getElementById('clicksDisplay');
        
        if (balanceDisplay) {
            balanceDisplay.textContent = `$${balance.toFixed(2)}`;
        }
        
        if (clicksDisplay) {
            clicksDisplay.textContent = `${earnings.dailyClicks} / ${EARNINGS.maxClicksPerDay}`;
        }
    } catch (error) {
        console.error('[UI] Dashboard update error:', error);
    }
}

async function updateEarningsDisplay() {
    await updateDashboard();
}

function updateWithdrawModal() {
    const userId = AUTH.getCurrentUserId();
    EARNINGS.getBalance(userId).then(balance => {
        const modalBalance = document.getElementById('modalBalance');
        if (modalBalance) {
            modalBalance.textContent = `$${balance.toFixed(2)}`;
        }
    });
}

function showDashboard() {
    const dashboard = document.getElementById('dashboard');
    const hero = document.getElementById('hero');
    
    if (dashboard) dashboard.classList.remove('hidden');
    if (hero) hero.classList.add('hidden');
}

function hideDashboard() {
    const dashboard = document.getElementById('dashboard');
    const hero = document.getElementById('hero');
    
    if (dashboard) dashboard.classList.add('hidden');
    if (hero) hero.classList.remove('hidden');
}

function updateNavigation() {
    const userId = AUTH.getCurrentUserId();
    const loginBtn = document.getElementById('loginBtn');
    const joinBtn = document.getElementById('joinBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (userId) {
        if (loginBtn) loginBtn.classList.add('hidden');
        if (joinBtn) joinBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
    } else {
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (joinBtn) joinBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
    }
}

function switchAds(type) {
    const socialAd = document.getElementById('socialAdPlaceholder');
    const adultAd = document.getElementById('adultAdPlaceholder');
    
    if (type === 'social') {
        if (socialAd) {
            socialAd.classList.remove('hidden');
            // Reload social ad script
            reloadAdScript(socialAd);
        }
        if (adultAd) adultAd.classList.add('hidden');
    } else {
        if (socialAd) socialAd.classList.add('hidden');
        if (adultAd) {
            adultAd.classList.remove('hidden');
            // Reload adult ad script
            reloadAdScript(adultAd);
        }
    }
    
    // Save preference
    saveAdPreference(type);
}

function reloadAdScript(adContainer) {
    // Trigger Adsterra to reload ads in the container
    try {
        if (window.zergnet && typeof window.zergnet.zergnet_async_init === 'function') {
            window.zergnet.zergnet_async_init();
        }
        // Alternative for Adsterra
        if (window.adsterra && typeof window.adsterra === 'object') {
            console.log('[Ads] Reloading ad container');
        }
    } catch (e) {
        console.log('[Ads] Ad reload attempted');
    }
}

function clearJoinForm() {
    const joinEmail = document.getElementById('joinEmail');
    const joinUser = document.getElementById('joinUser');
    const joinPass = document.getElementById('joinPass');
    const agreeTerms = document.getElementById('agreeTerms');
    
    if (joinEmail) joinEmail.value = '';
    if (joinUser) joinUser.value = '';
    if (joinPass) joinPass.value = '';
    if (agreeTerms) agreeTerms.checked = false;
}

function clearLoginForm() {
    const loginUser = document.getElementById('loginUser');
    const loginPass = document.getElementById('loginPass');
    
    if (loginUser) loginUser.value = '';
    if (loginPass) loginPass.value = '';
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay')?.forEach(modal => {
        modal.classList.add('hidden');
    });
}

// ============================================
// CUSTOM NOTIFICATIONS
// ============================================

function showNotification(message, type = 'info') {
    try {
        const notificationArea = document.getElementById('notificationArea');
        if (!notificationArea) return;
        
        const toast = document.createElement('div');
        toast.className = 'notify-toast';
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        
        // Add type-specific styling
        if (type === 'success') {
            toast.style.borderLeftColor = '#4CAF50';
            toast.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
        } else if (type === 'error') {
            toast.style.borderLeftColor = '#FF6B6B';
            toast.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
        } else if (type === 'warning') {
            toast.style.borderLeftColor = '#FFD700';
            toast.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
        }
        
        notificationArea.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.5s ease forwards';
            setTimeout(() => {
                try {
                    toast.remove();
                } catch (e) {
                    console.error('[Notification] Remove error:', e);
                }
            }, 500);
        }, 5000);
    } catch (error) {
        console.error('[Notification] Show error:', error);
    }
}

// ============================================
// ANIMATIONS & EFFECTS
// ============================================

const animationStyles = document.createElement('style');
animationStyles.textContent = `
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
document.head.appendChild(animationStyles);

function addRippleEffect(element) {
    if (!element || !element.getBoundingClientRect) return;
    
    try {
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        
        const event = window.event;
        if (!event || !event.clientX) return;
        
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;
        
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        element.appendChild(ripple);
        
        setTimeout(() => {
            try {
                ripple.remove();
            } catch (e) {
                console.error('[Ripple] Remove error:', e);
            }
        }, 600);
    } catch (error) {
        console.error('[Ripple] Effect error:', error);
    }
}

// ============================================
// SESSION MANAGEMENT
// ============================================

function checkSessionValidity() {
    const userId = AUTH.getCurrentUserId();
    
    if (userId && !AUTH.isSessionValid()) {
        console.log('[Session] Invalid or expired');
        AUTH.logout();
        hideDashboard();
        updateNavigation();
        showNotification('Session expired. Please log in again.', 'error');
        return false;
    }
    
    return true;
}

// Check session every 30 seconds
const sessionCheckInterval = setInterval(() => {
    checkSessionValidity();
}, 30000);

// ============================================
// TERMS & CONDITIONS
// ============================================

const FULL_TERMS = `1. INTRODUCTION & ACCEPTANCE
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
- Ad preference is saved and restored on each login.
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

Last Updated: October 2026
BeeEarn - Premium Ad Monetization Platform`;

function populateTerms() {
    try {
        const termsTextDiv = document.querySelector('.terms-text');
        if (!termsTextDiv) return;
        
        if (termsTextDiv.children.length === 0) {
            const termsHTML = FULL_TERMS
                .split('\n\n')
                .map(paragraph => {
                    if (paragraph.startsWith('#')) {
                        const level = paragraph.match(/^#+/)[0].length;
                        const text = paragraph.replace(/^#+\s/, '');
                        return `<h${level + 1}>${text}</h${level + 1}>`;
                    }
                    return paragraph ? `<p>${paragraph}</p>` : '';
                })
                .join('');
            
            termsTextDiv.innerHTML = termsHTML;
        }
    } catch (error) {
        console.error('[Terms] Populate error:', error);
    }
}

// ============================================
// PAGE INITIALIZATION
// ============================================

async function initializePage() {
    try {
        console.log('[Init] Starting initialization...');
        
        await initializeDB();
        registerServiceWorker();
        populateTerms();
        
        // Check if user is already logged in
        const userId = AUTH.getCurrentUserId();
        if (userId && checkSessionValidity()) {
            console.log('[Init] User logged in, loading dashboard...');
            updateNavigation();
            showDashboard();
            updateDashboard();
            
        // Restore ad preference
        const savedAdPref = localStorage.getItem(`adPref_${userId}`) || 'social';
        switchAds(savedAdPref);
        
        // Update filter buttons UI
        if (savedAdPref === 'social') {
            document.getElementById('showSocialBtn')?.classList.add('active');
            document.getElementById('showAdultBtn')?.classList.remove('active');
        } else {
            document.getElementById('showAdultBtn')?.classList.add('active');
            document.getElementById('showSocialBtn')?.classList.remove('active');
        }
        
        console.log('[Init] Initialization complete');
    } catch (error) {
        console.error('[Init] Initialization error:', error);
        showNotification('Failed to initialize platform. Please refresh.', 'error');
    }
}

// Start on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePage);
} else {
    initializePage();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    clearInterval(sessionCheckInterval);
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AUTH, EARNINGS, WITHDRAWAL, PAYMENT_METHODS };
}

console.log('[BeeEarn] Script loaded and ready');
