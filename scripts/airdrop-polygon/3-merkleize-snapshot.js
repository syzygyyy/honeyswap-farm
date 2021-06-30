const web3 = require('./web3.js')()
const fs = require('fs')
const { createTree } = require('./merkle.js')
const BN = require('bn.js')

const INPUT_SNAPSHOT = './raw-snapshot.json'
const OUTPUT_SNAPSHOT = './airdrop-snapshot.json'

function solidityKeccak256(...args) {
  const types = []
  const values = []
  for (const { type, value } of args) {
    types.push(type)
    values.push(value)
  }
  return web3.utils.sha3(web3.eth.abi.encodeParameters(types, values))
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(INPUT_SNAPSHOT, 'utf8'))
  const merkleSnapshot = {
    root: null,
    leaves: [],
    accounts: {}
  }
  const orderedSnapshot = Object.entries(snapshot)
  let total = new BN('0')
  for (const [account, amount] of orderedSnapshot) {
    total = total.add(new BN(amount, 16))
    const xAmount = `0x${amount}`
    const leaf = solidityKeccak256(
      { type: 'address', value: account },
      { type: 'uint256', value: xAmount }
    )
    merkleSnapshot.leaves.push(leaf)
    merkleSnapshot.accounts[account] = { amount, leaf, xAmount }
  }

  const tree = createTree(merkleSnapshot.leaves)
  const root = tree.getHexRoot()
  const cRoot = '0x1cbb34d2372574cd4cc3349d4773c8da7783de7cd9df4880c4364ec21219db31'
  console.log(`root (${root === cRoot}): `, root)
  merkleSnapshot.root = root

  fs.writeFileSync(OUTPUT_SNAPSHOT, JSON.stringify(merkleSnapshot), 'utf8')
  console.log('\ntotal: ', total.toString())
}

main().then(() => process.exit(0))
