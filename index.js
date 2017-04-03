var fs = require('fs')
var path = require('path')

var _mtimes = {} // file mtimes
var _files = {} // files being watched
var _intervals = {} // variable polling intervals
var _timeouts = {} // polling setTimeouts

var _watchers = {}
var _textContents = {} // TODO

var HOT_FILE = (1000 * 60 * 10) // 10 minutes in ms
var WARM_FILE = (1000 * 60 * 30) // 30 minutes in ms

var _errors = {}

var _enoents = {}
var MAX_ENOENTS = 25

function poll (filepath) {
  var mtime = _mtimes[filepath]

  fs.stat(filepath, function (err, stats) {
    if (err) {
      // increment error counter
      _errors[filepath] = (_errors[filepath] || 0) + 1

      switch (err.code) {
        case 'ENOENT': // file doesn't exist - probably locked/being modified
          _enoents[filepath] = (_enoents[filepath] || 0) + 1 // increment
          if (_enoents[filepath] < MAX_ENOENTS) { // retry very soon
            // console.log('ENOENT retry: ' + _enoents[filepath])
            clearTimeout(_timeouts[filepath])
            _timeouts[filepath] = setTimeout(function () {
              poll(filepath)
            }, 5)
          } else {
            throw new Error('Error! Max ENOENT retries: ' + _enoents[filepath])
          }
          break
        default:
          throw err
      }
      return undefined
    }

    _enoents[filepath] = 0 // successful read, clear ENOENTs

    if (stats.mtime > mtime) {
      _mtimes[filepath] = stats.mtime
      _watchers[filepath].emit()
    }

    // slow down or speed up the polling based on how actively
    // the file being watched is being modified
    var delta = Date.now() - stats.mtime
    if (delta < HOT_FILE) {
      if (_intervals[filepath] !== 33) {
        console.log('HOT FILE $fp'.replace('$fp', filepath))
        _intervals[filepath] = 33
      }
    } else if (delta < WARM_FILE) {
      if (_intervals[filepath] !== 99) {
        console.log('WARM FILE $fp'.replace('$fp', filepath))
        _intervals[filepath] = 99
      }
    } else {
      if (_intervals[filepath] !== 300) {
        console.log('COLD FILE $fp'.replace('$fp', filepath))
        _intervals[filepath] = 300
      }
    }

    // schedule next poll
    clearTimeout(_timeouts[filepath])
    _timeouts[filepath] = setTimeout(function () {
      poll(filepath)
    }, _intervals[filepath])
  })
}

function startPolling (filepath) {
  if (_timeouts[filepath] !== undefined) {
    throw new Error('Error! File is already being watched/polled.')
  }
  _mtimes[filepath] = 0
  _intervals[filepath] = 300
  _timeouts[filepath] = setTimeout(function () {
    poll(filepath)
  }, _intervals[filepath])
}

function createWatcher () {
  var _listeners = []
  function on (callback) {
    _listeners.push(callback)
    return function off () {
      var i = _listeners.indexOf(callback)
      return _listeners.splice(i, 1)
    }
  }

  function emit () {
    _listeners.forEach(function (callback) {
      callback()
    })
  }

  return {
    on: on,
    emit: emit
  }
}

function watch (filepath) {
  filepath = path.resolve(filepath) // resolve path
  // remove trailling path separators
  while (filepath[filepath.length - 1] === path.sep) filepath = filepath.slice(0, -1)

  // make sure file isn't already being watched
  if (_watchers[filepath] === undefined) {
    _watchers[filepath] = createWatcher(filepath)

    _files[filepath] = Date.now()

    if (/node_modules|^\.|[\/\\]\./i.test(filepath)) {
      console.log('warning: skipping node_modules or dotfile')
    } else {
      console.log('watching: $fp'.replace('$fp', filepath))
      startPolling(filepath)
    }
  } else { // TODO
    console.log('warning: $fp already being watched.'.replace('$fp', filepath))
  }

  return _watchers[filepath]
}

function clear () {
  Object.keys(_timeouts).forEach(function (filepath) {
    clearTimeout(_timeouts[filepath])
  })

  _mtimes = {} // file mtimes
  _files = {} // files being watched
  _intervals = {} // variable polling intervals
  _timeouts = {} // polling setTimeouts

  _textContents = {} // TODO
}

module.exports = {
  watch: watch,
  clear: clear
}
