// Call init to start the application
document.addEventListener('DOMContentLoaded', init);

// DOM Elements
const currentPriceElement = document.getElementById('current-price');
const refreshButton = document.getElementById('refresh-btn');
const analysisContent = document.getElementById('analysis-content');
const movingAverageElement = document.getElementById('moving-average');
const investButtons = document.querySelectorAll('.invest-btn');
const transactionContainer = document.getElementById('transaction-container');
const transactionStatus = document.getElementById('transaction-status');
const txModal = new bootstrap.Modal(document.getElementById('txModal'));
const modalMessage = document.getElementById('modal-message');
const connectWalletBtn = document.getElementById('connect-wallet');
const disconnectWalletBtn = document.getElementById('disconnect-wallet');
const walletStatusElement = document.getElementById('wallet-status');

// Web3 instance
let web3;

// API Endpoints
const API = {
  PRICE: '/api/fetchsonicprice',
  ANALYSIS: '/api/analyze',
  INVEST: '/api/invest',
  USER: '/api/user'  // New endpoint for user data operations
};

// Global state
let currentPrice = 0;
let currentAnalysis = null;
let walletAddress = null;
let chainId = null;

// Sonic Chain Configuration
const SONIC_CHAIN_ID = '57054'; // Sonic Chain ID in hex (decimal: 622)
const SONIC_CHAIN_CONFIG = {
  chainId: SONIC_CHAIN_ID,
  chainName: 'Sonic Chain',
  nativeCurrency: {
    name: 'Sonic',
    symbol: 'S',
    decimals: 18
  },
  rpcUrls: ['https://rpc.blaze.soniclabs.com'],
  blockExplorerUrls: ['https://explorer.blaze.soniclabs.com']
};

// Initialize the app
async function init() {
  await fetchPrice();
  await fetchAnalysis();
  setupEventListeners();
  checkWalletConnection();
}

// Check if wallet is already connected
async function checkWalletConnection() {
  if (window.ethereum) {
    try {
      // Initialize Web3
      web3 = new Web3(window.ethereum);
      
      // Check if accounts are already connected
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        handleAccountsChanged(accounts);
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  }
}

// Connect to Metamask wallet
async function connectWallet() {
  if (!window.ethereum) {
    alert('Please install MetaMask to use this feature');
    return;
  }

  try {
    // Initialize Web3
    web3 = new Web3(window.ethereum);
    
    // Request account access
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    handleAccountsChanged(accounts);
    
    // Check if connected to Sonic Chain
    await checkAndSwitchChain();
    
    // Create or update user in database
    await saveUserData();
    
    return true;
  } catch (error) {
    console.error('Error connecting to wallet:', error);
    walletStatusElement.innerHTML = `
      <div class="alert alert-danger">
        Failed to connect wallet: ${error.message}
      </div>
    `;
    return false;
  }
}

// Disconnect wallet
async function disconnectWallet() {
  // We can't force disconnect MetaMask, but we can reset the UI state
  walletAddress = null;
  updateWalletUI(false);
  
  // Clear the wallet status
  walletStatusElement.innerHTML = `
    <div class="alert alert-secondary">
      Wallet disconnected. Connect again to invest.
    </div>
  `;
  
  // Notify the user
  alert('Wallet disconnected from this site. Note that you may still be connected in your MetaMask extension.');
}

// Handle account changes
function handleAccountsChanged(accounts) {
  if (accounts.length === 0) {
    // Disconnected
    walletAddress = null;
    updateWalletUI(false);
  } else {
    // Connected
    walletAddress = accounts[0];
    updateWalletUI(true);
  }
}

// Check and switch to Sonic Chain if needed
async function checkAndSwitchChain() {
  try {
    // Get current chain ID
    chainId = await window.ethereum.request({ method: 'eth_chainId' });
    
    if (chainId !== SONIC_CHAIN_ID) {
      try {
        // Try to switch to Sonic Chain
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SONIC_CHAIN_ID }]
        });
      } catch (switchError) {
        // If chain hasn't been added to MetaMask
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SONIC_CHAIN_CONFIG]
          });
        } else {
          throw switchError;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error switching chain:', error);
    walletStatusElement.innerHTML = `
      <div class="alert alert-warning">
        Please switch to Sonic Chain in your wallet.
      </div>
    `;
    return false;
  }
}

