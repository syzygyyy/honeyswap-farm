const { web3, mainAddr } = require('./web3')()
const GovernanceWrapperData = require('../../build/contracts/GovernanceWrapper.json')
const addresses = require('../../addresses.json')
const { safeBN } = require('../../test/utils')(web3)

const INITIAL_POOLS = {
  '0xbf4e56921b55314ada601212b088e7489cca5893': [425, true],
  '0x1013ba833071Fd8AcA8Bf2AC83E5515c5fB9E76F': [25, false],
  '0x1fC4a2523349bD6Df30000b923BB1ACB3A27051F': [25, false],
  '0x0c787944946d22922C9f41C477CC539700d35bB2': [25, false]
  // '0xcb4794c90e47bee0d11027bdb8ebc5e1774ebad9': 300,
  // '0xeccfd2e27c58429153bb9229e55e4b3efc827d1f': 50,
  // '0xeae495187472b8db83cf9dc738ba3869fde5b1d3': 50,
  // '0x6d3842ab227a0436a6e8c459e93c74bd8c16fb34': 50,
  // '0xd862db749534d539713b2c392421fe5a8e43e19e': 50,
  // '0x1013ba833071fd8aca8bf2ac83e5515c5fb9e76f': 30,
  // '0x1fc4a2523349bd6df30000b923bb1acb3a27051f': 30,
  // '0x0c787944946d22922c9f41c477cc539700d35bb2': 30
}

const GAS_PRICE = '5000000000'

async function main() {
  console.log('addresses.polygon.governanceWrapper: ', addresses.polygon.governanceWrapper)
  const gov = new web3.eth.Contract(GovernanceWrapperData.abi, addresses.polygon.governanceWrapper)
  const pools = []
  const weights = []
  const isAdding = []
  for (const [pool, [weight, isAdd]] of Object.entries(INITIAL_POOLS)) {
    pools.push(pool)
    weights.push(safeBN(weight))
    isAdding.push(isAdd)
  }
  await gov.methods
    .modifyPools(pools, weights, isAdding)
    .send({ from: mainAddr, gas: 3000000, gasPrice: GAS_PRICE })
}

main().then(() => process.exit(0))
