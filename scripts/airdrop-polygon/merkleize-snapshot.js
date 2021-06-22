const web3 = require('./web3.js')()
const fs = require('fs')
const { createTree, createProof } = require('./merkle.js')
const BN = require('bn.js')

const INPUT_SNAPSHOT = './raw-snapshot.json'
const OUTPUT_SNAPSHOT = './airdrop-snapshot.json'
const testAddress = '0x6fF546eC084962Ac2A7962b0f94d5f766e467aF4'

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
  let total = new BN('0')
  for (const [account, amount] of orderedSnapshot) {
    total = total.add(new BN(amount, 16))
    const xAmount = `0x${amount}` 
    const leaf = solidityKeccak256(
      { type: 'address', value: account },
      { type: 'uint256', value: xAmount}
    )
    merkleSnapshot.leaves.push(leaf)
    merkleSnapshot.accounts[account] = { amount, leaf, xAmount }
  }

  const tree = createTree(merkleSnapshot.leaves)
  const root = tree.getHexRoot()
  const cRoot = '0x1cbb34d2372574cd4cc3349d4773c8da7783de7cd9df4880c4364ec21219db31'
  console.log(`root (${root === cRoot}): `, root)
  merkleSnapshot.root = root

  //const testAddress = orderedSnapshot[Math.floor(orderedSnapshot.length * Math.random())][0]
  const testLeaf = merkleSnapshot.accounts[testAddress].leaf
  const proof = createProof(merkleSnapshot, testAddress)
  if (!verifyMerkle(proof, root, testLeaf)) {
    throw new Error('Could not verify a merkleproof')
  }

  console.log('testAddress: ', testAddress)
  console.log('testLeaf: ', testLeaf)
  console.log('merkleSnapshot.accounts[testAddress].amount: ', merkleSnapshot.accounts[testAddress].amount)
  console.log('merkleSnapshot.accounts[testAddress].xAmount: ', merkleSnapshot.accounts[testAddress].xAmount)
  console.log('verified:', verifyMerkle(proof, root, merkleSnapshot.accounts[testAddress].leaf))
  console.log(`\nproof: [${proof.join(',')}]`)

  fs.writeFileSync(OUTPUT_SNAPSHOT, JSON.stringify(merkleSnapshot), 'utf8')
  console.log('\ntotal: ', total.toString())
}

main().then(() => process.exit(0))
