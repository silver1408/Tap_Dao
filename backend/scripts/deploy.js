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

    // Token allocation is now handled dynamically when cards are
    // registered via POST /register. No pre-allocated voters needed.

    console.log("✅ Deployment complete.");
    console.log("Voters will be allocated tokens when they register their NFC card.\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
