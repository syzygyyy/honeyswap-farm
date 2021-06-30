module.exports = () => {
  require('dotenv').config()
  const Web3 = require('web3')

  return new Web3(new Web3.providers.WebsocketProvider(process.env.MATIC_PROVIDER))
  // return new Web3(new Web3.providers.HttpProvider('https://rpc.xdaichain.com/'))
}