// Update UI based on wallet connection status
function updateWalletUI(connected) {
  if (connected) {
    // Show disconnect button and update connect button
    connectWalletBtn.textContent = 'Wallet Connected';
    connectWalletBtn.classList.remove('btn-light', 'btn-primary');
    connectWalletBtn.classList.add('btn-success');
    connectWalletBtn.disabled = true;
    
    disconnectWalletBtn.classList.remove('d-none');
    
    walletStatusElement.innerHTML = `
      <div class="alert alert-success">
        <small>Connected Address: ${formatAddress(walletAddress)}</small>
        <small class="d-block mt-1">Network: Sonic Chain</small>
      </div>
    `;
    
    // Enable investment buttons
    investButtons.forEach(button => {
      button.disabled = false;
    });
  } else {
    // Hide disconnect button and reset connect button
    connectWalletBtn.textContent = 'Connect Wallet';
    connectWalletBtn.classList.remove('btn-success');
    connectWalletBtn.classList.add('btn-light');
    connectWalletBtn.disabled = false;
    
    disconnectWalletBtn.classList.add('d-none');
    
    walletStatusElement.innerHTML = `
      <div class="alert alert-secondary">
        Please connect your wallet to invest.
      </div>
    `;
    
    // Disable investment buttons
    investButtons.forEach(button => {
      button.disabled = true;
    });
  }
}

// Save user data to MongoDB
async function saveUserData() {
  if (!walletAddress) return;
  
  try {
    const response = await fetch(API.USER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        walletAddress,
        lastSeen: new Date().toISOString(),
        chainId
      })
    });
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('Error saving user data:', data.message);
    }
  } catch (error) {
    console.error('Error saving user data:', error);
  }
}

// Fetch current token price from connected wallet if possible
async function fetchPrice() {
  try {
    // Show loading state
    currentPriceElement.textContent = 'Fetching price...';
    currentPriceElement.classList.remove('text-danger');
    
    // First try to get price from API
    const response = await fetch(API.PRICE);
    const data = await response.json();
    
    if (data.success && data.price) {
      currentPrice = data.price;
      currentPriceElement.textContent = `$${data.price.toFixed(4)} USD`;
      
      // Update timestamp
      const timestamp = document.createElement('small');
      timestamp.className = 'text-muted d-block mt-1';
      timestamp.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
      
      // Replace or append timestamp
      const existingTimestamp = currentPriceElement.nextElementSibling;
      if (existingTimestamp && existingTimestamp.classList.contains('text-muted')) {
        existingTimestamp.replaceWith(timestamp);
      } else {
        currentPriceElement.after(timestamp);
      }
      
      return data.price;
    } else {
      throw new Error(data.message || 'Failed to fetch price');
    }
  } catch (error) {
    console.error('Error fetching price:', error);
    currentPriceElement.textContent = 'Error loading price';
    currentPriceElement.classList.add('text-danger');
    return null;
  }
}

// Fetch token analysis and recommendations
async function fetchAnalysis() {
  try {
    // Show loading state
    analysisContent.innerHTML = `
      <p class="text-center">
        <span class="spinner-border text-primary" role="status"></span><br>
        Analyzing market conditions...
      </p>
    `;
    
    const response = await fetch(API.ANALYSIS);
    const data = await response.json();
    
    if (data.success && data.analysis) {
      currentAnalysis = data.analysis;
      
      // Update the analysis content
      analysisContent.innerHTML = `
        <div class="alert alert-${getRiskAlertClass(data.analysis.riskLevel)}" role="alert">
          <h5 class="alert-heading">Risk Level: ${capitalizeFirstLetter(data.analysis.riskLevel)}</h5>
          <p>${data.analysis.recommendation}</p>
          <hr>
          <p class="mb-0">Suggested Investment: $${data.analysis.suggestedInvestment}</p>
        </div>
      `;
      
      // Update moving average display
      movingAverageElement.textContent = `7-Day Moving Average: $${data.analysis.movingAverage.toFixed(4)}`;
      
      // Highlight the recommended option
      highlightRecommendedOption(data.analysis.riskLevel);
    } else {
      throw new Error(data.message || 'Failed to analyze token');
    }
  } catch (error) {
    console.error('Error fetching analysis:', error);
    analysisContent.innerHTML = `
      <div class="alert alert-warning" role="alert">
        <p>Unable to generate investment analysis. Using default medium risk profile.</p>
      </div>
    `;
  }
}

