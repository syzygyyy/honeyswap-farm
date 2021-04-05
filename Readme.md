# Honey farming contracts

View this hack md file for an in-depth documentation: https://hackmd.io/BFrhyOTUQ3O9REs5PuZahQ?view

## Deploy procedure

1. Deploy xComb token (contracts/HSFToken.sol)
2. Take the nonce from the xComb deploy tx add two, then enter the deploy
   address and nonce into the `get-deterministic-addr.js` script as follows:
   `node scripts/get-deterministic-addr.js <addr> <nonce>`. Then approve that
   address to spend the tokens that will be distributed
3. Deploy the Farm (contracts/HoneyFarm.sol)
4. Deploy referral rewarder (contracts/ReferralRewarder.sol)
5. Transfer necessary xComb tokens to the referral rewarder
6. Transfer ownership of the referral rewarder to the farm contract
7. Set the referral rewarder address on the farm contract
