const { MerkleTree } = require('merkletreejs')
const keccak256 = require('keccak256')

function createTree(leaves) {
  const bufferedLeaves = leaves.map((leaf) => Buffer.from(leaf.slice(2), 'hex'))
  return new MerkleTree(bufferedLeaves, keccak256, { sortPairs: true })
}

function createProof(snapshot, addr) {
  const account = snapshot.accounts[addr]
  if (account === undefined) return null
  const tree = createTree(snapshot.leaves)
  if (tree.getHexRoot() !== snapshot.root) throw new Error('root mismatch')
  return tree.getHexProof(account.leaf)
}

/*
// how to claim (example code):

const addr = < user address >
const claimProof = createProof(snapshot, addr)
const recipient = < claim recipient >
claimerContract.claimTo(recipient, claimProof, snapshot.accounts[addr].amount)

// check if already claimed:
const addr = < claimer address >
const leaf = snapshot.accounts[addr].leaf
const alreadyClaimed = claimerContract.hasAlreadyClaimed(leaf)
*/

module.exports = { createTree, createProof }
