# Tap DAO — backend image
#
# One image serves two roles in the Compose stack:
#   • `app`     → runs `node server.js`, listens on $PORT (9200)
#   • `hardhat` → runs `npx hardhat node`, reachable only as http://hardhat:8545
#
# The RPC host always comes from RPC_URL, never from a hardcoded address.

FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx hardhat compile

# Only the API port is published to the host (on 127.0.0.1); the chain port
# stays on the internal Compose network.
EXPOSE 9200

CMD ["node", "server.js"]
