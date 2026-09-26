# Off-Grid DAO — Community Voting Kiosk

A decentralized, local-first Ethereum voting kiosk. This repository allows communities to run a completely local Ethereum Virtual Machine (EVM) to track secure, sybil-resistant votes using physical NFC transit cards mapped to cryptographic private keys.

---

## Architecture Overview
*   **Public API**: `https://tap-back.kiyoai.in` (Node.js + Express, published through a Cloudflare Tunnel)
*   **Public UI**: `https://tap.kiyoai.in` (React app served by nginx; the browser calls the API origin directly)
*   **Blockchain**: Hardhat node, reachable only inside the Compose network as `http://hardhat:8545`
*   **Smart Contract**: `OffGridDAO.sol` (Single-choice voting, strictly prevents double-voting)
*   **Backend / Bridge**: Node.js + Express (Wallet custodian mapping physical cards to private keys via Ethers.js)
*   **State**: `lib/jsonStore.js` persists cards, wallet slots, images, invites and sessions on a Docker volume

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
The API is now listening on **9200** (see `PORT` in `backend/.env.example`). In the
production topology it is reached through the tunnel as
**https://tap-back.kiyoai.in**, and the UI at **https://tap.kiyoai.in**.
Your dashboard is now live! Open your browser to **http://localhost:9201**

---

## 🐳 Run Everything with Docker

You can start the blockchain, deploy the contract, and launch the web server with one command:

```bash
docker compose up -d --build
```

This starts three services:
* `hardhat` runs the local Ethereum node, reachable only as `http://hardhat:8545`
* `deploy` compiles and deploys `OffGridDAO`, then writes the contract address to shared runtime storage
* `app` starts the Express API on `9200` after deployment is complete, published on `127.0.0.1` so only a host-level `cloudflared` can reach it

The API is then public at **https://tap-back.kiyoai.in** and the UI at
**https://tap.kiyoai.in**. Configuration comes from the root `.env`
(see `../.env.example`); `docker/docker-compose.yml` here is the backend-only
variant.
Open **http://localhost:9201** after the stack finishes starting.

---
## NFC Demonstration Workaround
### Setting up the iPhone NFC Shortcut

To use real physical NFC cards (like Metro cards) to trigger votes, configure an
iPhone automation that calls the **public** scan endpoint — the phone is
wireless, so it cannot reach a loopback address:

```
https://tap-back.kiyoai.in/scan?cardId=Metro_Card_001
```

Because the scan is triggered from the phone, the kiosk exchanges a single-use
claim for its own session (see "Shared-kiosk session isolation" in the root
README); the member's PIN is still required for balance, voting and proposals.
On a LAN-only setup (no tunnel) use the host's IP instead, e.g.
`http://192.168.1.15:9200/scan?cardId=Metro_Card_001`.

### 1. Configure the iPhone Shortcut
Open the **Shortcuts App** on the iPhone:
1. Go to **Automations** → **+** → **Create Personal Automation**
2. Choose **NFC** → **Scan** your Metro Card.
3. Add Action: **Get Contents of URL**
4. Set the URL to the public API origin and the scanning endpoint:
   ```
   https://tap-back.kiyoai.in/scan?cardId=Metro_Card_001
   ```
5. Uncheck "Ask before running" and hit Done!

### 2. Running the application
Open **https://tap.kiyoai.in**. When the screen says "Waiting for tap...", tap
the Metro Card to the iPhone. The phone notifies the API over the tunnel, the
kiosk signs the member in, and the vote is confirmed on screen instantly.
   http://192.168.1.15:9201/scan?cardId=Metro_Card_001
   ```
5. Uncheck "Ask before running" and hit Done!

### 3. Running the application
Now, open `http://localhost:9201` on the laptop. Click **+ Add Proposal**, create a project, and vote for it. When the screen says "Waiting for tap...", tap the Metro Card to your iPhone. The iPhone will ping the Ubuntu laptop over Wi-Fi, execute the secure Ethereum transaction, and visually confirm it on the  screen instantly! 
 http://192.168.1.15:9201/scan?cardId=Metro_Card_001
