require('dotenv').config();
const s = require('./services/proposalSummaryService');
console.log("API KEY: ", process.env.FEATHERLESS_API_KEY ? "EXISTS" : "MISSING");
s.generateProposalFromDescription('Fix the pot holes in street 5')
  .then(res => console.log("SUCCESS:", res))
  .catch(err => console.error("ERROR:", err));
