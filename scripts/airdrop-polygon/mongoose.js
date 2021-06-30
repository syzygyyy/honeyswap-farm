const web3 = require('web3')
require('dotenv').config()

const mongoose = require('mongoose')
const { Schema } = mongoose

const connectDB = async () =>
  await mongoose.connect(process.env.DB_CONNECTION, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })

const isAddressValidator = () => ({
  validator: web3.utils.checkAddressChecksum,
  message: ({ value }) => `${value} is not a valid address`
})

const transferSchema = new Schema({
  blockNumber: Number,
  chain: String,
  transactionHash: {
    type: String,
    validate: {
      validator: (txId) => web3.utils.isHexStrict(txId) && txId.length === 66,
      message: ({ value }) => `${value} is not valid transaction id`
    }
  },
  logIndex: Number,
  pair: { type: String, validate: isAddressValidator() },
  from: { type: String, validate: isAddressValidator() },
  to: { type: String, validate: isAddressValidator() },
  value: String
})
const Transfer = mongoose.model('Transfer', transferSchema)

const ASCENDING = 1
const DESCENDING = -1

module.exports = {
  connectDB,
  Transfer,
  ASCENDING,
  DESCENDING
}
