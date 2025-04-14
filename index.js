require('dotenv').config();
const ethers = require('ethers');
const readline = require('readline');
const chalk = require('chalk');
const cliSpinners = require('cli-spinners');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs').promises;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const network = {
  name: 'Tea Sepolia Testnet 🌐',
  rpc: 'https://tea-sepolia.g.alchemy.com/public',
  chainId: 10218,
  symbol: 'TEA',
  explorer: 'https://sepolia.tea.xyz/'
};

const erc20ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

const stTeaABI = [
  'function stake() payable',
  'function balanceOf(address owner) view returns (uint256)',
  'function withdraw(uint256 _amount)'
];

const stTeaContractAddress = '0x04290DACdb061C6C9A0B9735556744be49A64012';

// Load configuration
let config;
async function loadConfig() {
  try {
    const data = await fs.readFile('config.json', 'utf8');
    config = JSON.parse(data);
    validateConfig();
    return config;
  } catch (error) {
    console.error(chalk.red('Error loading config.json:', error.message, '❌'));
    process.exit(1);
  }
}

function validateConfig() {
  if (!config.maxConcurrentThreads || typeof config.maxConcurrentThreads !== 'number' || config.maxConcurrentThreads < 1) {
    console.error(chalk.red('Invalid maxConcurrentThreads in config.json. Must be a positive number.'));
    process.exit(1);
  }
}

