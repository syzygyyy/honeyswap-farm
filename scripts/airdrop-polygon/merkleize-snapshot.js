const web3 = require('./web3.js')()
const fs = require('fs')
const { createTree, createProof } = require('./merkle.js')

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


function hashTwo(a, b) {
  const [fst, snd] = a <= b ? [a, b] : [b, a]
  return solidityKeccak256(
    { type: 'bytes32', value: fst },
    { type: 'bytes32', value: snd }
  )
}

function verifyMerkle(proof, root, leaf) {
  return proof.reduce(hashTwo, leaf) === root
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(INPUT_SNAPSHOT, 'utf8'))
  const merkleSnapshot = {
    root: null,
    leaves: [],
    accounts: {}
  }
  const orderedSnapshot = Object.entries(snapshot)
  for (const [account, amount] of orderedSnapshot) {
    const packedData = solidityKeccak256(
      { type: 'address', value: account },
      { type: 'uint256', value: `0x${amount}` }
    )
    const leaf = web3.utils.sha3(packedData)
    merkleSnapshot.leaves.push(leaf)
    merkleSnapshot.accounts[account] = { amount, leaf }
  }

  const tree = createTree(merkleSnapshot.leaves)
  const root = tree.getHexRoot()
  merkleSnapshot.root = root

  const testAddress = '0x25823C754327e7765149839ba7191Fe7E79ee909'
  const proof = createProof(merkleSnapshot, testAddress)
  if (!verifyMerkle(proof, root, merkleSnapshot.accounts[testAddress].leaf)) {
    throw new Error('Could not verify a merkleproof')
  }

  fs.writeFileSync(OUTPUT_SNAPSHOT, JSON.stringify(merkleSnapshot), 'utf8')
}

main().then(() => process.exit(0))
