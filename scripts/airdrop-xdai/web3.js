module.exports = () => {
  const Web3 = require('web3')
  return new Web3(new Web3.providers.WebsocketProvider('wss://rpc.xdaichain.com/wss'))
  // return new Web3(new Web3.providers.HttpProvider('https://rpc.xdaichain.com/'))
}
