# Off-Grid DAO — Community Voting Kiosk

A decentralized, local-first Ethereum voting kiosk. This repository allows communities to run a completely local Ethereum Virtual Machine (EVM) to track secure, sybil-resistant votes using physical NFC transit cards mapped to cryptographic private keys.

---

## Architecture Overview
*   **Blockchain**: Hardhat Local Node (EVM running entirely on `localhost:8545`)
*   **Smart Contract**: `OffGridDAO.sol` (Single-choice voting, strictly prevents double-voting)
*   **Backend / Bridge**: Node.js + Express (Wallet custodian mapping physical cards to private keys via Ethers.js)
*   **Frontend**: Vanilla HTML/JS with Glassmorphism UI (Receives WebSocket updates from the backend)

---

## How to Run on Ubuntu Linux 

If you are cloning this repository on Ubuntu, follow these exact steps to run the local blockchain and server. **Note:** Node.js projects do not use `requirements.txt` like Python. Instead, the `package.json` file handles all dependencies automatically!

### Step 1: Install Dependencies
Open your Ubuntu terminal and make sure you have Node.js installed. Then install all project dependencies from the `package.json` file:
```bash
# If you don't have Node installed: sudo apt install nodejs npm
npm install
```

### Step 2: Start the Local Blockchain (Terminal 1)
Boot up the Hardhat EVM (Ethereum Virtual Machine). This will generate 20 default crypto accounts for testing.
```bash
npx hardhat node
```
*(Leave this terminal window open. This is your active blockchain.)*

### Step 3: Deploy the Smart Contract (Terminal 2)
Open a new terminal tab. Compile the Solidity code and deploy it to your local blockchain:
```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network localhost
```
*(This script will create `address.json` so the server knows where the contract lives).*

### Step 4: Start the Web Server (Terminal 2)
In that same second terminal window, start the Node.js bridge server:
```bash
node server.js
```
Your dashboard is now live! Open your browser to **http://localhost:3001**

---

## 🐳 Run Everything with Docker

You can start the blockchain, deploy the contract, and launch the web server with one command:

```bash
docker compose up -d --build
```

This starts three services:
* `hardhat` runs the local Ethereum node on `8545`
* `deploy` compiles and deploys `OffGridDAO`, then writes the contract address to shared runtime storage
* `app` starts the Express server on `3001` after deployment is complete

Open **http://localhost:3001** after the stack finishes starting.

---
## NFC Demonstration Workaround
### Setting up the iPhone NFC Shortcut

To use real physical NFC cards (like Metro cards) to trigger votes, you need to configure an iPhone automation. Because the phone is wireless, it cannot connect to `localhost`. It needs the **exact Local Wi-Fi IP Address** of the Ubuntu laptop running the server.

### 1. Find the Ubuntu Laptop's IP Address
On the Ubuntu machine, open a terminal and run:
```bash
hostname -I
```
*(Look for the number starting with `192.168.x.x` or `10.0.x.x`. Example: `192.168.1.15`)*

### 2. Configure the iPhone Shortcut
Make sure the iPhone and the Ubuntu laptop are connected to the exact same Wi-Fi network (or laptop hotspot). 
Open the **Shortcuts App** on iPhone:
1. Go to **Automations** → **+** → **Create Personal Automation**
2. Choose **NFC** → **Scan** your Metro Card.
3. Add Action: **Get Contents of URL**
4. Set the URL to your Ubuntu IP address plus port 3001 and the scanning endpoint. Example:
   ```
   http://192.168.1.15:3001/scan?cardId=Metro_Card_001
   ```
5. Uncheck "Ask before running" and hit Done!

### 3. Running the application
Now, open `http://localhost:3001` on the laptop. Click **+ Add Proposal**, create a project, and vote for it. When the screen says "Waiting for tap...", tap the Metro Card to your iPhone. The iPhone will ping the Ubuntu laptop over Wi-Fi, execute the secure Ethereum transaction, and visually confirm it on the  screen instantly! 
 http://192.168.1.15:3001/scan?cardId=Metro_Card_001