async function loadProxies() {
  try {
    const data = await fs.readFile('proxies.txt', 'utf8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line);
    if (proxies.length === 0) {
      console.log(chalk.yellow('No proxies found in proxies.txt. Running without proxy.'));
      return [];
    }
    return proxies;
  } catch (error) {
    console.error(chalk.red('Error reading proxies.txt:', error.message, '❌'));
    return [];
  }
}

async function loadWallets() {
  try {
    const data = await fs.readFile('private_keys.txt', 'utf8');
    const privateKeys = data.split('\n').map(line => line.trim()).filter(line => line);
    if (privateKeys.length === 0) {
      console.log(chalk.red('No private keys found in private_keys.txt. 🚫'));
      process.exit(1);
    }
    return privateKeys;
  } catch (error) {
    console.error(chalk.red('Error reading private_keys.txt:', error.message, '❌'));
    process.exit(1);
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function parseProxy(proxy) {
  if (!proxy) return null;
  let proxyUrl = proxy;
  if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
    proxyUrl = `http://${proxy}`;
  }
  return proxyUrl;
}

function showSpinner(message) {
  const spinner = cliSpinners.dots.frames;
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${chalk.yellow(message)} ${spinner[i++ % spinner.length]}`);
  }, 100);
  return () => {
    clearInterval(interval);
    process.stdout.write('\r');
  };
}

async function confirmTransaction(details) {
  console.log(chalk.white('┌─── Transaction Preview ───┐'));
  for (const [key, value] of Object.entries(details)) {
    console.log(chalk.white(`│ ${key.padEnd(10)} : ${chalk.cyan(value)}`));
  }
  console.log(chalk.white('└──────────────────────────┘'));
  return new Promise(resolve => {
    rl.question(chalk.yellow('Confirm transaction? (y/n): '), answer => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function displayBanner(provider) {
  try {
    const blockNumber = await provider.getBlockNumber();
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');
    const bannerText = `
${chalk.white('===============================================')}
${chalk.cyan('                TEA SEPOLIA AUTO BOT')}
${chalk.yellow('     Join Us: https://t.me/AirdropInsiderID ')}
${chalk.yellow(`        Block: ${blockNumber} | Gas: ${parseFloat(gasPriceGwei).toFixed(2)} Gwei `)}
${chalk.white('===============================================')}
    `;
    console.log(bannerText);
  } catch (error) {
    console.error(chalk.red('Error fetching network status:', error.message, '❌'));
    const bannerText = `
${chalk.white('===============================================')}
${chalk.cyan('                TEA SEPOLIA AUTO BOT')}
${chalk.yellow('     Join Us: https://t.me/AirdropInsiderID ')}
${chalk.yellow('     Network status unavailable')}
${chalk.white('===============================================')}
    `;
    console.log(bannerText);
  }
}

async function createProviders(proxies) {
  const providers = [];
  if (proxies.length === 0) {
    providers.push(new ethers.providers.JsonRpcProvider(network.rpc));
  } else {
    for (const proxy of proxies) {
      const proxyUrl = parseProxy(proxy);
      const agent = new HttpsProxyAgent(proxyUrl);
      const provider = new ethers.providers.JsonRpcProvider({
        url: network.rpc,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        agent
      });
      providers.push({ provider, proxy });
    }
  }
  return providers;
}

async function connectToNetwork() {
  try {
    const proxies = await loadProxies();
    const providers = await createProviders(proxies);
    const privateKeys = await loadWallets();
    const wallets = privateKeys.map(key => {
      const providerData = providers[0];
      return {
        wallet: new ethers.Wallet(key, providerData.provider),
        provider: providerData.provider,
        proxy: providerData.proxy || 'None'
      };
    });
    
    return { providers, wallets };
  } catch (error) {
    console.error(chalk.red('Connection error:', error.message, '❌'));
    process.exit(1);
  }
}

async function getWalletInfo(walletData, index) {
  const { wallet, provider, proxy } = walletData;
  const address = wallet.address;
  const teaBalance = await provider.getBalance(address).catch(() => ethers.BigNumber.from(0));
  const stTeaContract = new ethers.Contract(
    stTeaContractAddress,
    ['function balanceOf(address owner) view returns (uint256)'],
    wallet
  );
  const stTeaBalance = await stTeaContract.balanceOf(address).catch(() => ethers.BigNumber.from(0));
  
  console.log(chalk.white(`\n===== WALLET ${index + 1} INFORMATION =====`));
  console.log(chalk.white(`Address: ${chalk.cyan(address)} 👤`));
  console.log(chalk.white(`TEA Balance: ${chalk.cyan(ethers.utils.formatEther(teaBalance))} ${network.symbol} `));
  console.log(chalk.white(`stTEA Balance: ${chalk.cyan(ethers.utils.formatEther(stTeaBalance))} stTEA `));
  console.log(chalk.white(`Using proxy: ${chalk.cyan(proxy)} 🌐`));
  console.log(chalk.white('=============================\n'));
}

async function withTimeout(promise, timeoutMs, errorMessage) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function stakeTea(walletData, amount, providers) {
  const maxRetries = 3;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const { provider, proxy } = shuffleArray([...providers])[0];
      const wallet = walletData.wallet.connect(provider);
      const amountWei = ethers.utils.parseEther(amount.toString());
      const gasPrice = await provider.getGasPrice();
      const estimatedGas = 200000;
      const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas));
      
      const confirmed = await confirmTransaction({
        Action: 'Stake',
        Amount: `${amount} TEA`,
        'Est. Gas': `${gasCost} TEA`,
        Proxy: proxy || 'None'
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        console.log(chalk.white('===== STAKING CANCELED =====\n'));
        return null;
      }
      
      const stTeaContract = new ethers.Contract(stTeaContractAddress, stTeaABI, wallet);
      
      console.log(chalk.white('\n===== STAKING TEA ====='));
      console.log(chalk.yellow(`Staking ${amount} TEA for ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} using proxy ${proxy || 'None'}...`));
      
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const tx = await stTeaContract.stake({
        value: amountWei,
        gasLimit: estimatedGas,
        gasPrice,
        nonce
      });
      
      console.log(chalk.white(`Transaction sent! Hash: ${chalk.cyan(tx.hash)} 📤`));
      console.log(chalk.gray(`View on explorer: ${network.explorer}/tx/${tx.hash} 🔗`));
      
      const stopSpinner = showSpinner('Waiting for confirmation...');
      const receipt = await withTimeout(
        tx.wait(),
        60000,
        'Transaction confirmation timed out after 60 seconds'
      );
      stopSpinner();
      
      console.log(chalk.green(`Transaction confirmed in block ${receipt.blockNumber} ✅`));
      console.log(chalk.green(`Successfully staked ${amount} TEA! 🎉`));
      console.log(chalk.white('===== STAKING COMPLETED =====\n'));
      
      return receipt;
    } catch (error) {
      console.error(chalk.red(`Error staking TEA (attempt ${retry + 1}/${maxRetries + 1}): ${error.message} ❌`));
      if (retry < maxRetries && (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message.includes('timed out'))) {
        console.log(chalk.yellow('Retrying with a different proxy...'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.log(chalk.white('===== STAKING FAILED =====\n'));
      return null;
    }
  }
  return null;
}

async function withdrawTea(walletData, amount, providers) {
  const maxRetries = 3;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const { provider, proxy } = shuffleArray([...providers])[0];
      const wallet = walletData.wallet.connect(provider);
      const amountWei = ethers.utils.parseEther(amount.toString());
      const gasPrice = await provider.getGasPrice();
      const estimatedGas = 100000;
      const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas));
      
      const confirmed = await confirmTransaction({
        Action: 'Withdraw',
        Amount: `${amount} stTEA`,
        'Est. Gas': `${gasCost} TEA`,
        Proxy: proxy || 'None'
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        console.log(chalk.white('===== WITHDRAW CANCELED =====\n'));
        return null;
      }
      
      const stTeaContract = new ethers.Contract(stTeaContractAddress, stTeaABI, wallet);
      
      console.log(chalk.white('\n===== WITHDRAWING TEA ====='));
      console.log(chalk.yellow(`Withdrawing ${amount} stTEA for ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} using proxy ${proxy || 'None'}...`));
      
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const tx = await stTeaContract.withdraw(amountWei, {
        gasLimit: estimatedGas,
        gasPrice,
        nonce
      });
      
      console.log(chalk.white(`Transaction sent! Hash: ${chalk.cyan(tx.hash)} 📤`));
      console.log(chalk.gray(`View on explorer: ${network.explorer}/tx/${tx.hash} 🔗`));
      
      const stopSpinner = showSpinner('Waiting for confirmation...');
      const receipt = await withTimeout(
        tx.wait(),
        60000,
        'Transaction confirmation timed out after 60 seconds'
      );
      stopSpinner();
      
      console.log(chalk.green(`Transaction confirmed in block ${receipt.blockNumber} ✅`));
      console.log(chalk.green(`Successfully withdrawn ${amount} stTEA! 🎉`));
      console.log(chalk.white('===== WITHDRAW COMPLETED =====\n'));
      
      return receipt;
    } catch (error) {
      console.error(chalk.red(`Error withdrawing TEA (attempt ${retry + 1}/${maxRetries + 1}): ${error.message} ❌`));
      if (retry < maxRetries && (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message.includes('timed out'))) {
        console.log(chalk.yellow('Retrying with a different proxy...'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.log(chalk.white('===== WITHDRAW FAILED =====\n'));
      return null;
    }
  }
  return null;
}

async function claimRewards(walletData, providers) {
  const maxRetries = 3;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const { provider, proxy } = shuffleArray([...providers])[0];
      const wallet = walletData.wallet.connect(provider);
      console.log(chalk.white('\n===== CLAIMING REWARDS ====='));
      console.log(chalk.yellow(`Claiming stTEA rewards for ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} using proxy ${proxy || 'None'}...`));
      
      const data = "0x3d18b912";
      const gasPrice = await provider.getGasPrice();
      const estimatedGas = 100000;
      const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas));
      
      const confirmed = await confirmTransaction({
        Action: 'Claim Rewards',
        'Est. Gas': `${gasCost} TEA`,
        Proxy: proxy || 'None'
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        console.log(chalk.white('===== CLAIM CANCELED =====\n'));
        return null;
      }
      
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const tx = await wallet.sendTransaction({
        to: stTeaContractAddress,
        data: data,
        gasLimit: estimatedGas,
        gasPrice,
        nonce
      });
      
      console.log(chalk.white(`Transaction sent! Hash: ${chalk.cyan(tx.hash)} 📤`));
      console.log(chalk.gray(`View on explorer: ${network.explorer}/tx/${tx.hash} 🔗`));
      
      const stopSpinner = showSpinner('Waiting for confirmation...');
      const receipt = await withTimeout(
        tx.wait(),
        60000,
        'Transaction confirmation timed out after 60 seconds'
      );
      stopSpinner();
      
      console.log(chalk.green(`Transaction confirmed in block ${receipt.blockNumber} ✅`));
      console.log(chalk.green('Successfully claimed rewards! 🎉'));
      console.log(chalk.white('===== CLAIMING COMPLETED =====\n'));
      
      const balance = await provider.getBalance(wallet.address);
      console.log(chalk.white(`Updated TEA Balance: ${chalk.cyan(ethers.utils.formatEther(balance))} ${network.symbol} 💰`));
      
      return receipt;
    } catch (error) {
      console.error(chalk.red(`Error claiming rewards (attempt ${retry + 1}/${maxRetries + 1}): ${error.message} ❌`));
      if (retry < maxRetries && (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message.includes('timed out'))) {
        console.log(chalk.yellow('Retrying with a different proxy...'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.log(chalk.white('===== CLAIMING FAILED =====\n'));
      return null;
    }
  }
  return null;
}

function generateRandomAddress() {
  const wallet = ethers.Wallet.createRandom();
  return wallet.address;
}

async function sendToRandomAddress(walletData, amount, providers, skipConfirmation = false, retryCount = 0) {
  const maxRetries = 3;
  try {
    const { provider, proxy } = shuffleArray([...providers])[0];
    const wallet = walletData.wallet.connect(provider);
    const toAddress = generateRandomAddress();
    const amountWei = ethers.utils.parseEther(amount.toString());
    const gasPrice = await provider.getGasPrice();
    const estimatedGas = 21000;
    const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas));
    
    if (!skipConfirmation) {
      const confirmed = await confirmTransaction({
        Action: 'Transfer',
        Amount: `${amount} TEA`,
        To: toAddress.slice(0, 6) + '...' + toAddress.slice(-4),
        'Est. Gas': `${gasCost} TEA`,
        Proxy: proxy || 'None'
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        return null;
      }
    }
    
    console.log(chalk.yellow(`Sending ${amount} TEA to random address: ${chalk.cyan(toAddress)} from ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)} using proxy ${proxy || 'None'} 📤`));
    
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amountWei,
      gasLimit: estimatedGas,
      gasPrice,
      nonce
    });
    
    console.log(chalk.white(`Transaction sent! Hash: ${chalk.cyan(tx.hash)} 🚀`));
    console.log(chalk.gray(`View on explorer: ${network.explorer}/tx/${tx.hash} 🔗`));
    
    const stopSpinner = showSpinner('Waiting for confirmation...');
    const receipt = await withTimeout(
      tx.wait(),
      60000,
      'Transaction confirmation timed out after 60 seconds'
    );
    stopSpinner();
    
    console.log(chalk.green(`Transaction confirmed in block ${receipt.blockNumber} ✅`));
    
    return { receipt, toAddress };
  } catch (error) {
    console.error(chalk.red(`Error sending TEA (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message} ❌`));
    if (retryCount < maxRetries && (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message.includes('timed out'))) {
      console.log(chalk.yellow('Retrying with a different proxy...'));
      await new Promise(resolve => setTimeout(resolve, 1000));
      return sendToRandomAddress(walletData, amount, providers, skipConfirmation, retryCount + 1);
    }
    return null;
  }
}

async function executeRandomTransfers(wallets, amount, numberOfTransfers, providers, isDailyTask = false) {
  console.log(chalk.white('\n===== BATCH TRANSFER ====='));
  console.log(chalk.yellow(`Preparing ${numberOfTransfers} random transfers of ${amount} TEA each... 🚀`));
  
  if (!isDailyTask) {
    const walletCount = Array.isArray(wallets) ? wallets.length : 1;
    const gasPrice = await providers[0].provider.getGasPrice();
    const estimatedGas = 21000;
    const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas).mul(numberOfTransfers).mul(walletCount));
    
    const confirmed = await confirmTransaction({
      Action: 'Batch Transfer',
      'Total Amount': `${(amount * numberOfTransfers * walletCount).toFixed(4)} TEA`,
      Transfers: numberOfTransfers * walletCount,
      'Est. Gas': `${gasCost} TEA`,
      'Max Threads': config.maxConcurrentThreads
    });
    
    if (!confirmed) {
      console.log(chalk.red('Transaction canceled. 🚫'));
      console.log(chalk.white('===== BATCH TRANSFER CANCELED =====\n'));
      return [];
    }
  }
  
  console.log(chalk.yellow(`Starting ${numberOfTransfers} transfers per wallet...\n`));
  
  const results = [];
  
  // If wallets is an array (all wallets selected), process for each wallet
  if (Array.isArray(wallets)) {
    for (const walletData of wallets) {
      console.log(chalk.cyan(`\nProcessing transfers for wallet ${walletData.wallet.address.slice(0, 6)}...${walletData.wallet.address.slice(-4)}`));
      const queue = Array.from({ length: numberOfTransfers }, (_, i) => i);
      
      // Process transfers sequentially to avoid nonce issues
      for (const index of queue) {
        console.log(chalk.white(`\nTransfer ${index + 1}/${numberOfTransfers}`));
        const result = await sendToRandomAddress(walletData, amount, providers, true);
        if (result) {
          results.push(result);
        } else {
          console.log(chalk.yellow(`Skipping transfer ${index + 1} due to failure.`));
        }
      }
    }
  } else {
    // Single wallet case
    const queue = Array.from({ length: numberOfTransfers }, (_, i) => i);
    
    // Process transfers sequentially
    for (const index of queue) {
      console.log(chalk.white(`\nTransfer ${index + 1}/${numberOfTransfers}`));
      const result = await sendToRandomAddress(wallets, amount, providers, true);
      if (result) {
        results.push(result);
      } else {
        console.log(chalk.yellow(`Skipping transfer ${index + 1} due to failure.`));
      }
    }
  }
  
  console.log(chalk.green(`\nCompleted ${results.length}/${numberOfTransfers * (Array.isArray(wallets) ? wallets.length : 1)} transfers successfully. 🎉`));
  console.log(chalk.white('===== BATCH TRANSFER COMPLETED =====\n'));
  
  return results;
}

async function executeDailyTask(wallets, providers) {
  const amount = 0.0001;
  const numberOfTransfers = 100;
  const walletCount = Array.isArray(wallets) ? wallets.length : 1;
  
  console.log(chalk.white('\n===== DAILY TASK ====='));
  console.log(chalk.yellow(`Preparing daily task: ${numberOfTransfers} transfers of ${amount} TEA each for ${walletCount} wallet${walletCount > 1 ? 's' : ''}`));
  
  const gasPrice = await providers[0].provider.getGasPrice();
  const estimatedGas = 21000;
  const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas).mul(numberOfTransfers).mul(walletCount));
  
  const confirmed = await confirmTransaction({
    Action: 'Daily Task',
    'Total Amount': `${(amount * numberOfTransfers * walletCount).toFixed(4)} TEA`,
    Transfers: numberOfTransfers * walletCount,
    Wallets: walletCount,
    'Est. Gas': `${gasCost} TEA`
  });
  
  if (!confirmed) {
    console.log(chalk.red('Transaction canceled. 🚫'));
    console.log(chalk.white('===== DAILY TASK CANCELED =====\n'));
    return;
  }
  
  await executeRandomTransfers(wallets, amount, numberOfTransfers, providers, true);
  
  console.log(chalk.white('===== DAILY TASK COMPLETED =====\n'));
}

async function selectWallet(wallets, allowAll = false) {
  console.log(chalk.white('\n===== SELECT WALLET ====='));
  wallets.forEach((walletData, index) => {
    console.log(chalk.white(`${index + 1}. ${walletData.wallet.address.slice(0, 6)}...${walletData.wallet.address.slice(-4)}`));
  });
  if (allowAll) {
    console.log(chalk.white(`${wallets.length + 1}. All wallets`));
  }
  console.log(chalk.white('0. Back to main menu'));
  console.log(chalk.white('===================='));
  
  return new Promise(resolve => {
    rl.question(chalk.yellow(`\nSelect wallet number (0${allowAll ? `, ${wallets.length + 1} for all` : ''}): `), answer => {
      const index = parseInt(answer) - 1;
      if (answer === '0') {
        resolve(null);
      } else if (allowAll && parseInt(answer) === wallets.length + 1) {
        resolve(wallets);
      } else if (isNaN(index) || index < 0 || index >= wallets.length) {
        console.log(chalk.red('Invalid selection. Please try again. ⚠️'));
        resolve(selectWallet(wallets, allowAll));
      } else {
        resolve(wallets[index]);
      }
    });
  });
}

async function showMainMenu() {
  await loadConfig();
  const { providers, wallets } = await connectToNetwork();
  await displayBanner(providers[0].provider);
  
  for (let i = 0; i < wallets.length; i++) {
    await getWalletInfo(wallets[i], i);
  }
  
  console.log(chalk.white('\n===== MAIN MENU ====='));
  console.log(chalk.white('1. Send TEA to random addresses'));
  console.log(chalk.white('2. Stake TEA'));
  console.log(chalk.white('3. Claim rewards'));
  console.log(chalk.white('4. Withdraw stTEA'));
  console.log(chalk.white('5. Daily task (100 transfers of 0.0001 TEA)'));
  console.log(chalk.white('6. Exit'));
  console.log(chalk.white('===================='));
  
  rl.question(chalk.yellow('\nChoose an option (1-6): '), async (answer) => {
    if (answer === '6') {
      console.log(chalk.white('\n===== EXITING ====='));
      console.log(chalk.white('Thank you for using TEA BOT! 👋'));
      console.log(chalk.white('===================='));
      rl.close();
      process.exit(0);
    }
    
    const allowAll = true;
    const selectedWallets = await selectWallet(wallets, allowAll);
    
    if (!selectedWallets) {
      process.stdout.write('\x1Bc');
      console.clear();
      return showMainMenu();
    }
    
    switch (answer) {
      case '1':
        await handleRandomTransfers(selectedWallets, providers);
        break;
      case '2':
        await handleStaking(selectedWallets, providers);
        break;
      case '3':
        await handleClaiming(selectedWallets, providers);
        break;
      case '4':
        await handleWithdrawing(selectedWallets, providers);
        break;
      case '5':
        await handleDailyTask(selectedWallets, providers);
        break;
      default:
        console.log(chalk.red('Invalid option. Please try again. ⚠️'));
        await showMainMenu();
        break;
    }
  });
}

async function handleRandomTransfers(selectedWallets, providers) {
  console.log(chalk.white('\n===== RANDOM TRANSFERS ====='));
  rl.question(chalk.yellow('Enter amount of TEA to send in each transfer: '), async (amountStr) => {
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount) || amount <= 0) {
      console.log(chalk.red('Invalid amount. Please enter a positive number. ⚠️'));
      return handleRandomTransfers(selectedWallets, providers);
    }
    
    rl.question(chalk.yellow('Enter number of transfers to make: '), async (countStr) => {
      const count = parseInt(countStr);
      
      if (isNaN(count) || count <= 0) {
        console.log(chalk.red('Invalid count. Please enter a positive integer. ⚠️'));
        return handleRandomTransfers(selectedWallets, providers);
      }
      
      await executeRandomTransfers(selectedWallets, amount, count, providers);
      
      rl.question(chalk.yellow('\nPress Enter to return to the main menu...'), async () => {
        process.stdout.write('\x1Bc');
        console.clear();
        await showMainMenu();
      });
    });
  });
}

async function handleStaking(selectedWallets, providers) {
  console.log(chalk.white('\n===== STAKING ====='));
  rl.question(chalk.yellow('Enter amount of TEA to stake: '), async (amountStr) => {
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount) || amount <= 0) {
      console.log(chalk.red('Invalid amount. Please enter a positive number. ⚠️'));
      return handleStaking(selectedWallets, providers);
    }
    
    if (Array.isArray(selectedWallets)) {
      const walletCount = selectedWallets.length;
      const gasPrice = await providers[0].provider.getGasPrice();
      const estimatedGas = 200000;
      const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas).mul(walletCount));
      
      const confirmed = await confirmTransaction({
        Action: 'Stake',
        'Total Amount': `${(amount * walletCount).toFixed(4)} TEA`,
        Wallets: walletCount,
        'Est. Gas': `${gasCost} TEA`
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        console.log(chalk.white('===== STAKING CANCELED =====\n'));
        return;
      }
      
      for (const walletData of selectedWallets) {
        console.log(chalk.cyan(`\nProcessing staking for wallet ${walletData.wallet.address.slice(0, 6)}...${walletData.wallet.address.slice(-4)}`));
        await stakeTea(walletData, amount, providers);
      }
    } else {
      await stakeTea(selectedWallets, amount, providers);
    }
    
    rl.question(chalk.yellow('\nPress Enter to return to the main menu...'), async () => {
      process.stdout.write('\x1Bc');
      console.clear();
      await showMainMenu();
    });
  });
}

async function handleWithdrawing(selectedWallets, providers) {
  console.log(chalk.white('\n===== WITHDRAWING ====='));
  rl.question(chalk.yellow('Enter amount of stTEA to withdraw: '), async (amountStr) => {
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount) || amount <= 0) {
      console.log(chalk.red('Invalid amount. Please enter a positive number. ⚠️'));
      return handleWithdrawing(selectedWallets, providers);
    }
    
    if (Array.isArray(selectedWallets)) {
      const walletCount = selectedWallets.length;
      const gasPrice = await providers[0].provider.getGasPrice();
      const estimatedGas = 100000;
      const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas).mul(walletCount));
      
      const confirmed = await confirmTransaction({
        Action: 'Withdraw',
        'Total Amount': `${(amount * walletCount).toFixed(4)} stTEA`,
        Wallets: walletCount,
        'Est. Gas': `${gasCost} TEA`
      });
      
      if (!confirmed) {
        console.log(chalk.red('Transaction canceled. 🚫'));
        console.log(chalk.white('===== WITHDRAW CANCELED =====\n'));
        return;
      }
      
      for (const walletData of selectedWallets) {
        console.log(chalk.cyan(`\nProcessing withdrawal for wallet ${walletData.wallet.address.slice(0, 6)}...${walletData.wallet.address.slice(-4)}`));
        await withdrawTea(walletData, amount, providers);
      }
    } else {
      await withdrawTea(selectedWallets, amount, providers);
    }
    
    rl.question(chalk.yellow('\nPress Enter to return to the main menu...'), async () => {
      process.stdout.write('\x1Bc');
      console.clear();
      await showMainMenu();
    });
  });
}

async function handleClaiming(selectedWallets, providers) {
  console.log(chalk.white('\n===== CLAIMING ====='));
  if (Array.isArray(selectedWallets)) {
    const walletCount = selectedWallets.length;
    const gasPrice = await providers[0].provider.getGasPrice();
    const estimatedGas = 100000;
    const gasCost = ethers.utils.formatEther(gasPrice.mul(estimatedGas).mul(walletCount));
    
    const confirmed = await confirmTransaction({
      Action: 'Claim Rewards',
      Wallets: walletCount,
      'Est. Gas': `${gasCost} TEA`
    });
    
    if (!confirmed) {
      console.log(chalk.red('Transaction canceled. 🚫'));
      console.log(chalk.white('===== CLAIM CANCELED =====\n'));
      return;
    }
    
    for (const walletData of selectedWallets) {
      console.log(chalk.cyan(`\nProcessing claim for wallet ${walletData.wallet.address.slice(0, 6)}...${walletData.wallet.address.slice(-4)}`));
      await claimRewards(walletData, providers);
    }
  } else {
    await claimRewards(selectedWallets, providers);
  }
  
  rl.question(chalk.yellow('\nPress Enter to return to the main menu...'), async () => {
    process.stdout.write('\x1Bc');
    console.clear();
    await showMainMenu();
  });
}

async function handleDailyTask(selectedWallets, providers) {
  console.log(chalk.white('\n===== DAILY TASK ====='));
  await executeDailyTask(selectedWallets, providers);
  
  rl.question(chalk.yellow('\nPress Enter to return to the main menu...'), async () => {
    process.stdout.write('\x1Bc');
    console.clear();
    await showMainMenu();
  });
}

showMainMenu();

rl.on('close', () => {
  console.log(chalk.green('\nThank you for using TEA BOT! 👋'));
  process.exit(0);
});
