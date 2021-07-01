const web3 = require('./web3.js')()
const mongoose = require('./mongoose.js')

async function main() {
  await mongoose.connectDB()
  const res = await mongoose.Transfer.aggregate([
    {
      $group: {
        _id: { logIndex: '$logIndex', blockNumber: '$blockNumber' },
        dups: { $addToSet: '$_id' },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $project: { dups: { $slice: ['$dups', 1, { $subtract: [{ $size: '$dups' }, 1] }] } } },
    { $unwind: '$dups' },
    { $project: { _id: false, count: false } },
    { $group: { _id: null, dups: { $push: '$dups' } } }
  ])
  .allowDiskUse(true)
  console.log('res: ', res)
}

main().then(() => process.exit(0))
