module.exports = (web3, { solidityKeccak256 }) => {
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

  function createLeaf(addr, amount) {
    return solidityKeccak256(
      { type: 'address', value: addr },
      { type: 'uint256', value: amount}
    )
  }

  function createSnapshot(accounts) {
    const orderedAccounts = Object.entries(accounts)
    const newSnapshot = { root: null, leaves: [], accounts: {} }
    for (const [account, amount] of orderedAccounts) {
      const leaf = createLeaf(account, amount)
      newSnapshot.leaves.push(leaf)
      newSnapshot.accounts[account] = { amount, leaf }
    }
    const tree = createTree(newSnapshot.leaves)
    const root = tree.getHexRoot()
    newSnapshot.root = root

    return newSnapshot
  }

  return { createTree, createProof, hashTwo, verifyMerkle, createLeaf , createSnapshot }
}