// Process investment with wallet integration
async function processInvestment(amount, riskLevel) {
  // Check wallet connection first
  if (!walletAddress) {
    const connected = await connectWallet();
    if (!connected) {
      alert('Please connect your wallet to invest.');
      return;
    }
  }
  
  try {
    // Check chain connection
    const correctChain = await checkAndSwitchChain();
    if (!correctChain) return;
    
    // Show processing modal
    modalMessage.textContent = `Processing your $${amount} investment at ${riskLevel} risk level...`;
    txModal.show();
    
    const response = await fetch(API.INVEST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        amount, 
        riskLevel,
        walletAddress // Include wallet address with investment
      })
    });
    
    const data = await response.json();
    
    // Hide the modal
    txModal.hide();
    
    if (data.success) {
      // Show success message
      transactionContainer.classList.remove('d-none');
      transactionStatus.classList.remove('alert-danger');
      transactionStatus.classList.add('alert-success');
      transactionStatus.innerHTML = `
        <h5>Investment Successful!</h5>
        <p>You have invested $${amount} at ${riskLevel} risk level.</p>
        <p>Transaction Hash: <a href="https://explorer.blaze.soniclabs.com/tx/${data.transactionHash}" target="_blank">
          ${data.transactionHash.substring(0, 10)}...${data.transactionHash.substring(data.transactionHash.length - 8)}
        </a></p>
      `;
      
      // Update user investment history
      await updateUserInvestment(amount, riskLevel, data.transactionHash);
    } else {
      throw new Error(data.message || 'Transaction failed');
    }
  } catch (error) {
    console.error('Investment error:', error);
    
    // Hide the modal if still showing
    txModal.hide();
    
    // Show error message
    transactionContainer.classList.remove('d-none');
    transactionStatus.classList.remove('alert-success');
    transactionStatus.classList.add('alert-danger');
    transactionStatus.innerHTML = `
      <h5>Investment Failed</h5>
      <p>${error.message || 'An error occurred while processing your investment.'}</p>
      <p>Please try again later.</p>
    `;
  }
}

// Update user's investment history in MongoDB
async function updateUserInvestment(amount, riskLevel, transactionHash) {
  if (!walletAddress) return;
  
  try {
    const response = await fetch(`${API.USER}/investment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        walletAddress,
        investment: {
          amount,
          riskLevel,
          transactionHash,
          timestamp: new Date().toISOString(),
          tokenPrice: currentPrice
        }
      })
    });
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('Error updating investment history:', data.message);
    }
  } catch (error) {
    console.error('Error updating investment history:', error);
  }
}

// Helper Functions
function getRiskAlertClass(riskLevel) {
  switch (riskLevel) {
    case 'low': return 'success';
    case 'medium': return 'warning';
    case 'high': return 'danger';
    default: return 'info';
  }
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function highlightRecommendedOption(riskLevel) {
  // Remove existing recommended class
  document.querySelectorAll('.risk-card').forEach(card => {
    card.classList.remove('recommended');
  });
  
  // Add recommended class to the suggested risk level
  const recommendedCard = document.querySelector(`.risk-${riskLevel}`);
  if (recommendedCard) {
    recommendedCard.classList.add('recommended');
  }
}

// Format wallet address for display (0x1234...5678)
function formatAddress(address) {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Event Listeners
function setupEventListeners() {
  // Refresh button
  refreshButton.addEventListener('click', async () => {
    await fetchPrice();
    await fetchAnalysis();
  });
  
  // Connect wallet button
  connectWalletBtn.addEventListener('click', connectWallet);
  
  // Disconnect wallet button
  disconnectWalletBtn.addEventListener('click', disconnectWallet);
  
  // Investment buttons
  investButtons.forEach(button => {
    button.addEventListener('click', () => {
      const amount = parseInt(button.dataset.amount);
      const riskLevel = button.dataset.risk;
      
      if (confirm(`Confirm ${amount} investment at ${riskLevel} risk level?`)) {
        processInvestment(amount, riskLevel);
      }
    });
  });
  
  // Listen for account changes
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    
    // Listen for chain changes
    window.ethereum.on('chainChanged', () => {
      // Refresh the page on chain change
      window.location.reload();
    });
  }
}