const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("Deploying OffGridDAO...");

    const DAO = await hre.ethers.getContractFactory("OffGridDAO");
    const dao = await DAO.deploy();

    await dao.waitForDeployment();
    
    const contractAddress = await dao.getAddress();
    console.log(`\n🎉 OffGridDAO deployed to: ${contractAddress}\n`);

    const artifactPath = path.join(
        process.cwd(),
        'artifacts',
        'contracts',
        'OffGridDAO.sol',
        'OffGridDAO.json'
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const deploymentPayload = {
        contractName: 'OffGridDAO',
        contractAddress,
        abi: artifact.abi,
        deployedAt: new Date().toISOString(),
    };
    
    const addressFilePath = process.env.ADDRESS_FILE || path.join(process.cwd(), 'address.json');
    fs.mkdirSync(path.dirname(addressFilePath), { recursive: true });
    fs.writeFileSync(addressFilePath, JSON.stringify(deploymentPayload, null, 2));

    if (addressFilePath !== path.join(process.cwd(), 'address.json')) {
        fs.writeFileSync(path.join(process.cwd(), 'address.json'), JSON.stringify(deploymentPayload, null, 2));
    }

    // Allocate tokens to all known voter wallets
    console.log("Allocating initial tokens to voters...");
    
    // Hardhat Account #0 (Vaibhav Gupta / Admin)
    const tx1 = await dao.allocateTokens("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 1000);
    await tx1.wait();
    
    // Hardhat Account #1 (OG Pratyush Mehra)
    const tx2 = await dao.allocateTokens("0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1000);
    await tx2.wait();
    
    // Hardhat Account #2 (Suryansh Mishra)
    const tx3 = await dao.allocateTokens("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", 1000);
    await tx3.wait();

    console.log("✅ Tokens allocated!");
    console.log("Deployment complete. Add proposals from the dashboard UI!\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
