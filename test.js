var pw = require('./index.js')

var w = pw.watch('tmp.js')
w.on(function (data) {
  console.log('modified: ' + data.path)
  console.log(data)
})
