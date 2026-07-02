require("dotenv").config();
const fmp = require("./src/fmpService");

async function runTest() {
  const testSymbol = "AAPL";
  const testDate = "2024-05-02"; // Known earnings date for Apple Q2 2024
  
  console.log(`Running checkEarningsForDate for ${testSymbol} on ${testDate}...`);
  const results = await fmp.checkEarningsForDate([testSymbol], testDate);
  
  console.log(`\n--- TEST RESULTS FOR ${testSymbol} ON ${testDate} ---`);
  console.log(JSON.stringify(results, null, 2));
}

runTest().catch(console.error);
