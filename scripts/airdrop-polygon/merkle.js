const { MerkleTree } = require('merkletreejs')
const keccak256 = require('keccak256')


function createTree(leaves) {
  const bufferedLeaves = leaves.map(leaf => Buffer.from(leaf.slice(2), 'hex'))
  return new MerkleTree(bufferedLeaves, keccak256, { sortPairs: true })
}

function createProof(snapshot, addr) {
  const account = snapshot.accounts[addr]
  if (account === undefined) return null
  const tree = createTree(snapshot.leaves)
  return tree.getHexProof(account.leaf)
}

module.exports = { createTree, createProof }
